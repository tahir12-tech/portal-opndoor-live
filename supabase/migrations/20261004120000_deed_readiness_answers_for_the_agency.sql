-- THE AGENCY ROW NEVER GOT AN ANSWER.
--
-- org_deed_readiness returns one row per BRANCH, and every row carries both
-- ids. The client sorts them by "is branch_id null":
--
--     if (r.branch_id) branches.set(...); else agencies.set(...);
--
-- so the agencies map was always empty, `ready` was always undefined for an
-- agency row, and the agency line fell through to the supplier-rail mailbox
-- warning: "No agent contact. A deed cannot be issued for this branch."
--
-- On one of our agencies that warning is wrong twice over. The mailbox is not
-- the deed path there — the org's PEOPLE are — and in Regent's case there is an
-- active, positioned manager who would receive it. The branch row directly
-- underneath said nothing, because that half of the contract worked.
--
-- The client's shape was right and the function simply never produced it. This
-- adds the agency-level row rather than teaching a second place to fold the
-- branch answers, so the rule stays in one place.
--
-- AN AGENCY IS READY WHEN EVERY BRANCH IS. Not "any": the agency row is what
-- shows while the branches are collapsed, so a single branch nobody can receive
-- for has to be visible without expanding. An agency with no branches at all is
-- not ready, because there is nowhere for a deed to go.
create or replace function public.org_deed_readiness()
returns table (agency_id uuid, branch_id uuid, ready boolean)
language sql stable security definer set search_path to ''
as $function$
  with vis_agency as (
    select a.id, a.group_id
    from public.agencies a
    join public.partners p on p.id = a.partner_id
    -- The ESTATE. An agency's referencing choice does not remove it from ours.
    where p.referencing_mode = 'opndoor_referenced'
      and (public.is_admin()
           or (public.app_role() in ('management','referrer','developer')
               and case
                     when public.app_has_scope()
                       then a.id in (select b.agency_id from public.branches b
                                      where b.id in (select public.app_scope_branches()))
                     else a.partner_id = public.app_partner()
                   end))
  ),
  per_branch as (
    select va.id as agency_id, b.id as branch_id,
           (select count(*) > 0 from public.deed_people_target(b.id)) as ready
    from vis_agency va
    join public.branches b on b.agency_id = va.id
  )
  -- One row per branch, as before.
  select pb.agency_id, pb.branch_id, pb.ready from per_branch pb
  union all
  -- ...and one for the agency itself, which is what the collapsed row reads.
  select va.id, null::uuid,
         coalesce((select bool_and(pb.ready) from per_branch pb where pb.agency_id = va.id), false)
  from vis_agency va
$function$;

comment on function public.org_deed_readiness() is
  'Can a deed be delivered? One row per branch, plus one per agency with a null branch_id — the agency row is what shows while its branches are collapsed, and is true only when every branch can receive, so a single gap is visible without expanding. Scoped to the caller: an admin sees the estate, a manager sees their own.';

revoke all on function public.org_deed_readiness() from public, anon;
grant execute on function public.org_deed_readiness() to authenticated;
