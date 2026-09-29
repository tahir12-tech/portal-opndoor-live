-- A VOLUME COUNTER BELONGS TO A ROUTE, NOT JUST TO A PARTY.
--
-- Q-05, amendments 3 and 4 of the four. Both are the same mechanism, which is
-- why they are one migration:
--
--   3. route-scoped volume counters
--   4. two independent counters for an agency on both routes
--
-- MATT'S RULING OF 2026-08-17 DECIDES THE SHAPE. "An agency exists once and is
-- never duplicated per supplier, so an agency under two suppliers is ONE party
-- shown with TWO counters." The Q-05 scoping recommended the opposite -- two
-- agency rows, one per supplier -- and the ruling overrides it.
--
-- One party with two counters means the counter's identity is (party, ROUTE),
-- not (party). So `agreement_volume` takes the route and filters on it, for
-- every counting scope, and a fourth scope 'route' is added for a supplier
-- counting its own whole book across all the agencies under it.
--
-- WHAT THIS CHANGES FOR AN AGENCY ON ONE ROUTE: nothing. Every application it
-- has is on that route, so the count is identical. The filter only bites where
-- there are two routes to tell apart, which is the case that was wrong.
--
-- WHAT I AM NOT CHANGING, and deliberately. I wrote in QUEUE.md that Matt's
-- ruling "means active_agreement_on's one-live-agreement-per-party rule has to
-- admit one agreement per party per route". That was my inference and it is
-- not what he said. An agency on two routes can hold ONE agreement and still
-- show two counters, because the counters are volume and the agreement is
-- terms -- which is exactly what this migration delivers. Whether a party may
-- hold two simultaneous agreements is a separate question nobody has asked, so
-- pricing_agreements_exclusivity is left exactly as it is.
--
-- THE SIGNATURE CHANGES RATHER THAN GAINING A DEFAULT. `p_route uuid` has no
-- DEFAULT and the two-argument form is dropped, so no caller can keep the old
-- route-blind behaviour by accident. There is exactly one caller,
-- resolve_pricing_agreement, and it already takes p_route_partner.
--
-- Extends the isolation suite: supabase/tests/a_suppliers_volume_is_its_own.test.sql.

-- ---------------------------------------------------------------------------
-- 1. The fourth scope.
--
-- 'route' only makes sense on a partner-scoped agreement: it means "everything
-- that came down this route", and a route IS a partner. Constraining it here
-- rather than trusting the editor keeps the meaning in one place. Both checks
-- validate clean against the 8 existing rows, all of which are 'agency'.
-- ---------------------------------------------------------------------------
alter table public.pricing_agreements
  drop constraint if exists pricing_agreements_counting_scope_check;
alter table public.pricing_agreements
  add constraint pricing_agreements_counting_scope_check
  check (counting_scope in ('group', 'agency', 'branch', 'route'));

alter table public.pricing_agreements
  drop constraint if exists pricing_agreements_route_scope_check;
alter table public.pricing_agreements
  add constraint pricing_agreements_route_scope_check
  check (counting_scope <> 'route' or scope_level = 'partner');

comment on column public.pricing_agreements.counting_scope is
  'Which applications count towards this agreement''s volume tiers: the '
  'branch, the agency, the group, or the whole route. Whichever is chosen, '
  'the count is always confined to ONE route, so an agency that sits under '
  'two suppliers has two counters and not one pooled total '
  '(Matt, 2026-08-17).';

-- ---------------------------------------------------------------------------
-- 2. The counter itself.
-- ---------------------------------------------------------------------------
drop function if exists public.agreement_volume(uuid, uuid);

create function public.agreement_volume(p_agreement uuid, p_branch uuid, p_route uuid)
returns integer
language sql stable security definer set search_path to ''
as $function$
  with pa as (select * from public.pricing_agreements where id = p_agreement),
  ctx as (
    select b.id as branch_id, b.agency_id, a.group_id
    from public.branches b left join public.agencies a on a.id = b.agency_id
    where b.id = p_branch
  )
  select count(*)::int
  from public.applications ap
  join public.branches b2 on b2.id = ap.branch_id
  left join public.agencies a2 on a2.id = b2.agency_id
  cross join pa cross join ctx
  where ap.paid_at is not null
    -- NOT THE DIRECT RAIL. A direct application is given a branch by the
    -- automatic matcher, so it landed inside that agency's negotiated volume
    -- and could push them into a better commission band; Opndoor's own direct
    -- business is not the matched agency's.
    --
    -- Written as `= 'Agent referral'` when that was fixed, which is the same
    -- slip 20261006580000 corrected in agency_weekly_digest: there are THREE
    -- rails, so including one excludes two. A SUPPLIER with a negotiated
    -- agreement counted zero applications forever, its tier never advanced,
    -- and it stayed on the worst band of a deal it had already outgrown --
    -- invisibly, because the count is simply always 0.
    and public.application_channel(ap.id) <> 'Direct'
    and ap.livemode
    -- ONE ROUTE, ALWAYS. This is the line that makes a counter belong to a
    -- route. partner_id on an application is the route it came down, frozen
    -- at creation. For an agency on a single route it changes no count at
    -- all; for an agency under two suppliers it is the difference between one
    -- pooled total, which would let volume bought from supplier A pay for a
    -- better band with supplier B, and the two separate counters Matt asked
    -- for.
    and ap.partner_id = p_route
    and ap.paid_at::date >= public.agreement_period_start(p_agreement)
    and case pa.counting_scope
          when 'branch' then b2.id = ctx.branch_id
          when 'agency' then b2.agency_id = ctx.agency_id
          when 'route'  then true   -- the route filter above IS the scope
          else a2.group_id is not distinct from ctx.group_id and ctx.group_id is not null
        end
$function$;

comment on function public.agreement_volume(uuid, uuid, uuid) is
  'How many paid, live, non-direct applications count towards this '
  'agreement''s volume tiers, on ONE route. The route argument has no default '
  'and the two-argument form is dropped, so a caller cannot silently keep the '
  'route-blind count that pooled an agency''s two suppliers into one total.';

-- The browser never calls this: it is reached through resolve_pricing_agreement
-- and the statement builders. Naming `public` in the revoke is required by
-- src/data/migrationPatterns.test.ts.
revoke all on function public.agreement_volume(uuid, uuid, uuid) from public, anon;
revoke all on function public.agreement_volume(uuid, uuid, uuid) from authenticated;
grant execute on function public.agreement_volume(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Its one caller, which already knows the route.
--
-- Body is 20261006120000's, unchanged except that the two agreement_volume
-- calls now pass p_route_partner.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_pricing_agreement(
  p_branch uuid, p_route_partner uuid, p_tenant_count integer default 1)
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
      and public.agreement_volume(ag.id, p_branch, p_route_partner) >= t.from_count
      and (t.to_count is null or public.agreement_volume(ag.id, p_branch, p_route_partner) < t.to_count)
    order by t.from_count desc
    limit 1
  )
  select ag.id, ag.scope_level,
         (select fee_basis_weeks from band),
         (select fee_basis_unit from band),
         coalesce((select agent_rate from tier), (select agent_rate from band))
  from agreement ag
$function$;
