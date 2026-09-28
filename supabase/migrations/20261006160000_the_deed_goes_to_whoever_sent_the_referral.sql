-- THE DEED GOES TO WHOEVER SENT THE REFERRAL.
--
-- WHAT HAPPENED BEFORE, on real rows. On dev, Regent's Lettings has three
-- executed deeds. Two of them (GR-20845, GR-20846) were referred by Tom Reeve,
-- a Negotiator, and both were delivered automatically to manager@regent.dev.test
-- -- Rosa Vance, the Director. On GR-20846 Tom then had to press Resend, and it
-- went to Rosa again. The product never let the person who made the referral
-- have the document it produced.
--
-- WHY IT PICKED ROSA. deed_people_target resolves from the BRANCH alone and
-- knows nothing about the application: four rungs, nominated recipient, then a
-- branch-scoped user, then an agency-scoped user, then a group-scoped one,
-- `order by pri asc, email asc limit 1`. Regent's Park has no nominee and no
-- branch-scoped user, so it fell to rung 3, where Rosa and Nadia both sit, and
-- 'manager@regent.dev.test' sorts before 'manager2@regent.dev.test'. The
-- alphabet chose who receives Regent's deeds.
--
-- THE RULE NOW.
--   1. the referrer, while they are active
--   2. plus every ticked user whose POSITION covers the referral, always
--   3. and if the referrer has gone: the ticked users, then an active manager
--      whose position covers the branch, then park and alert
--
-- THE NOMINATED OVERRIDE GOES. branch_deed_recipient was the answer to "this
-- branch has nobody obvious"; the referrer is a better answer and is always
-- present. Rung 1 is removed here. The table is left in place and unused rather
-- than dropped: it holds who somebody once nominated, and a migration that
-- deletes that on cutover night cannot be undone by reading it back.
--
-- AND THE DIRECT RAIL STOPS BEING AN AGENCY. application_is_agent_estate reads
-- the route partner's referencing_mode, and 'opndoor-direct' is itself seeded
-- as 'opndoor_referenced' (20260812040000). So the people ladder ran on direct
-- applications, ahead of the tenant's own named contact in the coalesce below.
-- A direct tenant whose branch_id had been pointed at a real branch by the
-- agency auto-match had their executed deed sent, automatically, to an agency
-- person they never chose. The discriminator is application_channel, which
-- already answers 'Direct' for that partner BEFORE it looks at the mode, and is
-- the test the rest of the product uses. No fourth rail test is introduced.

-- ---------------------------------------------------------------------------
-- WHO IS TOLD ABOUT THIS REFERRAL.
-- ---------------------------------------------------------------------------
create or replace function public.agency_notification_recipients(p_application uuid)
returns table (email text, display_name text, rung text)
language sql stable security definer set search_path to ''
as $function$
  with app as (
    select a.id, a.branch_id, a.referrer_id, b.agency_id, ag.group_id
      from public.applications a
      left join public.branches b on b.id = a.branch_id
      left join public.agencies ag on ag.id = b.agency_id
     -- THE AGENCY RAIL ONLY. Direct and the supplier rail keep the contacts
     -- they already had; this function answers for neither.
     where a.id = p_application
       and public.application_channel(a.id) = 'Agent referral'
  ),
  -- 1. The person who sent it. referrer_id is set by create_referral to
  --    auth.uid(), so this is unambiguous and needs no inference.
  referrer as (
    select u.email, u.full_name as display_name, 'referrer'::text as rung, 1 as pri
      from app join public.users u on u.id = app.referrer_id
     where u.status = 'active' and coalesce(btrim(u.email), '') <> ''
  ),
  -- 2. Everybody ticked whose POSITION covers this referral. The scope is the
  --    position they already hold, never a second setting: branch for their
  --    branch, agency for every branch in it, group for the whole group.
  copies as (
    select u.email, u.full_name as display_name, 'copy'::text as rung, 2 as pri
      from app
      join public.user_scopes s
        on (s.kind = 'branch' and s.branch_id = app.branch_id)
        or (s.kind = 'agency' and s.agency_id = app.agency_id)
        or (s.kind = 'group'  and app.group_id is not null and s.group_id = app.group_id)
      join public.users u on u.id = s.user_id
     where u.receives_notifications
       and u.status = 'active'
       and coalesce(btrim(u.email), '') <> ''
  ),
  -- 3. The catch, used only when the two above are empty. "A manager on the
  --    branch" read as a manager whose position COVERS the branch: Regent's
  --    managers are positioned on the agency, not the branch, so the narrow
  --    reading would park every Regent deed the day its negotiator left.
  fallback as (
    select u.email, u.full_name as display_name, 'branch_manager'::text as rung, 3 as pri
      from app
      join public.user_scopes s
        on (s.kind = 'branch' and s.branch_id = app.branch_id)
        or (s.kind = 'agency' and s.agency_id = app.agency_id)
        or (s.kind = 'group'  and app.group_id is not null and s.group_id = app.group_id)
      join public.users u on u.id = s.user_id
     where u.status = 'active'
       and u.role = 'management'
       and coalesce(btrim(u.email), '') <> ''
       and not exists (select 1 from referrer)
       and not exists (select 1 from copies)
  ),
  everyone as (
    select * from referrer
    union all select * from copies
    union all select * from fallback
  )
  -- One address once, at its best rung: somebody who is both the referrer and
  -- ticked is the referrer, and is emailed a single time.
  select distinct on (lower(btrim(email))) email, display_name, rung
    from everyone
   order by lower(btrim(email)), pri asc, email asc
$function$;

comment on function public.agency_notification_recipients(uuid) is
  'Who is told about an agency-rail referral: the referrer while they are active, plus every ticked user whose position covers it, and when neither exists an active manager covering the branch. Agency rail only, by application_channel. Deduplicated by address at the best rung.';

revoke all on function public.agency_notification_recipients(uuid) from public;
grant execute on function public.agency_notification_recipients(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- THE PEOPLE LADDER LOSES ITS FIRST RUNG.
-- ---------------------------------------------------------------------------
create or replace function public.deed_people_target(p_branch uuid)
returns table (email text, display_name text)
language sql stable security definer set search_path to ''
as $function$
  -- THE NOMINATED RECIPIENT IS GONE (20261006160000). It existed to answer
  -- "this branch has nobody obvious", and the referrer answers that better and
  -- is always there. What is left is the fallback chain, which is all this
  -- function is now used for: readiness, and the last resort in
  -- agency_notification_recipients.
  with b as (
    select br.id as branch_id, br.agency_id, ag.group_id
    from public.branches br
    left join public.agencies ag on ag.id = br.agency_id
    where br.id = p_branch
  ),
  cand as (
    select 2 as pri, u.email, u.full_name
    from b join public.user_scopes s on s.kind = 'branch' and s.branch_id = b.branch_id
           join public.users u on u.id = s.user_id
    where u.status = 'active'
    union all
    select 3, u.email, u.full_name
    from b join public.user_scopes s on s.kind = 'agency' and s.agency_id = b.agency_id
           join public.users u on u.id = s.user_id
    where u.status = 'active'
    union all
    select 4, u.email, u.full_name
    from b join public.user_scopes s on s.kind = 'group' and s.group_id = b.group_id
           join public.users u on u.id = s.user_id
    where u.status = 'active'
  )
  select email, full_name from cand order by pri asc, email asc limit 1
$function$;

-- ---------------------------------------------------------------------------
-- WHERE THE EXECUTED DEED GOES.
-- ---------------------------------------------------------------------------
create or replace function public.deed_delivery_target(p_application uuid)
returns table (email text, display_name text, source text, verified boolean, auto_send boolean)
language sql stable security definer set search_path to ''
as $function$
  select
    coalesce(nr.email, d.email, rc.email, c.email),
    coalesce(
      nr.display_name,
      nullif(btrim(coalesce(d.agency_name, '')), ''),
      nullif(btrim(coalesce(d.first_name, '') || ' ' || coalesce(d.last_name, '')), ''),
      rc.name, c.name
    ),
    case
      -- The rung is the source now, so "where did it go" answers "to the person
      -- who sent it" rather than the undifferentiated 'org_person'.
      when nr.email is not null         then nr.rung
      when d.application_id is not null then 'delivery_contact'
      when rc.id is not null            then 'route_contact'
      else 'branch_contact'
    end,
    case
      when nr.email is not null         then true
      when d.application_id is not null then d.verified_at is not null
      else true
    end,
    case
      -- Not our estate: the mailbox is the deed path and always auto-sends.
      when public.application_channel(a.id) <> 'Agent referral' then true
      else nr.email is not null
    end
  from public.applications a
  /* THE AGENCY RAIL'S PRIMARY, and only on the agency rail. This lateral used
     to be deed_people_target gated on application_is_agent_estate, which is
     true for 'opndoor-direct' as well, so a direct tenant's deed could be sent
     to an agency. application_channel answers 'Direct' for that partner before
     it looks at the mode, so the tenant's own contact below now wins. */
  left join lateral (
    select r.email, r.display_name, r.rung
      from public.agency_notification_recipients(a.id) r
     order by case r.rung when 'referrer' then 1 when 'copy' then 2 else 3 end, r.email
     limit 1
  ) nr on true
  left join public.application_delivery_contacts d on d.application_id = a.id
  left join lateral (
    select * from public.effective_primary_contact_route(a.branch_id, a.partner_id)
  ) rc on true
  left join lateral (
    select * from public.effective_primary_contact(a.branch_id)
  ) c on true
  where a.id = p_application
$function$;

comment on function public.deed_delivery_target(uuid) is
  'Where an executed deed goes. Agency rail: the referrer, else a ticked user in scope, else an active manager covering the branch, else nothing and the webhook parks it. Every other rail is unchanged, and DIRECT now reaches the tenant''s own named contact: the old gate (application_is_agent_estate) is true for opndoor-direct, so the people ladder used to run there and beat it.';

-- ---------------------------------------------------------------------------
-- READINESS MEANS "SOMEBODY CAN CATCH IT", not "somebody is nominated".
-- ---------------------------------------------------------------------------
create or replace function public.branch_notification_fallback_exists(p_branch uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  -- Under the new rule the recipient is the referrer, who exists on every
  -- agency-rail application by construction. What a BRANCH can be short of is
  -- somebody to catch a referral whose referrer has been deactivated. That is
  -- what this answers, and it is what the screens now warn about.
  select exists (
    select 1
      from public.branches b
      left join public.agencies ag on ag.id = b.agency_id
      join public.user_scopes s
        on (s.kind = 'branch' and s.branch_id = b.id)
        or (s.kind = 'agency' and s.agency_id = b.agency_id)
        or (s.kind = 'group'  and ag.group_id is not null and s.group_id = ag.group_id)
      join public.users u on u.id = s.user_id
     where b.id = p_branch
       and u.status = 'active'
       and (u.role = 'management' or u.receives_notifications)
  )
$function$;

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
                     else a.partner_id = public.app_partner()
                   end))
  ),
  per_branch as (
    -- WAS: does deed_people_target resolve anybody, which counted a nomination
    -- and nothing else when there was one. A branch is ready when a referral
    -- whose referrer has gone still has somewhere to land.
    select va.id as agency_id, b.id as branch_id,
           public.branch_notification_fallback_exists(b.id) as ready
    from vis_agency va
    join public.branches b on b.agency_id = va.id
  )
  select pb.agency_id, pb.branch_id, pb.ready from per_branch pb
  union all
  select va.id, null::uuid,
         coalesce((select bool_and(pb.ready) from per_branch pb where pb.agency_id = va.id), false)
  from vis_agency va
$function$;

comment on function public.org_deed_readiness() is
  'Can a referral here still be delivered if its referrer leaves? One row per branch plus one per agency (bool_and over its branches). It no longer counts a nominated recipient, because the nomination override was dropped in 20261006160000 and the referrer is the recipient now; what a branch can lack is somebody to catch the fallback.';
