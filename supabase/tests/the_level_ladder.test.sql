-- THE LEVEL LADDER: you may act only on someone BELOW you.
--
-- RULING. A caller may change the position, level or status of a person strictly
-- below their own level and of nobody else. A Manager may act on Negotiators, not
-- on a Manager and not on a Director. A Director may act on Managers and
-- Negotiators, not on another Director. Yourself is somebody at your own level, so
-- that is refused too. Opndoor staff sit above all three.
--
-- THE TWO RULES ARE DIFFERENT, and half of these assertions exist to hold them
-- apart:
--
--   the PERSON you act on must be strictly BELOW you
--   the LEVEL you hand out may be AT OR BELOW yours
--
-- So a Manager may make a Negotiator into a peer Manager, and may not then touch
-- them again. A Director may make a Director. Neither may act on an equal.
--
-- WHAT WAS ACTUALLY BROKEN, measured on dev before any of this was written, by
-- impersonating a Manager against a Director in the same agency:
--
--   update public.users set status = 'deactivated' where id = <the Director>;  APPLIED
--   update public.users set role   = 'referrer'    where id = <the Director>;  APPLIED
--
-- A Manager could lock her own Director out of the portal and demote her to
-- Negotiator, through PostgREST, touching none of the RPCs. Only sees_commission
-- was guarded. That is why assertions 17-22 below go at the TABLE and not at a
-- function: guarding the RPCs alone would have left the real door open, and every
-- RPC assertion here would have passed while the product was still broken.

begin;
select plan(38);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route)
values ('95000000-0000-0000-0000-000000000001', 'zzz-ladder', 'ZZZ Ladder Route', 'opndoor_referenced', 0.25, 0.10, true);
insert into public.agencies (id, partner_id, name) values
  ('95000000-0000-0000-0000-00000000000a', '95000000-0000-0000-0000-000000000001', 'ZZZ Ladder Lettings'),
  ('95000000-0000-0000-0000-00000000000c', '95000000-0000-0000-0000-000000000001', 'ZZZ Other Lettings');
insert into public.branches (id, agency_id, partner_id, name) values
  ('95000000-0000-0000-0000-00000000000b', '95000000-0000-0000-0000-00000000000a',
   '95000000-0000-0000-0000-000000000001', 'ZZZ Ladder Park'),
  ('95000000-0000-0000-0000-00000000000e', '95000000-0000-0000-0000-00000000000c',
   '95000000-0000-0000-0000-000000000001', 'ZZZ Other Park');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', em, '', now(), now(), now()
from (values
  ('95000000-0000-0000-0000-0000000000d1'::uuid, 'mgr@zzzladder.test'),
  ('95000000-0000-0000-0000-0000000000d2'::uuid, 'dir@zzzladder.test'),
  ('95000000-0000-0000-0000-0000000000d3'::uuid, 'neg@zzzladder.test'),
  ('95000000-0000-0000-0000-0000000000d4'::uuid, 'dir2@zzzladder.test'),
  ('95000000-0000-0000-0000-0000000000d5'::uuid, 'mgr2@zzzladder.test'),
  ('95000000-0000-0000-0000-0000000000d6'::uuid, 'dev@zzzladder.test'),
  ('95000000-0000-0000-0000-0000000000d7'::uuid, 'adm@zzzladder.test'),
  ('95000000-0000-0000-0000-0000000000d8'::uuid, 'opm@zzzladder.test'),
  ('95000000-0000-0000-0000-0000000000d9'::uuid, 'pend@zzzladder.test'),
  ('95000000-0000-0000-0000-0000000000da'::uuid, 'neg2@zzzladder.test')
) v(id, em);

/* A POSITION ON EVERY AGENCY PERSON, NEGOTIATORS INCLUDED.

   This block used to say the opposite, and said it at length: the Negotiators
   were deliberately left unpositioned and located by home_branch_id, "which is
   the whole point of the unpositioned-negotiator resolution".

   That resolution is gone. home_branch_id is a column its own subject could
   PATCH, and app_scoped_agencies unioned in the agency above it, so a manager
   could move their own boundary to a competitor's agency: reproduced on dev at
   7 applications and 1 agency before, 21 and 2 after. 20261006300000 made a
   position mandatory on our estate and backfilled the six real negotiators from
   exactly this column; 20261006310000 then took the column out of every
   predicate that read it.

   So the fixture models what the estate now looks like. The home branches stay,
   because a Negotiator still sits somewhere and the column is still shown; they
   are simply no longer what locates them. Containment still never explains a
   refusal below, which is what keeps these assertions about the ladder. */
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, home_branch_id) values
  ('95000000-0000-0000-0000-0000000000d1', 'Mo Manager',   'mgr@zzzladder.test',  'management', '95000000-0000-0000-0000-000000000001', 'active', false, '95000000-0000-0000-0000-00000000000b'),
  ('95000000-0000-0000-0000-0000000000d2', 'Dee Director', 'dir@zzzladder.test',  'management', '95000000-0000-0000-0000-000000000001', 'active', true,  '95000000-0000-0000-0000-00000000000b'),
  ('95000000-0000-0000-0000-0000000000d3', 'Ned Negotiator','neg@zzzladder.test', 'referrer',   '95000000-0000-0000-0000-000000000001', 'active', false, '95000000-0000-0000-0000-00000000000b'),
  ('95000000-0000-0000-0000-0000000000d4', 'Des Director', 'dir2@zzzladder.test', 'management', '95000000-0000-0000-0000-000000000001', 'active', true,  '95000000-0000-0000-0000-00000000000b'),
  ('95000000-0000-0000-0000-0000000000d5', 'May Manager',  'mgr2@zzzladder.test', 'management', '95000000-0000-0000-0000-000000000001', 'active', false, '95000000-0000-0000-0000-00000000000b'),
  ('95000000-0000-0000-0000-0000000000d6', 'Dev Eloper',   'dev@zzzladder.test',  'developer',  '95000000-0000-0000-0000-000000000001', 'active', false, '95000000-0000-0000-0000-00000000000b'),
  ('95000000-0000-0000-0000-0000000000d7', 'Ada Admin',    'adm@zzzladder.test',  'superadmin', null, 'active', true,  null),
  ('95000000-0000-0000-0000-0000000000d8', 'Ops Manager',  'opm@zzzladder.test',  'opndoor_manager', null, 'active', false, null),
  ('95000000-0000-0000-0000-0000000000d9', 'Pen Ding',     'pend@zzzladder.test', 'referrer',   '95000000-0000-0000-0000-000000000001', 'pending', false, '95000000-0000-0000-0000-00000000000b'),
  /* A SECOND NEGOTIATOR, LEFT ALONE. Ned is promoted to a peer Manager partway
     through, which is the point of that assertion, so anything needing a pristine
     Negotiator afterwards must not reuse him. Reusing him is exactly how this file
     first went green on two assertions that were measuring a mutated fixture. */
  ('95000000-0000-0000-0000-0000000000da', 'Nia Negotiator','neg2@zzzladder.test','referrer',  '95000000-0000-0000-0000-000000000001', 'active', false, '95000000-0000-0000-0000-00000000000b');

-- Everyone agency-side holds the same agency position, so containment never
-- explains a refusal below: only the ladder can. The Negotiators and the
-- developer are in this list now too -- their LEVEL still comes from role and
-- sees_commission, not from the kind of position they hold, which is what the
-- rank assertions immediately below are there to keep true.
insert into public.user_scopes (user_id, kind, agency_id)
select id, 'agency', '95000000-0000-0000-0000-00000000000a'
  from (values ('95000000-0000-0000-0000-0000000000d1'::uuid),
               ('95000000-0000-0000-0000-0000000000d2'::uuid),
               ('95000000-0000-0000-0000-0000000000d3'::uuid),
               ('95000000-0000-0000-0000-0000000000d4'::uuid),
               ('95000000-0000-0000-0000-0000000000d5'::uuid),
               ('95000000-0000-0000-0000-0000000000d6'::uuid),
               ('95000000-0000-0000-0000-0000000000d9'::uuid),
               ('95000000-0000-0000-0000-0000000000da'::uuid)) v(id);

-- ===========================================================================
-- THE RESOLVER. One place resolves a level, so this is where it is checked.
-- ===========================================================================
select is(public.level_rank_of('95000000-0000-0000-0000-0000000000d2'), 1, 'a Director ranks 1');
select is(public.level_rank_of('95000000-0000-0000-0000-0000000000d1'), 2, 'a Manager ranks 2');
select is(public.level_rank_of('95000000-0000-0000-0000-0000000000d3'), 3, 'a Negotiator ranks 3');
select is(public.level_rank_of('95000000-0000-0000-0000-0000000000d7'), 0, 'a superadmin ranks 0, above all three');
select is(public.level_rank_of('95000000-0000-0000-0000-0000000000d8'), 0, 'and so does an opndoor_manager');
select is(public.level_rank_of('95000000-0000-0000-0000-0000000000d6'), 3,
  'a developer ranks beside a Negotiator, so their own agency can still deactivate them');
select is(public.level_rank_of('00000000-0000-0000-0000-0000000000ff'), null, 'nobody ranks nothing');

-- A developer HAS a rank and is NOT an agency level. The two questions are
-- separate and this is the row that proves it, because conflating them would let
-- a level-change control name a developer.
select is(public.agency_level_of('95000000-0000-0000-0000-0000000000d6'), null,
  'a developer has no agency level, though they have a rank');
select is(public.agency_level_of('95000000-0000-0000-0000-0000000000d7'), null,
  'nor does opndoor staff');

/* THE ROW-WISE TWIN AGREES WITH THE SESSION PREDICATE. level_rank_of's 0 arm
   duplicates is_opndoor_staff()'s role list because is_opndoor_staff() can only ask
   about auth.uid(). Driven off the table rather than written out, so a staff-ish
   role added later fails here instead of silently ranking null and becoming
   actionable by a Director. */
select is(
  (select count(*) from public.users u
    where (public.level_rank_of(u.id) = 0) <> (u.role in ('superadmin','opndoor_manager'))),
  0::bigint,
  'rank 0 means opndoor staff and opndoor staff means rank 0, for every row in the table');

-- ===========================================================================
-- AS A MANAGER. The case Matt reported: Rosa's row shows Nadia no actions.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"95000000-0000-0000-0000-0000000000d1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ---- set_agency_level, named in the ask ----
select throws_ok(
  $$select public.set_agency_level('95000000-0000-0000-0000-0000000000d2', 'Negotiator')$$,
  '42501', 'You can only do this to someone below your own level.',
  'a Manager cannot re-level the Director ABOVE her');

select throws_ok(
  $$select public.set_agency_level('95000000-0000-0000-0000-0000000000d5', 'Negotiator')$$,
  '42501', 'You can only do this to someone below your own level.',
  'nor a Manager AT her own level');

select throws_ok(
  $$select public.set_agency_level('95000000-0000-0000-0000-0000000000d1', 'Director')$$,
  '42501', 'You cannot do this to your own account.',
  'nor herself, which is the promotion this whole ladder exists to stop');

/* THE HOLE THE PERSON CHECK DOES NOT CLOSE. Ned IS below her, so
   assert_may_act_on_user is satisfied; Director is above her, so the level must be
   refused separately. Without assert_may_grant_level a Manager mints a Director. */
select throws_ok(
  $$select public.set_agency_level('95000000-0000-0000-0000-0000000000d3', 'Director')$$,
  '42501', 'You can only give someone a level at or below your own.',
  'and cannot promote someone below her to a level above her');

-- AT OR BELOW, so a peer is allowed. She gives away her seniority over them by
-- doing it, which is correct and is asserted two lines down.
select lives_ok(
  $$select public.set_agency_level('95000000-0000-0000-0000-0000000000d3', 'Manager')$$,
  'but she may make a Negotiator a peer Manager, which is at her own level');

select throws_ok(
  $$select public.set_agency_level('95000000-0000-0000-0000-0000000000d3', 'Negotiator')$$,
  '42501', 'You can only do this to someone below your own level.',
  'and having done so she can no longer act on them, because they are her equal now');

-- ---- set_user_scope, also named in the ask, and completely untested before ----
select throws_ok(
  $$select public.set_user_scope('95000000-0000-0000-0000-0000000000d2', 'branch', '95000000-0000-0000-0000-00000000000b')$$,
  '42501', 'You can only do this to someone below your own level.',
  'a Manager cannot position the Director above her');

select throws_ok(
  $$select public.set_user_scope('95000000-0000-0000-0000-0000000000d5', 'agency', '95000000-0000-0000-0000-00000000000a')$$,
  '42501', 'You can only do this to someone below your own level.',
  'nor a Manager at her own level');

select throws_ok(
  $$select public.set_user_scope('95000000-0000-0000-0000-0000000000d1', 'agency', '95000000-0000-0000-0000-00000000000a')$$,
  '42501', 'You cannot do this to your own account.',
  'nor grant herself a position, which she could do until now');

-- ---- and the other four controls, one line each ----
select throws_ok(
  $$select public.admin_set_user_status('95000000-0000-0000-0000-0000000000d2', 'deactivated')$$,
  '42501', 'You can only do this to someone below your own level.',
  'a Manager cannot remove her Director''s access');

select throws_ok(
  $$select public.admin_reset_user_mfa('95000000-0000-0000-0000-0000000000d2')$$,
  '42501', 'You can only do this to someone below your own level.',
  'nor reset her Director''s two-factor');

select throws_ok(
  $$select public.authorise_password_reset('95000000-0000-0000-0000-0000000000d2')$$,
  '42501', 'You can only do this to someone below your own level.',
  'nor send her Director a password reset');

select throws_ok(
  $$select public.admin_update_user_role('95000000-0000-0000-0000-0000000000d2', 'referrer')$$,
  '42501', 'You can only do this to someone below your own level.',
  'nor demote her Director by role');

-- The narrow exemption, which an existing test already depends on.
select lives_ok(
  $$select public.admin_update_user_name('95000000-0000-0000-0000-0000000000d1', 'Mo Manager Jr')$$,
  'but she may still fix her own name, which is not an act of authority over anyone');

-- ===========================================================================
-- THE DOOR THAT IS NOT AN RPC. Where "in SQL, not the UI" is actually won.
-- Each of these APPLIED before the guard existed.
-- ===========================================================================
/* REFUSED EARLIER THAN IT USED TO BE, and these two assertions changed shape
   because of it. 20261006170000 scoped users_mgmt_update to the caller's own
   agency AND to a level at or below their own, so her Director's row is no
   longer VISIBLE to her UPDATE: it matches nothing and never reaches the
   trigger that used to raise. A write that matches nothing is a better answer
   than a write that raises, and the assertion has to say which it is rather
   than expecting the old sentence. The trigger is still proved below, on the
   equal the policy does admit. */
/* AND THEN REFUSED EARLIER AGAIN. 20261006550000 took UPDATE on role,
   sees_commission and status away from authenticated altogether: nothing in
   the product writes those columns, every change goes through an RPC, and
   leaving the grant meant a Manager could PATCH a Negotiator to 'developer'
   because both gates on that write read the PRE-image and never looked at the
   level the row became.

   So these three now ask the ladder through the doors the product actually
   uses. That is the stronger test: it is the path a real Manager takes, and it
   reaches assert_may_act_on_user rather than the trigger that was only ever
   defending the direct write. */
select throws_ok(
  $$select public.admin_set_user_status('95000000-0000-0000-0000-0000000000d2','deactivated')$$,
  '42501', null,
  'a Manager cannot deactivate her Director');

select throws_ok(
  $$select public.set_agency_level('95000000-0000-0000-0000-0000000000d2','Negotiator')$$,
  '42501', null,
  'nor demote her, which is the escalation that was open');

select throws_ok(
  $$select public.admin_set_user_status('95000000-0000-0000-0000-0000000000d5','deactivated')$$,
  '42501', null,
  'nor deactivate an equal');

-- ...and the Director is untouched by either, which is what those two assertions
-- are actually for. Read as the test rather than as her: users_select would let
-- her see the row, but the point here is the stored value, not her view of it.
reset role;
select is((select status || '/' || role from public.users where id = '95000000-0000-0000-0000-0000000000d2'),
  'active/management',
  'her Director is still active and still a Director after both attempts');
set local role authenticated;

-- A LADDER, NOT A WALL. The trigger must leave the legitimate write alone, and must
-- not fire on a column it does not govern.
select lives_ok(
  $$select public.admin_set_user_status('95000000-0000-0000-0000-0000000000da','deactivated')$$,
  'but she may deactivate a Negotiator, who is below her');

select lives_ok(
  $$update public.users set full_name = 'Mo M' where id = '95000000-0000-0000-0000-0000000000d1'$$,
  'and a name change does not touch the trigger at all');

-- ===========================================================================
-- AS A DIRECTOR. Downward works; sideways does not.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"95000000-0000-0000-0000-0000000000d2","role":"authenticated","aal":"aal2"}', true);

select throws_ok(
  $$select public.set_agency_level('95000000-0000-0000-0000-0000000000d4', 'Manager')$$,
  '42501', 'You can only do this to someone below your own level.',
  'a Director cannot re-level another Director');

/* SUPERSEDES 20261005210000, which made this admin-only "deliberately". A Director
   may now hand out the commission bit, because Director IS the commission bit. It
   passes users_commission_capability_is_admin_only because this RPC is SECURITY
   DEFINER owned by postgres, so that trigger takes its privileged-role escape; the
   trigger still refuses a direct write from any signed-in caller. */
select lives_ok(
  $$select public.set_agency_level('95000000-0000-0000-0000-0000000000d1', 'Director')$$,
  'but a Director may make a Manager a Director, which opndoor alone used to do');

select is(
  (select sees_commission from public.users where id = '95000000-0000-0000-0000-0000000000d1'),
  true, 'and the commission bit moved with the level, not separately');

select is(
  (select old_value || ' -> ' || new_value from public.user_audit
    where target_user = '95000000-0000-0000-0000-0000000000d1' and action = 'agency level changed'
    order by at desc limit 1),
  'Manager -> Director', 'audited, with the levels named as the product names them');

-- ===========================================================================
-- OPNDOOR IS ABOVE ALL THREE, and the existing guards still bind them.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"95000000-0000-0000-0000-0000000000d7","role":"authenticated","aal":"aal2"}', true);

select lives_ok(
  $$select public.set_agency_level('95000000-0000-0000-0000-0000000000d4', 'Negotiator')$$,
  'an admin may re-level a Director, because the ladder does not judge opndoor');

select throws_ok(
  $$select public.set_agency_level('95000000-0000-0000-0000-0000000000d8', 'Negotiator')$$,
  '22023', 'That person is not agency staff, so they have no agency level.',
  'and still cannot give opndoor staff an agency level');

-- ===========================================================================
-- MAKE MANAGER WAS DEAD. 20261006089000 fixed an audit insert naming two columns
-- user_audit has never had, which raised 42703 and rolled the role change back on
-- every call. This is the assertion that would have caught it two migrations ago.
-- ===========================================================================
select lives_ok(
  $$select public.admin_update_user_role('95000000-0000-0000-0000-0000000000da', 'management')$$,
  'an admin can change a role at all, which raised 42703 until now');

select is(
  (select new_value from public.user_audit
    where target_user = '95000000-0000-0000-0000-0000000000da' and action = 'role'
    order by at desc limit 1),
  'management', 'and the role change is audited, which it never once was');

select * from finish();
rollback;
