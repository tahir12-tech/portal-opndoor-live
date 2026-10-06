-- ===========================================================================
-- "INVITED [DATE]", WHICH THE PEOPLE LIST COULD NOT SAY.
--
-- Matt, 2026-10-02, verbatim:
--
--   "The agency People tab (admin view, e.g. New Independent) only shows
--    Name, Level and Status. Use the same shared people table as every
--    other people screen, with Sees and Last active (or "Invited [date]"
--    for pending invites). Show the Office column only when the agency has
--    more than one office; for a single-office agency like New Independent,
--    leave it out. Check every people screen uses the shared table and list
--    any that don't. Deploy to dev and check there."
--
-- Last active came from auth.users.last_sign_in_at, which a person who has
-- never signed in has not got, so every pending invite read "Pending
-- invite" -- the status said twice, once as a pill and once as a date. The
-- date Matt wants is the one the invitation was sent on, and it was not in
-- the function's output at all.
--
-- coalesce(au.invited_at, u.created_at). invited_at is what Supabase stamps
-- when an invitation is sent, and is set on all six pending rows on dev; the
-- created_at fallback is for a row made some other way -- a user created
-- directly, or seeded -- so the cell says a date rather than falling back to
-- the pill's own word.
--
-- WHY A DROP AND NOT A REPLACE. `create or replace` cannot add a column to
-- a set-returning function's result. Dropping it restores PUBLIC EXECUTE
-- silently, which is how an earlier revoke was quietly undone, so the grant
-- pair is re-stated below and nowhere else -- the visibility rule itself is
-- copied VERBATIM from the live definition, for the reason 20261005180000
-- gives in full: a first draft of that file rebuilt the rule from memory and
-- widened it in two ways.
-- ===========================================================================
drop function if exists public.list_managed_users();

create or replace function public.list_managed_users()
returns table (
  id uuid, full_name text, email text, role text, status text,
  partner_slug text, last_sign_in_at timestamptz, has_mfa boolean,
  home_branch_id uuid, sees_commission boolean, invited_at timestamptz
)
language sql stable security definer set search_path to ''
as $function$
  select u.id, u.full_name, u.email, u.role, u.status,
         p.slug as partner_slug,
         au.last_sign_in_at,
         exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified') as has_mfa,
         u.home_branch_id,
         u.sees_commission,
         coalesce(au.invited_at, u.created_at) as invited_at
  from public.users u
  left join public.partners p on p.id = u.partner_id
  left join auth.users au on au.id = u.id
  where public.is_aal2()
    and (public.is_admin()
         or (public.app_role() = 'management' and u.partner_id = public.app_partner()
             and public.app_may_reach_user(u.id))
         or u.id = auth.uid());
$function$;

comment on function public.list_managed_users() is
  'The people a caller may manage, with truthful last-active from auth.users. Carries sees_commission so a screen can name the level: Director and Manager are both management scope and differ only by that bit. Carries invited_at (20261007480000) so a pending invite reads "Invited 2 Oct 2026" rather than repeating its own status. Visibility unchanged by 20261005180000, by 20261006310000 and by this migration.';

revoke all on function public.list_managed_users() from public, anon;
grant execute on function public.list_managed_users() to authenticated, service_role;
