-- ONE AGENCY, TWO COUNTERS, AND THE SCREEN SAYS SO.
--
-- 20261006750000 made the volume counter belong to a route and dropped the
-- two-argument `agreement_volume`, so that no caller could keep the old
-- route-blind count by accident. It found one caller, resolve_pricing_agreement,
-- and missed a second: agreement_for_agency, which is what the Agreement
-- editor and the agency page read. Three test files went from passing to
-- erroring on the next full run, which is what the run is for.
--
-- The correction is in a new migration rather than an edit to that one,
-- because 20261006750000 has already been applied to dev and re-applying a
-- migration makes dev disagree with a clean filename-order run.
--
-- AND WHILE FIXING IT, THE OTHER HALF OF MATT'S RULING. He said an agency
-- under two suppliers is one party shown with TWO COUNTERS. 20261006750000
-- delivered the counting; this delivers the showing. `volume` stays exactly
-- as it was -- the count on the agency's own route -- so nothing that reads it
-- changes meaning, and a new `volumes` carries one entry per route the agency
-- has actually transacted on:
--
--   [{"route_id": "...", "route": "Opndoor agents", "count": 12},
--    {"route_id": "...", "route": "Harbour Lets",   "count": 3}]
--
-- An agency on one route gets a single entry and the screen reads as it
-- always did. The array is built from routes the agency has PAID business on,
-- not from every partner it has a relationship with, so a route that has
-- never transacted does not appear as a permanent zero.
--
-- Each entry is the real agreement_volume for that route, not a raw count:
-- the agreement's period, its counting scope, the direct-rail exclusion and
-- the livemode test all apply, so the numbers on screen are the numbers the
-- tiers are actually resolved against.

-- DROPPED AND RECREATED, not replaced: adding an OUT column changes the row
-- type, and Postgres refuses `create or replace` for that. A drop takes the
-- grants with it, so they are restored below exactly as 20261006330000 set
-- them -- authenticated and service_role, never anon.
drop function if exists public.agreement_for_agency(uuid);

create function public.agreement_for_agency(p_agency uuid)
returns table(agreement_id uuid, scope_level text, coverage text, period text,
              counting_scope text, is_standard boolean, note text, effective_from date,
              period_start date, volume integer, volumes jsonb,
              bands jsonb, tiers jsonb, next_rate numeric, next_basis numeric)
language plpgsql stable security definer set search_path to ''
as $function$
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
  ),
  -- EVERY ROUTE THIS AGENCY HAS ACTUALLY TRANSACTED ON. applications.partner_id
  -- is the route, frozen at creation, so this is the honest list: the routes
  -- money has come down, rather than every relationship on file.
  routes as (
    select distinct ap.partner_id as route_id
    from public.applications ap
    where ap.agency_id = p_agency and ap.paid_at is not null and ap.livemode
      and public.application_channel(ap.id) <> 'Direct'
  )
  select pa.id, pa.scope_level, pa.coverage, pa.period, pa.counting_scope, pa.is_standard, pa.note, pa.effective_from,
         public.agreement_period_start(pa.id),
         -- Unchanged meaning: the agency's own route.
         public.agreement_volume(pa.id, (select branch_id from b1), (select partner_id from b1)),
         -- And every route it has, so two suppliers read as two counters.
         (select coalesce(jsonb_agg(jsonb_build_object(
             'route_id', rt.route_id,
             'route', coalesce(p2.name, 'Unknown route'),
             'count', public.agreement_volume(pa.id, (select branch_id from b1), rt.route_id)
           ) order by coalesce(p2.name, '')), '[]'::jsonb)
          from routes rt left join public.partners p2 on p2.id = rt.route_id),
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

comment on function public.agreement_for_agency(uuid) is
  'The pricing agreement in force for one agency, with its bands, tiers and '
  'volume. `volume` is the count on the agency''s own route; `volumes` is one '
  'entry per route it has paid business on, because an agency under two '
  'suppliers is one party with two counters and not one pooled total '
  '(Matt, 2026-08-17).';

revoke all on function public.agreement_for_agency(uuid) from public, anon;
grant execute on function public.agreement_for_agency(uuid) to authenticated, service_role;
