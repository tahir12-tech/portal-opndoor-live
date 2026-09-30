/* =====================================================================
   NM-P, THE SERVER HALF. A SINGLE-OFFICE AGENCY IS JUST THE AGENCY.

   Matt, 2026-09-30: "A single-office agency shows only as the agency...
   No '1 branch', no branch row, no branch name. Where the system needs an
   office behind the scenes, it uses the agency's own name and address and
   is never shown separately."

   WHY THE RULE NEEDS A SQL COPY AT ALL. The client half is one predicate
   in src/data/agencyOffices.ts, and the screens ask it. The EMAILS and the
   DEED do not: they are Deno edge functions with no access to src/, and
   the copy they send is built from rows an RPC hands them. So the same
   question has to be answerable here, and the two have to agree.

   THE BRANCH ROW DOES NOT STOP EXISTING, which is the whole point of
   putting this in a function rather than in the data. Every referral still
   hangs off a branch, branch_id is still how the agency rail resolves a
   position, and deeds, statements and notifications all still route
   through one. This decides what is SHOWN, nothing else.

   THREE RULES IT KEEPS, each of which would be a real bug the other way:

     A PLACEHOLDER IS NOT AN OFFICE. The house rail carries "Unattached"
     branches that exist only so a NOT NULL foreign key resolves. Counting
     one would make a genuinely single-office agency look like two and the
     rule would never fire for it.

     ZERO IS NOT ONE. An agency with no office is a real state the product
     surfaces deliberately, so the test is `= 1` and never `<= 1`.

     AN UNKNOWN AGENCY STILL NAMES ITS OFFICE. A null agency_id answers
     true, which is today's behaviour: hiding a real office name because a
     row could not be resolved is a silent wrong answer, and showing one is
     merely the old screen.

   STABLE, so it can be used inside a query's select list without being
   re-evaluated per row beyond what the planner decides, and SECURITY
   INVOKER: it reads `branches`, which is RLS-protected, and a definer
   version would answer about offices the caller cannot see. Every caller
   today is either the service role or a reader who already holds the
   agency, so invoker is both correct and sufficient.
   ===================================================================== */

create or replace function public.agency_names_its_offices(p_agency uuid)
returns boolean
language sql
stable
set search_path to ''
as $$
  select case
    when p_agency is null then true
    else (select count(*) from public.branches b
           where b.agency_id = p_agency
             and coalesce(b.is_placeholder, false) = false) <> 1
  end;
$$;

comment on function public.agency_names_its_offices(uuid) is
  'NM-P. True when this agency has other than exactly one real office, and so may show a branch name, a branch row or a branch count. False only for a single-office agency, which shows as the agency alone. A placeholder branch is not an office; zero offices is not one; an unknown agency answers true.';

revoke all on function public.agency_names_its_offices(uuid) from public;
grant execute on function public.agency_names_its_offices(uuid) to authenticated;
