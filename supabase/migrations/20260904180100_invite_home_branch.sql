-- A negotiator's home branch, recorded at invite, so the manager who invited them
-- sees them from day one instead of only after their first referral.
--
-- "Staff in my branches" (app_user_in_scope) placed a referrer by ACTIVITY: they
-- appeared once they had referred into one of my branches. A freshly invited
-- negotiator has no activity, no attachment and no position, so they vanished from
-- the inviting branch manager's Users screen until they referred. The invite now
-- records the branch (public.users.home_branch_id) and app_user_in_scope treats it
-- as the attachment from the start.
--
-- Additive: a new nullable column and a new function version. NULL for everyone
-- who has no home branch (managers, admins, legacy referrers) so nothing else
-- changes. The preserved cases (unscoped management, referrer, developer, admin)
-- are untouched: the new arm only ADDS a way for a positioned manager to place a
-- referrer, and only fires under the existing `app_has_scope()` guard.

alter table public.users
  add column if not exists home_branch_id uuid references public.branches(id) on delete set null;

comment on column public.users.home_branch_id is
  'The branch a negotiator was invited into, recorded at invite so a scoped manager sees them from day one, before any referral. NULL for staff without a home branch (managers, admins, legacy referrers).';

-- Re-create app_user_in_scope with the home-branch arm added.
create or replace function public.app_user_in_scope(p_user uuid)
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select p_user = auth.uid()
    or (public.app_has_scope() and (
         -- placed at invite: their home branch is one of mine (visible from day one)
         exists (select 1 from public.users u
                  where u.id = p_user and u.home_branch_id in (select public.app_scope_branches()))
         -- a referrer located by where they have referred
      or exists (select 1 from public.applications a
                  where a.referrer_id = p_user
                    and a.branch_id in (select public.app_scope_branches()))
         -- a colleague attached to one of my branches
      or exists (select 1 from public.user_agency_attachments ua
                  join public.branches b on b.agency_id = ua.agency_id
                  where ua.user_id = p_user
                    and b.id in (select public.app_scope_branches()))
         -- a manager whose own position overlaps mine (chain of command up)
      or exists (select 1 from public.app_scope_branches_for(p_user) x
                  where x in (select public.app_scope_branches()))
    ));
$function$;
