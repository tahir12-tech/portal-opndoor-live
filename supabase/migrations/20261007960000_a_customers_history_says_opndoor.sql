/* =====================================================================
   A CUSTOMER'S HISTORY SAYS "opndoor", NOT WHICH OF US.

   Matt, 2026-10-03: "in Recent changes and any other customer-facing history,
   show changes made by Opndoor staff as 'opndoor', not the staff member's
   name."

   Every row an Opndoor admin made named a person at Opndoor on a page an
   agency's Director and a supplier's Management open every week. The
   customer's question is never which of us did it.

   THE READER DECIDES, so an Opndoor admin still sees the name: for them "who"
   is the whole point of an audit trail. And the actor is resolved by
   `actor_id` rather than by matching the stored name, which is a text
   snapshot taken when the row was written. A row with no actor_id falls
   through unchanged: if we cannot show it was Opndoor staff, we must not say
   it was.
   ===================================================================== */

CREATE OR REPLACE FUNCTION public.agency_changes(p_agency uuid, p_limit integer DEFAULT 50)
 RETURNS TABLE(at timestamp with time zone, actor text, subject_kind text, subject text, action text, detail text, field text, old_value text, new_value text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    select o.at, o.actor, o.actor_id,
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
    select o.at, o.actor, o.actor_id, 'branch', br.name, o.action, o.detail, null, null, null
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
    select o.at, o.actor, o.actor_id, 'person', coalesce(u.full_name, u.email), o.action,
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
    /* AN INVITE IS SAID IN AGENCY LEVELS, not in the role column. Matt,
       2026-10-02: "'invited set to management' should read 'Independent
       Director invited as Director', using agency level names (Director,
       Manager, Negotiator) everywhere on agency pages."

       `user_audit` stores the ROLE on an invite ('management'), and
       Director and Manager are the same role differing only by
       `sees_commission` -- so the stored value cannot name the level on
       its own. The level is computed here from the person's own row,
       which for a pending invite IS what they were invited as, and for
       an accepted one is what they are now. Emitted as an ACTION with a
       detail rather than as a field pair, because "invited" is
       something that happened and not a column that moved: a field pair
       can only ever render as "X set to Y".

       Every other user_audit action keeps the field shape it had. */
    select ua.at, ua.actor, ua.actor_id, 'person', coalesce(u.full_name, u.email),
           case when ua.action = 'invited' then 'invited_as' end,
           case when ua.action = 'invited' then
             case
               when u.role = 'referrer' then 'Negotiator'
               when u.role = 'management' and coalesce(u.sees_commission, false) then 'Director'
               when u.role = 'management' then 'Manager'
               when u.role is null then coalesce(ua.new_value, 'a user')
               else initcap(replace(u.role::text, '_', ' '))
             end
           end,
           case when ua.action = 'invited' then null else ua.action end,
           case when ua.action = 'invited' then null else ua.old_value end,
           case when ua.action = 'invited' then null else ua.new_value end
    from public.user_audit ua
    join people pp on pp.user_id = ua.target_user
    left join public.users u on u.id = ua.target_user
  )
  /* =====================================================================
     OPNDOOR'S OWN STAFF ARE "opndoor" TO A CUSTOMER.

     Matt, 2026-10-03: "in Recent changes and any other customer-facing
     history, show changes made by Opndoor staff as 'opndoor', not the staff
     member's name."

     WHY IT MATTERS MORE THAN IT LOOKS. This list is read by an agency's own
     Director and by a supplier's Management, and every row an Opndoor admin
     made named a person at Opndoor: "Nicholas Dwyer set the agent rate to
     10%". That is our internal staffing, published to a customer, on a page
     they open every week. The customer's question is never which of us did
     it; it is that opndoor did.

     THE CALLER DECIDES, NOT THE ROW. An Opndoor admin reading the same
     history still needs the name, because for them "who" is the whole point
     of an audit trail. So this is `is_opndoor_staff()` on the READER, which
     is already how the rest of this function's siblings decide what to show.

     RESOLVED BY actor_id AND NOT BY THE NAME. The stored `actor` is a text
     snapshot taken when the row was written, so matching it against anything
     would be matching a string; the id points at the row that says what they
     are. An audit row with no actor_id -- a system write, an older row --
     falls through unchanged, which is right: if we cannot show that it was
     Opndoor staff, we must not claim it was.
     ===================================================================== */
  select r.at,
         case
           when not coalesce(public.is_opndoor_staff(), false)
                and r.actor_id is not null
                and exists (select 1 from public.users au
                             where au.id = r.actor_id
                               and au.role in ('superadmin', 'opndoor_manager'))
             then 'opndoor'
           else r.actor
         end,
         r.subject_kind, r.subject, r.action, r.detail,
         r.field, r.old_value, r.new_value
  from rows r
  order by r.at desc
  limit greatest(coalesce(p_limit, 50), 1);
end $function$;
