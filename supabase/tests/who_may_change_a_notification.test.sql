-- WHO MAY CHANGE WHICH NOTIFICATION SETTING.
--
-- Matt, 2026-09-30: "a Director can change the notification settings of
-- anyone at or below them in their own agency, not just see them. Each
-- person can still change their own event choices. Two settings are
-- Director-only: turning monthly commission statements on or off (and only
-- for people who can see commission), and whether someone is copied on
-- colleagues' referrals within their position. Opndoor admin can change
-- anyone's."
--
-- THREE SETTINGS, THREE DIFFERENT RULES. They used to share one, and the
-- easiest way to get this wrong is to write the positive rule for all three
-- and assume the rest falls out.
--
--   event choices       self, OR a Director at/above in their own agency, OR admin
--   monthly statements  Director-only (NOT self), and only for someone who
--                       may see commission. Plus admin.
--   copied on referrals Director-only (NOT self). Plus admin.
--
-- THE NEGATIVE HALF IS THE POINT. "Director-only" REMOVES a capability from
-- self-service: a Negotiator may not switch their own statements on, and
-- neither may a Manager. Assertions 7, 8 and 11 are those, and they are the
-- ones a fix written only in the positive direction would leave open.
--
-- AND "IN THEIR OWN AGENCY" IS THE POSITION LADDER, NOT partner_id. On the
-- agency rail every agency shares the house partner `opndoor-agents`, so a
-- partner test would let Regent's Director change somebody at a different
-- agency entirely. Assertion 6 is that, and it is rule 2 -- the single most
-- repeated finding in this whole effort.

begin;
select plan(15);

-- ===========================================================================
-- TWO AGENCIES ON THE HOUSE RAIL, so "same partner" is true across both and
-- cannot be mistaken for "same agency".
-- ===========================================================================
insert into public.agencies (id, partner_id, name) values
  ('e2000000-0000-0000-0000-0000000000a1',
   (select id from public.partners where slug='opndoor-agents'),'ZZZ WM Agency One'),
  ('e2000000-0000-0000-0000-0000000000a2',
   (select id from public.partners where slug='opndoor-agents'),'ZZZ WM Agency Two');
insert into public.branches (id, agency_id, partner_id, name) values
  ('e2000000-0000-0000-0000-0000000000b1','e2000000-0000-0000-0000-0000000000a1',
   (select id from public.partners where slug='opndoor-agents'),'ZZZ WM Office One'),
  ('e2000000-0000-0000-0000-0000000000b2','e2000000-0000-0000-0000-0000000000a2',
   (select id from public.partners where slug='opndoor-agents'),'ZZZ WM Office Two');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       x.email,'',now(),now(),now()
from (values
  ('e2000000-0000-0000-0000-00000000c001'::uuid,'zzz.wm.dir@r.test'),
  ('e2000000-0000-0000-0000-00000000c002'::uuid,'zzz.wm.mgr@r.test'),
  ('e2000000-0000-0000-0000-00000000c003'::uuid,'zzz.wm.neg@r.test'),
  ('e2000000-0000-0000-0000-00000000c004'::uuid,'zzz.wm.other@r.test'),
  ('e2000000-0000-0000-0000-00000000c005'::uuid,'zzz.wm.admin@r.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('e2000000-0000-0000-0000-00000000c001','WM Director','zzz.wm.dir@r.test','management',
   (select id from public.partners where slug='opndoor-agents'),'active',true),
  ('e2000000-0000-0000-0000-00000000c002','WM Manager','zzz.wm.mgr@r.test','management',
   (select id from public.partners where slug='opndoor-agents'),'active',false),
  ('e2000000-0000-0000-0000-00000000c003','WM Negotiator','zzz.wm.neg@r.test','referrer',
   (select id from public.partners where slug='opndoor-agents'),'active',false),
  -- A Negotiator at the OTHER agency, same partner.
  ('e2000000-0000-0000-0000-00000000c004','WM Other Agency Neg','zzz.wm.other@r.test','referrer',
   (select id from public.partners where slug='opndoor-agents'),'active',false),
  ('e2000000-0000-0000-0000-00000000c005','WM Admin','zzz.wm.admin@r.test','superadmin',
   null,'active',true);

insert into public.user_scopes (user_id, kind, agency_id) values
  ('e2000000-0000-0000-0000-00000000c001','agency','e2000000-0000-0000-0000-0000000000a1'),
  ('e2000000-0000-0000-0000-00000000c002','agency','e2000000-0000-0000-0000-0000000000a1');
-- A branch position carries branch_id, not agency_id: the check constraint
-- pairs the kind with the column, which is the whole point of having it.
insert into public.user_scopes (user_id, kind, branch_id) values
  ('e2000000-0000-0000-0000-00000000c003','branch','e2000000-0000-0000-0000-0000000000b1'),
  ('e2000000-0000-0000-0000-00000000c004','branch','e2000000-0000-0000-0000-0000000000b2');

select public.migrate_notification_settings_to_people();

-- ===========================================================================
-- EVENT CHOICES. Self, or a Director at or above, or an admin.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"e2000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.set_notification_for('e2000000-0000-0000-0000-00000000c003','paid', false)$$,
  'a Director may change a Negotiator''s event choice in their own agency');

select lives_ok(
  $$select public.set_notification_for('e2000000-0000-0000-0000-00000000c002','paid', false)$$,
  'and a Manager''s, who is below them');

-- ===========================================================================
-- 3-4. A NEGOTIATOR STILL CHOOSES THEIR OWN, AND ONLY THEIR OWN.
-- ===========================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"e2000000-0000-0000-0000-00000000c003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.set_notification_for('e2000000-0000-0000-0000-00000000c003','sent', false)$$,
  'a Negotiator may still change their own event choices');

select throws_ok(
  $$select public.set_notification_for('e2000000-0000-0000-0000-00000000c002','sent', false)$$,
  '42501',
  'You can only change this for yourself, or for people at or below you in your own agency.',
  'but not a colleague''s');

-- ===========================================================================
-- 5-6. A MANAGER IS NOT A DIRECTOR, AND AN AGENCY IS NOT A PARTNER.
-- ===========================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"e2000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select throws_ok(
  $$select public.set_notification_for('e2000000-0000-0000-0000-00000000c003','sent', true)$$,
  '42501',
  'You can only change this for yourself, or for people at or below you in your own agency.',
  'a Manager may not change a Negotiator''s, because only a Director may');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"e2000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

/* RULE 2. Same house partner, different agency. A partner test would let
   this through, which is the most repeated finding in this effort. */
select throws_ok(
  $$select public.set_notification_for('e2000000-0000-0000-0000-00000000c004','sent', true)$$,
  '42501',
  'You can only change this for yourself, or for people at or below you in your own agency.',
  'and a Director may not reach into another agency on the same house partner');

-- ===========================================================================
-- 7-9. MONTHLY STATEMENTS ARE DIRECTOR-ONLY, AND ONLY FOR SOMEBODY WHO MAY
-- SEE COMMISSION. The negative assertions are the point.
-- ===========================================================================
select throws_ok(
  $$select public.set_receives_commission_statements('e2000000-0000-0000-0000-00000000c002', true)$$,
  '22023',
  'Only a Director receives a commission statement. Change their level first.',
  'even a Director may not switch statements on for a Manager, who may not see commission');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"e2000000-0000-0000-0000-00000000c003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

/* NOT SELF-SERVICE, AND THE TARGET IS THE DIRECTOR ON PURPOSE.
   A Negotiator switching their OWN statements on is refused too, but by the
   LEVEL gate ("Only a Director receives a commission statement"), which
   fires first because a Negotiator may not see commission at all. That is
   the right refusal and a more useful sentence, but it does not exercise
   the PERMISSION rule -- it would still refuse if the permission rule were
   missing entirely. Pointing a Negotiator at the DIRECTOR's row gets past
   the level gate, so what refuses is the thing this assertion is about. */
select throws_ok(
  $$select public.set_receives_commission_statements('e2000000-0000-0000-0000-00000000c001', true)$$,
  '42501',
  'Only a Director, or Opndoor, decides who receives a commission statement.',
  'a Negotiator may NOT set statements for anybody: this one is not self-service');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"e2000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.set_receives_commission_statements('e2000000-0000-0000-0000-00000000c001', true)$$,
  'while a Director may set it for a Director');

-- ===========================================================================
-- 10-11. COPIED ON COLLEAGUES' REFERRALS IS DIRECTOR-ONLY TOO.
-- ===========================================================================
select lives_ok(
  $$select public.set_receives_notifications('e2000000-0000-0000-0000-00000000c003', true)$$,
  'a Director may decide who is copied on colleagues'' referrals');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"e2000000-0000-0000-0000-00000000c003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select throws_ok(
  $$select public.set_receives_notifications('e2000000-0000-0000-0000-00000000c003', true)$$,
  '42501',
  'You can only change this for people at or below your own position, in your own agency.',
  'and a Negotiator may NOT copy themselves in: this one is not self-service either');

-- ===========================================================================
-- 12-13. AN OPNDOOR ADMIN MAY CHANGE ANYONE'S, ACROSS AGENCIES.
-- ===========================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"e2000000-0000-0000-0000-00000000c005","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.set_notification_for('e2000000-0000-0000-0000-00000000c004','sent', false)$$,
  'an opndoor admin may change anyone''s event choices, in any agency');

select lives_ok(
  $$select public.set_receives_notifications('e2000000-0000-0000-0000-00000000c004', true)$$,
  'and who is copied on colleagues'' referrals, likewise');

-- ===========================================================================
-- 14-15. THE TWO LADDER QUESTIONS, ASKED DIRECTLY.
--
-- Both are allowlisted definer functions, and the allowlist ratchet requires
-- an allowlisted function to be exercised by name rather than only reached
-- through something else. Asked here as the two roles whose answers differ,
-- which is also the cheapest possible regression test on the ladder itself.
-- ===========================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"e2000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is(
  public.caller_is_director(), false,
  'caller_is_director says no to a Manager, who is management WITHOUT sees_commission');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"e2000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is(
  public.caller_may_set_for('e2000000-0000-0000-0000-00000000c004'), false,
  'and caller_may_set_for says no across agencies on the same house partner');

reset role;
select * from finish();
rollback;
