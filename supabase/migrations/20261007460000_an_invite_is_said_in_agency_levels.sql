-- =========================================================================
-- AN INVITE IS SAID IN AGENCY LEVELS.
--
-- Matt, 2026-10-02: "Recent changes: 'invited set to management' should
-- read 'Independent Director invited as Director', using agency level
-- names (Director, Manager, Negotiator) everywhere on agency pages."
--
-- WHY IT READ LIKE THAT. `agency_changes` passes a `user_audit` row
-- through as a FIELD PAIR -- field 'invited', new value 'management' --
-- and a field pair can only ever render as "X set to Y". The value is
-- the ROLE column, and on our estate Director and Manager are the same
-- role differing only by `sees_commission`, so the stored value cannot
-- name the level even if the sentence were better.
--
-- SO THE LEVEL IS COMPUTED HERE, from the person's own row, and the
-- invite is emitted as an ACTION with a detail rather than as a field
-- pair -- because "invited" is something that happened, not a column
-- that moved.
--
-- IS THE LEVEL RIGHT FOR AN OLD ROW? For a PENDING invite, which is the
-- case Matt is looking at, it is exactly what they were invited as:
-- nothing has changed it. For an accepted one it is what they are now,
-- which differs only if somebody has since changed their level -- and
-- that change has its own row in this same list, directly above.
-- Storing the level at invite time would be the stricter answer and
-- would leave every existing row unreadable, which is the thing being
-- fixed.
--
-- Every other user_audit action keeps the field shape it had.
-- =========================================================================

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
    select ua.at, ua.actor, 'person', coalesce(u.full_name, u.email),
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
  select r.at, r.actor, r.subject_kind, r.subject, r.action, r.detail,
         r.field, r.old_value, r.new_value
  from rows r
  order by r.at desc
  limit greatest(coalesce(p_limit, 50), 1);
end $function$;
