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
