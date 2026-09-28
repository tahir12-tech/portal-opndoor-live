-- THE PEOPLE SURFACE WAS NEVER CLOSED.
--
-- An independent review of the five isolation rules, given only the rules and
-- the code, found two criticals and several more. Its summary is exactly
-- right and worth writing down: the 20261006 batch removed the partner-wide
-- fail-open from the OBJECT surfaces (applications, agencies, branches,
-- contacts) and built app_may_reach_*, and never applied either to the PEOPLE
-- surface -- and app_scoped_agencies() reads a column on that surface which
-- nothing guards.
--
-- ===========================================================================
-- 1. A MANAGER COULD REWRITE THEIR OWN BOUNDARY (critical, reproduced on dev)
-- ===========================================================================
-- app_scoped_agencies() unions in the agency above users.home_branch_id, with
-- no role test. users_mgmt_update admits `id = auth.uid()` ahead of both the
-- containment and the level test, and no trigger covers home_branch_id: the
-- five that exist cover id, role/status, sees_commission,
-- receives_commission_statements and receives_notifications.
--
-- Measured on dev as Rosa Vance, a Manager at Regent's:
--
--   before                                7 applications, 1 agency
--   PATCH own home_branch_id -> Northgate  succeeded
--   after                                21 applications, 2 agencies
--   UPDATE Northgate's applications      14 rows written
--
-- TWO FIXES, because either alone leaves the other reachable.
--
-- (a) THE COLUMN IS ONLY MEANINGFUL FOR A NEGOTIATOR, and that is what it was
--     added for: "a negotiator holds no scope row, so their only location is
--     the branch they were invited into". A management user's reach comes from
--     user_scopes. Honouring home_branch_id for them was never intended and is
--     what turned a profile field into a permission.
--
-- (b) AND THE COLUMN IS GUARDED ANYWAY, because a Negotiator moving their own
--     home branch is still a Negotiator changing where they sit, and because
--     a field that grants anything should not be writable by its subject.

create or replace function public.app_scoped_agencies()
returns setof uuid
language sql stable security definer set search_path to ''
as $function$
  select a.id
  from public.agencies a
  where exists (
    select 1 from public.user_scopes s
    where s.user_id = auth.uid()
      and (   (s.kind = 'agency' and s.agency_id = a.id)
           or (s.kind = 'group'  and a.group_id is not null and s.group_id = a.group_id)
           or (s.kind = 'branch' and exists (
                 select 1 from public.branches b
                 where b.id = s.branch_id and b.agency_id = a.id)))
  )
  union
  -- A NEGOTIATOR ONLY. This arm exists because a negotiator holds no scope
  -- row and their only location is the branch they were invited into. For a
  -- management user it was a second, unguarded way to claim an agency: set
  -- your own home_branch_id and the union hands you that agency, on top of
  -- the one you already had, so nothing on screen even looks different.
  select b.agency_id
  from public.users u
  join public.branches b on b.id = u.home_branch_id
  where u.id = auth.uid() and u.role = 'referrer'
$function$;

comment on function public.app_scoped_agencies() is
  'The agencies the caller reaches: their positions, plus -- for a NEGOTIATOR, who holds no position -- the agency above their home branch. The role test on that second arm is load-bearing: without it a Manager could PATCH their own home_branch_id and union another agency into their own boundary.';

-- The column itself, guarded like every other column on this table that means
-- something. A Negotiator's home branch is set by whoever invites or places
-- them, not by the person themselves.
create or replace function public.users_home_branch_guard()
returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  if public.is_admin() or current_user in ('service_role','postgres','supabase_admin') then
    return new;
  end if;
  -- Moving somebody INTO a branch you cannot reach is the escalation; moving
  -- them out of one you can is ordinary. Both ends are checked.
  if new.home_branch_id is not null and not public.app_may_reach_branch(new.home_branch_id) then
    raise exception 'You can only place somebody at a branch you reach.' using errcode = '42501';
  end if;
  if old.home_branch_id is not null and not public.app_may_reach_branch(old.home_branch_id) then
    raise exception 'You can only move somebody out of a branch you reach.' using errcode = '42501';
  end if;
  -- And never your own: a home branch is a placement, and placing yourself is
  -- the shape of the escalation above even once the role test is in place.
  if new.id = auth.uid() then
    raise exception 'Your own home branch is set by your manager, not by you.' using errcode = '42501';
  end if;
  return new;
end $function$;

drop trigger if exists users_home_branch_guard on public.users;
create trigger users_home_branch_guard
  before update of home_branch_id on public.users
  for each row
  when (new.home_branch_id is distinct from old.home_branch_id)
  execute function public.users_home_branch_guard();

-- ===========================================================================
-- 2. THE PEOPLE READS KEPT THE FAIL-OPEN (critical)
-- ===========================================================================
-- users_select and user_scopes_select still carry
--     and (not public.app_has_scope() or public.app_user_in_scope(id))
-- so a management user with NO position reads every person on the partner --
-- on the house route, every agency's staff, with name, email, role, MFA state
-- and home branch. The developer arm has no scope test at all.
--
-- app_may_reach_user was written in 20261006220000 and never wired in. It is
-- the OVERLAP form, which is the right test for reading a colleague.

drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select
  using (
    public.is_admin()
    or id = auth.uid()
    or (public.app_role() in ('management', 'developer')
        and partner_id = public.app_partner()
        and public.app_may_reach_user(id))
  );

drop policy if exists user_scopes_select on public.user_scopes;
create policy user_scopes_select on public.user_scopes
  for select
  using (
    public.is_admin()
    or user_id = auth.uid()
    or (public.app_role() in ('management', 'developer')
        and public.app_may_reach_user(user_id))
  );

-- The rank of a LEVEL rather than of a person, which the insert policy needs
-- because the person does not exist yet.
create or replace function public.level_rank_of_level(p_level text)
returns integer
language sql immutable
as $function$
  select case p_level
    when 'Director' then 1
    when 'Manager' then 2
    when 'Negotiator' then 3
    else 99
  end
$function$;

-- users_mgmt_insert never got users_mgmt_update's treatment either: partner
-- only, no containment, no level. A created row must land somewhere the
-- creator reaches, and must not be senior to them.
drop policy if exists users_mgmt_insert on public.users;
create policy users_mgmt_insert on public.users
  for insert
  with check (
    public.app_role() = 'management'
    and partner_id = public.app_partner()
    and role in ('management', 'referrer', 'developer')
    -- A new person with no position yet cannot be placed by this policy, so
    -- the test is on the LEVEL they are being given. invite-user grants the
    -- position separately, through set_user_scope, which tests containment.
    and coalesce(public.level_rank_of_level(
          case when role = 'referrer' then 'Negotiator'
               when sees_commission then 'Director' else 'Manager' end), 99)
        >= coalesce(public.level_rank_of(auth.uid()), 99)
  );

-- ===========================================================================
-- 3. TWO DEFINER FUNCTIONS HANDED OUT STAFF DIRECTORIES (high)
-- ===========================================================================
-- deed_people_target(branch) and agency_notification_recipients(application)
-- both return a named staff email, and both were granted to `authenticated`
-- with no reach test. This is the same class of data deed_delivery_target was
-- explicitly revoked from authenticated for in 20260815020000 ("an agent's
-- email and name"); the new function re-opened a decision already taken.
--
-- Neither is called from the client (checked across src). One is called from
-- an edge function, as service_role.
revoke execute on function public.deed_people_target(uuid) from authenticated;
revoke execute on function public.agency_notification_recipients(uuid) from authenticated;
grant execute on function public.deed_people_target(uuid) to service_role;
grant execute on function public.agency_notification_recipients(uuid) to service_role;

-- And branch_notification_fallback_exists was created with no revoke, so it
-- kept PUBLIC EXECUTE. One bit, but anon-reachable.
revoke all on function public.branch_notification_fallback_exists(uuid) from public;
grant execute on function public.branch_notification_fallback_exists(uuid) to authenticated, service_role;

-- org_deed_readiness widens to the whole partner for an unpositioned caller,
-- and its widening arm fires ONLY on the house partner -- exactly where it is
-- wrong. A Negotiator holds no position by definition, so every Negotiator
-- was handed every agency and branch id on the rail.
create or replace function public.org_deed_readiness()
returns table (agency_id uuid, branch_id uuid, ready boolean)
language sql stable security definer set search_path to ''
as $function$
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
  from vis_agency va
$function$;

-- ===========================================================================
-- 4. A CLIENT LIST, READABLE BY A NEGOTIATOR (medium-high)
-- ===========================================================================
-- partner_agency_rel_select is `is_admin() or partner_id = app_partner()`,
-- with no role and no agency test. Its own comment claims it "never exposes
-- one partner's relationships to another: that would be a client list". On
-- the house rail it does exactly that, and the uuids it hands out are the
-- input to the escalations above.
drop policy if exists partner_agency_rel_select on public.partner_agency_relationships;
create policy partner_agency_rel_select on public.partner_agency_relationships
  for select
  using (
    public.is_admin()
    or (partner_id = public.app_partner() and public.app_may_reach_agency(agency_id))
  );

-- ===========================================================================
-- 5. THE ACTIVITY TRAIL DID NOT FILTER VISIBILITY
-- ===========================================================================
-- activity_log rows written as 'internal' are declared opndoor-admin-only and
-- were enforced only in the client, at one render site.
drop policy if exists activity_log_select on public.activity_log;
create policy activity_log_select on public.activity_log
  for select
  using (
    application_id in (select id from public.applications)
    and (visibility <> 'internal' or public.is_admin() or public.app_role() = 'opndoor_manager')
  );
