-- list_managed_users now returns home_branch_id, so the client can show a
-- negotiator (a referrer with a home branch and no user_scope) on their branch node
-- in the agency tree. Additive: the column already exists on public.users (added by
-- 20260904180000, after this RPC was last defined, so the RPC never picked it up);
-- everything else is byte-identical. NULL for managers/admins/legacy referrers.
-- A new OUT column changes the return type, so the old signature must be dropped first.
drop function if exists public.list_managed_users();
create or replace function public.list_managed_users()
 returns table(id uuid, full_name text, email text, role text, status text, partner_slug text, last_sign_in_at timestamp with time zone, has_mfa boolean, home_branch_id uuid)
 language sql stable security definer set search_path to ''
as $function$
  select u.id, u.full_name, u.email, u.role, u.status,
         p.slug as partner_slug,
         au.last_sign_in_at,
         exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified') as has_mfa,
         u.home_branch_id
  from public.users u
  left join public.partners p on p.id = u.partner_id
  left join auth.users au on au.id = u.id
  where public.is_aal2()
    and (public.is_admin()
         or (public.app_role() = 'management' and u.partner_id = public.app_partner()
             and (not public.app_has_scope() or public.app_user_in_scope(u.id)))
         or u.id = auth.uid());
$function$;

revoke execute on function public.list_managed_users() from public, anon;
grant execute on function public.list_managed_users() to authenticated;
