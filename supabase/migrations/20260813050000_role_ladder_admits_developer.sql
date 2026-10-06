-- ===========================================================================
-- admin_update_user_role refused 'developer' while the User Management screen
-- offered it as a full option with a written description.
--
-- The screen and the server disagreed, in two places: invite-user's allowlist
-- (fixed in the Edge Function) and here, twice over, at the role check and
-- again at the role-model wall. The consequence was that no agency could be
-- given a key-minting user through the product, so every API key an agency
-- holds began with opndoor running SQL by hand. Self-service is the premise of
-- the agency-referrals shape, and this was the thing standing in front of it.
--
-- WHAT IS NOT RELAXED. The role-model wall stays: an opndoor admin cannot be
-- reassigned to a partner role and a partner user cannot become an admin. Only
-- the set of PARTNER roles widens, from two to three, and 'developer' has been
-- a legal value of users_role_check since 20260810210000.
--
-- Reproduced in full because Postgres cannot patch a body. Every other guard,
-- the self-service check, the last-admin check and the AAL2 requirement, is
-- byte-identical.
-- ===========================================================================

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
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin')) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- A branch-scoped manager cannot change roles at all. They may invite a
  -- negotiator, which is staffing their own branches, but changing somebody's
  -- role reaches across the partner and a branch position is not that.
  if not public.is_admin() and public.app_has_scope() then
    if not exists (select 1 from public.user_scopes s
                    where s.user_id = me and s.kind in ('group','agency')) then
      raise exception 'A branch manager cannot change roles.' using errcode = '42501';
    end if;
  end if;

  -- Role-model wall (both directions). Unchanged except that the partner side
  -- now has three roles rather than two.
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

  update public.users set role = p_role where id = p_user returning * into res;

  select full_name into who from public.users where id = me;
  insert into public.user_audit(user_id, action, detail, actor, actor_id)
  values (p_user, 'role_changed', format('%s -> %s', cur.role, p_role), coalesce(who, 'opndoor admin'), me);

  return res;
end $function$;

-- The wall must still stand in both directions.
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_update_user_role';

  if position('An opndoor admin cannot be reassigned to a partner role' in v_src) = 0 then
    raise exception 'the role-model wall lost its admin-to-partner arm';
  end if;
  if position('At least one active opndoor admin must remain' in v_src) = 0 then
    raise exception 'the last-admin guard was lost';
  end if;
  if position('You cannot change your own role' in v_src) = 0 then
    raise exception 'the self-service guard was lost';
  end if;
end $$;
