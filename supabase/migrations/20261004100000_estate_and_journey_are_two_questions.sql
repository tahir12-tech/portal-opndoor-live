-- AN AGENCY CAN BE OURS AND STILL DO ITS OWN REFERENCING.
--
-- referencing_mode has been answering two different questions with one word:
--
--   1. WHO CHECKS THE TENANT, which decides the tenant's JOURNEY — an invite
--      into the eligibility form, or straight to payment.
--   2. WHAT KIND OF RELATIONSHIP THIS IS, which decides the org ladder, the
--      additive commission split, whether joint tenancies are allowed, and
--      where an executed deed goes.
--
-- They travelled together because every agency we had did both: Opndoor
-- referenced their tenants AND they sat in our org tree. Regent is the case
-- that pulls them apart. They are our agency — staff in the portal, a group and
-- branches, a negotiated agreement, joint tenancies, commission split per
-- tenancy — and they reference their own tenants, so their applicants must go
-- straight to payment and must never see an eligibility form.
--
-- Asked as one question, Regent is impossible: agent rail gives them the deal
-- and the wrong journey, supplier rail gives them the journey and neither the
-- 5-week band nor joint tenancies at all. Asked as two, Regent is ordinary.
--
--   resolve_referencing_mode(branch, route)  WHO CHECKS  the agency's own
--                                            choice wins over its partner's.
--                                            Unchanged. Still what is frozen
--                                            onto applications.referencing_mode
--                                            and still what forks the journey.
--
--   is_agent_estate(branch, route)           WHAT KIND   a property of the
--                                            estate, read from the ROUTE
--                                            PARTNER and never overridden by
--                                            an agency's referencing choice.
--
-- BLAST RADIUS, measured rather than assumed: the two answers differ only for
-- an agency that has set its own referencing_mode, and no agency anywhere has
-- ever set one (select count(*) from agencies where referencing_mode is not
-- null => 0). Every existing application, every supplier partner and every
-- agent-rail agency resolves exactly as it did before this migration. The only
-- row whose behaviour changes is one that does not exist yet: Regent's.

-- ---------------------------------------------------------------------------
-- 1. THE SECOND QUESTION.
-- ---------------------------------------------------------------------------
create or replace function public.is_agent_estate(p_branch uuid, p_route_partner uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  -- Deliberately the ROUTE PARTNER's mode, not resolve_referencing_mode's.
  -- An agency saying "we reference our own tenants" changes their journey; it
  -- does not take them out of our estate or off their agreement.
  select coalesce(
    (select p.referencing_mode = 'opndoor_referenced'
       from public.partners p where p.id = p_route_partner),
    false)
$function$;

comment on function public.is_agent_estate(uuid, uuid) is
  'Is this branch part of the Opndoor agency estate: the org ladder, the additive commission split, joint tenancies, and deed delivery to named people? A property of the estate, read from the route partner. Distinct from resolve_referencing_mode, which answers who checks the tenant and therefore what journey the tenant gets. An agency that references its own tenants is still our agency.';

revoke all on function public.is_agent_estate(uuid, uuid) from public, anon;
grant execute on function public.is_agent_estate(uuid, uuid) to authenticated, service_role;

-- The same question about an application that already exists. Its partner_id is
-- the route partner, frozen at creation.
create or replace function public.application_is_agent_estate(p_application uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select coalesce(
    (select p.referencing_mode = 'opndoor_referenced'
       from public.applications a join public.partners p on p.id = a.partner_id
      where a.id = p_application),
    false)
$function$;

revoke all on function public.application_is_agent_estate(uuid) from public, anon;
grant execute on function public.application_is_agent_estate(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. CREATE_REFERRAL. Three decisions move from the journey to the estate; the
--    fourth — what is frozen onto referencing_mode — stays the journey.
-- ---------------------------------------------------------------------------
create or replace function public.create_referral(
  p_branch uuid, p_tenant_title text, p_first text, p_last text, p_dob date,
  p_email text, p_phone text, p_addr1 text, p_addr2 text, p_city text,
  p_county text, p_postcode text, p_rent numeric, p_tenancy_start date
)
returns public.applications
language plpgsql security definer set search_path to ''
as $function$
declare
  a public.applications; ag uuid; pid uuid; v_route uuid; v_mode text;
  v_portal_ok boolean; prate numeric; arate numeric;
  v_fee numeric; v_basis numeric; v_agreement uuid; v_estate boolean;
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
              else p_branch = (select u.home_branch_id from public.users u where u.id = auth.uid())
            end) then
      raise exception 'You can only refer against a branch within your own scope.' using errcode = '42501';
    end if;
  end if;

  -- THE PRICE. Rail-agnostic already: the agreement decides, standard terms are
  -- one month's rent exactly, a negotiated basis is weeks of rent.
  select f.fee_amount, f.fee_basis_weeks, f.agreement_id
    into v_fee, v_basis, v_agreement
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
    guarantee_ref, fee_amount, fee_basis_weeks, pricing_agreement_id,
    branch_id, agency_id, partner_id, referrer_id, referrer_name,
    tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
    prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
    monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode,
    referencing_mode
  ) values (
    'GR-' || nextval('public.guarantee_ref_seq')::text,
    v_fee, v_basis, v_agreement,
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

  if v_estate then
    insert into public.application_commission_lines (application_id, level, org_id, org_name, rate)
    select a.id, s.level, s.org_id, s.org_name, s.rate
    from public.commission_split(p_branch, v_route, 1) s;
  end if;

  return a;
end $function$;

comment on function public.create_referral(uuid, text, text, text, date, text, text, text, text, text, text, text, numeric, date) is
  'Portal create path. Freezes the fee and the commission at creation. Two independent questions: the ESTATE (is_agent_estate) decides the position ladder and whether commission is the additive split; the JOURNEY (resolve_referencing_mode) is frozen onto referencing_mode and decides whether the tenant is invited to an eligibility form or sent straight to payment. An agency that references its own tenants is still our agency.';

revoke all on function public.create_referral(uuid, text, text, text, date, text, text, text, text, text, text, text, numeric, date) from public, anon;
grant execute on function public.create_referral(uuid, text, text, text, date, text, text, text, text, text, text, text, numeric, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. CREATE_JOINT_REFERRAL. A joint tenancy is an ESTATE thing, not a journey
--    thing: it is about one guarantee over one property with a commission split
--    per tenancy, none of which depends on who checked the tenants.
-- ---------------------------------------------------------------------------
create or replace function public.create_joint_referral(
  p_branch uuid, p_tenants jsonb,
  p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text,
  p_rent numeric, p_tenancy_start date
)
returns setof public.applications
language plpgsql security definer set search_path to ''
as $function$
declare
  ag uuid; pid uuid; v_route uuid; v_mode text; v_portal_ok boolean; v_estate boolean;
  v_n int; v_pct numeric; v_fee numeric; v_basis numeric; v_agreement uuid;
  v_tenancy uuid; t jsonb; v_share_pct numeric; v_share_rent numeric;
  v_app public.applications; v_i int := 0; v_emails text[];
  v_pcts numeric[]; v_fees numeric[];
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  v_n := jsonb_array_length(p_tenants);
  if v_n is null or v_n < 1 then raise exception 'At least one tenant is required.' using errcode = '22023'; end if;

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

  -- THE ESTATE, not the journey. A supplier hands us finished referrals one
  -- tenant at a time and has no org tree to split commission across; one of our
  -- agencies has both, whoever referenced the tenants.
  if not v_estate then
    raise exception 'A joint tenancy needs an agency of ours to sit under, and this referral comes from a partner who sends them one tenant at a time. Refer each tenant separately.'
      using errcode = '22023';
  end if;

  if not public.is_admin() then
    if not (case when public.app_has_scope()
                 then p_branch in (select public.app_scope_branches())
                 else p_branch = (select u.home_branch_id from public.users u where u.id = auth.uid())
            end) then
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

  select f.fee_amount, f.fee_basis_weeks, f.agreement_id
    into v_fee, v_basis, v_agreement
  from public.resolve_fee(p_branch, v_route, p_rent, v_n) f;
  v_fees := public.apportion(v_fee, v_pcts);

  insert into public.tenancies (monthly_rent, tenancy_start, prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode)
  values (p_rent, p_tenancy_start, btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')),''),
          btrim(p_city), nullif(btrim(coalesce(p_county,'')),''), upper(btrim(p_postcode)))
  returning id into v_tenancy;

  for t in select value from jsonb_array_elements(p_tenants) with ordinality as e(value, ord) order by ord loop
    v_i := v_i + 1;
    v_share_pct := (t->>'share_percent')::numeric;
    v_share_rent := round(p_rent * v_share_pct / 100.0, 2);

    perform public.assert_referral_valid(
      p_branch, t->>'title', t->>'first', t->>'last', (t->>'dob')::date, t->>'email', t->>'phone',
      p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

    insert into public.applications(
      guarantee_ref, fee_amount, fee_basis_weeks, pricing_agreement_id,
      tenancy_id, tenancy_position, share_percent, share_amount,
      branch_id, agency_id, partner_id, referrer_id, referrer_name,
      tenant_title, tenant_first_name, tenant_middle_name, tenant_last_name,
      tenant_dob, tenant_email, tenant_phone,
      prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
      monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode, referencing_mode
    ) values (
      'GR-' || nextval('public.guarantee_ref_seq')::text,
      v_fees[v_i], v_basis, v_agreement,
      v_tenancy, v_i, v_share_pct, v_share_rent,
      p_branch, ag, v_route, auth.uid(),
      (select full_name from public.users where id = auth.uid()),
      t->>'title', btrim(t->>'first'), nullif(btrim(coalesce(t->>'middle','')),''), btrim(t->>'last'),
      (t->>'dob')::date, btrim(t->>'email'), btrim(t->>'phone'),
      btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')),''), btrim(p_city),
      nullif(btrim(coalesce(p_county,'')),''), upper(btrim(p_postcode)),
      p_rent, p_tenancy_start, 'sent', now(),
      (select r.partner_rate from public.resolve_rates(p_branch, v_route) r),
      public.commission_total(p_branch, v_route, v_n),
      -- The JOURNEY, per tenant. Regent's applicants are pre-referenced, so each
      -- one goes straight to their own payment link for their own share.
      true, v_mode
    ) returning * into v_app;

    insert into public.application_commission_lines (application_id, level, org_id, org_name, rate, basis_amount)
    select v_app.id, s.level, s.org_id, s.org_name, s.rate, v_fees[v_i]
    from public.commission_split(p_branch, v_route, v_n) s;

    return next v_app;
  end loop;
end $function$;

comment on function public.create_joint_referral(uuid, jsonb, text, text, text, text, text, numeric, date) is
  'One tenancy, N applicants, atomically, for an agency of OUR estate — whoever referenced the tenants. The fee is resolved once at the tenant count and split by share to the penny (the last applicant takes the rounding). Each applicant''s journey follows resolve_referencing_mode: pre-referenced tenants go straight to their own payment link for their own share.';

revoke all on function public.create_joint_referral(uuid, jsonb, text, text, text, text, text, numeric, date) from public, anon;
grant execute on function public.create_joint_referral(uuid, jsonb, text, text, text, text, text, numeric, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. WHERE AN EXECUTED DEED GOES. Also the estate: our agency's deeds go to its
--    named, active people, whether or not we checked its tenants.
-- ---------------------------------------------------------------------------
create or replace function public.deed_delivery_target(p_application uuid)
returns table (email text, display_name text, source text, verified boolean, auto_send boolean)
language sql stable security definer set search_path to ''
as $function$
  select
    coalesce(pe.email, d.email, rc.email, c.email),
    coalesce(
      pe.display_name,
      nullif(btrim(coalesce(d.agency_name, '')), ''),
      nullif(btrim(coalesce(d.first_name, '') || ' ' || coalesce(d.last_name, '')), ''),
      rc.name, c.name
    ),
    case
      when pe.email is not null           then 'org_person'
      when d.application_id is not null    then 'delivery_contact'
      when rc.id is not null               then 'route_contact'
      else 'branch_contact'
    end,
    case
      when pe.email is not null            then true
      when d.application_id is not null     then d.verified_at is not null
      else true
    end,
    case
      when not public.application_is_agent_estate(a.id) then true
      when d.application_id is not null                 then true
      else pe.email is not null
    end
  from public.applications a
  -- People for OUR estate, keyed on the relationship rather than on who checked
  -- the tenant. Regent references its own tenants and its deeds still go to
  -- Regent's people, not to a legacy branch contact row.
  left join lateral (
    select * from public.deed_people_target(a.branch_id)
    where public.application_is_agent_estate(a.id)
  ) pe on true
  left join public.application_delivery_contacts d on d.application_id = a.id
  left join lateral (
    select * from public.effective_primary_contact_route(a.branch_id, a.partner_id)
  ) rc on true
  left join lateral (
    select * from public.effective_primary_contact(a.branch_id)
  ) c on true
  where a.id = p_application
$function$;

comment on function public.deed_delivery_target(uuid) is
  'Where an executed deed goes, keyed on the ESTATE rather than on who referenced the tenant. Our agencies: the org''s ACTIVE people, then the agent_contacts chain for generation only. Supplier partners: unchanged. auto_send is false when one of our agencies has no active person to receive it.';

revoke all on function public.deed_delivery_target(uuid) from public, anon, authenticated;
grant execute on function public.deed_delivery_target(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. DEED READINESS on the Agencies screens. Same correction: 20260928140000
--    made this follow the agency's referencing choice, which was right for the
--    case it had (an agency opting INTO eligibility) and wrong for Regent, who
--    opts out of eligibility and is still one of ours with people to deliver to.
-- ---------------------------------------------------------------------------
create or replace function public.org_deed_readiness()
returns table (agency_id uuid, branch_id uuid, ready boolean)
language sql stable security definer set search_path to ''
as $function$
  with vis_agency as (
    select a.id, a.group_id
    from public.agencies a
    join public.partners p on p.id = a.partner_id
    -- The ESTATE. An agency's referencing choice does not remove it from ours.
    where p.referencing_mode = 'opndoor_referenced'
      and (public.is_admin()
           or (public.app_role() in ('management','referrer','developer')
               and case
                     when public.app_has_scope()
                       then a.id in (select b.agency_id from public.branches b
                                      where b.id in (select public.app_scope_branches()))
                     else a.partner_id = public.app_partner()
                   end))
  )
  select va.id, b.id, (select count(*) > 0 from public.deed_people_target(b.id))
  from vis_agency va
  join public.branches b on b.agency_id = va.id
$function$;

revoke all on function public.org_deed_readiness() from public, anon;
grant execute on function public.org_deed_readiness() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The form asks the ESTATE whether it may offer a second tenant. It was
--    asking the journey, which for Regent answers "pre-referenced" and would
--    have hidden the control on the one agency that needs it most.
-- ---------------------------------------------------------------------------
create or replace function public.origin_is_agent_estate(
  p_agency text, p_branch text, p_partner_slug text
)
returns boolean
language plpgsql stable security definer set search_path to ''
as $function$
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
                        or (public.app_has_scope() and b2.id in (select public.app_scope_branches()))
                        or b2.id = (select u.home_branch_id from public.users u where u.id = auth.uid()))))
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

comment on function public.origin_is_agent_estate(text, text, text) is
  'May a referral against this agent and branch carry more than one tenant? Answers the ESTATE question, by the same function create_joint_referral enforces, so the form cannot offer a button the RPC would refuse — nor withhold one it would allow.';

revoke all on function public.origin_is_agent_estate(text, text, text) from public, anon;
grant execute on function public.origin_is_agent_estate(text, text, text) to authenticated;
