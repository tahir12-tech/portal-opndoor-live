-- EVERY PERSON CONTROL RESPECTS THE LADDER.
--
-- 20261006090000 built the predicate. This puts it in front of every control that
-- changes a person, and closes the door that is not an RPC at all.
--
-- CONTAINMENT AND SENIORITY ARE DIFFERENT QUESTIONS, and every guard below asks
-- both. The existing gate,
--
--   is_admin() or (app_role() = 'management' and cur.partner_id = app_partner()
--                  and cur.role <> 'superadmin'
--                  and (not app_has_scope() or app_user_in_scope(cur.id)))
--
-- is what keeps a Director inside their own agency: the house partner
-- opndoor-agents holds many agencies, so partner equality alone would let a
-- Director of one act on a Negotiator of another. It stays exactly as it is. The
-- ladder is added beside it with `perform public.assert_may_act_on_user(p_user);`.
--
-- Each body below is copied forward from what is deployed, byte for byte, with the
-- one line inserted. A plpgsql body cannot be ALTERed, so a whole `create or
-- replace` is the only way to add a line, which is why these are long.

-- ---------------------------------------------------------------------------
-- 1. STATUS. "Remove access" is this, and it destroys nothing: one update to
--    users.status, a ban on the auth row and a session delete. The person, their
--    name, every application they referred, the referrer_name snapshots on those
--    applications, their positions, their audit trail and their league history all
--    stay. applications_referrer_id_fkey has no ON DELETE action and no RLS policy
--    qualifies on users.status.
--
--    Also closing R12 while in here: the function accepted a 'pending' target for
--    'active', which would have marked somebody active who has never set a
--    password. The UI never offered it; the RPC did.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_user_status(p_user uuid, p_status text)
returns public.users
language plpgsql security definer set search_path to ''
as $function$
declare cur public.users; res public.users; who text; me uuid := auth.uid(); old_status text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_status not in ('active','deactivated') then raise exception 'Invalid status' using errcode = '22023'; end if;
  select * into cur from public.users where id = p_user;
  if cur.id is null then raise exception 'User not found' using errcode = '22023'; end if;
  if not (public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and (not public.app_has_scope() or public.app_user_in_scope(cur.id)))) then
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

-- ---------------------------------------------------------------------------
-- 2. ROLE, the /users editor. Team no longer uses this (it calls set_agency_level,
--    which moves role and sees_commission together); this stays the admin Users
--    role editor and still needs the ladder.
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_user_role(p_user uuid, p_role text)
returns public.users
language plpgsql security definer set search_path to ''
as $function$
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
              and (not public.app_has_scope() or public.app_user_in_scope(cur.id)))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform public.assert_may_act_on_user(p_user);
  if not public.is_admin() and public.app_has_scope() then
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

-- ---------------------------------------------------------------------------
-- 3. LEVEL. The one Matt named, and the one that changes most.
--
-- SUPERSEDES 20261005210000, whose header said: "admin only, deliberately... If
-- the product later wants a Director to do it, this is the one function to
-- change." The product wants it. A Director may now set the level of a Manager or
-- a Negotiator, and this is the one function changed.
--
-- TWO CONSEQUENCES, NAMED OUT LOUD.
--
-- (a) A Director may now hand out the commission bit, because Director IS the
--     commission bit. "Who sees the money" is no longer exclusively opndoor's to
--     grant. That is the ruling. Note how it passes the commission trigger: this
--     function is SECURITY DEFINER owned by postgres, so inside it current_user is
--     postgres and users_commission_capability_is_admin_only takes its
--     privileged-role escape. The trigger is unchanged and still refuses a direct
--     write from a signed-in caller, which is the hole it was built for.
--
-- (b) The commission-statement tick is NOT moving.
--     set_receives_commission_statements and users_commission_tick_guard stay admin
--     only. Who is PAID is a different question from who may SEE, and only the
--     second is being delegated.
--
-- A CONTAINMENT GATE IS ADDED HERE, and it is new rather than copied, because this
-- function never had one: it was admin-only, and an admin needs no containment. The
-- moment a Director can call it, partner equality alone is not enough, since the
-- house partner opndoor-agents holds many agencies. Without this a Regent Director
-- could re-level somebody at another agency on the same rail. It is the same
-- predicate the five sibling controls use, so there is one shape to review.
-- ---------------------------------------------------------------------------
create or replace function public.set_agency_level(p_user uuid, p_level text)
returns void
language plpgsql security definer set search_path to ''
as $function$
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
              and (not public.app_has_scope() or public.app_user_in_scope(cur.id)))) then
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

-- ---------------------------------------------------------------------------
-- 4. POSITION. The other one Matt named.
--
-- SUPERSEDES the comment at 20260904170000:240-243, which said "The target USER may
-- be anyone in the partner (delegating your own scope downward, including to a new
-- hire), so no p_user restriction is added." A p_user restriction is added now.
-- Delegating downward is still exactly what this does; the ladder is what makes
-- "downward" mean something.
--
-- The assert goes BEFORE the containment check so that a refusal names the person
-- rather than the position: "you cannot do this to someone at or above your level"
-- is the true reason, and "you can only grant a position within your own scope"
-- would be a misleading answer to the same click.
--
-- One live behaviour ends here: there was no self check, so a group-scoped Manager
-- could grant themselves an extra agency position inside their own reach. Team's
-- Position button is offered on your own row today, so that was reachable.
-- ---------------------------------------------------------------------------
create or replace function public.set_user_scope(p_user uuid, p_kind text, p_target uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare v_target public.users;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_kind not in ('group','agency','branch') then
    raise exception 'Scope must be group, agency or branch. A negotiator simply has none.' using errcode = '22023';
  end if;

  select * into v_target from public.users where id = p_user;
  if not found then raise exception 'User not found' using errcode = '22023'; end if;

  -- Only a group or agency position can grant positions, and only within the
  -- partner. A branch manager granting positions would be a way out of the branch.
  if not (
    public.is_admin()
    or (
      public.app_role() = 'management'
      and v_target.partner_id = public.app_partner()
      and (
        not public.app_has_scope()
        or exists (select 1 from public.user_scopes s
                    where s.user_id = auth.uid() and s.kind in ('group','agency'))
      )
    )
  ) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  perform public.assert_may_act_on_user(p_user);

  -- A scoped granter may only grant a position that lands entirely within their
  -- own branch set: no branch the granted (kind, target) expands to may sit outside
  -- app_scope_branches(). Admins and unscoped managers are unrestricted.
  if not public.is_admin() and public.app_has_scope() then
    if exists (
      select 1 from (
        select b.id from public.agencies a join public.branches b on b.agency_id = a.id
          where p_kind = 'group' and a.group_id = p_target
        union
        select b.id from public.branches b where p_kind = 'agency' and b.agency_id = p_target
        union
        select p_target where p_kind = 'branch'
      ) tb(id)
      where tb.id not in (select public.app_scope_branches())
    ) then
      raise exception 'You can only grant a position within your own scope.' using errcode = '42501';
    end if;
  end if;

  insert into public.user_scopes (user_id, kind, group_id, agency_id, branch_id, created_by)
  values (
    p_user, p_kind,
    case when p_kind = 'group'  then p_target end,
    case when p_kind = 'agency' then p_target end,
    case when p_kind = 'branch' then p_target end,
    auth.uid()
  )
  on conflict do nothing;
end $function$;

-- ---------------------------------------------------------------------------
-- 5. TWO-FACTOR RESET. This is item 5's admin control and the Team row control:
--    the same function, reached from three surfaces.
--
--    It already deletes factors and sessions. Challenges and recovery codes need no
--    statement of their own: mfa_challenges_auth_factor_id_fkey and
--    mfa_recovery_code_sets_mfa_factor_id_fkey cascade from auth.mfa_factors, and
--    mfa_amr_claims_session_id_fkey and refresh_tokens_session_id_fkey cascade from
--    auth.sessions. The person re-enrols on next sign-in.
-- ---------------------------------------------------------------------------
create or replace function public.admin_reset_user_mfa(p_user uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare cur public.users; who text; me uuid := auth.uid();
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into cur from public.users where id = p_user;
  if cur.id is null then raise exception 'User not found' using errcode = '22023'; end if;
  if not (public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and (not public.app_has_scope() or public.app_user_in_scope(cur.id)))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform public.assert_may_act_on_user(p_user);
  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  delete from auth.mfa_factors where user_id = p_user;
  delete from auth.sessions where user_id = p_user;
  insert into public.user_audit(target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'reset_mfa', 'enrolled', 'reset', who, me);
end $function$;

-- ---------------------------------------------------------------------------
-- 6. NAME, and the one documented exemption: your own.
--
--    manager_cannot_promote_themselves.test.sql already asserts that a Manager may
--    edit their own full_name, so the assert is asked only about somebody else.
--    Fixing your own name is not an act of authority over anyone.
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_user_name(p_user uuid, p_full_name text)
returns public.users
language plpgsql security definer set search_path to ''
as $function$
declare cur public.users; res public.users; who text; me uuid := auth.uid(); v_name text := btrim(coalesce(p_full_name,''));
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if v_name = '' then raise exception 'A name is required.' using errcode = '22023'; end if;
  if length(v_name) > 120 then raise exception 'That name is too long.' using errcode = '22023'; end if;
  select * into cur from public.users where id = p_user;
  if cur.id is null then raise exception 'User not found' using errcode = '22023'; end if;
  if not (public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and (not public.app_has_scope() or public.app_user_in_scope(cur.id)))) then
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

-- ---------------------------------------------------------------------------
-- 7. CANCEL INVITE. A pending invitee has a role and a commission bit like anybody
--    else, so the ladder reads correctly on them before they have ever signed in.
-- ---------------------------------------------------------------------------
create or replace function public.admin_cancel_invite(p_user uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare cur public.users; me uuid := auth.uid(); who text; em text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into cur from public.users where id = p_user;
  if not found then raise exception 'user not found'; end if;
  if cur.status <> 'pending' then raise exception 'Only a pending invite can be cancelled' using errcode = '42501'; end if;
  if not (public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and (not public.app_has_scope() or public.app_user_in_scope(cur.id)))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform public.assert_may_act_on_user(p_user);

  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  em := cur.email;
  insert into public.user_audit(target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'invite_cancelled', em, null, who, me);

  delete from auth.users where id = p_user;
end $function$;

-- ---------------------------------------------------------------------------
-- 8. PASSWORD RESET, which had no caller and therefore no authority at all.
--
-- send-password-reset takes an EMAIL ADDRESS and nothing else, reads no
-- Authorization header, and is verify_jwt = false. Its header says "Anonymous by
-- design", and it should stay that way: it is the Forgot-password endpoint. But
-- that means the admin-initiated reset was a byte-identical anonymous request, so
-- there was nothing to apply a level rule to and nothing recorded when it happened.
--
-- This is what makes it authorisable: it takes a USER ID, judges the caller, writes
-- the audit row, and hands back the address so the caller never had to know it. The
-- edge function mints the link from what this returns.
-- ---------------------------------------------------------------------------
create or replace function public.authorise_password_reset(p_user uuid)
returns text
language plpgsql security definer set search_path to ''
as $function$
declare cur public.users; who text; me uuid := auth.uid();
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into cur from public.users where id = p_user;
  if cur.id is null then raise exception 'User not found' using errcode = '22023'; end if;
  if not (public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and (not public.app_has_scope() or public.app_user_in_scope(cur.id)))) then
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

comment on function public.authorise_password_reset(uuid) is
  'Authorise an admin-initiated password reset for this person and return their email so the caller never had to supply it. Audited as password_reset_sent. The anonymous Forgot-password endpoint is unchanged and still takes an address with no caller; this is the authenticated twin, which is the only one a level rule can apply to.';

revoke all on function public.authorise_password_reset(uuid) from public, anon;
grant execute on function public.authorise_password_reset(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. THE DOOR THAT IS NOT AN RPC. Without this the rule does not hold, and the
--    eight functions above are decoration.
--
-- PROVEN ON DEV, as Nadia Shaw (Manager) against Rosa Vance (Director), same
-- agency, as `authenticated` with aal2 claims, in a rolled-back transaction:
--
--   update public.users set status = 'deactivated' where id = <Rosa>;  -- APPLIED
--   update public.users set role   = 'referrer'    where id = <Rosa>;  -- APPLIED
--
-- `authenticated` holds column UPDATE on users.role, users.status and
-- users.sees_commission, and the policy users_mgmt_update is
--
--   app_role() = 'management' and partner_id = app_partner()
--   and role = any (array['management','referrer','developer'])
--
-- with no scope clause, no self clause and no level clause. So a Manager could lock
-- her own Director out and demote her, from the REST endpoint, touching none of the
-- RPCs. Only sees_commission was guarded, by 20261005210000's trigger.
--
-- A SECOND TRIGGER, ADDITIVELY, rather than editing that one: it guards different
-- columns for a different reason, and the pair reads better than one function doing
-- two jobs. Same shape, same reasoning, including the two things that migration
-- learned the hard way:
--
--   * SECURITY INVOKER. A DEFINER trigger runs with current_user = the owner,
--     which is postgres, so the privileged-role escape below would match every
--     caller and the guard would never fire. That exact mistake was made once here
--     already.
--   * current_user, not auth.uid(), for the escape. Our own server-side writes
--     arrive as service_role (the invite path) or postgres (seeding and every
--     SECURITY DEFINER function above, which is how the eight RPCs still work).
--     A signed-in caller is always `authenticated`, however senior, so they are
--     judged by the ladder and not by which connection they came in on.
--
-- Not a revoke of the column grants instead: no client code updates public.users
-- directly, but the service-role insert in invite-user needs them, and a revoke's
-- failure mode is a bare "permission denied for table users" in front of a staff
-- user rather than a sentence explaining itself.
-- ---------------------------------------------------------------------------
create or replace function public.users_level_ladder_guard()
returns trigger language plpgsql set search_path to ''
as $function$
begin
  if new.role is distinct from old.role
     or new.status is distinct from old.status then
    if not (public.may_act_on_user(old.id)
            or current_user in ('service_role', 'postgres', 'supabase_admin')) then
      raise exception 'You can only change the level or access of someone below your own level.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $function$;

comment on function public.users_level_ladder_guard() is
  'Refuses a direct change to users.role or users.status from a signed-in caller who is not above the target on the level ladder. Without it the ladder held only in the RPCs, and a Manager could deactivate or demote her own Director straight through PostgREST, which was proven on dev before this was written.';

drop trigger if exists users_level_ladder_guard on public.users;
create trigger users_level_ladder_guard
  before update of role, status on public.users
  for each row execute function public.users_level_ladder_guard();
