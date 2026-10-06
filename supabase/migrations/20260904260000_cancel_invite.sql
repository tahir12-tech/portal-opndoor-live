-- Cancel a pending invite: remove the pending user, invalidate their invite link
-- (deleting the auth user cascades public.users), and free the email to be
-- invited again. Same authority as sending the invite. The cancellation is
-- audited; because deleting the user would otherwise cascade its audit rows away,
-- user_audit.target_user becomes nullable with ON DELETE SET NULL, and the
-- cancelled email is kept in old_value so the record survives the deletion.

alter table public.user_audit alter column target_user drop not null;
alter table public.user_audit drop constraint user_audit_target_user_fkey;
alter table public.user_audit add constraint user_audit_target_user_fkey
  foreign key (target_user) references public.users(id) on delete set null;

create or replace function public.admin_cancel_invite(p_user uuid)
returns void language plpgsql security definer set search_path to ''
as $function$
declare cur public.users; me uuid := auth.uid(); who text; em text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into cur from public.users where id = p_user;
  if not found then raise exception 'user not found'; end if;
  -- Only a pending invite can be cancelled: an accepted user is deactivated, not
  -- deleted (and applications.referrer_id would restrict the delete anyway).
  if cur.status <> 'pending' then raise exception 'Only a pending invite can be cancelled' using errcode = '42501'; end if;
  -- Same authority as sending the invite: opndoor admin, or a manager over this
  -- user's partner and position.
  if not (public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and (not public.app_has_scope() or public.app_user_in_scope(cur.id)))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  em := cur.email;
  insert into public.user_audit(target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'invite_cancelled', em, null, who, me);

  -- Deleting the auth user cascades away public.users and kills the invite link,
  -- freeing the email. The audit row survives (target_user -> null via the ON
  -- DELETE SET NULL above; the cancelled email is preserved in old_value).
  delete from auth.users where id = p_user;
end $function$;

revoke all on function public.admin_cancel_invite(uuid) from public, anon;
grant execute on function public.admin_cancel_invite(uuid) to authenticated;
