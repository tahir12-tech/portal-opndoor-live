-- WHO OPNDOOR TELLS.
--
-- Q-04. Today every internal alert of every kind goes to one address read
-- from an environment variable, and if that variable is unset the alert is
-- dropped -- the whole inventory is in docs/OPS-NOTIFICATIONS.md. This is the
-- routing table asserted: the floor on a critical type, deactivation, the
-- fallback, and who may change it.
--
-- EVERY ASSERTION HERE FAILS BEFORE 20261006640000 and 20261006650000,
-- because none of these functions or tables existed.
--
-- The four the instruction names explicitly -- "routing, the floor on
-- critical types, deactivation, and that nobody below superadmin can change
-- it" -- are assertions 3-4, 6-8, 9 and 12-13.

begin;
select plan(16);

-- ===========================================================================
-- TWO OPNDOOR PEOPLE AND A SHARED INBOX
-- ===========================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),now(),now()
from (values
  ('a1000000-0000-0000-0000-0000000000f1'::uuid,'zzz.ops.admin@o.test'),
  ('a1000000-0000-0000-0000-0000000000f2'::uuid,'zzz.ops.mgr@o.test'),
  ('a1000000-0000-0000-0000-0000000000f3'::uuid,'zzz.ops.second@o.test')
) as x(id,email);

-- Opndoor staff have NO partner: users_partner_by_role requires it.
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('a1000000-0000-0000-0000-0000000000f1','ZZZ Ops Admin','zzz.ops.admin@o.test','superadmin',null,'active',true),
  ('a1000000-0000-0000-0000-0000000000f2','ZZZ Ops Manager','zzz.ops.mgr@o.test','opndoor_manager',null,'active',true),
  ('a1000000-0000-0000-0000-0000000000f3','ZZZ Ops Second','zzz.ops.second@o.test','superadmin',null,'active',true);

insert into public.ops_inboxes (id, name, email) values
  ('a1000000-0000-0000-0000-0000000000b1','ZZZ Ops Desk','zzz.ops.desk@o.test');

/* THIS TEST OWNS EVERY ROUTE IT REASONS ABOUT.
 *
 * The floor assertions below are about THE LAST recipient of a critical
 * alert, so they are only meaningful if the test controls the whole set. It
 * did not: dev is a real database and somebody has since routed
 * deed_claim_failed to a real admin through the Internal notifications
 * screen, which made three recipients where the test assumed two. Turning
 * two off then left one standing, the floor never fired, and five assertions
 * failed -- including the two that exist to prove the floor works.
 *
 * Nothing was wrong with the product. The test was reading a global set and
 * calling it its own. It passed in CI, whose Postgres is thrown away and
 * empty, and would have gone on passing there while being wrong here.
 *
 * Deleted rather than disabled, inside the transaction that rolls back. The
 * floor trigger is deferred and this file never commits, so the delete does
 * not trip it; the assertions that NEED it fire it deliberately with
 * `set constraints all immediate`, and by then the only routes left for
 * these three types are the ones this file made.
 *
 * SCOPED, TWICE OVER, and neither is fussiness.
 *
 * To the types this file manages, because `set constraints all immediate`
 * fires the floor for EVERY critical type at once: deleting every foreign
 * route emptied critical types this test never touches and made those raise
 * instead, which is the floor working correctly on rows that are none of
 * this test's business.
 *
 * And in TWO PLACES rather than one. A critical type must not sit empty
 * across a `set constraints all immediate`, so each type is cleared
 * immediately before this file gives it its own recipients.
 * deed_claim_failed is cleared here because its routing is the next thing
 * that happens; deed_void_failed is cleared further down, beside its own.
 */
delete from public.ops_routes
 where alert_type in ('deed_claim_failed', 'hubspot_map_drift')
   and coalesce(user_id::text, inbox_id::text) not like 'a1000000-%';

-- ===========================================================================
-- THE TYPES, AND THEIR GROUPS
-- ===========================================================================
select ok((select count(*)::int from public.ops_notification_types()) >= 25,
  'every alert kind the platform raises is routable');
select set_eq(
  $$select distinct grp::text from public.ops_notification_types()$$,
  $$values ('Critical'::text), ('Operations'::text), ('Commercial'::text), ('Information'::text)$$,
  'grouped as the instruction names: Critical, Operations, Commercial, Information');

-- ===========================================================================
-- ROUTING
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"a1000000-0000-0000-0000-0000000000f1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.set_ops_route('deed_claim_failed','person','a1000000-0000-0000-0000-0000000000f1', true)$$,
  'an opndoor admin routes a critical alert to a person');
select lives_ok(
  $$select public.set_ops_route('deed_claim_failed','inbox','a1000000-0000-0000-0000-0000000000b1', true)$$,
  'and to a shared inbox as well');

reset role;
select set_eq(
  $$select email::text from public.ops_route_recipients('deed_claim_failed')$$,
  $$values ('zzz.ops.admin@o.test'::text), ('zzz.ops.desk@o.test'::text)$$,
  'and the send path resolves to exactly those two');

-- The counter the floor is built on, by name: it is what decides whether a
-- removal is allowed, and a definer function on the allowlist has to be
-- exercised directly rather than only through the trigger that calls it.
select is(public.ops_route_live_count('deed_claim_failed'), 2,
  'the live count is the recipients who could actually receive it');

-- ===========================================================================
-- THE FLOOR ON A CRITICAL TYPE
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"a1000000-0000-0000-0000-0000000000f1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.set_ops_route('deed_claim_failed','inbox','a1000000-0000-0000-0000-0000000000b1', false);
    set constraints all immediate$$,
  'one of the two can be turned off, because one is left');

-- THE LAST ONE CANNOT. The constraint is deferred, so it is the COMMIT that
-- refuses; `set constraints all immediate` is what makes that visible inside a
-- test that never commits.
select throws_ok(
  $$select public.set_ops_route('deed_claim_failed','person','a1000000-0000-0000-0000-0000000000f1', false);
    set constraints all immediate$$,
  '23514', 'A critical alert cannot be left with nobody to receive it. Add another recipient before removing this one.',
  'and the last recipient of a critical alert cannot be removed, with the reason');

select lives_ok($$set constraints all deferred$$,
  'and the deferred guard is restored for the rest of this file');

-- A NON-CRITICAL TYPE HAS NO FLOOR: "we do not want these" is a legitimate
-- answer for an Information alert and an unwanted alert is how an inbox stops
-- being read.
select lives_ok(
  $$select public.set_ops_route('hubspot_map_drift','person','a1000000-0000-0000-0000-0000000000f1', true);
    select public.set_ops_route('hubspot_map_drift','person','a1000000-0000-0000-0000-0000000000f1', false);
    set constraints all immediate$$,
  'while a non-critical alert can be switched off entirely');
select lives_ok($$set constraints all deferred$$, 'and again');

-- ===========================================================================
-- DEACTIVATION DROPS SOMEBODY OFF EVERY ROUTE
-- ===========================================================================
-- This is the one that matters most: nobody is looking at the routing page
-- when a leaver is processed.
reset role;
-- Cleared here, not at the top: see the note beside the first delete. This
-- type is critical, so it must not be empty when a later assertion fires the
-- deferred floor, and its own recipient is added on the very next line.
delete from public.ops_routes
 where alert_type = 'deed_void_failed'
   and coalesce(user_id::text, inbox_id::text) not like 'a1000000-%';
select public.set_ops_route('deed_void_failed','person','a1000000-0000-0000-0000-0000000000f3', true);
select is(
  (select count(*)::int from public.ops_route_recipients('deed_void_failed')), 1,
  'a critical alert routed to one person resolves to them');

select throws_ok(
  $$update public.users set status = 'deactivated' where id = 'a1000000-0000-0000-0000-0000000000f3';
    set constraints all immediate$$,
  '23514', null,
  'and deactivating that person is refused, because it would leave the alert with nobody');
select lives_ok($$set constraints all deferred$$, 'and the guard is restored');

-- ===========================================================================
-- NOBODY BELOW SUPERADMIN CAN CHANGE IT
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"a1000000-0000-0000-0000-0000000000f2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select throws_ok(
  $$select public.set_ops_route('deed_claim_failed','person','a1000000-0000-0000-0000-0000000000f2', true)$$,
  '42501', 'Only an opndoor admin can change where internal alerts go.',
  'an opndoor_manager cannot change the routing');

-- BUT THEY MAY VIEW IT. "Only superadmin can edit; opndoor_manager can view."
select ok(
  (select count(*)::int from public.ops_routing_matrix()) > 0,
  'though they can read the whole matrix, which is what the instruction gives them');

select * from finish();
rollback;
