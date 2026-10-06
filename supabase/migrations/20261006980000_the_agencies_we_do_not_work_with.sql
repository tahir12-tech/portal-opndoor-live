/* =====================================================================
   NM-N. THE AGENCIES A DIRECT TENANT NAMED THAT WE DO NOT WORK WITH.

   Matt, 2026-09-30, verbatim: "NM-N: don't create companies in HubSpot
   automatically; list agencies a direct tenant named that we don't work
   with on the Reconciliation page, with the agent contact given, for
   someone to add to HubSpot by hand."

   THERE IS NO WRITE SIDE, AND THAT IS THE POINT. Item 24 asked for the
   agency to be created in HubSpot as a prospect, and the check against
   HUBSPOT-CONSEQUENCES.md said the dedupe sentence inside it -- "if the
   company already exists in HubSpot, add to it rather than duplicating" --
   cannot be honoured today: HubSpot's upsert matches only on our own unique
   property, so a prospect keyed on something of ours dedupes against our
   own previous writes and will happily create a second company beside one a
   salesperson typed in by hand. Matt's answer removes the problem instead of
   solving it. The portal lists what it knows; a person decides. Nothing here
   writes anywhere and `hubspot-sync` is untouched.

   ONE ROW PER AGENCY, NOT PER APPLICATION, because the instruction says
   "list agencies" and the reader's job is to create a company. Three
   tenants who all named Foo Lettings are one company to create, not three,
   and `typed_name_key` -- the normalised name the matcher already keeps --
   is what says they are the same one. The count comes back with it, because
   "four tenants named this agency" is the difference between a prospect
   worth typing in and a one-off.

   WHAT IT MAY NOT RETURN, which is why the column list is written out and
   why `applications` is joined for exactly one column. Item 24: "Only the
   agency and agent contact go across, never the tenant's details." The
   queue function this sits beside DOES return the tenant's name and
   property, correctly: the person working that queue is deciding which
   agency a named tenant belongs to. This list is for retyping a company
   into a CRM, so `applications` contributes `livemode` and nothing else. A
   later hand adding "and the tenant, for context" is the failure this
   paragraph exists to prevent.

   AND IT FILTERS livemode, which `agency_match_queue` does not. That is a
   known gap in the sibling and not one to copy: a sandbox application is a
   test, and a list whose stated purpose is hand entry into the real CRM
   must not carry test rows into it.

   'letting_agent' AND NOT ANY CONTACT. The one dismissed row on dev gave a
   `private_landlord` contact, and a private landlord is not an agent: their
   details are a person's, not a company's, and putting them in a CRM under
   a company heading would be wrong twice over. So an agency with no agent
   contact comes back with an empty `contacts` array and is still listed --
   the typed name is the thing being retyped, and the contact is what makes
   it easier, not what makes it worth listing.

   THE CONTACT MAY BE INCOMPLETE. `delivery_contact_named` was re-added NOT
   VALID by 20260904120000, so a row written before that date can carry an
   agency_name with no surname and no phone. Every field in the object is
   therefore nullable and the client must render around that.

   RLS: `application_agency_match` has row security and no policy at all, on
   purpose -- nothing reads it except through a function that has checked
   the caller. This is the fourth such reader and carries the same two
   guards as the other three.
   ===================================================================== */

create or replace function public.not_in_network_agencies()
returns table(
  name_key text,
  typed_name text,
  tenants integer,
  last_named_at timestamptz,
  contacts jsonb
)
language plpgsql
stable security definer
set search_path to ''
as $$
begin
  /* TWO STATEMENTS, NOT ONE CONDITION. `not A and B` is `(not A) and B`,
     which is the bug 20261006440000 was written to undo across this whole
     family, and each `not coalesce(<single>, false)` is the null-safe deny
     shape guardsAreNullSafe.test.ts lints for. Same two guards, same order,
     as agency_match_queue. */
  if not coalesce(public.is_opndoor_staff(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  return query
    with named as (
      select m.typed_name_key,
             m.typed_name,
             m.application_id,
             coalesce(m.resolved_at, m.created_at) as at
        from public.application_agency_match m
        join public.applications a on a.id = m.application_id
       where m.state = 'dismissed'
         and a.livemode
         and coalesce(btrim(m.typed_name_key), '') <> ''
    )
    select n.typed_name_key,
           /* THE SPELLING THE MOST RECENT TENANT USED. The key is
              normalised and is not a name anybody would type into a CRM;
              picking the latest of the real spellings is arbitrary between
              equals but is always one somebody actually wrote. */
           (array_agg(n.typed_name order by n.at desc))[1],
           count(*)::integer,
           max(n.at),
           coalesce(
             (select jsonb_agg(distinct jsonb_build_object(
                       'agencyName', c.agency_name,
                       'title',      c.title,
                       'firstName',  c.first_name,
                       'lastName',   c.last_name,
                       'email',      c.email,
                       'phone',      c.phone))
                from public.application_delivery_contacts c
               where c.kind = 'letting_agent'
                 and c.application_id in (select n2.application_id from named n2
                                           where n2.typed_name_key = n.typed_name_key)),
             '[]'::jsonb)
      from named n
     group by n.typed_name_key
     order by max(n.at) desc;
end $$;

/* The browser calls this as `authenticated` and nobody else calls it at all.
   `public` is named explicitly: a revoke that does not name it leaves the
   default grant standing, which is how a definer function ends up callable
   by anon through the default PUBLIC execute privilege. */
revoke all on function public.not_in_network_agencies() from public;
grant execute on function public.not_in_network_agencies() to authenticated;

comment on function public.not_in_network_agencies() is
  'NM-N. Agencies a direct tenant named that were dismissed as not in our network, one row per agency, with the agent contacts the tenants gave, for hand entry into the CRM. Never returns anything of the tenant''s. Opndoor staff, AAL2.';
