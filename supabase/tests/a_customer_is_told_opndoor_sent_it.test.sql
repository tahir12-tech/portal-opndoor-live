/* A CUSTOMER IS TOLD WHICH OF THEIR REFERRALS OPNDOOR SENT.
   Migration: 20261009010000.

   Matt (cq): "Referrals an Opndoor admin made on a customer's behalf still
   show the admin's name ('Nicholas Dwyer') in that customer's referrer
   lists, charts and exports; show 'opndoor (on your behalf)' in every
   customer view."

   WHAT THIS FUNCTION IS FOR, and why it exists at all: the browser cannot
   work it out. users RLS hides opndoor staff from a customer, so the
   embedded referrer row comes back empty and its role is null for exactly
   the rows that need masking, while referrer_name -- a snapshot stored on
   the application -- happily reads "Nicholas Dwyer".

   IT IS SECURITY DEFINER, so the tests that matter are the limits: it
   answers about ids it was GIVEN, it returns ids and nothing else, and it
   refuses to become a lookup service. */
begin;
select plan(8);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  ('ee200000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','zzz.whosent.admin@opndoor.test','',now(),now(),now()),
  ('ee200000-0000-0000-0000-00000000c002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','zzz.whosent.mgr@opndoor.test','',now(),now(),now()),
  ('ee200000-0000-0000-0000-00000000c003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','zzz.whosent.neg@regent.test','',now(),now(),now());

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('ee200000-0000-0000-0000-00000000c001','ZZZ Who Sent Admin','zzz.whosent.admin@opndoor.test',
   'superadmin', null,'active',true),
  ('ee200000-0000-0000-0000-00000000c002','ZZZ Who Sent Manager','zzz.whosent.mgr@opndoor.test',
   'opndoor_manager', null,'active',false),
  ('ee200000-0000-0000-0000-00000000c003','ZZZ Who Sent Negotiator','zzz.whosent.neg@regent.test',
   'referrer', (select id from public.partners where slug='opndoor-agents'),'active',false);

-- ===========================================================================
-- 1. WHO MAY ASK.
-- ===========================================================================
select function_privs_are('public','opndoor_user_ids',array['uuid[]'],
  'anon', array[]::text[],
  'anon may not ask who is opndoor');
select function_privs_are('public','opndoor_user_ids',array['uuid[]'],
  'authenticated', array['EXECUTE'],
  'a signed-in customer may, which is the whole point');

-- ===========================================================================
-- 2. THE ANSWER, AS A CUSTOMER WHO CANNOT SEE THE ROWS BEHIND IT.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ee200000-0000-0000-0000-00000000c003","role":"authenticated","aal":"aal1"}', true);

/* THE PREMISE, asserted rather than assumed: if this ever returns a row the
   masking problem has gone away and so has the reason for this function. */
select is(
  (select count(*)::int from public.users u
    where u.id = 'ee200000-0000-0000-0000-00000000c001'),
  0,
  'a negotiator cannot read the opndoor admin row at all');

select results_eq(
  $$select public.opndoor_user_ids(array[
      'ee200000-0000-0000-0000-00000000c001'::uuid,
      'ee200000-0000-0000-0000-00000000c003'::uuid]) order by 1$$,
  $$values ('ee200000-0000-0000-0000-00000000c001'::uuid)$$,
  'but is told which of the ids they hold is opndoor''s');

/* BOTH OPNDOOR ROLES, because opndoor_manager was added months after
   superadmin and every allowlist written before it went stale at once --
   which is the bug that blanked their Reporting page. */
select results_eq(
  $$select public.opndoor_user_ids(array['ee200000-0000-0000-0000-00000000c002'::uuid])$$,
  $$values ('ee200000-0000-0000-0000-00000000c002'::uuid)$$,
  'and an opndoor manager counts as opndoor too');

select is(
  (select count(*)::int from public.opndoor_user_ids(
     array['ee200000-0000-0000-0000-00000000c003'::uuid])),
  0,
  'their own colleague is not opndoor and is not returned');

-- ===========================================================================
-- 3. AND IT REFUSES TO BE A LOOKUP SERVICE.
-- ===========================================================================
/* AN ID THAT IS NOT A USER ANSWERS NOTHING rather than erroring, so a
   caller learns only about ids that exist AND are opndoor's -- never that
   some other uuid is a real person. */
select is(
  (select count(*)::int from public.opndoor_user_ids(
     array['ee200000-0000-0000-0000-0000000fffff'::uuid])),
  0,
  'an id that is nobody answers nothing');

/* THE SHAPE GUARD. A book has a handful of distinct referrers; an array far
   larger than any real one means this is being used for something it was
   not built for, and it answers nothing rather than enumerating. */
select is(
  (select count(*)::int from public.opndoor_user_ids(
     (select array_agg('ee200000-0000-0000-0000-00000000c001'::uuid)
        from generate_series(1, 501)))),
  0,
  'and an array bigger than any real book answers nothing at all');

select * from finish();
rollback;
