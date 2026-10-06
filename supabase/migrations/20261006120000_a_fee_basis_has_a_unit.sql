-- A FEE BASIS HAS A UNIT: weeks, or months.
--
-- "One month's rent" has always been expressible only as 4.3333 weeks, because a
-- week is rent x 12 / 52 and a month is therefore 52/12 of one. The editor
-- offered that number with a note explaining it, and the arithmetic came out at
-- rent x 12/52 x 4.3333 = 0.99999... of the rent. On £2,000 that is £1,999.98:
-- twopence under a month, on the one figure a tenant is asked to pay.
--
-- Standard terms already dodge it. resolve_fee has a special case returning
-- p_rent exactly when pa.is_standard, precisely because the weeks expression does
-- not land on a month. That special case is the proof the model was short a unit:
-- a NEGOTIATED agreement of one month at 15% had no way to say so.
--
-- SO THE QUANTITY GAINS A UNIT, and the quantity column now means "this many of
-- that unit". 3 weeks is (3, 'weeks'). One month is (1, 'months') and prices at
-- exactly the rent.
--
-- THE COLUMN KEEPS ITS NAME, and that is a deliberate trade rather than an
-- oversight. fee_basis_weeks is read by seven database functions, by the
-- applications snapshot, by the client editor and by the email templates.
-- Renaming it is a bigger change than this one, made on the day of a cutover, for
-- a clarity that this comment and the check constraint below can supply instead.
-- Every place that reads it is updated here, so there is no reader left believing
-- the old meaning.
--
-- INERT UNTIL SOMEBODY CHOOSES MONTHS. The column defaults to 'weeks', so every
-- existing agreement, every existing application and every existing figure is
-- exactly what it was. Nothing reprices.

alter table public.pricing_agreement_bands
  add column if not exists fee_basis_unit text not null default 'weeks';

do $$ begin
  alter table public.pricing_agreement_bands
    add constraint pab_fee_basis_unit_chk check (fee_basis_unit in ('weeks','months'));
exception when duplicate_object then null; end $$;

comment on column public.pricing_agreement_bands.fee_basis_unit is
  'The unit fee_basis_weeks is counted in: weeks (rent x 12/52 each) or months (the rent each). A month cannot be said in weeks exactly, because 52/12 does not terminate, so "one month" as 4.3333 weeks priced at 0.99999 of the rent.';

comment on column public.pricing_agreement_bands.fee_basis_weeks is
  'How many of fee_basis_unit the guarantee fee is. Named for the unit it held before months existed; read it as the QUANTITY, and always alongside fee_basis_unit.';

-- The snapshot on the application needs the unit too, or a month-based fee is
-- recorded as 4.33 weeks and every screen and email says "4.33 weeks of rent"
-- about a fee that was one month's.
alter table public.applications
  add column if not exists fee_basis_unit text not null default 'weeks';

do $$ begin
  alter table public.applications
    add constraint applications_fee_basis_unit_chk check (fee_basis_unit in ('weeks','months'));
exception when duplicate_object then null; end $$;

comment on column public.applications.fee_basis_unit is
  'The unit fee_basis_weeks was counted in when this fee was frozen. Defaults to weeks, which is what every application created before agreements could be priced in months was.';

-- The client reads it to word the fee ("one month's rent" / "3 weeks of rent").
grant select (fee_basis_unit) on public.applications to authenticated;

-- ---------------------------------------------------------------------------
-- THE ARITHMETIC, in one place.
--
-- Extracted rather than repeated: it is now two cases instead of one expression,
-- and resolve_fee, referral_fee_preview and both create paths all need it. Three
-- copies of a two-case price is how a month becomes 4.3333 weeks again in one of
-- them.
-- ---------------------------------------------------------------------------
create or replace function public.fee_from_basis(p_rent numeric, p_qty numeric, p_unit text)
returns numeric
language sql immutable set search_path to ''
as $function$
  select case
           -- EXACTLY the rent, times the number of months. No 12/52 anywhere
           -- near it, which is the whole point of the unit.
           when p_unit = 'months' then round(p_rent * coalesce(p_qty, 1), 2)
           else round(p_rent * 12.0 / 52.0 * coalesce(p_qty, 4.35), 2)
         end
$function$;

comment on function public.fee_from_basis(numeric, numeric, text) is
  'The guarantee fee for a rent, a basis quantity and its unit. Months are an exact multiple of the rent; weeks are rent x 12/52 each. The one implementation, because a second copy is where a month turns back into 4.3333 weeks.';

revoke all on function public.fee_from_basis(numeric, numeric, text) from public, anon;
grant execute on function public.fee_from_basis(numeric, numeric, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- THE RESOLVER carries the unit out with the quantity. Everything else here
-- follows from that: a quantity without its unit is not a price.
-- ---------------------------------------------------------------------------
drop function if exists public.resolve_pricing_agreement(uuid, uuid, integer);

create or replace function public.resolve_pricing_agreement(p_branch uuid, p_route_partner uuid, p_tenant_count integer default 1)
returns table(id uuid, scope_level text, fee_basis_weeks numeric, fee_basis_unit text, agent_rate numeric)
language sql stable security definer set search_path to ''
as $function$
  with ctx as (
    select b.agency_id, a.group_id
    from public.branches b left join public.agencies a on a.id = b.agency_id
    where b.id = p_branch
  ),
  agreement as (
    select pa.*
    from public.pricing_agreements pa, ctx
    where pa.ended_at is null
      and pa.effective_from <= current_date
      and (pa.effective_to is null or pa.effective_to >= current_date)
      and (
        (pa.scope_level = 'agency'  and pa.scope_id = ctx.agency_id)
        or (pa.scope_level = 'group'   and ctx.group_id is not null and pa.scope_id = ctx.group_id)
        or (pa.scope_level = 'partner' and pa.scope_id = p_route_partner)
      )
    order by case pa.scope_level when 'agency' then 1 when 'group' then 2 else 3 end,
             pa.effective_from desc
    limit 1
  ),
  band as (
    select b.* from public.pricing_agreement_bands b, agreement ag
    where b.agreement_id = ag.id
      and b.min_tenants <= p_tenant_count
      and (b.max_tenants is null or b.max_tenants >= p_tenant_count)
    order by b.min_tenants desc
    limit 1
  ),
  tier as (
    select t.* from public.commission_tiers t, agreement ag
    where t.agreement_id = ag.id
      and public.agreement_volume(ag.id, p_branch) >= t.from_count
      and (t.to_count is null or public.agreement_volume(ag.id, p_branch) < t.to_count)
    order by t.from_count desc
    limit 1
  )
  select ag.id, ag.scope_level,
         (select fee_basis_weeks from band),
         (select fee_basis_unit from band),
         coalesce((select agent_rate from tier), (select agent_rate from band))
  from agreement ag
$function$;

revoke all on function public.resolve_pricing_agreement(uuid, uuid, integer) from public, anon;
grant execute on function public.resolve_pricing_agreement(uuid, uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- THE PRICE. The standard-terms special case stays exactly as it was and is now
-- visibly the same thing as a months basis: both are the rent, once.
-- ---------------------------------------------------------------------------
drop function if exists public.resolve_fee(uuid, uuid, numeric, integer);

create or replace function public.resolve_fee(p_branch uuid, p_route_partner uuid, p_rent numeric, p_tenant_count integer default 1)
returns table(fee_amount numeric, fee_basis_weeks numeric, fee_basis_unit text, agreement_id uuid, agent_rate numeric)
language sql stable security definer set search_path to ''
as $function$
  select
    case
      when r.id is null then p_rent                       -- no agreement: standard
      when pa.is_standard then p_rent                     -- standard terms: one month, exactly
      else public.fee_from_basis(p_rent, r.fee_basis_weeks, r.fee_basis_unit)
    end,
    coalesce(r.fee_basis_weeks, 4.35),
    -- Standard terms ARE one month, so they answer 'months' and every screen
    -- that words the basis says "one month's rent" rather than "4.35 weeks".
    case when r.id is null or pa.is_standard then 'months' else coalesce(r.fee_basis_unit, 'weeks') end,
    r.id,
    r.agent_rate
  from (select 1) one
  left join lateral public.resolve_pricing_agreement(p_branch, p_route_partner, p_tenant_count) r on true
  left join public.pricing_agreements pa on pa.id = r.id
$function$;

revoke all on function public.resolve_fee(uuid, uuid, numeric, integer) from public, anon;
grant execute on function public.resolve_fee(uuid, uuid, numeric, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- THE EDITOR'S WRITE AND READ PATHS. Bands travel as jsonb, so neither
-- signature changes: create_agreement reads one more key and agreement_for_agency
-- returns one more. A client that sends no unit writes 'weeks', which is the
-- band it always wrote.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_agreement(p_level text, p_id uuid, p_coverage text, p_period text, p_counting_scope text, p_bands jsonb, p_tiers jsonb DEFAULT '[]'::jsonb, p_note text DEFAULT NULL::text, p_confirm_replace boolean DEFAULT false, p_confirm_breach boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid; c record; v_actor text; v_n int; b jsonb; t jsonb; v_worst numeric;
  v_detail text; v_mx numeric; r record; v_breached boolean := false;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_coverage not in ('additive','all_in') then
    raise exception 'Coverage must be additive or all-in.' using errcode = '22023';
  end if;
  if p_coverage = 'all_in' and p_level not in ('group','agency') then
    raise exception 'An all-in agreement covers everything under a group or an agency, so it cannot sit on a %.', p_level
      using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_bands,'[]'::jsonb)) < 1 then
    raise exception 'An agreement needs at least one tenant-count band.' using errcode = '22023';
  end if;

  select count(*) into v_n from public.agreement_conflicts(p_level, p_id, p_coverage);
  if v_n > 0 and not p_confirm_replace then
    raise exception 'This would replace % existing arrangement(s). Confirm to clear them.', v_n
      using errcode = '22023';
  end if;

  -- THE MIRROR BREACH, checked before anything is written so the refusal costs
  -- nothing. An ADDITIVE agreement above an all-in is NOT a breach and is no
  -- longer checked: it never reaches that agency's branches.
  select max((x->>'rate')::numeric) into v_mx from jsonb_array_elements(p_bands) x;
  if p_coverage = 'all_in' then
    for r in select * from public.rate_above_all_in(p_level, p_id) loop
      v_breached := true;
      v_detail := public.all_in_breach_sentence(
        r.party_name, r.rate,
        (select name from public.agencies where id = p_id), v_mx);
      if not p_confirm_breach then
        raise exception '%', v_detail using errcode = '22023';
      end if;
    end loop;
    if v_breached then perform set_config('app.confirm_all_in_breach', 'on', true); end if;
  end if;

  select full_name into v_actor from public.users where id = auth.uid();

  for c in select * from public.agreement_conflicts(p_level, p_id, p_coverage) loop
    if c.kind = 'rate' then
      insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
      values (c.level, c.node_id, 'rate_cleared_for_agreement',
              c.node_name || ' ' || c.detail || ', cleared because an agreement now prices it',
              coalesce(v_actor,'an administrator'), auth.uid());
      if c.level = 'agency'   then update public.agencies      set agent_rate = null where id = c.node_id;
      elsif c.level = 'group' then update public.agency_groups set agent_rate = null where id = c.node_id;
      else                         update public.branches      set agent_rate = null where id = c.node_id;
      end if;
    else
      insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
      values (c.level, c.node_id, 'agreement_superseded',
              coalesce(c.node_name,'A party') || ' ' || c.detail || ', ended because '
              || case when c.level = p_level and c.node_id = p_id
                      then 'a new agreement replaces it'
                      else 'an all-in agreement now covers it' end,
              coalesce(v_actor,'an administrator'), auth.uid());
      update public.pricing_agreements set ended_at = now()
       where scope_level = c.level and scope_id = c.node_id and not is_standard
         and ended_at is null;
    end if;
  end loop;

  insert into public.pricing_agreements
    (scope_level, scope_id, coverage, period, counting_scope, note, created_by, effective_from, is_standard)
  values (p_level, p_id, p_coverage, p_period, p_counting_scope, p_note, auth.uid(), current_date, false)
  returning id into v_id;

  for b in select * from jsonb_array_elements(p_bands) loop
    insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, fee_basis_unit, agent_rate)
    values (v_id, coalesce((b->>'min')::int, 1), nullif(b->>'max','')::int,
            (b->>'weeks')::numeric,
            -- Absent means weeks, so an older client that does not send a unit
            -- writes exactly the band it always wrote.
            case when b->>'unit' = 'months' then 'months' else 'weeks' end,
            nullif(b->>'rate','')::numeric);
  end loop;
  for t in select * from jsonb_array_elements(coalesce(p_tiers,'[]'::jsonb)) loop
    insert into public.commission_tiers (agreement_id, from_count, to_count, agent_rate)
    values (v_id, (t->>'from')::int, nullif(t->>'to','')::int, (t->>'rate')::numeric);
  end loop;

  v_worst := public.assert_agreement_within_cap(v_id);

  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values (p_level, p_id, 'agreement_created',
          p_coverage || ' agreement, volume per ' || p_counting_scope || ' per ' || p_period ||
          ', worst branch total ' || to_char(round(v_worst * 100, 2), 'FM999990.00') || '%',
          coalesce(v_actor,'an administrator'), auth.uid());

  if v_breached then
    -- Against the party that signed, and against the group whose line breaches
    -- it: the ones who need to find out are both of them.
    for r in select * from public.rate_above_all_in(p_level, p_id) loop
      v_detail := public.all_in_breach_sentence(r.party_name, r.rate,
        (select name from public.agencies where id = p_id), v_mx);
      insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
      values (p_level, p_id, 'all_in_breach_confirmed', v_detail,
              coalesce(v_actor,'an administrator'), auth.uid());
      insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
      select 'group', a.group_id, 'all_in_breach_confirmed', v_detail,
             coalesce(v_actor,'an administrator'), auth.uid()
      from public.agencies a where a.id = p_id and a.group_id is not null;
    end loop;
    perform set_config('app.confirm_all_in_breach', 'off', true);
  end if;

  return v_id;
end $function$;


CREATE OR REPLACE FUNCTION public.agreement_for_agency(p_agency uuid)
 RETURNS TABLE(agreement_id uuid, scope_level text, coverage text, period text, counting_scope text, is_standard boolean, note text, effective_from date, period_start date, volume integer, bands jsonb, tiers jsonb, next_rate numeric, next_basis numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with b1 as (
    select b.id as branch_id, b.partner_id from public.branches b
    where b.agency_id = p_agency order by b.created_at limit 1
  ),
  r as (
    select * from public.resolve_pricing_agreement(
      (select branch_id from b1), (select partner_id from b1), 1)
  )
  select pa.id, pa.scope_level, pa.coverage, pa.period, pa.counting_scope, pa.is_standard, pa.note, pa.effective_from,
         public.agreement_period_start(pa.id),
         public.agreement_volume(pa.id, (select branch_id from b1)),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'min', bd.min_tenants, 'max', bd.max_tenants,
             'weeks', bd.fee_basis_weeks, 'unit', bd.fee_basis_unit, 'rate', bd.agent_rate) order by bd.min_tenants), '[]'::jsonb)
            from public.pricing_agreement_bands bd where bd.agreement_id = pa.id),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'from', t.from_count, 'to', t.to_count, 'rate', t.agent_rate) order by t.from_count), '[]'::jsonb)
            from public.commission_tiers t where t.agreement_id = pa.id),
         (select agent_rate from r), (select fee_basis_weeks from r)
  from public.pricing_agreements pa
  where pa.id = (select id from r)
$function$;

-- ---------------------------------------------------------------------------
-- THE TWO CREATE PATHS, copied forward from what is deployed with the unit
-- captured out of resolve_fee and snapshotted onto the application beside the
-- quantity. A basis of 1 recorded without its unit is one WEEK of rent, which is
-- a quarter of what a one-month agreement charges.
--
-- Both were verified by running them: create_joint_referral for three tenants
-- and create_referral for one, through commission_apportioned.test.sql. plpgsql
-- does not plan an INSERT until it executes, so a column list and a values list
-- that disagree compile cleanly and fail on the first referral. One of these two
-- did disagree at first, because the joint path inserts v_fees[v_i] rather than
-- v_fee and the patch matched only the latter.
-- ---------------------------------------------------------------------------
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
              else p_branch = (select u.home_branch_id from public.users u where u.id = auth.uid())
            end) then
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
