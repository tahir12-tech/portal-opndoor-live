-- A TENANCY'S COMMISSION LINES SUM TO THE TENANCY'S COMMISSION.
--
-- Reported from the walk: GR-20845 and GR-20846, a £2,000 tenancy split 54/46 on
-- a fee of £2,307.69 at 25%.
--
--   line 1   £1,246.15 x 25%  =  311.5375  ->  £311.54
--   line 2   £1,061.54 x 25%  =  265.3850  ->  £265.39
--                                              ---------
--                                              £576.93
--   the tenancy   £2,307.69 x 25%  =  576.9225  ->  £576.92
--
-- A penny over, on every statement, invoice and reconciliation that adds those
-- two lines. The fee and the rent are already apportioned so their parts sum to
-- the whole exactly; commission was the one figure still computed by rounding each
-- line on its own, so the halves of a rounding could both go up.
--
-- IT IS INTERMITTENT, WHICH IS WHY IT NEEDS AN INVARIANT AND NOT A SPOT CHECK. The
-- other joint tenancy on dev, GR-20762/20763 at £2,769.23 split 50/50, sums to
-- £692.31 and is correct, by luck: 346.16 + 346.15 happens to land on
-- round(692.3075). Half the joint tenancies in existence looked fine.
--
-- THE FIX IS THE ONE ALREADY IN USE. apportion() splits a total across percentage
-- shares with the LAST share taking the rounding, so the parts sum to exactly the
-- whole. The fee uses it, the rent uses it, and now the commission does: the
-- tenancy's commission is rounded ONCE and then divided, rather than divided and
-- then rounded n times.
--
-- WHY THE AMOUNT IS STORED RATHER THAN DERIVED. application_commission_lines is a
-- FROZEN record: "never recomputed, so history cannot move". An apportionment
-- computed at read time depends on the other lines in the tenancy, so adding a
-- tenant, refunding one, or withdrawing one would silently change the amount on a
-- line that had already been settled and paid. The amount is decided once, when
-- the split is frozen, and written down beside the rate it came from.

alter table public.application_commission_lines
  add column if not exists amount numeric;

comment on column public.application_commission_lines.amount is
  'What this payee earns on this application, in pounds, frozen at creation. On a joint tenancy it is the tenancy''s commission apportioned across the tenants (last line takes the rounding), NOT this line''s basis times its rate, so a tenancy''s lines sum to its commission exactly. Null on rows frozen before this column existed; readers fall back to round(basis_amount * rate, 2), which is what those rows were always worth.';

-- ---------------------------------------------------------------------------
-- THE FREEZE. A DROP and recreate, not a replace: adding parameters makes a NEW
-- function in Postgres rather than replacing the old one, and leaving the 5-arg
-- version behind would let a caller keep freezing un-apportioned amounts through
-- a signature nobody remembered was still there.
--
-- The new parameters all default to null, so create_referral's existing 5-argument
-- call still resolves here and still means "one tenant, nothing to apportion".
-- ---------------------------------------------------------------------------
drop function if exists public.freeze_commission_lines(uuid, uuid, uuid, int, numeric);

create or replace function public.freeze_commission_lines(
  p_application uuid, p_branch uuid, p_route_partner uuid,
  p_tenant_count int, p_basis numeric,
  -- The WHOLE tenancy's fee, the split it was divided by, and which tenant this
  -- is. Supplied together or not at all.
  p_tenancy_basis numeric default null,
  p_pcts numeric[] default null,
  p_position int default null
)
returns void
language sql security definer set search_path to ''
as $function$
  insert into public.application_commission_lines
    (application_id, level, org_id, org_name, rate, basis_amount, source, amount)
  select p_application, s.level, s.org_id, s.org_name, s.rate, p_basis, s.source,
         case
           when p_pcts is null or p_position is null or p_tenancy_basis is null
             -- A tenancy of one: its single line IS the tenancy's commission, so
             -- rounding it once here is the same arithmetic apportion would do.
             then round(p_basis * s.rate, 2)
           else
             -- Round the TENANCY's commission once, then divide. The reverse
             -- order is the defect.
             (public.apportion(round(p_tenancy_basis * s.rate, 2), p_pcts))[p_position]
         end
  from public.commission_split(p_branch, p_route_partner, p_tenant_count) s
$function$;

comment on function public.freeze_commission_lines(uuid, uuid, uuid, int, numeric, numeric, numeric[], int) is
  'Snapshot the additive split onto an application: one row per payee, with the basis, the slot the rate came from, and the amount earned. Given the tenancy basis, the split and this tenant''s position it apportions the TENANCY''s commission across the tenants so the lines sum to it exactly; without them it is a tenancy of one and the amount is this line''s basis times its rate. Called by create_referral and create_joint_referral; the only writer of application_commission_lines.';

revoke all on function public.freeze_commission_lines(uuid, uuid, uuid, int, numeric, numeric, numeric[], int) from public, anon, authenticated;
grant execute on function public.freeze_commission_lines(uuid, uuid, uuid, int, numeric, numeric, numeric[], int) to service_role;

-- ---------------------------------------------------------------------------
-- THE JOINT CREATE PATH, copied forward from what is deployed with exactly one
-- statement changed: the freeze call now carries the tenancy's fee, the split and
-- this tenant's position. Everything else is byte for byte what was there.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_joint_referral(p_branch uuid, p_tenants jsonb, p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text, p_rent numeric, p_tenancy_start date)
 RETURNS SETOF applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ag uuid; pid uuid; v_route uuid; v_mode text; v_portal_ok boolean; v_estate boolean;
  v_n int; v_pct numeric; v_fee numeric; v_basis numeric; v_agreement uuid;
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

  select f.fee_amount, f.fee_basis_weeks, f.agreement_id
    into v_fee, v_basis, v_agreement
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

-- ---------------------------------------------------------------------------
-- RE-FREEZING WHAT IS ALREADY THERE.
--
-- Every existing line gets the amount it should have had. Solo lines are
-- unchanged in value (their single line has always been the whole commission,
-- rounded once); joint lines are re-apportioned, which is where the pennies move.
--
-- The tenancy's fee is recovered as the SUM of its applications' fee_amount
-- rather than read from anywhere: those were themselves apportioned with the same
-- helper, so they sum to the tenancy fee exactly. That is the same number
-- create_joint_referral divided, which is what makes this a re-freeze and not a
-- recalculation from different inputs.
-- ---------------------------------------------------------------------------
with grp as (
  select a.tenancy_id,
         l.level,
         coalesce(l.org_id::text, 'name/' || lower(btrim(coalesce(l.org_name, '')))) as payee,
         l.rate,
         sum(coalesce(l.basis_amount, a.fee_amount, 0))            as tenancy_basis,
         array_agg(coalesce(a.share_percent, 0) order by a.tenancy_position) as pcts,
         array_agg(l.id order by a.tenancy_position)               as ids
    from public.applications a
    join public.application_commission_lines l on l.application_id = a.id
   where a.tenancy_id is not null
     and a.tenancy_position is not null
   group by 1, 2, 3, 4
),
spread as (
  select u.line_id, u.amt
    from grp g,
         lateral unnest(g.ids, public.apportion(round(g.tenancy_basis * g.rate, 2), g.pcts))
           as u(line_id, amt)
)
update public.application_commission_lines l
   set amount = s.amt
  from spread s
 where s.line_id = l.id
   and l.amount is distinct from s.amt;

-- Everything else is a tenancy of one, whose line has always been worth its basis
-- times its rate. Written down rather than left null so that `amount` means the
-- same thing on every row a reader meets from here on.
update public.application_commission_lines l
   set amount = round(coalesce(l.basis_amount, a.fee_amount, a.monthly_rent, 0) * l.rate, 2)
  from public.applications a
 where a.id = l.application_id
   and a.tenancy_id is null
   and l.amount is null;

-- ---------------------------------------------------------------------------
-- THE READ SIDE. commission_statement_lines computed round(basis * rate, 2) per
-- line, and its own comment described that as intended ("commission rounded to
-- the penny per line"), which is exactly the defect written down as a promise.
--
-- It now reads the frozen amount, falling back to the old arithmetic for rows
-- frozen before the column existed. The fallback is not a compromise: those rows
-- are worth what they were always worth, and the re-freeze above has already
-- given every row on this database an amount, so the coalesce only covers a row
-- created by code older than this migration.
--
-- Everything else in this function is copied forward unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commission_statement_lines(p_month date)
 RETURNS TABLE(payee_key text, level text, org_id uuid, org_name text, partner_id uuid, guarantee_ref text, tenant_name text, tenancy_place text, branch_name text, paid_on date, fee numeric, share_percent numeric, rate numeric, source text, commission numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with bounds as (
    select date_trunc('month', p_month)::date                         as m_start,
           (date_trunc('month', p_month) + interval '1 month')::date  as m_next
  ),
  paid as (
    select a.*
    from public.applications a, bounds b
    where a.paid_at is not null
      and (a.paid_at at time zone 'Europe/London') >= b.m_start
      and (a.paid_at at time zone 'Europe/London') <  b.m_next
      and coalesce(a.payment_state, '') <> 'refunded'
      and a.livemode is true
  ),
  -- Named split_line, not line: `line` is a built-in geometric type name, and a
  -- CTE that shadows a type is a trap nobody needs to walk into.
  split_line as (
    -- The frozen split. basis_amount is what the rate was a share of, snapshotted
    -- at creation; the fee is the fallback for rows frozen before that column
    -- existed, and is the same number by construction.
    select p.id as application_id, l.level, l.org_id, l.org_name, l.rate, l.source,
           coalesce(l.basis_amount, p.fee_amount, p.monthly_rent, 0) as basis,
           l.amount as frozen_amount
    from paid p
    join public.application_commission_lines l on l.application_id = p.id
    union all
    -- No split: a historic row, whose money was always the referring agency's.
    select p.id, 'agency', p.agency_id, coalesce(ag.name, '(unknown agency)'),
           coalesce(p.agent_rate, 0), null,
           coalesce(p.fee_amount, p.monthly_rent, 0),
           -- No frozen line at all, so nothing to read: this arm keeps the old
           -- arithmetic, which is all it ever had.
           null::numeric
    from paid p
    left join public.agencies ag on ag.id = p.agency_id
    where not exists (
      select 1 from public.application_commission_lines l where l.application_id = p.id
    )
  )
  select
    -- Same shape as the client's payeeKey (partner slug, level, org), so a payee
    -- has one identity whichever side of the wire names it.
    coalesce(pt.slug, '') || '|' || l.level || ':'
      || coalesce(l.org_id::text, 'name/' || lower(btrim(l.org_name))),
    l.level, l.org_id, l.org_name, p.partner_id,
    p.guarantee_ref,
    btrim(coalesce(p.tenant_first_name, '') || ' ' || coalesce(p.tenant_last_name, '')),
    case
      when p.tenancy_id is null or p.tenancy_position is null then ''
      else p.tenancy_position::text || ' of '
           || (select count(*) from public.applications s where s.tenancy_id = p.tenancy_id)::text
    end,
    coalesce(br.name, ''),
    (p.paid_at at time zone 'Europe/London')::date,
    l.basis, p.share_percent, l.rate, l.source,
    -- THE FROZEN AMOUNT, and round(basis * rate) only for a row frozen before
    -- that column existed. Computing it here per line is the defect: two lines of
    -- one tenancy could each round up and sum to a penny more than the tenancy's
    -- own commission.
    coalesce(l.frozen_amount, round(l.basis * l.rate, 2))
  from split_line l
  join paid p on p.id = l.application_id
  left join public.branches br on br.id = p.branch_id
  left join public.partners pt on pt.id = p.partner_id
$function$;

comment on function public.commission_statement_lines(date) is
  'Every commission line earned in the calendar month of p_month, one row per payee per application: applications that paid in the month (Europe/London), refunds excluded, live rows only. The amount is the one FROZEN on the line, so a joint tenancy''s lines sum to the tenancy''s commission exactly; it used to be round(basis * rate) computed here, which let two lines of one tenancy each round up. The SQL twin of accruePayees in liveAnalytics.ts.';
