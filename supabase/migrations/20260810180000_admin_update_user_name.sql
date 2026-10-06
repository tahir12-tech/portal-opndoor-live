-- Set a user's display name from the interface.
--
-- THE GAP THIS FILLS. Nothing in this schema could change full_name after
-- creation. Every `update public.users` statement in the tree touches only
-- status (20260704104758:92, 20260704185754:16) or role (20260704104758:145).
-- full_name was written once by invite-user and was then permanent.
--
-- That became a real problem with the partner API. A partner is not asked to
-- send a referrer name, so an unmatched referrer email auto-provisions a user
-- whose full_name is their email address. Without this RPC, that email is what
-- the users list, the dashboard and the league table show for ever, and there is
-- no way to fix it short of a hand-written UPDATE.
--
-- It compounds, because applications.referrer_name is SNAPSHOTTED at creation
-- (20260705140347) and never backfilled. Every application referred before the
-- user is named keeps the email. Naming them early is the only remedy, so naming
-- has to be easy.
--
-- PERMISSION MODEL: deliberately identical to admin_update_user_role
-- (20260704104758:107). Opndoor admin may rename anyone. Partner management may
-- rename users in their own partner, excluding superadmins. Same AAL2 gate, same
-- user_audit row, so the audit trail reads the same way for both actions.
--
-- TWO GUARDS FROM THE ROLE RPC ARE DELIBERATELY NOT CARRIED OVER:
--
--   the self-edit guard      changing your own ROLE is a privilege escalation,
--                            which is why that RPC forbids it. Changing your own
--                            NAME is not, and forbidding it would mean nobody
--                            can correct a typo in their own name.
--   the last-admin guard     protects against removing the final superadmin. A
--                            rename cannot do that.
--
-- Nothing else differs.

create or replace function public.admin_update_user_name(p_user uuid, p_full_name text)
returns public.users
language plpgsql security definer set search_path to ''
as $function$
declare cur public.users; res public.users; who text; me uuid := auth.uid(); v_name text := btrim(coalesce(p_full_name,''));
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  if v_name = '' then
    raise exception 'A name is required.' using errcode = '22023';
  end if;
  if length(v_name) > 120 then
    raise exception 'That name is too long.' using errcode = '22023';
  end if;

  select * into cur from public.users where id = p_user;
  if cur.id is null then raise exception 'User not found' using errcode = '22023'; end if;

  -- Same gate as admin_update_user_role.
  if not (public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin')) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if cur.full_name = v_name then return cur; end if;

  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  update public.users set full_name = v_name where id = p_user returning * into res;

  insert into public.user_audit(target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'name', cur.full_name, v_name, who, me);

  return res;
end $function$;

comment on function public.admin_update_user_name(uuid, text) is
  'Sets a user display name. Same permission model and audit trail as admin_update_user_role. Exists mainly so an API-auto-provisioned referrer, whose full_name defaults to their email, can be named from the interface before their referrer_name snapshot is frozen onto applications.';

revoke all on function public.admin_update_user_name(uuid, text) from public, anon;
grant execute on function public.admin_update_user_name(uuid, text) to authenticated;
