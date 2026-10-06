-- A HOME BRANCH IS A PLACEMENT, NOT A PERMISSION.
--
-- Reproduced on dev before this migration, as Rosa Vance, a Director at
-- Regent's, over PostgREST:
--
--   before                                 7 applications, 1 agency
--   PATCH own home_branch_id -> Northgate   succeeded
--   after                                 21 applications, 2 agencies
--   UPDATE Northgate's applications        14 rows written
--
-- One editable profile column, and the boundary moved. app_scoped_agencies()
-- unioned in the agency above users.home_branch_id; users_mgmt_update admits
-- `id = auth.uid()` ahead of the containment and level tests; and of the five
-- column triggers on public.users not one covered home_branch_id.
--
-- Two separate mistakes, and this migration refuses to pick between them.
--
--   (1) NO BOUNDARY TRUSTS A USER-EDITABLE COLUMN. Every predicate that read
--       home_branch_id to decide reach now reads positions instead. That is
--       only possible because 20261006300000 made a position mandatory on our
--       estate and backfilled the six negotiators who were relying on this
--       column to locate them.
--
--   (2) AND THE COLUMN IS GUARDED ANYWAY, on the principle that a field
--       nothing is allowed to depend on is still not a field its own subject
--       may rewrite. It moves through set_home_branch() and nowhere else.
--
-- The first fix alone leaves the next predicate free to reach for the column
-- again. The second alone leaves it a permission, just a better-guarded one.
--
-- AND THE CLASS IT BELONGS TO. The same review found the shape everywhere:
--
--     not public.app_has_scope() or <the real test>
--     case when public.app_has_scope() then <the real test> else true end
--
-- "narrow this for a positioned caller; for an unpositioned one there is
-- nothing to narrow by, so allow". Twenty-three sites. All of them are below,
-- rewritten to the app_may_reach_* predicates, which fail closed. With a
-- position now mandatory on our estate these arms are unreachable as well as
-- wrong, so this is dead-code removal rather than a tightening that can lock
-- somebody out of their own screen.

-- ===========================================================================
-- 1. THE FOUR PREDICATES STOP READING THE COLUMN
-- ===========================================================================

-- app_scoped_agencies: positions, and nothing else.
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
$function$;

comment on function public.app_scoped_agencies() is
  'The agencies the caller reaches, derived from their positions alone. It used to union in the agency above users.home_branch_id, which let a manager PATCH that column and hand themselves another agency.';

-- user_within_caller_scope: the target is located by position too. The old
-- home-branch arm existed because a negotiator held no scope row; they hold
-- one now, so dropping it protects rather than hides them.
create or replace function public.user_within_caller_scope(p_user uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  with caller as (
    select c.branch_id from public.app_scope_branches() as c(branch_id)
  ),
  target as (
    select t.branch_id from public.app_scope_branches_for(p_user) as t(branch_id)
  )
  select exists (select 1 from target)
     and not exists (
       select 1 from target t2
        where t2.branch_id not in (select c2.branch_id from caller c2)
     )
$function$;

-- app_user_in_scope: same column, same removal. The remaining three arms
-- locate a colleague by where they have referred, what they are attached to,
-- and whose position overlaps mine -- all of them written by somebody senior.
create or replace function public.app_user_in_scope(p_user uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select p_user = auth.uid()
    or (public.app_has_scope() and (
         -- a referrer located by where they have referred
         exists (select 1 from public.applications a
                  where a.referrer_id = p_user
                    and a.branch_id in (select public.app_scope_branches()))
         -- a colleague attached to one of my branches
      or exists (select 1 from public.user_agency_attachments ua
                  join public.branches b on b.agency_id = ua.agency_id
                  where ua.user_id = p_user
                    and b.id in (select public.app_scope_branches()))
         -- a colleague or manager whose own position overlaps mine
      or exists (select 1 from public.app_scope_branches_for(p_user) x
                  where x in (select public.app_scope_branches()))
    ));
$function$;

-- app_may_reach_user: loses the home-branch union, and its `else true`
-- becomes an explicit statement about the supplier rail with a closed default.
-- `else true` was correct -- on that rail the partner IS the company -- but a
-- bare `else true` under an authorisation test cannot be told apart from the
-- bug by a reader or by a grep, and this file exists because of the bug.
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
                   -- OUR ESTATE: the agency is the company, so reach them only
                   -- through a position that overlaps one of mine.
                   when public.is_our_estate_partner(u.partner_id)
                     then exists (
                       select 1 from public.app_scoped_agencies() mine(agency_id)
                        where mine.agency_id in (
                          select b.agency_id from public.branches b
                           where b.id in (select public.app_scope_branches_for(u.id))))
                   -- THE SUPPLIER RAIL: the partner is the company and everyone
                   -- in it is a colleague. Stated, not defaulted to.
                   when not public.is_our_estate_partner(u.partner_id)
                     then true
                   else false
                 end)
       from public.users u where u.id = p_user),
    false)
$function$;

-- app_may_reach_application_org: the same treatment for the same reason.
create or replace function public.app_may_reach_application_org(
  p_partner uuid, p_agency uuid, p_branch uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select case
    -- OUR ESTATE: the agency is the company. No partner-wide arm, so an
    -- unpositioned caller reaches nothing rather than everything.
    when public.is_our_estate_partner(p_partner)
      then p_agency in (select public.app_scoped_agencies())
    -- A SUPPLIER with a position is narrowed to it.
    when public.app_has_scope()
      then p_branch in (select public.app_scope_branches())
    -- A SUPPLIER without one sees their own company, which is the partner.
    -- The caller has already tested partner_id = app_partner().
    when not public.is_our_estate_partner(p_partner)
      then true
    else false
  end
$function$;

-- my_org_shape: the referral form's picker. Its home-branch arm was a UI
-- convenience rather than a boundary, but it is the same column doing the same
-- job, and the form it feeds is a write path.
create or replace function public.my_org_shape(p_partner uuid default null::uuid)
returns table(refers_own_stock boolean, agency_count integer, branch_count integer,
              collapse_agency boolean, collapse_branch boolean, may_add_agency boolean,
              only_agency_id uuid, only_agency_name text, only_branch_id uuid, only_branch_name text)
language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_partner uuid;
  v_own     boolean;
begin
  if not public.is_aal2() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if public.is_admin() and p_partner is not null then
    v_partner := p_partner;
  else
    v_partner := public.app_partner();
  end if;

  if v_partner is null then
    return;
  end if;

  select p.refers_own_stock into v_own from public.partners p where p.id = v_partner;
  v_own := coalesce(v_own, false);

  return query
  with reachable as (
    select b.id as bid, b.name as bname, a.id as aid, a.name as aname
      from public.branches b
      join public.agencies a on a.id = b.agency_id
     where a.partner_id = v_partner
       and (
         case
           -- A position says which branches, and on our estate it is the only
           -- thing that does. WAS: a home_branch_id arm beneath this one, and
           -- an `else true` beneath that.
           when public.app_has_scope() then b.id in (select s from public.app_scope_branches() s)
           -- No position on our own estate is now impossible; if it somehow
           -- happens, the honest answer is the empty set, which the client
           -- draws as "nothing is set up for your account yet".
           when public.is_our_estate_partner(v_partner) then false
           -- A supplier without a position sees their own company. Stated as
           -- its own arm rather than reached through `else`, so the default
           -- below is closed and the next arm added here meets a `false`.
           when not public.is_our_estate_partner(v_partner) then true
           else false
         end
       )
  ),
  agg as (
    select
      count(distinct r.aid)::int       as ag,
      count(*)::int                    as br,
      (array_agg(distinct r.aid))[1]   as aid1,
      (array_agg(distinct r.aname))[1] as aname1,
      (array_agg(r.bid))[1]            as bid1,
      (array_agg(r.bname))[1]          as bname1
    from reachable r
  )
  select
    v_own,
    agg.ag,
    agg.br,
    (v_own and agg.ag = 1),
    (v_own and agg.br = 1),
    (not v_own),
    case when agg.ag = 1 then agg.aid1   end,
    case when agg.ag = 1 then agg.aname1 end,
    case when agg.br = 1 then agg.bid1   end,
    case when agg.br = 1 then agg.bname1 end
  from agg;
end $function$;

-- ===========================================================================
-- 2. AND THE COLUMN MOVES THROUGH ONE DOOR
-- ===========================================================================
-- SECURITY INVOKER, deliberately. The first version of this guard was DEFINER
-- and tested `current_user in ('service_role','postgres','supabase_admin')`,
-- which inside a definer function is the function's OWNER -- postgres -- so
-- the service-role escape hatch opened for every caller and the guard passed
-- everybody. users_level_ladder_guard is invoker for exactly this reason.
create or replace function public.users_home_branch_guard()
returns trigger
language plpgsql
as $function$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  -- Changed through set_home_branch() or not at all. That RPC does the reach
  -- and level checks and then sets this flag for the length of its statement.
  if coalesce(current_setting('app.setting_home_branch', true), 'off') <> 'on' then
    raise exception 'Where somebody sits is changed from their row by a manager who reaches them, not by editing this field.'
      using errcode = '42501';
  end if;
  return new;
end $function$;

drop trigger if exists users_home_branch_guard on public.users;
create trigger users_home_branch_guard
  before update of home_branch_id on public.users
  for each row
  when (new.home_branch_id is distinct from old.home_branch_id)
  execute function public.users_home_branch_guard();

-- The one door. Admin, or a manager who reaches both the person and the
-- branch and stands above them.
create or replace function public.set_home_branch(p_user uuid, p_branch uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare v_target public.users; v_old uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  select * into v_target from public.users where id = p_user;
  if not found then raise exception 'User not found' using errcode = '22023'; end if;
  v_old := v_target.home_branch_id;

  if not public.is_admin() then
    if public.app_role() <> 'management' then
      raise exception 'not permitted' using errcode = '42501';
    end if;
    if v_target.partner_id is distinct from public.app_partner() then
      raise exception 'not permitted' using errcode = '42501';
    end if;
    -- Both ends of the move, and the person. Moving somebody INTO a branch
    -- you do not reach is the escalation; moving them OUT of one you do not
    -- reach is reaching into someone else's office to do it.
    if p_branch is not null and not public.app_may_reach_branch(p_branch) then
      raise exception 'You can only place somebody at a branch you reach.' using errcode = '42501';
    end if;
    if v_old is not null and not public.app_may_reach_branch(v_old) then
      raise exception 'You can only move somebody out of a branch you reach.' using errcode = '42501';
    end if;
    -- And never yourself, at any level. This is the reproduced escalation.
    if p_user = auth.uid() then
      raise exception 'Where you sit is set by your manager, not by you.' using errcode = '42501';
    end if;
    perform public.assert_may_act_on_user(p_user);
  end if;

  perform set_config('app.setting_home_branch', 'on', true);
  update public.users set home_branch_id = p_branch where id = p_user;
  perform set_config('app.setting_home_branch', 'off', true);

  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values ('user', p_user, 'home_branch_set',
          coalesce(v_old::text, 'none') || ' -> ' || coalesce(p_branch::text, 'none'),
          (select full_name from public.users where id = auth.uid()), auth.uid());
end $function$;

comment on function public.set_home_branch(uuid, uuid) is
  'The only way users.home_branch_id changes. Admin, or a manager who reaches the person, reaches both the branch they leave and the branch they join, and stands above them. Never yourself.';

revoke all on function public.set_home_branch(uuid, uuid) from public, anon;
grant execute on function public.set_home_branch(uuid, uuid) to authenticated, service_role;

-- users_mgmt_update admitted `id = auth.uid()` ahead of the containment and
-- level tests, which is what let the self-PATCH through the policy in the
-- first place. A person may still edit their own row; the column trigger above
-- is what decides which columns, and home_branch_id is no longer one of them.

-- ===========================================================================
-- 3. THE POLICY THAT CARRIED THE SAME ARM
-- ===========================================================================
drop policy if exists branch_deed_recipient_select on public.branch_deed_recipient;
create policy branch_deed_recipient_select on public.branch_deed_recipient
  for select
  using (
    public.is_opndoor_staff()
    or exists (
      select 1 from public.branches b
      where b.id = branch_deed_recipient.branch_id
        and b.partner_id = public.app_partner()
        and public.app_may_reach_branch(b.id)
    )
  );

-- ===========================================================================
-- 4. THE TWENTY DEFINER FUNCTIONS THAT CARRIED THE ARM
-- ===========================================================================
-- Rewritten from pg_get_functiondef and re-created, so nothing but the
-- authorisation arm changes and no body is retyped from memory. In each one
--
--     (not public.app_has_scope() or public.app_user_in_scope(X))
--        becomes  public.app_may_reach_user(X)
--     (not public.app_has_scope() or X.branch_id in (select public.app_scope_branches()))
--        becomes  public.app_may_reach_branch(X.branch_id)
--
-- and where the arm guarded something else it is simply deleted, leaving the
-- real test alone. The `partner_id = public.app_partner()` beside each of
-- these stays: on the supplier rail it is the company boundary and still
-- load-bearing. It is no longer the ONLY test, which is what it had become.

-- add_application_note(text,text)
CREATE OR REPLACE FUNCTION public.add_application_note(p_ref text, p_body text)
 RETURNS app_notes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications; r text; owned boolean; b text; n public.app_notes;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where guarantee_ref = p_ref;
  if not found then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := a.referrer_id = auth.uid();
  if not (public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and public.app_may_reach_branch(a.branch_id))
          or (r = 'referrer' and owned)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  b := btrim(coalesce(p_body, ''));
  if b = '' then raise exception 'A note cannot be empty.' using errcode = '22023'; end if;
  insert into public.app_notes(application_id, body, author, author_id)
  values (a.id, left(b, 2000), (select full_name from public.users where id = auth.uid()), auth.uid())
  returning * into n;
  return n;
end $function$;

-- admin_cancel_invite(uuid)
CREATE OR REPLACE FUNCTION public.admin_cancel_invite(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur public.users; me uuid := auth.uid(); who text; em text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into cur from public.users where id = p_user;
  if not found then raise exception 'user not found'; end if;
  if cur.status <> 'pending' then raise exception 'Only a pending invite can be cancelled' using errcode = '42501'; end if;
  if not (public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and public.app_may_reach_user(cur.id))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform public.assert_may_act_on_user(p_user);

  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  em := cur.email;
  insert into public.user_audit(target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'invite_cancelled', em, null, who, me);

  delete from auth.users where id = p_user;
end $function$;

-- admin_reset_user_mfa(uuid)
CREATE OR REPLACE FUNCTION public.admin_reset_user_mfa(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur public.users; who text; me uuid := auth.uid();
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into cur from public.users where id = p_user;
  if cur.id is null then raise exception 'User not found' using errcode = '22023'; end if;
  if not (public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and public.app_may_reach_user(cur.id))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform public.assert_may_act_on_user(p_user);
  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  delete from auth.mfa_factors where user_id = p_user;
  delete from auth.sessions where user_id = p_user;
  insert into public.user_audit(target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'reset_mfa', 'enrolled', 'reset', who, me);
end $function$;

-- admin_set_user_status(uuid,text)
CREATE OR REPLACE FUNCTION public.admin_set_user_status(p_user uuid, p_status text)
 RETURNS users
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur public.users; res public.users; who text; me uuid := auth.uid(); old_status text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_status not in ('active','deactivated') then raise exception 'Invalid status' using errcode = '22023'; end if;
  select * into cur from public.users where id = p_user;
  if cur.id is null then raise exception 'User not found' using errcode = '22023'; end if;
  if not (public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and public.app_may_reach_user(cur.id))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform public.assert_may_act_on_user(p_user);
  -- Kept even though the ladder already refuses self: this message says the actual
  -- reason, and an admin (whom the ladder exempts) still must not lock themselves out.
  if p_status = 'deactivated' and p_user = me then
    raise exception 'You cannot deactivate your own account.' using errcode = '42501';
  end if;
  -- An invitation is not an account yet. Activating one would let somebody in with
  -- no password ever set; the invite is cancelled or resent, never activated.
  if cur.status = 'pending' then
    raise exception 'That invitation has not been accepted yet, so it cannot be activated or deactivated. Resend or cancel it instead.' using errcode = '42501';
  end if;
  if p_status = 'deactivated' and cur.role = 'superadmin'
     and (select count(*) from public.users where role = 'superadmin' and status = 'active') <= 1 then
    raise exception 'At least one active opndoor admin must remain.' using errcode = '42501';
  end if;
  old_status := cur.status;
  if old_status = p_status then return cur; end if;
  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  update public.users set status = p_status where id = p_user returning * into res;
  if p_status = 'deactivated' then
    update auth.users set banned_until = 'infinity' where id = p_user;
    delete from auth.sessions where user_id = p_user;
  else
    update auth.users set banned_until = null where id = p_user;
  end if;
  insert into public.user_audit(target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'status', old_status, p_status, who, me);
  return res;
end $function$;

-- admin_update_user_name(uuid,text)
CREATE OR REPLACE FUNCTION public.admin_update_user_name(p_user uuid, p_full_name text)
 RETURNS users
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur public.users; res public.users; who text; me uuid := auth.uid(); v_name text := btrim(coalesce(p_full_name,''));
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if v_name = '' then raise exception 'A name is required.' using errcode = '22023'; end if;
  if length(v_name) > 120 then raise exception 'That name is too long.' using errcode = '22023'; end if;
  select * into cur from public.users where id = p_user;
  if cur.id is null then raise exception 'User not found' using errcode = '22023'; end if;
  if not (public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and public.app_may_reach_user(cur.id))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_user <> me then perform public.assert_may_act_on_user(p_user); end if;
  if cur.full_name = v_name then return cur; end if;
  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  update public.users set full_name = v_name where id = p_user returning * into res;
  insert into public.user_audit(target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'name', cur.full_name, v_name, who, me);
  return res;
end $function$;

-- admin_update_user_role(uuid,text)
CREATE OR REPLACE FUNCTION public.admin_update_user_role(p_user uuid, p_role text)
 RETURNS users
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur public.users; res public.users; who text; me uuid := auth.uid();
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_role not in ('superadmin','management','referrer','developer') then
    raise exception 'Invalid role' using errcode = '22023';
  end if;
  select * into cur from public.users where id = p_user;
  if cur.id is null then raise exception 'User not found' using errcode = '22023'; end if;
  if not (public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and public.app_may_reach_user(cur.id))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform public.assert_may_act_on_user(p_user);
  -- WAS: `if not public.is_admin() and public.app_has_scope() then`, so an
  -- unpositioned manager SKIPPED this narrowing rather than being refused by
  -- it. The same class as the arms above, wearing a different face.
  if not public.is_admin() then
    if not exists (select 1 from public.user_scopes s
                    where s.user_id = me and s.kind in ('group','agency')) then
      raise exception 'A branch manager cannot change roles.' using errcode = '42501';
    end if;
  end if;
  if cur.role = 'superadmin' and p_role <> 'superadmin' then
    raise exception 'An opndoor admin cannot be reassigned to a partner role.' using errcode = '22023';
  end if;
  if cur.role <> 'superadmin' and p_role not in ('management','referrer','developer') then
    raise exception 'A partner user can only be Management, Referrer or Developer.' using errcode = '22023';
  end if;
  if p_user = me and p_role <> cur.role then
    raise exception 'You cannot change your own role.' using errcode = '42501';
  end if;
  if cur.role = 'superadmin' and p_role <> 'superadmin'
     and (select count(*) from public.users where role = 'superadmin' and status = 'active') <= 1 then
    raise exception 'At least one active opndoor admin must remain.' using errcode = '42501';
  end if;
  if cur.role = p_role then return cur; end if;
  update public.users set role = p_role where id = p_user returning * into res;
  select full_name into who from public.users where id = me;
  insert into public.user_audit(target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'role', cur.role, p_role, coalesce(who, 'opndoor admin'), me);
  return res;
end $function$;

-- agent_rail_funnel(text)
CREATE OR REPLACE FUNCTION public.agent_rail_funnel(p_slug text DEFAULT NULL::text)
 RETURNS TABLE(invited integer, registered integer, details integer, fee integer, documents integer, submitted integer, approved integer, declined integer, guarantee integer, deed integer, stuck_invited integer, stuck_fee integer, stuck_referencing integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pid uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_slug is not null then
    if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
    select id into pid from public.partners where slug = p_slug;
  else
    pid := public.app_partner();
  end if;
  if pid is null then return; end if;
  if not public.is_admin() and not (public.app_role() = 'management' and pid = public.app_partner()) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return query
  with base as (
    select
      a.status,
      a.branch_id,
      (a.applicant_id is not null) as is_registered,
      (coalesce(btrim(a.prop_addr1),'') <> '' and coalesce(a.monthly_rent,0) > 0 and a.tenancy_start is not null) as prop_done,
      exists (select 1 from public.application_profiles pr where pr.application_id = a.id and pr.nationality is not null) as about_done,
      exists (select 1 from public.application_eligibility_payments ep where ep.application_id = a.id and ep.paid_at is not null) as fee_done,
      exists (select 1 from public.application_documents d where d.application_id = a.id and d.kind = 'id_document') as id_done,
      (exists (select 1 from public.application_documents d where d.application_id = a.id and d.kind = 'bank_connection')
        or (select count(*) from public.application_documents d where d.application_id = a.id and d.kind = 'bank_statement') >= 3) as fin_done,
      (select max(ti.created_at) from public.tenant_invites ti where ti.application_id = a.id) as invited_at,
      (select pr.completed_at from public.application_profiles pr where pr.application_id = a.id) as submitted_at
    from public.applications a
    where a.livemode and a.partner_id = pid
      and a.referencing_mode = 'opndoor_referenced'
      and (public.is_admin()
           or (public.app_role() = 'management'
               and public.app_may_reach_branch(a.branch_id)))
  )
  select
    count(*)::int,
    count(*) filter (where is_registered)::int,
    count(*) filter (where is_registered and prop_done and about_done)::int,
    count(*) filter (where fee_done)::int,
    count(*) filter (where id_done and fin_done)::int,
    count(*) filter (where status in ('referencing','sent','paid','deed','declined'))::int,
    count(*) filter (where status in ('sent','paid','deed'))::int,
    count(*) filter (where status = 'declined')::int,
    count(*) filter (where status in ('paid','deed'))::int,
    count(*) filter (where status = 'deed')::int,
    count(*) filter (where status = 'draft' and not is_registered and invited_at < now() - interval '7 days')::int,
    count(*) filter (where status = 'draft' and is_registered and not fee_done and invited_at < now() - interval '7 days')::int,
    count(*) filter (where status = 'referencing' and submitted_at < now() - interval '7 days')::int
  from base;
end $function$;

-- amend_tenancy_start(uuid,date)
CREATE OR REPLACE FUNCTION public.amend_tenancy_start(p_app uuid, p_new_start date)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications; r text; owned boolean;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_new_start is null then raise exception 'A new tenancy start date is required' using errcode = '22023'; end if;
  if p_new_start < date '2000-01-01' or p_new_start > (current_date + interval '5 years')::date then
    raise exception 'Tenancy start date is out of range' using errcode = '22023';
  end if;
  select * into a from public.applications where id = p_app;
  if not found then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := a.referrer_id = auth.uid();
  if not (public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and public.app_may_reach_branch(a.branch_id))
          or (r = 'referrer'   and owned)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if not public.can_amend_tenancy_start(r, a.status, owned, a.deed_state) then
    raise exception 'amend not permitted for this role and status' using errcode = '42501';
  end if;
  -- Date only. expiry_date is generated from tenancy_start; the deed lifecycle is
  -- handled by the amend-tenancy-start Edge Function, not here.
  update public.applications set tenancy_start = p_new_start where id = p_app returning * into a;
  return a;
end $function$;

-- application_journey(text)
CREATE OR REPLACE FUNCTION public.application_journey(p_ref text)
 RETURNS TABLE(referencing_mode text, status text, invited_at timestamp with time zone, registered_at timestamp with time zone, property_done boolean, about_done boolean, fee_paid_at timestamp with time zone, id_done boolean, financials_done boolean, submitted_at timestamp with time zone, decided_at timestamp with time zone, decision text, decline_reason text, guarantee_paid_at timestamp with time zone, deed_at timestamp with time zone, deed_state text, current_step text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications;
begin
  select * into a from public.applications where guarantee_ref = p_ref;
  if not found then return; end if;
  if not (public.is_admin()
    or (public.app_role() = 'referrer'  and a.referrer_id = auth.uid())
    or (public.app_role() = 'developer' and a.partner_id = public.app_partner())
    or (public.app_role() = 'management' and a.partner_id = public.app_partner()
        and public.app_may_reach_branch(a.branch_id))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return query select
    a.referencing_mode,
    a.status,
    (select max(ti.created_at) from public.tenant_invites ti where ti.application_id = a.id),
    (select ap.created_at from public.applicants ap where ap.id = a.applicant_id),
    (coalesce(btrim(a.prop_addr1),'') <> '' and coalesce(a.monthly_rent,0) > 0 and a.tenancy_start is not null),
    exists (select 1 from public.application_profiles pr where pr.application_id = a.id and pr.nationality is not null),
    (select ep.paid_at from public.application_eligibility_payments ep where ep.application_id = a.id),
    exists (select 1 from public.application_documents d where d.application_id = a.id and d.kind = 'id_document'),
    (exists (select 1 from public.application_documents d where d.application_id = a.id and d.kind = 'bank_connection')
       or (select count(*) from public.application_documents d where d.application_id = a.id and d.kind = 'bank_statement') >= 3),
    (select pr.completed_at from public.application_profiles pr where pr.application_id = a.id),
    a.decided_at,
    case when a.status = 'declined' then 'declined'
         when a.decided_at is not null or a.status in ('sent','paid','deed') then 'approved'
         else null end,
    a.decline_reason,
    a.paid_at,
    coalesce(a.deed_executed_at, a.deed_issued_at),
    a.deed_state,
    a.current_step;
end $function$;

-- attach_user_to_agency(uuid,uuid)
CREATE OR REPLACE FUNCTION public.attach_user_to_agency(p_user uuid, p_agency uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_target public.users; v_agency public.agencies;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  select * into v_target from public.users where id = p_user;
  if not found then raise exception 'User not found' using errcode = '22023'; end if;
  select * into v_agency from public.agencies where id = p_agency;
  if not found then raise exception 'Agency not found' using errcode = '22023'; end if;

  -- Who may attach: an opndoor admin, or a manager acting within their own
  -- partner. A branch manager cannot: attaching somebody to an agency is a
  -- statement about the whole brand, which is above their position.
  if not (
    public.is_admin()
    or (
      public.app_role() = 'management'
      and v_target.partner_id = public.app_partner()
      and public.app_may_reach_agency(p_agency)
      and public.user_within_caller_scope(p_user)
      and (
        exists (select 1 from public.user_scopes s
                    where s.user_id = auth.uid() and s.kind in ('group','agency'))
      )
    )
  ) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  insert into public.user_agency_attachments (user_id, agency_id, created_by)
  values (p_user, p_agency, auth.uid())
  on conflict (user_id, agency_id) do nothing;
end $function$;

-- authorise_password_reset(uuid)
CREATE OR REPLACE FUNCTION public.authorise_password_reset(p_user uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur public.users; who text; me uuid := auth.uid();
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into cur from public.users where id = p_user;
  if cur.id is null then raise exception 'User not found' using errcode = '22023'; end if;
  if not (public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and public.app_may_reach_user(cur.id))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform public.assert_may_act_on_user(p_user);
  if cur.status = 'pending' then
    raise exception 'That person has not accepted their invitation yet, so there is no password to reset. Resend the invitation instead.' using errcode = '42501';
  end if;
  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  -- Audited in the same transaction as the authorisation, so a link that was minted
  -- always has a row and a row always means a link was authorised.
  insert into public.user_audit(target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'password_reset_sent', null, cur.email, who, me);
  return cur.email;
end $function$;

-- clear_awaiting_staff_send(uuid)
CREATE OR REPLACE FUNCTION public.clear_awaiting_staff_send(p_app uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications; r text; owned boolean;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where id = p_app;
  if not found then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := a.referrer_id = auth.uid();
  if not (public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and public.app_may_reach_branch(a.branch_id))
          or (r = 'referrer'   and owned)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  update public.applications set awaiting_staff_send = false where id = p_app;
end $function$;

-- clear_branch_deed_recipient(uuid)
CREATE OR REPLACE FUNCTION public.clear_branch_deed_recipient(p_branch uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_partner uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select partner_id into v_partner from public.branches where id = p_branch;
  if v_partner is null then raise exception 'Branch not found' using errcode = '22023'; end if;
  if not (
    public.is_admin()
    or (public.app_role() = 'management'
        and v_partner = public.app_partner()
        and public.app_may_reach_branch(p_branch))
  ) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  delete from public.branch_deed_recipient where branch_id = p_branch;
end $function$;

-- list_managed_users()
CREATE OR REPLACE FUNCTION public.list_managed_users()
 RETURNS TABLE(id uuid, full_name text, email text, role text, status text, partner_slug text, last_sign_in_at timestamp with time zone, has_mfa boolean, home_branch_id uuid, sees_commission boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select u.id, u.full_name, u.email, u.role, u.status,
         p.slug as partner_slug,
         au.last_sign_in_at,
         exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified') as has_mfa,
         u.home_branch_id,
         u.sees_commission
  from public.users u
  left join public.partners p on p.id = u.partner_id
  left join auth.users au on au.id = u.id
  where public.is_aal2()
    and (public.is_admin()
         or (public.app_role() = 'management' and u.partner_id = public.app_partner()
             and public.app_may_reach_user(u.id))
         or u.id = auth.uid());
$function$;

-- mark_withdrawn(text,text,text)
CREATE OR REPLACE FUNCTION public.mark_withdrawn(p_ref text, p_reason text, p_note text)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications; r text; owned boolean; who text; lbl text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where guarantee_ref = p_ref;
  if not found then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := a.referrer_id = auth.uid();
  if not (public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and public.app_may_reach_branch(a.branch_id))
          or (r = 'referrer' and owned)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if a.status <> 'sent' then raise exception 'Only an application at Sent (before payment) can be withdrawn.' using errcode = '42501'; end if;
  if p_reason not in ('another_guarantor','tenancy_fell_through','duplicate','other') then
    raise exception 'Invalid withdrawal reason' using errcode = '22023';
  end if;
  if p_reason = 'other' and coalesce(btrim(p_note), '') = '' then
    raise exception 'A note is required when the reason is Other.' using errcode = '22023';
  end if;
  update public.applications
    set status = 'withdrawn', withdrawn_at = now(), withdrawn_reason = p_reason,
        withdrawn_note = nullif(btrim(coalesce(p_note,'')), ''), withdrawn_by = auth.uid()
    where id = a.id returning * into a;
  who := coalesce((select full_name from public.users where id = auth.uid()), 'a user');
  lbl := case p_reason
           when 'another_guarantor' then 'tenant found another guarantor'
           when 'tenancy_fell_through' then 'tenancy fell through'
           when 'duplicate' then 'duplicate referral'
           else 'other' end;
  insert into public.activity_log(application_id, kind, message, actor, visibility)
  values (a.id, 'withdrawn',
    'Application withdrawn (' || lbl || ')' || case when a.withdrawn_note is not null then ': ' || a.withdrawn_note else '' end || '.',
    who, 'business');
  return a;
end $function$;

-- my_application_delivery(uuid)
CREATE OR REPLACE FUNCTION public.my_application_delivery(p_app uuid)
 RETURNS TABLE(state text, to_email text, to_name text, source text, auto_send boolean, attempted_to text, attempted_source text, failed_at timestamp with time zone, reason text, sent_at timestamp with time zone, held boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications; r text; owned boolean;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where id = p_app;
  if not found then return; end if;
  r := public.app_role();
  owned := a.referrer_id = auth.uid();
  if not (public.is_admin()
          or r = 'opndoor_manager'
          or (r in ('management','referrer','developer') and a.partner_id = public.app_partner()
              and public.app_may_reach_branch(a.branch_id))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  -- `owned` is read so a referrer's own application is reachable even where a
  -- scope would not otherwise admit it; the branch test above already covers
  -- the common case.
  if r = 'referrer' and not owned and not public.is_admin() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return query
  select
    case
      -- Order matters and is the whole point of the migration. A row that
      -- errored is FAILED even though it is also queued; a row with nobody to
      -- send to is HELD and was never attempted; a row with neither is simply
      -- not attempted yet, which is not a problem.
      when a.delivery_failed_at is not null then 'failed'
      when a.awaiting_staff_send            then 'cannot_deliver'
      when a.deed_sent_at is not null       then 'delivered'
      else 'not_attempted'
    end,
    t.email, t.display_name, t.source, t.auto_send,
    a.delivery_attempted_to, a.delivery_source, a.delivery_failed_at, a.delivery_reason,
    a.deed_sent_at, a.awaiting_staff_send
  from (select 1) one
  left join lateral public.deed_delivery_target(p_app) t on true;
end $function$;

-- send_deed_to_landlord(uuid,text,text)
CREATE OR REPLACE FUNCTION public.send_deed_to_landlord(p_app uuid, p_name text, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications; r text; owned boolean; nm text; em text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where id = p_app;
  if not found then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := a.referrer_id = auth.uid();
  -- Same audience as send_deed_to_agent: an owning referrer, a manager in scope,
  -- or opndoor admin. The UI shows this button only to agency staff; the rule is
  -- enforced here independently of the UI.
  if not (public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and public.app_may_reach_branch(a.branch_id))
          or (r = 'referrer' and owned)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if not public.can_send_deed(r, owned) then
    raise exception 'send not permitted for this role' using errcode = '42501';
  end if;
  if a.status <> 'deed' then raise exception 'deed not yet issued' using errcode = '22023'; end if;

  nm := btrim(coalesce(p_name, ''));
  em := btrim(coalesce(p_email, ''));
  if nm = '' then raise exception 'Landlord name is required' using errcode = '22023'; end if;
  if em !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Invalid landlord email' using errcode = '22023';
  end if;

  -- Stored on the application so the send form prefills on a resend.
  update public.applications set landlord_name = nm, landlord_email = em where id = p_app;
  return jsonb_build_object('sent_to', em, 'landlord_name', nm);
end $function$;

-- set_agency_level(uuid,text)
CREATE OR REPLACE FUNCTION public.set_agency_level(p_user uuid, p_level text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cur    public.users;
  v_role text;
  v_sees boolean;
  v_old  text;
  v_actor text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  select * into cur from public.users where id = p_user;
  if cur.id is null then
    raise exception 'No such person.' using errcode = '22023';
  end if;

  -- Containment: within my partner, and within my positions if I have any.
  if not (public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and public.app_may_reach_user(cur.id))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- Seniority, both halves. The first says I may touch this person; the second says
  -- I may hand out this level. Without the second a Manager could promote a
  -- Negotiator, who is below her, to Director, who is above her.
  perform public.assert_may_act_on_user(p_user);
  perform public.assert_may_grant_level(p_level);

  -- The three levels, spelled as the product spells them. Anything else is a
  -- typo and must not be guessed at. (assert_may_grant_level has already refused
  -- anything that is not one of the three; this maps the survivors.)
  if p_level = 'Director' then v_role := 'management'; v_sees := true;
  elsif p_level = 'Manager' then v_role := 'management'; v_sees := false;
  elsif p_level = 'Negotiator' then v_role := 'referrer'; v_sees := false;
  else
    raise exception 'An agency level is Director, Manager or Negotiator.' using errcode = '22023';
  end if;

  v_old := public.agency_level_of(p_user);

  -- Opndoor's own staff are not agency people and have no level to set. Guarding
  -- here rather than letting the update through: this function would otherwise be
  -- a way to turn a superadmin into a referrer. agency_level_of returns null for
  -- them and for a developer, which is the same answer for the same reason.
  if v_old is null then
    raise exception 'That person is not agency staff, so they have no agency level.' using errcode = '22023';
  end if;

  if v_old = p_level then return; end if;

  update public.users set role = v_role, sees_commission = v_sees where id = p_user;

  v_actor := coalesce((select full_name from public.users where id = auth.uid()), 'an administrator');
  insert into public.user_audit (target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'agency level changed', v_old, p_level, v_actor, auth.uid());
end $function$;

-- set_branch_deed_recipient(uuid,uuid)
CREATE OR REPLACE FUNCTION public.set_branch_deed_recipient(p_branch uuid, p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_partner uuid; v_user_partner uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select partner_id into v_partner from public.branches where id = p_branch;
  if v_partner is null then raise exception 'Branch not found' using errcode = '22023'; end if;
  select partner_id into v_user_partner from public.users where id = p_user;
  if v_user_partner is null or v_user_partner <> v_partner then
    raise exception 'The nominated recipient must be a user in this organisation.' using errcode = '22023';
  end if;
  if not (
    public.is_admin()
    or (public.app_role() = 'management'
        and v_partner = public.app_partner()
        and public.app_may_reach_branch(p_branch))
  ) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  insert into public.branch_deed_recipient (branch_id, user_id, set_by)
  values (p_branch, p_user, auth.uid())
  on conflict (branch_id) do update set user_id = excluded.user_id, set_by = excluded.set_by, set_at = now();
end $function$;

-- staff_payment_page_token(text)
CREATE OR REPLACE FUNCTION public.staff_payment_page_token(p_ref text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_app public.applications; v_token uuid;
begin
  select * into v_app from public.applications where guarantee_ref = p_ref;
  if not found then return null; end if;

  if not (public.is_admin()
       or (public.app_role() = 'management' and v_app.partner_id = public.app_partner()
           and public.app_may_reach_branch(v_app.branch_id))
       or (public.app_role() = 'referrer'   and v_app.referrer_id = auth.uid())) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  insert into public.payment_page_tokens(application_id, guarantee_ref, expires_at)
  values (v_app.id, v_app.guarantee_ref, now() + interval '90 days')
  on conflict (application_id) do update set expires_at = excluded.expires_at
  returning token into v_token;
  return v_token;
end $function$;


