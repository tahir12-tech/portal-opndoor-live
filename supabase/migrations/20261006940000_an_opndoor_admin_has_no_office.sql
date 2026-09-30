-- AN OPNDOOR ADMIN HAS NO OFFICE AND NO POSITION.
--
-- Walk fix 5, the server half. Matt: "Opndoor admins see everything by their
-- role and must never be given an office or position. Remove this dialog for
-- Opndoor team members, and make sure a position can never narrow what an
-- Opndoor admin sees, even if one was set."
--
-- Test: supabase/tests/an_opndoor_admin_has_no_office.test.sql
--
-- =========================================================================
-- WHAT WAS ACTUALLY WRONG, AND WHAT WAS NOT
-- =========================================================================
--
-- MEASURED BEFORE CHANGING ANYTHING, on dev, by writing a branch position
-- straight onto an admin and counting what they could then read:
--
--     applications 35 -> 35   agencies 9 -> 9
--     branches     11 -> 11   users   25 -> 25
--
-- So the second half of the instruction already held: a position does not
-- narrow an admin, because every read policy ORs its admin arm ahead of the
-- scope test. That is asserted in the test rather than left as a happy
-- accident of how a dozen policies happen to be written.
--
-- The first half did not hold. `set_user_scope` and `set_home_branch` both
-- authorise on `is_admin() or (management and same partner)` and then ask
-- the ladder, and `assert_may_act_on_user` RETURNS EARLY for opndoor staff.
-- So an admin could give another admin a position, give one to an opndoor
-- manager, or -- the case the walk actually found, because the dialog opened
-- on your own row -- give one to themselves.
--
-- WHY THIS IS WORTH CLOSING EVEN THOUGH IT NARROWS NOTHING TODAY. A position
-- on an admin is a row that every future scope test will read. The reads are
-- safe because of an ordering that nobody has written down as a rule, and
-- the state itself is meaningless: there is no such thing as an Opndoor
-- admin's office. A row that means nothing and that a later `and` could
-- suddenly start meaning is worth refusing at the door.
--
-- THE TARGET, NOT THE CALLER. An admin positioning ordinary people is the
-- whole point of the screen and is untouched.
--
-- AND THE GUARD SITS AFTER THE AUTHORISATION TEST, NOT BEFORE IT. Written
-- before it first, on the reasoning that there is no caller for whom an
-- admin has an office, which is true and is the wrong order anyway: an
-- unauthorised caller should learn "not permitted" and nothing about who the
-- target is. It also broke a real assertion.
-- `a_null_guard_refuses.test.sql` measures, on set_home_branch, that a
-- caller with NO users row is refused by the ROLE check rather than by some
-- later one -- and it has to use an opndoor_manager as the target, because
-- `users_partner_by_role` allows a NULL partner_id for nobody else, and a
-- NULL partner on both sides is what lets a NULL role walk past the second
-- check. A guard in front of that would have answered with this message
-- instead, and the NULL-guard property would have gone untested while its
-- test still passed on the new wording. Nobody is refused differently by the
-- move: for a management caller, an Opndoor-staff target already fails the
-- partner test above.

create or replace function public.set_user_scope(p_user uuid, p_kind text, p_target uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare v_target public.users;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  select * into v_target from public.users where id = p_user;
  if not coalesce(found, false) then raise exception 'User not found' using errcode = '22023'; end if;

  if not coalesce((public.is_admin()
          or (public.app_role() = 'management' and v_target.partner_id = public.app_partner())), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- WALK FIX 5, AFTER the authorisation test and not before it. See the
  -- header: an unauthorised caller must keep getting "not permitted", both
  -- because it tells them less and because a_null_guard_refuses measures
  -- exactly that on the twin function.
  if v_target.role in ('superadmin', 'opndoor_manager') then
    raise exception 'Opndoor staff see everything by their role, so they are never given an office or a position.'
      using errcode = '42501';
  end if;

  -- The ladder: this person exists and has a level, so it is a fair question.
  perform public.assert_may_act_on_user(p_user);
  -- The containment, shared with create_invited_user.
  perform public.assert_may_grant_position(p_kind, p_target);

  delete from public.user_scopes where user_id = p_user;
  insert into public.user_scopes (user_id, kind, group_id, agency_id, branch_id, created_by)
  values (p_user, p_kind,
          case when p_kind = 'group'  then p_target end,
          case when p_kind = 'agency' then p_target end,
          case when p_kind = 'branch' then p_target end,
          auth.uid());

  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values ('user', p_user, 'position_set', p_kind || ':' || p_target::text,
          (select full_name from public.users where id = auth.uid()), auth.uid());
end $function$;

create or replace function public.set_home_branch(p_user uuid, p_branch uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare v_target public.users; v_old uuid;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  select * into v_target from public.users where id = p_user;
  if not coalesce(found, false) then raise exception 'User not found' using errcode = '22023'; end if;
  v_old := v_target.home_branch_id;

  if not coalesce(public.is_admin(), false) then
    if coalesce(public.app_role(), '') <> 'management' then
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

  -- WALK FIX 5, the other half of the same sentence: "never be given an
  -- office or position". An office is home_branch_id. AFTER the block above,
  -- for the reason in the header.
  if v_target.role in ('superadmin', 'opndoor_manager') then
    raise exception 'Opndoor staff see everything by their role, so they are never given an office or a position.'
      using errcode = '42501';
  end if;

  perform set_config('app.setting_home_branch', 'on', true);
  update public.users set home_branch_id = p_branch where id = p_user;
  perform set_config('app.setting_home_branch', 'off', true);

  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values ('user', p_user, 'home_branch_set',
          coalesce(v_old::text, 'none') || ' -> ' || coalesce(p_branch::text, 'none'),
          (select full_name from public.users where id = auth.uid()), auth.uid());
end $function$;

comment on function public.set_user_scope(uuid, text, uuid) is
  'Grants one position, replacing any held. Refuses an Opndoor-staff target outright: they see everything by their role, so a position on them is a meaningless row that every future scope test would read.';
comment on function public.set_home_branch(uuid, uuid) is
  'Places somebody at an office. Refuses an Opndoor-staff target for the same reason as set_user_scope.';
