-- FOUR PREDICATES FOR "CAN I REACH THIS", so 70-odd guards stop each writing
-- their own answer.
--
-- The sweep found 124 open sites bounding data by `partner_id = app_partner()`.
-- They are not 124 rules: they are one rule written out many times, and on the
-- agency rail it is the wrong one, because every agency shares the house
-- partner 'opndoor-agents'.
--
-- Rewriting each guard to inline the agency test would be 70 new copies of the
-- same thing, which is how the 124 happened. Instead there are four
-- predicates, one per kind of object a guard is about, and every guard calls
-- the one that matches what it is guarding.
--
-- ALL FOUR ANSWER TRUE FOR AN OPNDOOR ADMIN and for opndoor_manager, because
-- reading across the estate is their job. All four answer on the AGENCY for
-- our own estate and on the PARTNER everywhere else, which is the whole
-- distinction: a supplier is a company, an agency on the house route is not.
--
-- NONE OF THEM HAS A PARTNER-WIDE FALLBACK on the estate arm. That fallback --
-- `case when app_has_scope() then ... else true end` -- is what made the
-- least-configured account the widest: an unpositioned management user reached
-- everything. Here they reach nothing until somebody gives them a position,
-- which is the state invite-user should have created in the first place.

-- ---------------------------------------------------------------------------
-- AN AGENCY. app_reachable_agency already answers this and is kept as the
-- name callers know; this is the alias the other three are written against so
-- the family reads consistently.
-- ---------------------------------------------------------------------------
create or replace function public.app_may_reach_agency(p_agency uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select p_agency is not null and public.app_reachable_agency(p_agency)
$function$;

-- ---------------------------------------------------------------------------
-- A BRANCH, by the agency above it.
-- ---------------------------------------------------------------------------
create or replace function public.app_may_reach_branch(p_branch uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select coalesce(
    (select public.app_reachable_agency(b.agency_id)
       from public.branches b where b.id = p_branch),
    false)
$function$;

-- ---------------------------------------------------------------------------
-- AN APPLICATION. Note the referrer arm: a negotiator holds no position and
-- reaches their own referrals, which is what every applications guard has
-- always said and what app_scoped_agencies cannot express on its own.
-- ---------------------------------------------------------------------------
create or replace function public.app_may_reach_application(p_application uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select coalesce(
    (select public.is_admin()
         or public.app_role() = 'opndoor_manager'
         or (a.referrer_id = auth.uid())
         or (a.partner_id = public.app_partner()
             and public.app_may_reach_application_org(a.partner_id, a.agency_id, a.branch_id))
       from public.applications a where a.id = p_application),
    false)
$function$;

-- ---------------------------------------------------------------------------
-- A PERSON. Reading a colleague is OVERLAP (app_user_in_scope); WRITING to one
-- is CONTAINMENT (user_within_caller_scope). This is the read predicate, and
-- the two are deliberately different: two managers of one agency overlap, and
-- neither contains the other.
-- ---------------------------------------------------------------------------
create or replace function public.app_may_reach_user(p_user uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select coalesce(
    (select public.is_admin()
         or public.app_role() = 'opndoor_manager'
         or u.id = auth.uid()
         or (u.partner_id = public.app_partner()
             and case
                   -- Our estate: the agency is the boundary, so reach them
                   -- only through a position or a home branch we also reach.
                   when public.is_our_estate_partner(u.partner_id)
                     then exists (
                       select 1 from public.app_scoped_agencies() mine(agency_id)
                        where mine.agency_id in (
                          select a2.id from public.agencies a2
                           where a2.id in (
                             select b.agency_id from public.branches b
                              where b.id in (select public.app_scope_branches_for(u.id))
                             union
                             select b2.agency_id from public.branches b2 where b2.id = u.home_branch_id)))
                   -- A supplier is a company; everyone in it is a colleague.
                   else true
                 end)
       from public.users u where u.id = p_user),
    false)
$function$;

comment on function public.app_may_reach_agency(uuid) is
  'Can the caller reach this agency? The agency is the boundary on our own estate, the partner everywhere else. Admin and opndoor_manager reach everything.';
comment on function public.app_may_reach_branch(uuid) is
  'Can the caller reach this branch? Answered by the agency above it.';
comment on function public.app_may_reach_application(uuid) is
  'Can the caller reach this application? Their own referrals always; otherwise the agency on our estate, the partner elsewhere.';
comment on function public.app_may_reach_user(uuid) is
  'Can the caller READ this person? Overlap, not containment: two managers of one agency can see each other and neither may write to the other. Writing is user_within_caller_scope.';

revoke all on function public.app_may_reach_agency(uuid) from public;
revoke all on function public.app_may_reach_branch(uuid) from public;
revoke all on function public.app_may_reach_application(uuid) from public;
revoke all on function public.app_may_reach_user(uuid) from public;
grant execute on function public.app_may_reach_agency(uuid) to authenticated;
grant execute on function public.app_may_reach_branch(uuid) to authenticated;
grant execute on function public.app_may_reach_application(uuid) to authenticated;
grant execute on function public.app_may_reach_user(uuid) to authenticated;
