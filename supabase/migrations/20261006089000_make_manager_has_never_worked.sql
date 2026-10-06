-- "MAKE MANAGER" HAS NEVER WORKED, AND NOTHING SAID SO.
--
-- admin_update_user_role ends with this insert:
--
--   insert into public.user_audit(user_id, action, detail, actor, actor_id)
--
-- public.user_audit has no user_id column and no detail column. It never has:
-- 20260704104758 created it as (target_user, partner_id, action, old_value,
-- new_value, actor, actor_id) and 20260904260000 only relaxed a check constraint.
--
-- plpgsql does not plan a statement until it executes, so the function CREATES
-- cleanly and raises 42703 the moment a role change actually reaches the audit
-- line. The raise happens after the update, inside the same transaction, so the
-- role change is rolled back with it. Every call that got far enough to do its job
-- failed, and the failure was indistinguishable from a permission refusal to
-- anyone watching the toast.
--
-- PROVEN ON DEV before this was written, as a superadmin, in a rolled-back
-- transaction:
--
--   select public.admin_update_user_role('<a referrer>', 'management');
--   -- 42703: column "user_id" of relation "user_audit" does not exist
--   -- and the target's role afterwards: still 'referrer'
--
-- Corroborated by the table itself: select action, count(*) from user_audit
-- returns exactly one row on dev, 'invited', so no role change has ever been
-- recorded by this function in the life of the project.
--
-- WHAT DEPENDED ON IT. Team's "Make Negotiator" / "Make Manager" button
-- (Team.tsx) and the admin Users role editor both call this and nothing else. So
-- the one control an agency had for moving somebody between Negotiator and
-- Manager has been dead in live mode since it was written. It is fixed here, on
-- its own, ahead of the level-ladder work, so that whoever tests the ladder is
-- not debugging two faults at once.
--
-- TWO CHANGES, both restoring what an earlier version of this function had:
--   * the audit insert uses the columns that exist, with action 'role', which is
--     the value 20260704104758 wrote;
--   * an early return when the role is unchanged, so a no-op click neither writes
--     an audit row nor touches the row. 20260704104758 had this and 20260810210000
--     dropped it.
--
-- The guards are copied forward BYTE FOR BYTE from the deployed body. This
-- migration deliberately changes no authority: the level ladder is the next
-- migration's job, and mixing the two would make this fix unreviewable.

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
  -- A branch-scoped manager cannot change roles at all (unchanged).
  if not public.is_admin() and public.app_has_scope() then
    if not exists (select 1 from public.user_scopes s
                    where s.user_id = me and s.kind in ('group','agency')) then
      raise exception 'A branch manager cannot change roles.' using errcode = '42501';
    end if;
  end if;
  -- Role-model wall (unchanged).
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

  -- NOTHING TO DO IS NOT AN EVENT. Restored from 20260704104758: without it a
  -- second click writes a second audit row saying a role changed from itself to
  -- itself, which is noise in the one record that has to be trustworthy.
  if cur.role = p_role then return cur; end if;

  update public.users set role = p_role where id = p_user returning * into res;
  select full_name into who from public.users where id = me;

  -- THE LINE THAT WAS WRONG. Same seven columns as every other audited control
  -- (admin_set_user_status, admin_update_user_name, admin_reset_user_mfa,
  -- admin_cancel_invite), so the shape is checked by sight against its siblings
  -- rather than trusted. partner_id is the TARGET's, because user_audit_read
  -- scopes on it.
  insert into public.user_audit(target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'role', cur.role, p_role, coalesce(who, 'opndoor admin'), me);
  return res;
end $function$;

comment on function public.admin_update_user_role(uuid, text) is
  'Change a user''s role, audited. Its audit insert named two columns that have never existed on user_audit, so from 20260810210000 until now every successful role change raised 42703 and rolled itself back: Make Manager and Make Negotiator were dead. A no-op call returns early rather than auditing a change from a value to itself.';
