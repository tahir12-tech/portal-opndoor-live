-- A PAYOUT LINE NAMES WHERE ITS RATE CAME FROM.
--
-- The agency page called Regent's 20% "Opndoor standard 20%". The standard is
-- 10%; 20% is their negotiated agreement. The screen guessed, and it guessed
-- with the only evidence it had:
--
--     standardOnly = one agency line && no explicit agency rate && no branch rate
--
-- which is true of a standard line AND of an agreement line, because the whole
-- point of one-rate-per-party is that an agreement party has no explicit rate.
-- Three surfaces then disagreed about one number: the agreement said 20%, "Rates
-- set" said nothing was set, and the payout table called 20% the standard.
--
-- The screen should not be inferring this at all. The rule knows which slot each
-- rate came out of, so it now says, and every consumer reads the same answer:
--
--   'standard'   the partner's rate, because nobody has negotiated anything
--   'agreement'  a negotiated agreement at that level
--   'rate'       an explicit rate somebody set on that party
--
-- The column is ADDED, never reordered, and every existing caller selects by
-- name, so create_referral, create_joint_referral and commission_total are
-- untouched by it.

-- Postgres will not widen a function's OUT columns in place, so the four are
-- dropped and recreated in dependency order. commission_preview is left alone:
-- it selects sum(r.rate) from the rule by name, so a new column is invisible to
-- it. commission_total, create_referral and create_joint_referral likewise
-- select by name and are untouched.
drop function if exists public.commission_split_batch(uuid[]);
drop function if exists public.commission_split(uuid, uuid, int);
drop function if exists public.commission_split_for(uuid, uuid, uuid, numeric);
drop function if exists public.commission_split_rule(uuid, text, numeric, uuid, text, numeric, uuid, text, numeric, numeric);

-- ---------------------------------------------------------------------------
-- 1. The rule reports the slot. Its arithmetic is unchanged, line for line.
-- ---------------------------------------------------------------------------
create or replace function public.commission_split_rule(
  p_agency_id uuid, p_agency_name text, p_agency_rate numeric,
  p_branch_id uuid, p_branch_name text, p_branch_rate numeric,
  p_group_id  uuid, p_group_name  text, p_group_rate  numeric,
  p_standard  numeric
)
returns table (level text, org_id uuid, org_name text, rate numeric, from_slot text)
language sql immutable set search_path to ''
as $function$
  select 'agency', p_agency_id, p_agency_name,
         coalesce(p_agency_rate, case when p_branch_rate is null then p_standard end),
         -- Which of the two arms of that coalesce actually supplied it.
         case when p_agency_rate is not null then 'party' else 'standard' end
  where p_agency_id is not null
    and coalesce(p_agency_rate, case when p_branch_rate is null then p_standard end) is not null
  union all
  select 'branch', p_branch_id, p_branch_name, p_branch_rate, 'party' where p_branch_rate is not null
  union all
  select 'group',  p_group_id,  p_group_name,  p_group_rate,  'party' where p_group_rate  is not null
$function$;

comment on function public.commission_split_rule(uuid, text, numeric, uuid, text, numeric, uuid, text, numeric, numeric) is
  'The additive commission rule itself, parameterised so a what-if preview can substitute one rate and get the same arithmetic. from_slot says whether a line came from the party''s own slot or from standard terms; commission_split_for turns that into standard / agreement / rate, because only it knows whether the party slot was filled by an agreement. The only implementation anywhere.';

revoke all on function public.commission_split_rule(uuid, text, numeric, uuid, text, numeric, uuid, text, numeric, numeric) from public, anon;
grant execute on function public.commission_split_rule(uuid, text, numeric, uuid, text, numeric, uuid, text, numeric, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. commission_split_for knows which slots the agreement filled, so it is the
--    one place that can name the source.
-- ---------------------------------------------------------------------------
create or replace function public.commission_split_for(
  p_branch uuid, p_route_partner uuid, p_agreement uuid, p_rate numeric
)
returns table (level text, org_id uuid, org_name text, rate numeric, source text)
language sql stable security definer set search_path to ''
as $function$
  with pa as (
    select scope_level, coverage from public.pricing_agreements where id = p_agreement
  )
  select r.level, r.org_id, r.org_name, r.rate,
         case
           -- The party slot at the level the agreement sits on was filled by it.
           when r.from_slot = 'party' and pa.scope_level = r.level then 'agreement'
           when r.from_slot = 'party'                              then 'rate'
           -- The standard slot carries a PARTNER-scoped agreement's rate when
           -- there is one; otherwise it is the partner's own standard rate.
           when pa.scope_level = 'partner' and p_rate is not null   then 'agreement'
           else 'standard'
         end
  from public.partners p
  left join public.branches b on b.id = p_branch
  left join public.agencies a on a.id = b.agency_id
  left join public.agency_groups g on g.id = a.group_id
  left join pa on true
  cross join lateral public.commission_split_rule(
    a.id, a.name,
    case when pa.coverage = 'all_in' and pa.scope_level = 'group' then null
         when pa.scope_level = 'agency' then p_rate
         else a.agent_rate end,
    b.id, b.name,
    case when pa.coverage = 'all_in' then null else b.agent_rate end,
    g.id, g.name,
    case when pa.scope_level = 'group' then p_rate else g.agent_rate end,
    case when pa.coverage = 'all_in' then null
         when pa.scope_level = 'partner' then coalesce(p_rate, p.agent_rate)
         else p.agent_rate end
  ) r
  where p.id = p_route_partner
$function$;

revoke all on function public.commission_split_for(uuid, uuid, uuid, numeric) from public, anon;
grant execute on function public.commission_split_for(uuid, uuid, uuid, numeric) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The two things the screens call.
-- ---------------------------------------------------------------------------
create or replace function public.commission_split(
  p_branch uuid, p_route_partner uuid, p_tenant_count int default 1
)
returns table (level text, org_id uuid, org_name text, rate numeric, source text)
language sql stable security definer set search_path to ''
as $function$
  select s.level, s.org_id, s.org_name, s.rate, s.source
  from (select 1) one
  left join lateral public.resolve_pricing_agreement(p_branch, p_route_partner, p_tenant_count) ag on true
  cross join lateral public.commission_split_for(p_branch, p_route_partner, ag.id, ag.agent_rate) s
$function$;

revoke all on function public.commission_split(uuid, uuid, int) from public, anon;
grant execute on function public.commission_split(uuid, uuid, int) to authenticated, service_role;

create or replace function public.commission_split_batch(p_branches uuid[])
returns table (branch_id uuid, level text, org_id uuid, org_name text, rate numeric, source text)
language sql stable security definer set search_path to ''
as $function$
  select b.id, s.level, s.org_id, s.org_name, s.rate, s.source
  from public.branches b
  cross join lateral public.commission_split(b.id, b.partner_id) s
  where b.id = any(p_branches)
    -- Only branches the caller can already see; this adds no reach.
    and (public.is_admin() or public.app_reachable_agency(b.agency_id)
         or (public.app_has_scope() and b.id in (select public.app_scope_branches())))
$function$;

revoke all on function public.commission_split_batch(uuid[]) from public, anon;
grant execute on function public.commission_split_batch(uuid[]) to authenticated;
