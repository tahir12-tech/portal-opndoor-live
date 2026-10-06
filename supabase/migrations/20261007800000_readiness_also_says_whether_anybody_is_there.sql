/* =====================================================================
   DEED READINESS ALSO SAYS WHETHER ANYBODY IS THERE AT ALL.

   Matt, 2026-10-03: "Agencies list and agency page: for Opndoor's own
   agencies with no users, replace 'No one at this agency can receive the
   deed. Invite a manager or nominate a recipient.' with a neutral 'No users
   yet. Invite someone to start referring.' Only warn about deed delivery
   when there's an application at that agency whose deed has nowhere to go."

   THE WARNING NEEDED A FACT THIS FUNCTION DID NOT RETURN. `ready` answers
   "could a deed reach somebody at or under this org", and it is false for two
   completely different situations:

     nobody has been invited yet        -> ordinary, and the fix is "invite
                                           somebody", which has nothing to do
                                           with deeds
     there are people and the ladder
     does not resolve to any of them    -> a real gap in who receives

   The screens drew the same alert for both, so every agency onboarded this
   morning wore a warning about a document that does not exist. Telling the
   two apart needs a COUNT, and the client cannot have one: the Agencies list
   draws a row per agency across the whole estate, and the per-user positions
   call that the single-agency page uses does not scale to it. That is the
   same reason `ready` is resolved here rather than in the client.

   AT OR UNDER THE ORG, and counted the way the agency page counts it so the
   two surfaces cannot disagree:
     - a position (public.user_scopes) at the agency, or at one of its
       branches
     - plus a negotiator with no position whose home_branch_id is one of its
       branches, which is what a Negotiator is on this rail

   EVERY STATUS COUNTS, unlike `ready`, which counts only active people. A
   pending invitee IS a user -- the agency page already has a separate line
   for "hasn't accepted their invite yet" -- and a deactivated one is still
   listed on People. "No users yet" has to mean nobody at all, or it is a lie
   on a page that lists them.

   DROPPED AND RECREATED because the return type gains a column, which CREATE
   OR REPLACE cannot do. The grants are re-stated below for the same reason:
   a DROP takes them with it, and this function is in the definer allowlist.
   ===================================================================== */

DROP FUNCTION IF EXISTS public.org_deed_readiness();

CREATE FUNCTION public.org_deed_readiness()
 RETURNS TABLE(agency_id uuid, branch_id uuid, ready boolean, people integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  return query
  with vis_agency as (
    select a.id, a.group_id
    from public.agencies a
    join public.partners p on p.id = a.partner_id
    where p.referencing_mode = 'opndoor_referenced'
      -- WAS: `else a.partner_id = app_partner()` for anyone unpositioned,
      -- which on this rail is every agency. app_reachable_agency has no such
      -- arm, and answers true for admin and opndoor_manager.
      and public.app_reachable_agency(a.id)
  ),
  /* WHO IS PLACED WHERE, once, for every visible agency's branches. Both
     halves of the client's own definition of "at this office": a scope row,
     and a negotiator's home branch. */
  placed_branch as (
    select b.id as branch_id, b.agency_id, u.id as user_id
    from vis_agency va
    join public.branches b on b.agency_id = va.id
    join public.users u on true
    where exists (
            select 1 from public.user_scopes us
            where us.user_id = u.id and us.branch_id = b.id
          )
       or (u.home_branch_id = b.id
           and not exists (select 1 from public.user_scopes us2 where us2.user_id = u.id))
  ),
  placed_agency as (
    select va.id as agency_id, us.user_id
    from vis_agency va
    join public.user_scopes us on us.agency_id = va.id
  ),
  per_branch as (
    select va.id as agency_id, b.id as branch_id,
           public.branch_notification_fallback_exists(b.id) as ready,
           (select count(distinct pb.user_id)::int from placed_branch pb where pb.branch_id = b.id) as people
    from vis_agency va
    join public.branches b on b.agency_id = va.id
  )
  select pb.agency_id, pb.branch_id, pb.ready, pb.people from per_branch pb
  union all
  select va.id, null::uuid,
         coalesce((select bool_and(pb.ready) from per_branch pb where pb.agency_id = va.id), false),
         /* THE AGENCY'S COUNT IS ITS OWN PEOPLE PLUS ITS BRANCHES',
            de-duplicated: one person holding a position at the agency and a
            home branch under it is one user, not two. */
         (select count(*)::int from (
            select pa.user_id from placed_agency pa where pa.agency_id = va.id
            union
            select pb.user_id from placed_branch pb where pb.agency_id = va.id
          ) u)
  from vis_agency va;
end $function$;

REVOKE ALL ON FUNCTION public.org_deed_readiness() FROM public;
GRANT EXECUTE ON FUNCTION public.org_deed_readiness() TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_deed_readiness() TO service_role;
