-- THE PEOPLE LIST HAS TO SAY WHICH LEVEL SOMEBODY IS.
--
-- list_managed_users returns role, and role can no longer name an agency
-- person on its own: Director and Manager are both 'management' and differ
-- only by sees_commission. Without the bit here, every screen listing people
-- would fetch it per row or guess, and the two levels would render alike.
--
-- Added as a COLUMN, not a computed label. The label is the client's job
-- (agencyLevelOf in src/data/types.ts) and there is exactly one of those; a
-- second vocabulary here would be a second thing to keep in step.
--
-- THE VISIBILITY RULE IS COPIED EXACTLY AND IS NOT THE POINT OF THIS
-- MIGRATION. It is repeated here only because Postgres will not widen a
-- function's OUT columns in place, so the whole thing must be dropped and
-- recreated. Reproduced verbatim from the live definition:
--
--   * an Opndoor admin sees everyone
--   * a management user sees their own partner's people, narrowed by their
--     position when they hold one (app_user_in_scope)
--   * and anybody can see themselves
--
-- A first draft of this file reconstructed that rule from memory and got it
-- wrong in three ways: it dropped the scope narrowing, dropped the self
-- clause, and invented an opndoor_manager arm. Two of those widen who a
-- manager can see. Hence the verbatim copy.
drop function if exists public.list_managed_users();

create or replace function public.list_managed_users()
returns table (
  id uuid, full_name text, email text, role text, status text,
  partner_slug text, last_sign_in_at timestamptz, has_mfa boolean,
  home_branch_id uuid, sees_commission boolean
)
language sql stable security definer set search_path to ''
as $function$
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
             and (not public.app_has_scope() or public.app_user_in_scope(u.id)))
         or u.id = auth.uid());
$function$;

comment on function public.list_managed_users() is
  'The people a caller may manage, with truthful last-active from auth.users. Carries sees_commission so a screen can name the level: Director and Manager are both management scope and differ only by that bit. Visibility unchanged by 20261005180000.';

revoke all on function public.list_managed_users() from public, anon;
grant execute on function public.list_managed_users() to authenticated;
