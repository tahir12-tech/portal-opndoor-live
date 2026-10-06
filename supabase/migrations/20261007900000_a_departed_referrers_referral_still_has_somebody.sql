/* =====================================================================
   WHO GETS THE PAID EMAIL AND THE SIGNED DEED WHEN THE REFERRER HAS GONE.

   Matt, 2026-10-03: "When a referrer's access is removed or they're deleted,
   their open referrals must still have someone to notify and to receive the
   deed. Tell me what happens today for GR-20837 (Tom Reeve deleted, referral
   awaiting payment) if the tenant pays and signs: who gets the paid email and
   the signed deed? It should go to the office's or agency's email if set,
   otherwise the agency's Directors, and the agency page should say 'N open
   referrals from people who have left; deeds will go to [who]'."

   THE ANSWER FIRST, MEASURED ON DEV, because it is better news than the
   question expects. Nothing is stranded today. Both
   `agency_notification_recipients` and `deed_delivery_target` (which reads it)
   filter the referrer rung on `u.status = 'active'`, so a deleted or
   deactivated person drops out rather than being written to, and the third
   rung fires: every active `role = 'management'` whose POSITION covers the
   branch. For GR-20837 and GR-20845 that is four people -- Wayne Kelly, Joe
   Joe, Rosa Vance and Nadia Shaw -- and `deed_delivery_target.auto_send` is
   true, so the deed goes out by itself.

   GR-20837 IS ALSO NO LONGER OPEN: it is `withdrawn` now, not awaiting
   payment. GR-20845 and GR-20846 are Tom Reeve's other two and both already
   hold executed deeds. So on dev there is no open pre-deed referral of a
   departed person at this moment; the rule still has to be right for the next
   one.

   WHAT CHANGES, which is the shape of the ladder rather than whether there is
   one. Matt's order is "the office's or agency's email if set, otherwise the
   agency's Directors", and the ladder had neither of those rungs: it went
   straight from "nobody ticked" to every manager in scope. So:

     1. referrer          the person who sent it, if still active. Unchanged.
     2. copy              everybody ticked whose position covers it. Unchanged.
     3. agency_contact    NEW. The office's own primary contact, falling back
                          to the agency's -- which is exactly what
                          `effective_primary_contact_route` already resolves,
                          branch before agency.
     4. director          NEW. Active management WITH `sees_commission`, which
                          is what a Director is on this rail.
     5. branch_manager    the old rung 3, kept as the last resort.

   WHY RUNG 5 SURVIVES, and it is not a hedge. Matt's sentence stops at
   Directors because in his head an agency has one. An agency with Managers and
   no Director is a real shape -- the ladder allows it, and nothing requires a
   Director to exist -- and on that agency a strict reading of the instruction
   sends an executed Deed of Guarantee to nobody. Stranding is the exact
   failure this rung was written for, so it stays beneath the two new ones:
   every agency Matt described is served by rungs 3 and 4, and the one he did
   not describe is not left silent.

   MEASURABLE ON REGENT'S, which has no `agent_contacts` row at all: rung 3
   finds nothing, so the deed moves from four people to the three Directors
   (Joe Joe, Rosa Vance, Wayne Kelly) and Nadia Shaw, who is a Manager, stops
   receiving it. That is the instruction doing what it says.
   ===================================================================== */

CREATE OR REPLACE FUNCTION public.agency_notification_recipients(p_application uuid)
 RETURNS TABLE(email text, display_name text, rung text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with app as (
    select a.id, a.branch_id, a.referrer_id, b.agency_id, ag.group_id,
           -- THE BRANCH'S OWN PARTNER for the contact rung below, not the
           -- application's. deed_delivery_target's R1 note is the precedent and
           -- the reason: where one agency is legitimately shared by two
           -- partners, keying a contact on the branch alone handed one route's
           -- executed deed to the other route's mailbox.
           b.partner_id as branch_partner_id
      from public.applications a
      left join public.branches b on b.id = a.branch_id
      left join public.agencies ag on ag.id = b.agency_id
     -- THE AGENCY RAIL ONLY. Direct and the supplier rail keep the contacts
     -- they already had; this function answers for neither.
     where a.id = p_application
       and public.application_channel(a.id) = 'Agent referral'
  ),
  -- 1. The person who sent it. referrer_id is set by create_referral to
  --    auth.uid(), so this is unambiguous and needs no inference. ACTIVE only,
  --    which is the half of Matt's question that was already right: a deleted
  --    or deactivated referrer drops out here rather than being emailed.
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
  /* 3. THE OFFICE'S OR THE AGENCY'S OWN EMAIL. Matt's first choice, and the
        one rung that is not a person: a mailbox outlives whoever was reading
        it, which is the whole point of preferring it to a colleague of the
        person who left.

        NAMED WHERE THERE IS A NAME. The contact row's `name` is often a desk
        rather than a person ("Lettings"), and an empty one would print a blank
        sender, so the agency's own name stands in. */
  contact as (
    select c.email,
           coalesce(nullif(btrim(c.name), ''), ag.name, 'The office') as display_name,
           'agency_contact'::text as rung, 3 as pri
      from app
      left join public.agencies ag on ag.id = app.agency_id
      cross join lateral public.effective_primary_contact_route(
                   app.branch_id, app.branch_partner_id) c
     where coalesce(btrim(c.email), '') <> ''
       and not exists (select 1 from referrer)
       and not exists (select 1 from copies)
  ),
  /* 4. THE AGENCY'S DIRECTORS. `role = 'management'` AND `sees_commission` is
        what a Director is on this rail -- the same pair `personLevelLabel`
        reads in the client and `level_rank_of` reads in SQL. Management without
        the flag is a MANAGER, which is rung 5. */
  directors as (
    select u.email, u.full_name as display_name, 'director'::text as rung, 4 as pri
      from app
      join public.user_scopes s
        on (s.kind = 'branch' and s.branch_id = app.branch_id)
        or (s.kind = 'agency' and s.agency_id = app.agency_id)
        or (s.kind = 'group'  and app.group_id is not null and s.group_id = app.group_id)
      join public.users u on u.id = s.user_id
     where u.status = 'active'
       and u.role = 'management'
       and u.sees_commission
       and coalesce(btrim(u.email), '') <> ''
       and not exists (select 1 from referrer)
       and not exists (select 1 from copies)
       and not exists (select 1 from contact)
  ),
  -- 5. The catch, used only when every rung above is empty. "A manager on the
  --    branch" read as a manager whose position COVERS the branch: Regent's
  --    managers are positioned on the agency, not the branch, so the narrow
  --    reading would park every Regent deed the day its negotiator left.
  --    BENEATH THE TWO NEW RUNGS NOW, and still here: see the header on why an
  --    agency with Managers and no Director must not be sent nothing at all.
  fallback as (
    select u.email, u.full_name as display_name, 'branch_manager'::text as rung, 5 as pri
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
       and not exists (select 1 from contact)
       and not exists (select 1 from directors)
  ),
  everyone as (
    select * from referrer
    union all select * from copies
    union all select * from contact
    union all select * from directors
    union all select * from fallback
  )
  -- One address once, at its best rung: somebody who is both the referrer and
  -- ticked is the referrer, and is emailed a single time.
  select distinct on (lower(btrim(email))) email, display_name, rung
    from everyone
   order by lower(btrim(email)), pri asc, email asc
$function$;

/* =====================================================================
   AND THE LINE ON THE AGENCY PAGE.

   Matt: "the agency page should say 'N open referrals from people who have
   left; deeds will go to [who]'."

   NO ARGUMENT, one row per reachable agency, which is `org_deed_readiness`'s
   shape and is deliberate: the Agencies page draws many agencies and a
   per-agency call would be one round trip per row. `app_reachable_agency` is
   the same predicate that one uses, and it answers true for an admin and for
   opndoor_manager, so this needs no second arm for them.

   "OPEN" IS PRE-DEED AND STILL ALIVE. A referral whose deed is already
   executed has nothing left to deliver, and a withdrawn, expired or declined
   one is closed -- GR-20837 is withdrawn, which is why it is not counted.

   "[WHO]" IS COMPUTED THROUGH THE LADDER, not described in prose, so the line
   cannot drift from where the deed actually goes. It is the distinct set of
   names the ladder answers for those referrals, which is one query per open
   referral and is why the count is capped: an agency with fifty of these has a
   different problem and the sentence is the same.
   ===================================================================== */
CREATE OR REPLACE FUNCTION public.org_departed_referrals()
 RETURNS TABLE(agency_id uuid, open_count integer, goes_to text[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  return query
  with mine as (
    select a.id, b.agency_id as ag
      from public.applications a
      join public.branches b on b.id = a.branch_id
      join public.users u on u.id = a.referrer_id
     where u.status in ('deleted', 'deactivated')
       and a.status not in ('withdrawn', 'expired', 'declined')
       and coalesce(a.deed_state, '') <> 'executed'
       and public.app_reachable_agency(b.agency_id)
  ),
  -- Capped: the sentence says the same thing at six as at sixty, and the
  -- ladder is a query per referral.
  named as (
    select m.ag, r.display_name
      from (select ag, id, row_number() over (partition by ag order by id) as rn from mine) m
      cross join lateral public.agency_notification_recipients(m.id) r
     where m.rn <= 20
  )
  select m.ag,
         count(*)::integer,
         coalesce((select array_agg(distinct n.display_name order by n.display_name)
                     from named n where n.ag = m.ag), array[]::text[])
    from mine m
   group by m.ag;
end $function$;
