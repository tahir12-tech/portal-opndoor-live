-- Can each agency / branch on the AGENT RAIL actually receive a deed?
--
-- THE PROBLEM. The Agencies list still judged deed readiness from the
-- agent_contacts mailbox, which is the SUPPLIER rail's answer. On the agent rail
-- the deed goes to the org's PEOPLE (deed_people_target, 20260923120000), so the
-- list warned on agencies that are perfectly able to receive one -- Northgate
-- Lettings has an agency manager, a branch manager and a negotiator and still
-- read "No agent contact. A deed cannot be issued."
--
-- The obvious wrong answer is to recompute the people ladder per row on the
-- client. That is one pass over every user, scope and nomination for every row
-- drawn, and the list must work at thousands of agencies. So it is resolved
-- here, set-based, in a single round trip.
--
-- THE LADDER, mirroring deed_people_target: a nominated recipient for the
-- branch, else a branch manager, else a manager at the agency, else one at the
-- group above.
--
-- ONE DELIBERATE DIFFERENCE. deed_people_target excludes only 'deactivated',
-- because it is the DELIVERY path and must not stop delivering to somebody who
-- is mid-invite. This is the WARNING signal, and a pending invitee has not
-- accepted, cannot sign in and cannot receive anything -- so readiness requires
-- status = 'active'. An agency whose only manager is still pending correctly
-- keeps its warning. The delivery path is untouched by this migration.
--
-- AGENT RAIL ONLY. Supplier-introduced orgs are excluded entirely and return no
-- rows, so the client keeps showing them the agent_contacts warning exactly as
-- before. Nothing on the supplier path reads this function.
--
-- VISIBILITY. security definer, so the ladder is computed over every user even
-- when the caller cannot see them -- otherwise a manager would under-report
-- readiness for their own agency. The rows RETURNED are therefore narrowed by
-- hand to mirror agencies_select / branches_select, reusing the same helpers
-- (app_has_scope, app_scope_branches, partner_can_reach_agency). If those
-- policies change, this must change with them.
create or replace function public.org_deed_readiness()
returns table (agency_id uuid, branch_id uuid, ready boolean)
language sql stable security definer set search_path to ''
as $function$
  with vis_agency as (
    select a.id, a.group_id
    from public.agencies a
    join public.partners p on p.id = a.partner_id
    where p.referencing_mode = 'opndoor_referenced'
      and (public.is_admin()
           or (public.app_role() in ('management','referrer','developer')
               and case
                     when public.app_has_scope()
                       then a.id in (select b.agency_id from public.branches b
                                      where b.id in (select public.app_scope_branches()))
                     else public.partner_can_reach_agency(a.id)
                   end))
  ),
  vis_branch as (
    select b.id, b.agency_id
    from public.branches b
    where public.is_admin()
       or (public.app_role() in ('management','referrer','developer')
           and case
                 when public.app_has_scope()
                   then b.id in (select public.app_scope_branches())
                 else public.partner_can_reach_agency(b.agency_id)
               end)
  ),
  -- ACTIVE people only. This is the line that keeps a pending manager from
  -- clearing the warning.
  act as (
    select s.kind, s.branch_id, s.agency_id, s.group_id
    from public.user_scopes s
    join public.users u on u.id = s.user_id
    where u.status = 'active'
  ),
  nom as (
    select r.branch_id
    from public.branch_deed_recipient r
    join public.users u on u.id = r.user_id
    where u.status = 'active'
  ),
  -- A manager at or above the agency covers every branch under it, which is what
  -- makes the ladder's fallback work.
  above as (
    select va.id as agency_id,
           (exists (select 1 from act where act.kind = 'agency' and act.agency_id = va.id)
         or exists (select 1 from act where act.kind = 'group'  and act.group_id  = va.group_id
                    and va.group_id is not null)) as covered
    from vis_agency va
  ),
  branch_row as (
    select vb.agency_id, vb.id as branch_id,
           (ab.covered
         or exists (select 1 from nom where nom.branch_id = vb.id)
         or exists (select 1 from act where act.kind = 'branch' and act.branch_id = vb.id)) as ready
    from vis_branch vb
    join above ab on ab.agency_id = vb.agency_id
  )
  -- One row per visible branch, plus one per visible agency (branch_id null) so a
  -- branchless agency still answers and the client needs no roll-up pass.
  select agency_id, branch_id, ready from branch_row
  union all
  select ab.agency_id, null::uuid,
         ab.covered or exists (select 1 from branch_row br
                                where br.agency_id = ab.agency_id and br.ready)
  from above ab
$function$;

comment on function public.org_deed_readiness() is
  'Agent rail only: can each visible agency and branch receive a deed from its own people (nominated recipient, else branch/agency/group manager)? Requires status = ''active'', so a pending invitee does not clear the warning -- unlike deed_people_target, which is the delivery path and excludes only deactivated users. Supplier-introduced orgs return no rows and keep the agent_contacts warning. One row per branch plus one per agency with a null branch_id.';

revoke all on function public.org_deed_readiness() from public, anon;
grant execute on function public.org_deed_readiness() to authenticated;
