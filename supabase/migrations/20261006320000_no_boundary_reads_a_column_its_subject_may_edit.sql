-- NO BOUNDARY READS A COLUMN ITS SUBJECT MAY EDIT.
--
-- 20261006310000 took users.home_branch_id out of the four reach predicates
-- and put a guard on the column. Seven more functions were still reading it,
-- and a grep for the column is the only way any of them would have been
-- found: none of them is named for people or for scope.
--
-- Three kinds, and the second and third are worse than the reach predicates:
--
--   READS       origin_referencing_mode, origin_is_agent_estate and
--               referral_fee_preview each end their reach test with
--               `or b2.id = (select home_branch_id ... where id = auth.uid())`.
--               The two arms before it already answer for anybody with a
--               position, so this arm only ever spoke for somebody without
--               one -- and it is the arm they could move.
--
--   WRITES      create_referral and create_joint_referral decide which branch
--               you may FILE A REFERRAL against:
--                 case when app_has_scope() then p_branch in app_scope_branches()
--                      else p_branch = <your own home_branch_id> end
--               so the unpositioned case let the caller nominate the branch
--               and then satisfy the test with it. Replaced by
--               app_may_reach_branch, which keeps the positioned arm exactly
--               as strict and gives the supplier rail the same answer it has
--               today, via partner_can_reach_agency.
--
--   MONEY       commission_statement_party picks WHICH GROUP, BRAND OR BRANCH
--               a commission statement is drawn for, and its fourth and last
--               arm read home_branch_id. A payee could have moved their own
--               statement to another office's books.
--
-- Rewritten from pg_get_functiondef so only the arm changes. my_org_shape is
-- here too, to say its supplier case out loud instead of reaching it through
-- a bare `else true` under an authorisation test.

-- commission_statement_party(uuid)
CREATE OR REPLACE FUNCTION public.commission_statement_party(p_user uuid)
 RETURNS TABLE(level text, org_id uuid, org_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with cand as (
    select 1 as pri, 'group'::text as level, g.id, g.name
    from public.user_scopes s
    join public.agency_groups g on g.id = s.group_id
    where s.user_id = p_user and s.kind = 'group'
    union all
    select 2, 'agency', a.id, a.name
    from public.user_scopes s
    join public.agencies a on a.id = s.agency_id
    where s.user_id = p_user and s.kind = 'agency'
    union all
    select 3, 'branch', b.id, b.name
    from public.user_scopes s
    join public.branches b on b.id = s.branch_id
    where s.user_id = p_user and s.kind = 'branch'
    -- WAS a fourth arm here: "a negotiator holds no scope row at all, so their
    -- party is the branch they were invited into", reading users.home_branch_id.
    -- That routed a COMMISSION STATEMENT off a column its own subject could
    -- PATCH. Negotiators hold a branch position now (20261006300000), so arm 3
    -- answers for them and the money follows a position like everyone else's.
  )
  -- Qualified throughout: level, org_id and org_name are also this function's
  -- OUT columns, and an unqualified reference to one of them is a coin toss
  -- between the CTE's column and the output parameter.
  select c.level, c.id, c.name from cand c order by c.pri asc, c.name asc limit 1
$function$;

-- create_joint_referral(uuid,jsonb,text,text,text,text,text,numeric,date)
CREATE OR REPLACE FUNCTION public.create_joint_referral(p_branch uuid, p_tenants jsonb, p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text, p_rent numeric, p_tenancy_start date)
 RETURNS SETOF applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ag uuid; pid uuid; v_route uuid; v_mode text; v_portal_ok boolean; v_estate boolean;
  v_n int; v_pct numeric; v_fee numeric; v_basis numeric; v_basis_unit text; v_agreement uuid;
  v_tenancy uuid; t jsonb; v_share_pct numeric;
  v_pcts numeric[]; v_fees numeric[]; v_rents numeric[]; v_emails text[]; v_i int := 0;
  v_app public.applications;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  v_n := jsonb_array_length(p_tenants);
  if v_n is null or v_n < 2 then
    raise exception 'A joint tenancy needs at least two tenants.' using errcode = '22023';
  end if;

  select b.agency_id, b.partner_id into ag, pid from public.branches b where b.id = p_branch;
  if ag is null then raise exception 'Selected branch not found' using errcode = '22023'; end if;
  if not (public.is_admin()
          or (public.app_role() in ('management','referrer') and pid = public.app_partner())) then
    raise exception 'not permitted for this partner' using errcode = '42501';
  end if;

  v_route := public.resolve_route_partner(p_branch, null);
  select p.portal_referrals_enabled into v_portal_ok from public.partners p where p.id = v_route;
  if not found then raise exception 'Route partner not found' using errcode = '22023'; end if;
  v_mode := public.resolve_referencing_mode(p_branch, v_route);
  v_estate := public.is_agent_estate(p_branch, v_route);

  if not v_estate then
    raise exception 'A joint tenancy needs an agency of ours to sit under, and this referral comes from a partner who sends them one tenant at a time. Refer each tenant separately.'
      using errcode = '22023';
  end if;

  if not public.is_admin() then
    if not (case when public.app_has_scope()
                 then p_branch in (select public.app_scope_branches())
                 else public.app_may_reach_branch(p_branch) end) then
      raise exception 'You can only refer against a branch within your own scope.' using errcode = '42501';
    end if;
  end if;
  if not coalesce(v_portal_ok, true) then
    raise exception 'This partner does not create referrals in the portal.' using errcode = '42501';
  end if;

  select array_agg((x->>'share_percent')::numeric order by ord) into v_pcts
  from jsonb_array_elements(p_tenants) with ordinality as e(x, ord);
  select coalesce(sum(s), 0) into v_pct from unnest(v_pcts) s;
  if abs(v_pct - 100) > 0.01 then
    raise exception 'The tenants'' shares total %, not 100%%. Adjust them by %.',
      to_char(v_pct,'FM999990.00') || '%', to_char(100 - v_pct,'FM999990.00') || '%'
      using errcode = '22023';
  end if;

  select array_agg(lower(btrim(x->>'email'))) into v_emails from jsonb_array_elements(p_tenants) x;
  if (select count(distinct e) from unnest(v_emails) e) <> v_n then
    raise exception 'Two tenants have the same email address.' using errcode = '22023';
  end if;

  -- THE UNIT COMES OUT WITH THE QUANTITY. A basis of 1 recorded without it is
  -- one WEEK of rent, which is a quarter of what a one-month agreement charges.
  select f.fee_amount, f.fee_basis_weeks, f.fee_basis_unit, f.agreement_id
    into v_fee, v_basis, v_basis_unit, v_agreement
  from public.resolve_fee(p_branch, v_route, p_rent, v_n) f;
  v_fees  := public.apportion(v_fee, v_pcts);
  -- THE RENT, APPORTIONED THE SAME WAY AS THE FEE. Each tenant's deed covers
  -- this amount and the underwriter's premium is a percentage of it, so the
  -- parts must sum to the whole exactly, not to within a penny.
  v_rents := public.apportion(p_rent, v_pcts);

  insert into public.tenancies (monthly_rent, tenancy_start, prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode)
  values (p_rent, p_tenancy_start, btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')),''),
          btrim(p_city), nullif(btrim(coalesce(p_county,'')),''), upper(btrim(p_postcode)))
  returning id into v_tenancy;

  for t in select value from jsonb_array_elements(p_tenants) with ordinality as e(value, ord) order by ord loop
    v_i := v_i + 1;
    v_share_pct := (t->>'share_percent')::numeric;

    perform public.assert_referral_valid(
      p_branch, t->>'title', t->>'first', t->>'last', (t->>'dob')::date, t->>'email', t->>'phone',
      p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

    insert into public.applications(
      guarantee_ref, fee_amount, fee_basis_weeks, fee_basis_unit, pricing_agreement_id,
      tenancy_id, tenancy_position, share_percent, share_amount,
      branch_id, agency_id, partner_id, referrer_id, referrer_name,
      tenant_title, tenant_first_name, tenant_middle_name, tenant_last_name,
      tenant_dob, tenant_email, tenant_phone,
      prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
      monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode, referencing_mode
    ) values (
      'GR-' || nextval('public.guarantee_ref_seq')::text,
      v_fees[v_i], v_basis, coalesce(v_basis_unit, 'weeks'), v_agreement,
      v_tenancy, v_i, v_share_pct, v_rents[v_i],
      p_branch, ag, v_route, auth.uid(),
      (select full_name from public.users where id = auth.uid()),
      t->>'title', btrim(t->>'first'), nullif(btrim(coalesce(t->>'middle','')),''), btrim(t->>'last'),
      (t->>'dob')::date, btrim(t->>'email'), btrim(t->>'phone'),
      btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')),''), btrim(p_city),
      nullif(btrim(coalesce(p_county,'')),''), upper(btrim(p_postcode)),
      p_rent, p_tenancy_start, 'sent', now(),
      (select r.partner_rate from public.resolve_rates(p_branch, v_route) r),
      public.commission_total(p_branch, v_route, v_n),
      true, v_mode
    ) returning * into v_app;

    -- THE TENANCY'S COMMISSION, APPORTIONED, not this line's basis rounded on its
    -- own. Passing the whole fee, the split and this tenant's position lets the
    -- freeze round ONCE for the tenancy and then divide, the same way v_fees and
    -- v_rents above are divided, so the lines sum to the tenancy's commission
    -- exactly. Rounding each line separately put GR-20845 and GR-20846 a penny
    -- over their tenancy's 25%.
    perform public.freeze_commission_lines(
      v_app.id, p_branch, v_route, v_n, v_fees[v_i],
      v_fee, v_pcts, v_i);

    return next v_app;
  end loop;
end $function$;

-- create_referral(uuid,text,text,text,date,text,text,text,text,text,text,text,numeric,date)
CREATE OR REPLACE FUNCTION public.create_referral(p_branch uuid, p_tenant_title text, p_first text, p_last text, p_dob date, p_email text, p_phone text, p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text, p_rent numeric, p_tenancy_start date)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.applications; ag uuid; pid uuid; v_route uuid; v_mode text;
  v_portal_ok boolean; prate numeric; arate numeric;
  v_fee numeric; v_basis numeric; v_basis_unit text; v_agreement uuid; v_estate boolean;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  perform public.assert_referral_valid(
    p_branch, p_tenant_title, p_first, p_last, p_dob, p_email, p_phone,
    p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

  select b.agency_id, b.partner_id into ag, pid from public.branches b where b.id = p_branch;
  if ag is null then raise exception 'Selected branch not found' using errcode = '22023'; end if;

  if not (public.is_admin()
          or (public.app_role() in ('management','referrer') and pid = public.app_partner())) then
    raise exception 'not permitted for this partner' using errcode = '42501';
  end if;

  v_route := public.resolve_route_partner(p_branch, null);
  select p.portal_referrals_enabled into v_portal_ok from public.partners p where p.id = v_route;
  if not found then raise exception 'Route partner not found' using errcode = '22023'; end if;

  -- WHO CHECKS THE TENANT. The agency's own mode if it has said, else the route
  -- partner's. This is the journey, and it is what gets frozen onto the row.
  v_mode := public.resolve_referencing_mode(p_branch, v_route);
  -- WHAT KIND OF RELATIONSHIP. Never overridden by the answer above.
  v_estate := public.is_agent_estate(p_branch, v_route);

  -- Position ladder: a property of the ESTATE. An agency's staff refer against
  -- their own branches whether or not Opndoor checks their tenants.
  if not public.is_admin() and v_estate then
    if not (case
              when public.app_has_scope()
                then p_branch in (select public.app_scope_branches())
              else public.app_may_reach_branch(p_branch) end) then
      raise exception 'You can only refer against a branch within your own scope.' using errcode = '42501';
    end if;
  end if;

  -- THE PRICE. Rail-agnostic already: the agreement decides, standard terms are
  -- one month's rent exactly, a negotiated basis is weeks of rent.
  -- THE UNIT COMES OUT WITH THE QUANTITY. A basis of 1 recorded without it is
  -- one WEEK of rent, which is a quarter of what a one-month agreement charges.
  select f.fee_amount, f.fee_basis_weeks, f.fee_basis_unit, f.agreement_id
    into v_fee, v_basis, v_basis_unit, v_agreement
  from public.resolve_fee(p_branch, v_route, p_rent, 1) f;

  -- COMMISSION: the ESTATE's additive split, or the flat snapshotted rates.
  select r.partner_rate, r.agent_rate into prate, arate
  from public.resolve_rates(p_branch, v_route) r;
  if v_estate then
    arate := public.commission_total(p_branch, v_route, 1);
  end if;

  if not coalesce(v_portal_ok, true) then
    raise exception 'This partner does not create referrals in the portal.' using errcode = '42501';
  end if;

  insert into public.applications(
    guarantee_ref, fee_amount, fee_basis_weeks, fee_basis_unit, pricing_agreement_id,
    branch_id, agency_id, partner_id, referrer_id, referrer_name,
    tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
    prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
    monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode,
    referencing_mode
  ) values (
    'GR-' || nextval('public.guarantee_ref_seq')::text,
    v_fee, v_basis, coalesce(v_basis_unit, 'weeks'), v_agreement,
    p_branch, ag, v_route, auth.uid(),
    (select full_name from public.users where id = auth.uid()),
    p_tenant_title, btrim(p_first), btrim(p_last), p_dob, btrim(p_email), btrim(p_phone),
    btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')), ''), btrim(p_city),
    nullif(btrim(coalesce(p_county,'')), ''), upper(btrim(p_postcode)),
    p_rent, p_tenancy_start, 'sent', now(), prate, arate, true,
    -- THE JOURNEY, frozen. create-referral forks on this: pre_referenced goes
    -- straight to a Stripe session, opndoor_referenced sends an invite.
    v_mode
  ) returning * into a;

  -- The basis is this applicant's own fee. For a tenancy of one that is the
  -- whole fee; create_joint_referral passes each applicant's share instead.
  if v_estate then
    perform public.freeze_commission_lines(a.id, p_branch, v_route, 1, v_fee);
  end if;

  return a;
end $function$;

-- my_org_shape(uuid)
CREATE OR REPLACE FUNCTION public.my_org_shape(p_partner uuid DEFAULT NULL::uuid)
 RETURNS TABLE(refers_own_stock boolean, agency_count integer, branch_count integer, collapse_agency boolean, collapse_branch boolean, may_add_agency boolean, only_agency_id uuid, only_agency_name text, only_branch_id uuid, only_branch_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_partner uuid;
  v_own     boolean;
begin
  if not public.is_aal2() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if public.is_admin() and p_partner is not null then
    v_partner := p_partner;
  else
    v_partner := public.app_partner();
  end if;

  if v_partner is null then
    return;
  end if;

  select p.refers_own_stock into v_own from public.partners p where p.id = v_partner;
  v_own := coalesce(v_own, false);

  return query
  with reachable as (
    select b.id as bid, b.name as bname, a.id as aid, a.name as aname
      from public.branches b
      join public.agencies a on a.id = b.agency_id
     where a.partner_id = v_partner
       and (
         case
           -- A position says which branches, and on our estate it is the only
           -- thing that does. WAS: a home_branch_id arm beneath this one, and
           -- an `else true` beneath that.
           when public.app_has_scope() then b.id in (select s from public.app_scope_branches() s)
           -- No position on our own estate is now impossible; if it somehow
           -- happens, the honest answer is the empty set, which the client
           -- draws as "nothing is set up for your account yet".
           when public.is_our_estate_partner(v_partner) then false
           -- A supplier without a position sees their own company. Stated, not
           -- defaulted to, so the closed default below is the one a new arm meets.
           when not public.is_our_estate_partner(v_partner) then true
           else false
         end
       )
  ),
  agg as (
    select
      count(distinct r.aid)::int       as ag,
      count(*)::int                    as br,
      (array_agg(distinct r.aid))[1]   as aid1,
      (array_agg(distinct r.aname))[1] as aname1,
      (array_agg(r.bid))[1]            as bid1,
      (array_agg(r.bname))[1]          as bname1
    from reachable r
  )
  select
    v_own,
    agg.ag,
    agg.br,
    (v_own and agg.ag = 1),
    (v_own and agg.br = 1),
    (not v_own),
    case when agg.ag = 1 then agg.aid1   end,
    case when agg.ag = 1 then agg.aname1 end,
    case when agg.br = 1 then agg.bid1   end,
    case when agg.br = 1 then agg.bname1 end
  from agg;
end $function$;

-- origin_is_agent_estate(text,text,text)
CREATE OR REPLACE FUNCTION public.origin_is_agent_estate(p_agency text, p_branch text, p_partner_slug text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_branch uuid; v_partner uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  if p_partner_slug is not null and btrim(p_partner_slug) <> '' then
    select id into v_partner from public.partners where slug = p_partner_slug;
  end if;
  if v_partner is not null and not public.is_admin()
     and v_partner is distinct from public.app_partner() then
    return false;
  end if;

  select b.id into v_branch
  from public.branches b join public.agencies a on a.id = b.agency_id
  where b.name = p_branch and a.name = p_agency
    and (v_partner is null or b.partner_id = v_partner)
  limit 1;

  if v_branch is not null and not (
       public.is_admin()
       or exists (select 1 from public.branches b2 where b2.id = v_branch
                   and (public.app_reachable_agency(b2.agency_id)
                        or (public.app_has_scope() and b2.id in (select public.app_scope_branches())))))
  then
    v_branch := null;
  end if;

  if v_branch is null then
    -- An agency that does not exist yet inherits its partner's shape.
    return coalesce((select p.referencing_mode = 'opndoor_referenced'
                       from public.partners p where p.id = v_partner), false);
  end if;

  return public.is_agent_estate(v_branch, public.resolve_route_partner(v_branch, null));
end $function$;

-- origin_referencing_mode(text,text,text)
CREATE OR REPLACE FUNCTION public.origin_referencing_mode(p_agency text, p_branch text, p_partner_slug text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_branch uuid; v_partner uuid; v_route uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  if p_partner_slug is not null and btrim(p_partner_slug) <> '' then
    select id into v_partner from public.partners where slug = p_partner_slug;
  end if;
  -- Only an admin may ask about a partner other than their own.
  if v_partner is not null and not public.is_admin()
     and v_partner is distinct from public.app_partner() then
    return null;
  end if;

  select b.id into v_branch
  from public.branches b join public.agencies a on a.id = b.agency_id
  where b.name = p_branch and a.name = p_agency
    and (v_partner is null or b.partner_id = v_partner)
  limit 1;

  -- Adds no reach: an agent cannot learn another agency's rail by typing its name.
  if v_branch is not null and not (
       public.is_admin()
       or exists (select 1 from public.branches b2 where b2.id = v_branch
                   and (public.app_reachable_agency(b2.agency_id)
                        or (public.app_has_scope() and b2.id in (select public.app_scope_branches())))))
  then
    v_branch := null;
  end if;

  if v_branch is null then
    -- No such branch yet. It will be created under this partner, so the partner's
    -- own mode is the honest answer.
    return (select p.referencing_mode from public.partners p where p.id = v_partner);
  end if;

  v_route := public.resolve_route_partner(v_branch, null);
  return public.resolve_referencing_mode(v_branch, v_route);
end $function$;

-- referral_fee_preview(text,text,text,numeric,numeric[])
CREATE OR REPLACE FUNCTION public.referral_fee_preview(p_agency text, p_branch text, p_partner_slug text, p_rent numeric, p_shares numeric[])
 RETURNS TABLE(fee_amount numeric, fee_basis_weeks numeric, is_standard boolean, agreement_id uuid, tenant_count integer, shares numeric[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_branch uuid; v_route uuid; v_partner uuid; v_n int; f record;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  v_n := greatest(coalesce(array_length(p_shares, 1), 1), 1);

  if p_partner_slug is not null and btrim(p_partner_slug) <> '' then
    select id into v_partner from public.partners where slug = p_partner_slug;
  end if;

  select b.id into v_branch
  from public.branches b join public.agencies a on a.id = b.agency_id
  where b.name = p_branch and a.name = p_agency
    and (v_partner is null or b.partner_id = v_partner)
  limit 1;

  -- Only branches the caller can already see. The preview adds no reach: an
  -- agent cannot price another agency's deal by typing its name.
  if v_branch is not null and not (
       public.is_admin()
       or exists (select 1 from public.branches b2 where b2.id = v_branch
                   and (public.app_reachable_agency(b2.agency_id)
                        or (public.app_has_scope() and b2.id in (select public.app_scope_branches())))))
  then
    v_branch := null;
  end if;

  v_route := case when v_branch is null then v_partner
                  else public.resolve_route_partner(v_branch, null) end;

  select f2.fee_amount, f2.fee_basis_weeks, f2.agreement_id
    into f
  from public.resolve_fee(v_branch, v_route, p_rent, v_n) f2;

  fee_amount := coalesce(f.fee_amount, p_rent);
  fee_basis_weeks := coalesce(f.fee_basis_weeks, 4.35);
  agreement_id := f.agreement_id;
  is_standard := coalesce((select pa.is_standard from public.pricing_agreements pa where pa.id = f.agreement_id), true);
  tenant_count := v_n;
  shares := public.apportion(fee_amount, coalesce(p_shares, array[100]::numeric[]));
  return next;
end $function$;

