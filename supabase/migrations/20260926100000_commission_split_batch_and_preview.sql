-- ONE implementation of the additive rule, and two ways to ask it.
--
-- The agency page was drawing its payout lines from a TypeScript mirror of this
-- rule. That mirror is deleted: a second implementation of a money rule is how
-- the old most-specific-wins logic drifted between the resolver and the screen in
-- the first place. Both things the page needs are answered here instead:
--
--   commission_split_batch(branch_ids[])  -> every payee line for a page of
--                                            branches, ONE call per page load.
--   commission_preview(level, id, rate)   -> what a pending edit WOULD produce,
--                                            without writing anything.
--
-- The preview is the reason the rule is extracted into commission_split_rule:
-- a what-if needs the same arithmetic with one value substituted, and the only
-- way to guarantee it matches is to call the same function.

-- ---------------------------------------------------------------------------
-- THE RULE, once. The agency earns its explicit rate, or the Opndoor standard
-- when neither it nor the branch has one; explicit branch and group rates are
-- additive lines on top.
-- ---------------------------------------------------------------------------
create or replace function public.commission_split_rule(
  p_agency_id uuid, p_agency_name text, p_agency_rate numeric,
  p_branch_id uuid, p_branch_name text, p_branch_rate numeric,
  p_group_id  uuid, p_group_name  text, p_group_rate  numeric,
  p_standard  numeric
)
returns table (level text, org_id uuid, org_name text, rate numeric)
language sql immutable set search_path to ''
as $function$
  select 'agency', p_agency_id, p_agency_name,
         coalesce(p_agency_rate, case when p_branch_rate is null then p_standard end)
  where p_agency_id is not null
    and coalesce(p_agency_rate, case when p_branch_rate is null then p_standard end) is not null
  union all
  select 'branch', p_branch_id, p_branch_name, p_branch_rate where p_branch_rate is not null
  union all
  select 'group',  p_group_id,  p_group_name,  p_group_rate  where p_group_rate  is not null
$function$;

comment on function public.commission_split_rule(uuid, text, numeric, uuid, text, numeric, uuid, text, numeric, numeric) is
  'The additive commission rule itself, parameterised so a what-if preview can substitute one rate and get the same arithmetic. The only implementation anywhere.';

revoke all on function public.commission_split_rule(uuid, text, numeric, uuid, text, numeric, uuid, text, numeric, numeric) from public, anon;
grant execute on function public.commission_split_rule(uuid, text, numeric, uuid, text, numeric, uuid, text, numeric, numeric) to authenticated, service_role;

-- commission_split now loads the stored values and defers to the rule.
create or replace function public.commission_split(p_branch uuid, p_route_partner uuid)
returns table (level text, org_id uuid, org_name text, rate numeric)
language sql stable security definer set search_path to ''
as $function$
  select r.level, r.org_id, r.org_name, r.rate
  from public.partners p
  left join public.branches b on b.id = p_branch
  left join public.agencies a on a.id = b.agency_id
  left join public.agency_groups g on g.id = a.group_id
  cross join lateral public.commission_split_rule(
    a.id, a.name, a.agent_rate,
    b.id, b.name, b.agent_rate,
    g.id, g.name, g.agent_rate,
    p.agent_rate
  ) r
  where p.id = p_route_partner
$function$;

-- ---------------------------------------------------------------------------
-- Every line for a page of branches, in one round trip.
-- ---------------------------------------------------------------------------
create or replace function public.commission_split_batch(p_branches uuid[])
returns table (branch_id uuid, level text, org_id uuid, org_name text, rate numeric)
language sql stable security definer set search_path to ''
as $function$
  select b.id, s.level, s.org_id, s.org_name, s.rate
  from public.branches b
  cross join lateral public.commission_split(b.id, b.partner_id) s
  where b.id = any(p_branches)
    -- Only branches the caller can already see; this adds no reach.
    and (public.is_admin() or public.app_reachable_agency(b.agency_id)
         or (public.app_has_scope() and b.id in (select public.app_scope_branches())))
$function$;

comment on function public.commission_split_batch(uuid[]) is
  'Every commission payee line for a set of branches, one call per page load. Narrowed to branches the caller can already see.';

revoke all on function public.commission_split_batch(uuid[]) from public, anon;
grant execute on function public.commission_split_batch(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- What a pending edit WOULD produce. Reads only; writes nothing.
-- ---------------------------------------------------------------------------
create or replace function public.commission_preview(p_level text, p_id uuid, p_rate numeric)
returns table (worst_total numeric, worst_branch text, branches_affected int)
language sql stable security definer set search_path to ''
as $function$
  with affected as (
    select b.id, b.name, b.agent_rate as branch_rate, b.partner_id,
           a.id as agency_id, a.name as agency_name, a.agent_rate as agency_rate,
           g.id as group_id, g.name as group_name, g.agent_rate as group_rate
    from public.branches b
    join public.agencies a on a.id = b.agency_id
    left join public.agency_groups g on g.id = a.group_id
    where (p_level = 'branch' and b.id = p_id)
       or (p_level = 'agency' and b.agency_id = p_id)
       or (p_level = 'group'  and a.group_id = p_id)
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
  from totals
$function$;

comment on function public.commission_preview(text, uuid, numeric) is
  'The worst branch total a pending rate change would produce, without writing it. Calls commission_split_rule with the draft value substituted, so the preview and the saved result cannot disagree.';

revoke all on function public.commission_preview(text, uuid, numeric) from public, anon;
grant execute on function public.commission_preview(text, uuid, numeric) to authenticated, service_role;
