-- A CLIMBER IS RANKED INSIDE THEIR OWN AGENCY.
--
-- partner_weekly_climbers ranks referrers within a PARTNER. On the house route
-- that put Regent's negotiators in one table with Northgate's, Southbank's and
-- Harborview's, picked the single biggest riser across all four, and named
-- them in the digest sent to every one of those agencies. So the weekly email
-- told an agency that the person of the week was somebody at a competitor.
--
-- It was withdrawn rather than rescoped when the digest was fixed, because
-- naming a competitor's staff is worse than naming nobody and there was no
-- agency-level twin. This is that twin, and the line comes back.
--
-- RANKED PER READER, NOT PER AGENCY, which is the part worth being careful
-- about. A brand manager over two agencies should see the best riser across
-- the two they hold, not two separate winners or one agency's. So the
-- partition is the READER, and the population is every referrer working at an
-- agency that reader covers -- exactly the set agency_weekly_digest sums for
-- them. A group director and a branch manager on the same estate then get
-- different, correct answers from the same function.
create or replace function public.agency_weekly_climber(
  p_user uuid,
  p_curr_start timestamptz, p_curr_end timestamptz,
  p_prev_start timestamptz, p_prev_end timestamptz)
returns table(climber_name text, climber_delta integer)
language sql stable security definer set search_path to ''
as $function$
  with mine as (
    -- The agencies this reader covers. Positions only: home_branch_id is not
    -- a boundary anywhere any more (20261006310000).
    select a.id
    from public.agencies a
    where exists (
      select 1 from public.user_scopes s
      where s.user_id = p_user
        and (   (s.kind = 'agency' and s.agency_id = a.id)
             or (s.kind = 'group'  and a.group_id is not null and s.group_id = a.group_id)
             or (s.kind = 'branch' and exists (
                   select 1 from public.branches b
                   where b.id = s.branch_id and b.agency_id = a.id)))
    )
  ),
  curr as (
    select a.referrer_id as rid, u.full_name as nm,
      coalesce(sum(a.monthly_rent) filter (
        where a.paid_at >= p_curr_start and a.paid_at < p_curr_end
          and a.payment_state is distinct from 'refunded'), 0) as fees,
      count(*) filter (
        where a.status not in ('withdrawn','expired')
          and a.sent_at >= p_curr_start and a.sent_at < p_curr_end) as sent
    from public.applications a
    join public.users u on u.id = a.referrer_id
    where a.livemode and a.referrer_id is not null and u.role <> 'superadmin'
      and a.agency_id in (select id from mine)
    group by a.referrer_id, u.full_name
  ),
  prev as (
    -- nm is carried only so last week's ranking breaks ties the same way this
    -- week's does. Rank the two differently and a name with no change in fees
    -- appears to have moved.
    select a.referrer_id as rid, u.full_name as nm,
      coalesce(sum(a.monthly_rent) filter (
        where a.paid_at >= p_prev_start and a.paid_at < p_prev_end
          and a.payment_state is distinct from 'refunded'), 0) as fees
    from public.applications a
    join public.users u on u.id = a.referrer_id
    where a.livemode and a.referrer_id is not null and u.role <> 'superadmin'
      and a.agency_id in (select id from mine)
    group by a.referrer_id, u.full_name
  ),
  curr_r as (select rid, nm, fees, sent, row_number() over (order by fees desc, nm asc) as rnk from curr),
  prev_r as (select rid, row_number() over (order by fees desc, nm asc) as rnk from prev),
  moved as (
    select c.nm, (p.rnk - c.rnk) as delta
    from curr_r c join prev_r p on p.rid = c.rid
    where (c.fees > 0 or c.sent > 0) and (p.rnk - c.rnk) > 0
  )
  -- One name, the biggest riser, ties broken by name so the answer is stable
  -- week to week rather than depending on the plan.
  select m.nm, m.delta::int from moved m order by m.delta desc, m.nm asc limit 1
$function$;

comment on function public.agency_weekly_climber(uuid, timestamptz, timestamptz, timestamptz, timestamptz) is
  'The biggest riser among the referrers working at the agencies one reader covers. Replaces partner_weekly_climbers in the weekly digest, which ranked across every agency on the house route and named a competitor''s staff member to all of them.';

-- Cron only. The digest is the single caller and it holds service_role.
revoke all on function public.agency_weekly_climber(uuid, timestamptz, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.agency_weekly_climber(uuid, timestamptz, timestamptz, timestamptz, timestamptz) to service_role;
