/* =====================================================================
   AN AGENCY CAN SEE WHAT CHANGED.

   Matt, 2026-10-01, verbatim: "Agency page: add a 'Recent changes' list
   like the supplier's, showing every change to the agency's details,
   branches, people's levels and commission deals in plain English, with
   who and when, using the shared builder."

   =====================================================================
   FOUR SOURCES, TWO SHAPES, AND NEITHER IS THE SUPPLIER'S
   =====================================================================

   The supplier's list reads one table with one shape: `partner_audit`,
   a (field, old, new) triple per row. An agency's history is not kept
   that way and never was:

     org_audit   (entity_type, entity_id, action, detail) -- an EVENT.
                 "created", "group_set", "commission_set",
                 "agreement_created", "position_set". The detail is
                 usually already a sentence and sometimes raw.
     user_audit  (target_user, action, old, new) -- a triple, for the
                 people.

   So this function's job is to put four queries into one shape and one
   order. It does NOT word them: `changeSentence` on the client does
   that, which is what "using the shared builder" asks for and what
   keeps the agency's list and the supplier's from drifting apart.

   BOTH SHAPES COME BACK, side by side, and a row carries whichever it
   has. An event is not a before-and-after and pretending otherwise
   ("action changed from nothing to created") would be worse than
   useless.

   =====================================================================
   WHOSE CHANGES COUNT AS THIS AGENCY'S
   =====================================================================

   Its own rows, its branches' rows, and its PEOPLE's rows -- where a
   person is somebody holding a position on this agency, on one of its
   branches, or on its group. That is `user_scopes`, which is the same
   place the reach predicates read, so "this agency's people" means the
   same thing here as everywhere else.

   A GROUP-LEVEL PERSON IS INCLUDED, deliberately: a Director positioned
   on the group runs this agency, and a change to their level changes
   who can act on it. Leaving them out would make the list quietly
   incomplete in exactly the case where it matters most.

   =====================================================================
   WHAT IT IS NOT ALLOWED TO LEAK
   =====================================================================

   `app_may_reach_agency` is the gate, which is the same predicate every
   other agency-scoped reader uses, so this cannot become a way around
   the boundary. Within it, the rows are about the agency the caller is
   already reading.

   Tests: supabase/tests/an_agency_can_see_what_changed.test.sql
   ===================================================================== */

create or replace function public.agency_changes(p_agency uuid, p_limit integer default 50)
returns table(
  at timestamptz,
  actor text,
  /** 'agency' | 'branch' | 'person' | 'deal' -- what the change was about. */
  subject_kind text,
  /** The branch or person it was about; null where it is the agency itself. */
  subject text,
  /** The event shape. */
  action text,
  detail text,
  /** The triple shape. Null on an event row. */
  field text,
  old_value text,
  new_value text
)
language plpgsql stable security definer set search_path to ''
as $function$
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  if not coalesce(public.app_may_reach_agency(p_agency), false) then
    raise exception 'Not permitted to read that agency.' using errcode = '42501';
  end if;

  return query
  with people as (
    /* THIS AGENCY'S PEOPLE: positioned on it, on one of its branches, or
       on its group. See the header for why the group counts. */
    select distinct us.user_id
    from public.user_scopes us
    left join public.branches b on b.id = us.branch_id
    left join public.agencies a on a.id = p_agency
    where us.agency_id = p_agency
       or b.agency_id = p_agency
       or (us.group_id is not null and us.group_id = a.group_id)
  ),
  rows as (
    -- 1. The agency's own details, and its deals.
    select o.at, o.actor,
           case when o.action like 'agreement%' or o.action = 'commission_set'
                     or o.action = 'all_in_breach_confirmed'
                then 'deal' else 'agency' end as subject_kind,
           null::text as subject,
           o.action, o.detail,
           null::text as field, null::text as old_value, null::text as new_value
    from public.org_audit o
    where o.entity_type = 'agency' and o.entity_id = p_agency

    union all
    -- 2. Its branches.
    select o.at, o.actor, 'branch', br.name, o.action, o.detail, null, null, null
    from public.org_audit o
    join public.branches br on br.id = o.entity_id
    where o.entity_type = 'branch' and br.agency_id = p_agency

    union all
    /* 3. Its people, as events (positions, notification ticks).

       THE POSITION'S DETAIL IS RESOLVED HERE, because it is stored as
       `kind:uuid` -- "branch:2dcca2aa-dc75-48d9-9004-c06a369f9c7f" --
       and no amount of wording on the client turns a uuid into a place.
       The client cannot look it up either: it holds the agency's own
       tree and not every group in the estate.

       The stored form is right to be an id: a name changes and the
       trail must not. Resolving it at READ time means an old row names
       the branch as it is called now, which is what somebody reading
       the history wants -- they are looking for the place, not for
       what it was called in March. */
    select o.at, o.actor, 'person', coalesce(u.full_name, u.email), o.action,
           case
             when o.action = 'position_set' then
               coalesce(
                 (select 'the ' || g.name || ' group' from public.agency_groups g
                   where 'group:' || g.id::text = o.detail),
                 (select ag.name from public.agencies ag
                   where 'agency:' || ag.id::text = o.detail),
                 (select 'the ' || br.name || ' branch' from public.branches br
                   where 'branch:' || br.id::text = o.detail),
                 o.detail)
             else o.detail
           end,
           null, null, null
    from public.org_audit o
    join people pp on pp.user_id = o.entity_id
    left join public.users u on u.id = o.entity_id
    where o.entity_type = 'user'

    union all
    -- 4. Its people's levels, which are a triple and live elsewhere.
    select ua.at, ua.actor, 'person', coalesce(u.full_name, u.email),
           null, null, ua.action, ua.old_value, ua.new_value
    from public.user_audit ua
    join people pp on pp.user_id = ua.target_user
    left join public.users u on u.id = ua.target_user
  )
  select r.at, r.actor, r.subject_kind, r.subject, r.action, r.detail,
         r.field, r.old_value, r.new_value
  from rows r
  order by r.at desc
  limit greatest(coalesce(p_limit, 50), 1);
end $function$;

revoke all on function public.agency_changes(uuid, integer) from public, anon;
grant execute on function public.agency_changes(uuid, integer) to authenticated, service_role;

comment on function public.agency_changes(uuid, integer) is
  'Everything that changed about one agency, newest first: its own details and deals, its branches, and its people''s positions and levels. Four sources in two shapes -- an event (action + detail) or a triple (field + old + new) -- because an agency''s history is not all kept as before-and-after. The wording is the client''s, so this list and the supplier''s read the same.';
