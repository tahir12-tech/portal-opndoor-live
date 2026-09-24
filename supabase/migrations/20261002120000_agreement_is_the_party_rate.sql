-- AN AGREEMENT IS THE PARTY'S RATE, NOT A NEW KIND OF STANDARD.
--
-- M4 fed a resolved agreement's rate into the rule's STANDARD slot, on the
-- reasoning that it "stands in for standard terms". Under the one-rate-per-party
-- ruling that is the wrong slot, and the difference is not cosmetic:
--
--   the agency default is suppressed when a branch sets its own rate (the branch
--   is doing the referring), but an EXPLICIT agency rate is never suppressed.
--
-- So an agency on a 20% agreement, at a branch with a 3% line and a group with a
-- 2% line, paid out 5% — the agreement vanished entirely — where the same agency
-- on an explicit 20% rate would have paid 25%. The ruling is that an additive
-- agreement "resolves this party's own line" and everything else adds "as it does
-- on top of an explicit rate", so the agreement goes in the party's own slot:
--
--   agency-scoped agreement  -> the agency's line
--   group-scoped agreement   -> the group's line
--   partner-scoped agreement -> standard terms, which is what a partner IS
--
-- This is also the shape the ruling implies: a party holds a rate or an
-- agreement, and the agreement is simply the negotiated form of the rate.
--
-- commission_split_for is extracted so that ONE function decides how an
-- agreement enters the rule, and the 50% cap then checks the real arithmetic at
-- the agreement's worst rate instead of re-deriving a parallel sum.

create or replace function public.commission_split_for(
  p_branch uuid, p_route_partner uuid, p_agreement uuid, p_rate numeric
)
returns table (level text, org_id uuid, org_name text, rate numeric)
language sql stable security definer set search_path to ''
as $function$
  with pa as (
    select scope_level, coverage from public.pricing_agreements where id = p_agreement
  )
  select r.level, r.org_id, r.org_name, r.rate
  from public.partners p
  left join public.branches b on b.id = p_branch
  left join public.agencies a on a.id = b.agency_id
  left join public.agency_groups g on g.id = a.group_id
  left join pa on true
  cross join lateral public.commission_split_rule(
    a.id, a.name,
    -- An all-in agreement ON THE GROUP is the whole commission for everything
    -- under it, so the agency contributes nothing of its own.
    case when pa.coverage = 'all_in' and pa.scope_level = 'group' then null
         when pa.scope_level = 'agency' then p_rate
         else a.agent_rate end,
    b.id, b.name,
    -- Nothing inside an all-in subtree contributes a line.
    case when pa.coverage = 'all_in' then null else b.agent_rate end,
    g.id, g.name,
    case when pa.scope_level = 'group' then p_rate else g.agent_rate end,
    -- Standard terms. Under all-in there is no fallback line to award: the
    -- agreement is the answer for its whole subtree.
    case when pa.coverage = 'all_in' then null
         when pa.scope_level = 'partner' then coalesce(p_rate, p.agent_rate)
         else p.agent_rate end
  ) r
  where p.id = p_route_partner
$function$;

comment on function public.commission_split_for(uuid, uuid, uuid, numeric) is
  'The additive rule with one named agreement applied at one named rate. The only place that decides which slot an agreement occupies, so the live split and the 50% cap cannot disagree about what a deal is worth.';

revoke all on function public.commission_split_for(uuid, uuid, uuid, numeric) from public, anon;
grant execute on function public.commission_split_for(uuid, uuid, uuid, numeric) to authenticated, service_role;

-- The live split is that function at the rate the agreement currently resolves to.
create or replace function public.commission_split(
  p_branch uuid, p_route_partner uuid, p_tenant_count int default 1
)
returns table (level text, org_id uuid, org_name text, rate numeric)
language sql stable security definer set search_path to ''
as $function$
  -- The left join is load-bearing: resolve_pricing_agreement returns NO rows when
  -- a party is on standard terms, and an inner join would then return no split at
  -- all rather than the standard one line.
  select s.level, s.org_id, s.org_name, s.rate
  from (select 1) one
  left join lateral public.resolve_pricing_agreement(p_branch, p_route_partner, p_tenant_count) ag on true
  cross join lateral public.commission_split_for(p_branch, p_route_partner, ag.id, ag.agent_rate) s
$function$;

revoke all on function public.commission_split(uuid, uuid, int) from public, anon;
grant execute on function public.commission_split(uuid, uuid, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- THE 50% CAP, now measured rather than re-derived: every branch the agreement
-- reaches, split by the real rule, at the highest rate the agreement can ever
-- produce (any band, any volume tier).
-- ---------------------------------------------------------------------------
create or replace function public.assert_agreement_within_cap(p_agreement uuid)
returns numeric
language plpgsql stable security definer set search_path to ''
as $function$
declare v_worst numeric; v_mx numeric;
begin
  v_mx := public.agreement_max_rate(p_agreement);

  select max(t.total) into v_worst
  from (
    select (select coalesce(sum(s.rate), 0)
              from public.commission_split_for(b2.id, b2.partner_id, pa.id,
                                               nullif(v_mx, 0)) s) as total
    from public.pricing_agreements pa
    join public.branches b2 on true
    join public.agencies a2 on a2.id = b2.agency_id
    where pa.id = p_agreement
      and ((pa.scope_level = 'agency'  and a2.id = pa.scope_id)
        or (pa.scope_level = 'group'   and a2.group_id = pa.scope_id)
        or (pa.scope_level = 'partner' and b2.partner_id = pa.scope_id))
  ) t;

  if v_worst is not null and v_worst > 0.50 then
    raise exception 'This agreement could take a branch to % of the guarantee fee. The most a branch may pay out in total is 50%%.',
      to_char(round(v_worst * 100, 2), 'FM999990.00') || '%' using errcode = '22023';
  end if;
  return coalesce(v_worst, 0);
end $function$;

revoke all on function public.assert_agreement_within_cap(uuid) from public, anon;
grant execute on function public.assert_agreement_within_cap(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The grant the awaiting_staff_send migration (20260925150000) missed.
--
-- applications is a DENYLIST grant: a new column is not selectable by
-- authenticated until a migration names it, which fails closed and is caught by
-- supabase/tests/applications_column_grants.test.sql. That test has been red
-- since awaiting_staff_send landed. It is a staff queue flag, not a commission
-- figure, so it belongs on the grant rather than on the denylist.
-- ---------------------------------------------------------------------------
grant select (awaiting_staff_send) on public.applications to authenticated;

-- ---------------------------------------------------------------------------
-- The agency screen has to be able to say WHICH KIND of deal this is: an all-in
-- agreement means the branches below earn nothing of their own, and a page that
-- shows the bands without saying so is describing half the deal.
-- ---------------------------------------------------------------------------
drop function if exists public.agreement_for_agency(uuid);
create or replace function public.agreement_for_agency(p_agency uuid)
returns table (
  agreement_id uuid, scope_level text, coverage text, period text, counting_scope text,
  is_standard boolean, note text, effective_from date, period_start date, volume integer,
  bands jsonb, tiers jsonb, next_rate numeric, next_basis numeric
)
language sql stable security definer set search_path to ''
as $function$
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
             'weeks', bd.fee_basis_weeks, 'rate', bd.agent_rate) order by bd.min_tenants), '[]'::jsonb)
            from public.pricing_agreement_bands bd where bd.agreement_id = pa.id),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'from', t.from_count, 'to', t.to_count, 'rate', t.agent_rate) order by t.from_count), '[]'::jsonb)
            from public.commission_tiers t where t.agreement_id = pa.id),
         (select agent_rate from r), (select fee_basis_weeks from r)
  from public.pricing_agreements pa
  where pa.id = (select id from r)
$function$;

revoke all on function public.agreement_for_agency(uuid) from public, anon;
grant execute on function public.agreement_for_agency(uuid) to authenticated;
