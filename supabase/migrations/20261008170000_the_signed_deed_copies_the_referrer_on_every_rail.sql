-- THE SIGNED DEED COPIES THE REFERRER ON EVERY RAIL THAT HAS ONE.
--
-- Matt (bg): "GR-26262 (Kestrel joint, signed 21:47): the signed deed went to
-- the agency (test@lettings.com) and the tenant, but not to the referrer,
-- Test Referrer (test@referrer.com). Per my notifications rule, the referrer
-- gets a copy by default unless they've switched it off. Check whether that's
-- built yet; if so, find why it didn't send."
--
-- Test: supabase/tests/the_signed_deed_copies_the_referrer.test.sql
--
-- =========================================================================
-- IT IS BUILT, AND IT WAS BUILT FOR ONE RAIL
-- =========================================================================
--
-- Measured on GR-26262 before changing anything:
--   application_channel          'Partner referral'
--   agency_notification_recipients   0 rows
--   deed_delivery_target         test@lettings.com (route_contact), alone
--
-- So the ladder exists, works, and answers nothing here -- for two separate
-- reasons, either of which alone would have been enough:
--
--   1. `agency_notification_recipients` filters `channel = 'Agent referral'`
--      and says so in terms: "Direct and the supplier rail keep the contacts
--      they already had; this function answers for neither." That was true
--      of the CONTACTS and silently also true of the LADDER.
--   2. `deed_delivery_target`'s ladder arm carries the same gate, so even a
--      populated ladder would not have been read on this rail.
--
-- AND THE REFERRER IS DEMONSTRABLY REACHABLE, which is what makes this a gap
-- rather than a missing feature: the same application logged "Notified
-- (paid): test@referrer.com" three minutes earlier. A different path, with
-- its own resolution, got it right.
--
-- =========================================================================
-- WHAT I TRIED FIRST, AND WHY THE TEST REFUSED IT
-- =========================================================================
--
-- The obvious fix is to drop the rail gate from
-- `agency_notification_recipients` so the supplier rail gets the ladder
-- too. My own test caught that this is much wider than Matt asked for.
--
-- That function has FIVE rungs, not one: the referrer, ticked copies, the
-- agency's own MAILBOX, and two fallbacks -- a Director, then a branch
-- Manager -- that exist to find somebody when nobody is ticked. On the
-- supplier rail the mailbox is already the row the contact arm returns, so
-- the agency was sent its own deed TWICE; and Director and branch Manager
-- are rungs the supplier ladder does not have. It is the AGENCY ladder, and
-- the name says so.
--
-- So the agency ladder is left exactly as it was, and the supplier rail
-- gets ONE new arm carrying ONE person: the referrer, resolved the way the
-- agency rail resolves its own first rung, and subject to the same
-- notification matrix cell so switching it off still works.
--
-- (ap) IS ESTATE-WIDE: every email to a portal user is on by default unless
-- they switch it off. A supplier's referrer is a portal user.
--
-- DIRECT STAYS OUT, and that is a decision rather than an oversight: a direct
-- tenant nominates their own contact and there is no referrer to copy.
--
-- =========================================================================
-- THE ORDER WAS IMPLICIT AND HAD TO STOP BEING
-- =========================================================================
--
-- `deed_delivery_target` has no ORDER BY, and the caller takes the first row
-- as the recipient and the rest as copies -- that first row is what
-- `deed_delivered_to` records. On the agency rail the ladder is the whole
-- answer and the referrer is rightly first. On the SUPPLIER rail the deed is
-- addressed to the AGENCY, which (ap) says can never be switched off, so the
-- referrer is a copy and the ladder must sort AFTER the contact.
--
-- Left to the union's natural order, adding the ladder would have made the
-- supplier's referrer the addressee of the instrument and rewritten
-- deed_delivered_to with it. The ordering is now explicit, in a wrapper so
-- the row type is unchanged and no caller learns a new column.

CREATE OR REPLACE FUNCTION public.deed_delivery_target(p_application uuid)
 RETURNS TABLE(email text, display_name text, source text, verified boolean, auto_send boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select t.email, t.display_name, t.source, t.verified, t.auto_send from (
  with a as (
    select * from public.applications where id = p_application
  ),
  ch as (
    select public.application_channel((select id from a)) as channel
  ),
  -- THE WHOLE LADDER, in rung order. No limit.
  nr as (
    select r.email, r.display_name, r.rung,
           case r.rung when 'referrer' then 1 when 'copy' then 2 else 3 end as pri
      from public.agency_notification_recipients((select id from a)) r
  ),
  d as (
    select * from public.application_delivery_contacts
     where application_id = (select id from a)
  ),
  rc as (
    select * from public.effective_primary_contact_route(
      (select branch_id from a), (select partner_id from a))
  ),
  -- R1. WAS `effective_primary_contact(branch)`, which keys on the branch
  -- ALONE with no partner filter and runs inside this definer function, so it
  -- saw every contact on the branch whatever RLS said. Where one agency is
  -- legitimately shared by two partners, that handed one route's executed deed
  -- to the other route's contact. Pinned to the BRANCH'S OWN partner: still
  -- the branch mailbox this rung was always for, but never another company's.
  c as (
    select * from public.effective_primary_contact_route(
      (select branch_id from a),
      (select b.partner_id from public.branches b where b.id = (select branch_id from a)))
  ),
  -- auto_send is a property of the application, so it is computed once.
  gate as (
    select (select channel from ch) <> 'Agent referral' or exists (select 1 from nr) as auto_send
  )
  -- THE AGENCY RAIL: one row per person on the ladder, FILTERED BY THE
  -- MATRIX. Q-03. The deed to its own recipient is a locked cell -- the
  -- referrer rung on this rail -- so notification_enabled answers true for it
  -- whatever any stored row says, and set_notification_setting refuses to
  -- turn it off. The COPIES are the switchable half: an agency that does not
  -- want its ticked users copied on the executed instrument can say so, and
  -- this is where that takes effect. Applied here rather than in the caller
  -- because deed_delivery_target is the one thing every deed send asks, and a
  -- rule applied in the caller is a rule the other caller forgets.
  select nr.email, nr.display_name, nr.rung,
         true,
         (select auto_send from gate),
         /* ORDER MATTERS AND WAS IMPLICIT. The caller takes targets[0] as the
            recipient and records it as `deed_delivered_to`; the rest are
            copies. On the agency rail the ladder IS the answer and the
            referrer is rightly first. */
         1 as ord
    from nr
   where (select channel from ch) = 'Agent referral'
     and public.notification_enabled(
           'agency', null, (select agency_id from a), 'deed_issued',
           case when nr.rung = 'referrer' then 'referrer' else 'ticked_users' end)

  union all

  -- EVERY OTHER RAIL, and the agency rail when the ladder is empty: the single
  -- contact, exactly as before. Direct stops at the tenant's own nominated
  -- contact and never reaches the route or branch mailbox.
  select
    case when (select channel from ch) = 'Direct'
         then (select email from d)
         else coalesce((select email from d), (select email from rc), (select email from c)) end,
    coalesce(
      nullif(btrim(coalesce((select agency_name from d), '')), ''),
      nullif(btrim(coalesce((select first_name from d), '') || ' ' || coalesce((select last_name from d), '')), ''),
      case when (select channel from ch) = 'Direct' then null
           else coalesce((select name from rc), (select name from c)) end
    ),
    case
      when (select application_id from d) is not null then 'delivery_contact'
      when (select channel from ch) = 'Direct' then 'delivery_contact'
      when (select id from rc) is not null then 'route_contact'
      else 'branch_contact'
    end,
    case when (select application_id from d) is not null
         then (select verified_at from d) is not null
         else true end,
    (select auto_send from gate),
    2 as ord
  where not ((select channel from ch) = 'Agent referral' and exists (select 1 from nr))

  union all

  /* AND THE AGENCY'S OWN MAILBOX, WHERE SOMEBODY HAS SET ONE, ON OUR OWN
     ESTATE. Matt, 2026-10-02: "Opndoor's own agencies (like Regent): no
     email required. Signed deeds go to whoever sent the referral (plus
     the people already ticked to receive them, as now). The agency or a
     branch can optionally add an email that ALSO receives the deed;
     leave it blank and nothing is missing."

     It did not. The agency rail returned the ladder and stopped, and the
     second arm above only runs when the ladder is EMPTY, so a mailbox
     set on one of our agencies was stored, shown on the Agencies screen,
     and never written to. GR-FROST-OURS on dev is the proof: its branch
     holds mayfair@frost.example and the deed resolved to the referrer
     alone.

     ALSO, NOT INSTEAD, which is the word in the instruction. This arm
     adds to the ladder rather than replacing it, and only where the
     ladder is non-empty -- when it is empty the second arm already
     returns this same contact, and emitting it twice would make
     `deed_delivered_to` read like two recipients where there is one.

     THE SUPPLIER RAIL IS UNTOUCHED. Its channel is not 'Agent referral',
     so this arm returns nothing for it and the second arm above is still
     the whole answer: one address, the branch's own or the agency's by
     inheritance, which is exactly what Matt's supplier half asks for.

     `branch_contact` as the source, which is what the second arm calls
     the same row, so nothing downstream has a new word to learn. */
  select
    coalesce(rc.email, c.email),
    coalesce(rc.name, c.name),
    'branch_contact',
    true,
    (select auto_send from gate),
    4 as ord
  from (select 1) one
  left join rc on true
  left join c on true
  where (select channel from ch) = 'Agent referral'
    and exists (select 1 from nr)
    and coalesce(btrim(coalesce(rc.email, c.email)), '') <> ''
    -- Not somebody who is already on the ladder: a Director whose own
    -- address is also the agency mailbox is one recipient, not two.
    and lower(btrim(coalesce(rc.email, c.email))) not in (select lower(btrim(nr.email)) from nr where nr.email is not null)

  union all

  /* THE SUPPLIER'S REFERRER, AND ONLY THE REFERRER. Matt (bg): GR-26262's
     signed deed reached the agency and the tenant and not Test Referrer,
     who sent it. (ap) is estate-wide -- every email to a portal user is on
     by default unless they switch it off -- and a supplier's referrer is a
     portal user.
 
     NOT THE WHOLE AGENCY LADDER, which is what I tried first and what my
     own test refused. `agency_notification_recipients` has FIVE rungs: the
     referrer, ticked copies, the agency's own MAILBOX, and two fallbacks
     (a Director, then a branch Manager) that exist to find somebody on the
     agency ladder when nobody is ticked. On the supplier rail that mailbox
     is already the row the contact arm returns, so widening the ladder sent
     the agency its own deed twice; and "Director" and "branch Manager" are
     rungs the supplier ladder does not have at all.
 
     SO THIS IS ONE PERSON, resolved the same way the agency rail resolves
     its first rung: referrer_id, which create_referral sets to auth.uid(),
     active only, and subject to the same notification matrix cell. Ordered
     AFTER the contact, because on this rail the deed is ADDRESSED to the
     agency -- which (ap) says can never be switched off -- and the referrer
     is a copy. Left to the union's natural order this would have made the
     referrer the addressee of a legal instrument and rewritten
     deed_delivered_to with it. */
  select u.email, u.full_name, 'referrer', true, (select auto_send from gate), 3
    from a join public.users u on u.id = a.referrer_id
   where (select channel from ch) = 'Partner referral'
     and u.status = 'active'
     and coalesce(btrim(u.email), '') <> ''
     and public.notification_enabled(
           'agency', null, (select agency_id from a), 'deed_issued', 'referrer')
     /* NEVER TWICE: a supplier whose referrer's address is also the agency
        mailbox is one recipient, not two.

        SET-BASED, NOT SCALAR, and three suites found out why. I first wrote
        this as `is distinct from coalesce((select email from d), ...)`, and
        `d` -- application_delivery_contacts -- can hold more than one row
        for an application, so the subquery raised 21000 and took out every
        test that touched a deed, including two with nothing to do with
        suppliers. The arms above get away with the scalar form because they
        run on rails where that table holds at most one row; this arm must
        not assume it. */
     and lower(btrim(u.email)) not in (
       select lower(btrim(x.email)) from (
         select d2.email from public.application_delivery_contacts d2 where d2.application_id = a.id
         union all select rc.email from rc
         union all select c.email from c
       ) x where x.email is not null and btrim(x.email) <> ''
     )
  ) t(email, display_name, source, verified, auto_send, ord) order by t.ord;
$function$
;
