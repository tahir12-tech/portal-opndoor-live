-- THE LAST FIVE ASK FOR THE SECOND FACTOR.
--
-- Round 6, M8, the half I left. Seven definer functions answered a
-- password-only session where RLS deliberately gives nothing; two were plpgsql
-- and were guarded in 20261006570000. These five are `language sql`, and five
-- of them state commercial terms:
--
--   agreement_for_agency     the negotiated deal for an agency
--   commission_preview       what a rate change would cost, before it is made
--   commission_split_batch   who is paid what at each branch
--   org_rate_tiers           every rate at every tier the caller reaches
--   org_deed_readiness       the shape of the caller's estate
--
-- is_aal2() reads `coalesce(jwt->>'aal','aal1') = 'aal2'`, so this is any
-- ordinary pre-TOTP or never-enrolled session, not a contrived one. Same class
-- as staff_payment_page_token and agency_branches_for_match in 20261006500000.
--
-- HOW, AND WHY NOT THE OBVIOUS WAY. The obvious fix is `and public.is_aal2()`
-- in the WHERE. These bodies have union arms and CTEs, so that means a
-- predicate on every arm, and getting one wrong fails silently in the
-- permissive direction. Twice today a mechanical edit to a multi-arm condition
-- moved what an operator applied to. So instead each function becomes plpgsql
-- with the guard first and `return query <the original body, untouched>`:
--
--   * the body moves as one span, so no arm can be missed and no operator can
--     re-associate -- the generator asserted that stripping the wrapper back
--     off recovers the original byte for byte, and that each body is a single
--     statement judged with comments and string literals blanked;
--   * it raises 42501 'MFA required' like every other guard in the schema,
--     rather than returning empty, so a caller is told what to do;
--   * it satisfies guardsAreNullSafe.test.ts, which an inline predicate would
--     not, because that lint only understands `if not ... then raise`.
--
-- WHAT IT COSTS: a plpgsql function cannot be inlined into a calling query.
-- Checked before doing it: all five are called exactly once each, standalone,
-- from the client by .rpc() (orgService.ts:571, :734, :710,
-- positionsService.ts:399, hydrate.ts:121), and none is called from another
-- SQL function. Nothing loses inlining that had it.

-- agreement_for_agency(uuid)
CREATE OR REPLACE FUNCTION public.agreement_for_agency(p_agency uuid)
 RETURNS TABLE(agreement_id uuid, scope_level text, coverage text, period text, counting_scope text, is_standard boolean, note text, effective_from date, period_start date, volume integer, bands jsonb, tiers jsonb, next_rate numeric, next_basis numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  return query
  with b1 as (
    select b.id as branch_id, b.partner_id from public.branches b
    -- AN AGREEMENT IS COMMERCIALLY SENSITIVE, and it is also a commission
    -- figure: the org test was here and the level test was not.
    where b.agency_id = p_agency
      and public.app_may_reach_agency(p_agency)
      and public.may_see_commission()
    order by b.created_at limit 1
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
  where pa.id = (select id from r);
end $function$;

-- commission_preview(text,uuid,numeric)
CREATE OR REPLACE FUNCTION public.commission_preview(p_level text, p_id uuid, p_rate numeric)
 RETURNS TABLE(worst_total numeric, worst_branch text, branches_affected integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  return query
  with affected as (
    select b.id, b.name, b.agent_rate as branch_rate, b.partner_id,
           a.id as agency_id, a.name as agency_name, a.agent_rate as agency_rate,
           g.id as group_id, g.name as group_name, g.agent_rate as group_rate
    from public.branches b
    join public.agencies a on a.id = b.agency_id
    left join public.agency_groups g on g.id = a.group_id
    where public.may_see_commission()
      -- The preview walked every branch under the named party with no test that
      -- the caller reaches it.
      and public.app_may_reach_agency(a.id)
      and ((p_level = 'branch' and b.id = p_id)
        or (p_level = 'agency' and b.agency_id = p_id)
        or (p_level = 'group'  and a.group_id = p_id))
  ),
  totals as (
    select f.name,
           (select coalesce(sum(r.rate), 0)
              from public.commission_split_rule(
                f.agency_id, f.agency_name,
                case when p_level = 'agency' then p_rate else f.agency_rate end,
                f.id, f.name,
                case when p_level = 'branch' then p_rate else f.branch_rate end,
                f.group_id, f.group_name,
                case when p_level = 'group'  then p_rate else f.group_rate end,
                (select p2.agent_rate from public.partners p2 where p2.id = f.partner_id)
              ) r) as total
    from affected f
  )
  select coalesce(max(total), 0),
         (select name from totals order by total desc nulls last limit 1),
         count(*)::int
  from totals;
end $function$;

-- commission_split_batch(uuid[])
CREATE OR REPLACE FUNCTION public.commission_split_batch(p_branches uuid[])
 RETURNS TABLE(branch_id uuid, level text, org_id uuid, org_name text, rate numeric, source text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  return query
  select b.id, s.level, s.org_id, s.org_name, s.rate, s.source
  from public.branches b
  cross join lateral public.commission_split(b.id, b.partner_id) s
  where b.id = any(p_branches)
    and public.may_see_commission()
    -- Only branches the caller can already see; this adds no reach.
    and (public.is_admin() or public.app_reachable_agency(b.agency_id)
         or (public.app_has_scope() and b.id in (select public.app_scope_branches())));
end $function$;

-- org_deed_readiness()
CREATE OR REPLACE FUNCTION public.org_deed_readiness()
 RETURNS TABLE(agency_id uuid, branch_id uuid, ready boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  return query
  with vis_agency as (
    select a.id, a.group_id
    from public.agencies a
    join public.partners p on p.id = a.partner_id
    where p.referencing_mode = 'opndoor_referenced'
      -- WAS: `else a.partner_id = app_partner()` for anyone unpositioned,
      -- which on this rail is every agency. app_reachable_agency has no such
      -- arm, and answers true for admin and opndoor_manager.
      and public.app_reachable_agency(a.id)
  ),
  per_branch as (
    select va.id as agency_id, b.id as branch_id,
           public.branch_notification_fallback_exists(b.id) as ready
    from vis_agency va
    join public.branches b on b.agency_id = va.id
  )
  select pb.agency_id, pb.branch_id, pb.ready from per_branch pb
  union all
  select va.id, null::uuid,
         coalesce((select bool_and(pb.ready) from per_branch pb where pb.agency_id = va.id), false)
  from vis_agency va;
end $function$;

-- org_rate_tiers()
CREATE OR REPLACE FUNCTION public.org_rate_tiers()
 RETURNS TABLE(level text, org_id uuid, partner_rate numeric, agent_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  return query
  select 'group', g.id, g.partner_rate, g.agent_rate
    from public.agency_groups g
   where public.may_see_commission() and public.app_reachable_group(g.id, g.partner_id)
  union all
  select 'agency', a.id, a.partner_rate, a.agent_rate
    from public.agencies a
   where public.may_see_commission() and public.app_reachable_agency(a.id)
  union all
  select 'branch', b.id, null::numeric, b.agent_rate
    from public.branches b
   where public.may_see_commission() and public.app_may_reach_branch(b.id);
end $function$;

