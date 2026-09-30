/* =====================================================================
   NM-N, CORRECTION. "LAST NAMED" MEANT "LAST DISMISSED".

   Found by the audit Matt asked for on the three items just built, in the
   migration immediately before this one (20261006980000), which is already
   applied to dev. A correction to an applied migration goes in a NEW file:
   re-running one makes dev disagree with a clean filename-order run, which
   is how a revoke that broke every user invite sat green in the suite for
   a day.

   WHAT WAS WRONG. The function returned

       max(coalesce(m.resolved_at, m.created_at)) as last_named_at

   and the client prints it as "last on <date>" under a heading that counts
   how many tenants NAMED the agency. But `resolved_at` is written by
   `dismiss_agency_match`, which sets `state = 'dismissed', resolved_by =
   auth.uid(), resolved_at = now()`. Every row in this list is dismissed by
   definition -- that is the filter -- so `resolved_at` is never null here
   and the coalesce never falls through. The column was the moment an
   Opndoor admin pressed "Not in network", presented as the moment a tenant
   named the agency.

   AND IT WAS NOT ONLY A LABEL. The same expression did two other jobs:

     order by max(...) desc          -- which agency is top of the list
     (array_agg(typed_name order by ... desc))[1]   -- which SPELLING to show

   So an afternoon of clearing a backlog would reorder the whole list by
   the order somebody happened to work through it, and the name offered for
   retyping into the CRM would be whichever spelling belonged to the row
   that was dismissed last rather than the one a tenant typed most
   recently. Dismissing four old matches in one sitting puts four stale
   prospects at the top.

   `m.created_at` IS THE RIGHT COLUMN. The match row is inserted by
   `match_application_agency` when the direct application is submitted, so
   it is the moment the tenant named the agency -- which is what the count
   beside it is counting and what the reader is being asked to judge
   freshness by.

   NOTHING ELSE CHANGES. Same two guards in the same order, same rail
   filters, same livemode filter, same contacts subquery, same grants. This
   is generated from 20261006980000, which a case-insensitive grep confirms
   is the last definition of this function.
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
  if not coalesce(public.is_opndoor_staff(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  return query
    with named as (
      select m.typed_name_key,
             m.typed_name,
             m.application_id,
             /* WHEN THE TENANT NAMED THEM. Was coalesce(m.resolved_at,
                m.created_at), which on this list is always resolved_at --
                the moment we pressed "Not in network". See the header. */
             m.created_at as at
        from public.application_agency_match m
        join public.applications a on a.id = m.application_id
       where m.state = 'dismissed'
         and a.livemode
         and coalesce(btrim(m.typed_name_key), '') <> ''
    )
    select n.typed_name_key,
           /* The spelling the most recent tenant used, which is what goes
              into the CRM. Now genuinely the most recent TENANT rather
              than the most recently dismissed row. */
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

/* Re-stated rather than assumed. `create or replace` keeps the existing
   privileges, so these are here for the clean filename-order apply, where
   this file may be the first to create the function if 20261006980000's
   grants were ever reordered. Naming `public` explicitly is the rule a
   default PUBLIC execute privilege otherwise defeats. */
revoke all on function public.not_in_network_agencies() from public;
grant execute on function public.not_in_network_agencies() to authenticated;

comment on function public.not_in_network_agencies() is
  'NM-N. Agencies a direct tenant named that were dismissed as not in our network, one row per agency, with the agent contacts the tenants gave, for hand entry into the CRM. last_named_at is when the tenant named them, not when we dismissed it. Never returns anything of the tenant''s. Opndoor staff, AAL2.';
