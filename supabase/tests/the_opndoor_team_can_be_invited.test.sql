-- THE OPNDOOR TEAM CAN BE INVITED, AND A SUPPLIER'S MANAGEMENT CAN INVITE.
--
-- Matt, 2026-10-03: "Blocker: Add opndoor team member with 'opndoor manager'
-- selected fails with 'A portal user is a manager, a referrer or a
-- developer.' The invite path doesn't accept the opndoor manager level. Fix
-- it so both opndoor admin and opndoor manager can be invited."
--
-- THE SENTENCE IS create_invited_user's OWN and it was the only thing
-- refusing: invite-user has had a branch for both opndoor roles since it was
-- written. So the blocker was one allowlist, three roles long, written for a
-- partner's people on a door the opndoor team page also uses.
--
-- AND THE SECOND REFUSAL, found while fixing the first: assert_may_grant_level
-- was asked on every management and referrer invite including a supplier's. It
-- knows the AGENCY ladder only, and level_rank_of is null for a supplier's own
-- people -- so a supplier's Management inviting a colleague was refused with a
-- sentence about a ladder they are not on.

begin;
select plan(11);

insert into public.partners (id, slug, name, referencing_mode, is_house_route, partner_kind)
values ('9f000000-0000-0000-0000-0000000000a1','zzz-inv-sup','ZZZ Invite Supplier',
        'pre_referenced_open', false, 'supplier');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('9f000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.inv.admin@o.test','',now(),now(),now()),
       ('9f000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.inv.supmgmt@s.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('9f000000-0000-0000-0000-0000000000d1','ZZZ Invite Admin','zzz.inv.admin@o.test',
        'superadmin', null, 'active', true),
       ('9f000000-0000-0000-0000-0000000000d2','ZZZ Supplier Management','zzz.inv.supmgmt@s.test',
        'management','9f000000-0000-0000-0000-0000000000a1','active', true);

/* THE AUTH ROWS FOR THE PEOPLE BEING INVITED. `public.users.id` references
   `auth.users.id`, and invite-user mints the auth account BEFORE calling
   create_invited_user -- so a test that calls the function directly has to
   stand in for that half, or every insert dies on the foreign key rather than
   on the rule under test. */
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       email, '', now(), now(), now()
from (values
  ('9f000000-0000-0000-0000-00000000e001'::uuid, 'zzz.new.mgr@o.test'),
  ('9f000000-0000-0000-0000-00000000e002'::uuid, 'zzz.new.admin@o.test'),
  ('9f000000-0000-0000-0000-00000000e003'::uuid, 'zzz.bad1@o.test'),
  ('9f000000-0000-0000-0000-00000000e004'::uuid, 'zzz.bad2@o.test'),
  ('9f000000-0000-0000-0000-00000000e005'::uuid, 'zzz.bad3@o.test'),
  ('9f000000-0000-0000-0000-00000000e006'::uuid, 'zzz.sup.colleague@s.test'),
  ('9f000000-0000-0000-0000-00000000e007'::uuid, 'zzz.climb@s.test')
) as v(id, email);

-- ===========================================================================
-- AS OPNDOOR ADMIN: both opndoor seats can now be created
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"9f000000-0000-0000-0000-0000000000d1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.create_invited_user(
      '9f000000-0000-0000-0000-00000000e001'::uuid, 'zzz.new.mgr@o.test', 'ZZZ New Manager',
      'opndoor_manager', null, null, false, null, null)$$,
  'an opndoor manager can be invited, which was the blocker');

select is(
  (select role from public.users where id = '9f000000-0000-0000-0000-00000000e001'),
  'opndoor_manager', 'and lands with that role');

select is(
  (select partner_id from public.users where id = '9f000000-0000-0000-0000-00000000e001'),
  null, 'and belongs to no supplier or agency');

select is(
  (select count(*)::int from public.user_scopes where user_id = '9f000000-0000-0000-0000-00000000e001'),
  0, 'and holds no position, because opndoor sits above the estate');

select lives_ok(
  $$select public.create_invited_user(
      '9f000000-0000-0000-0000-00000000e002'::uuid, 'zzz.new.admin@o.test', 'ZZZ New Admin',
      'superadmin', null, null, true, null, null)$$,
  'and an opndoor admin can be invited too');

-- ===========================================================================
-- THE THREE REFUSALS THAT KEEP THOSE SEATS OPNDOOR'S
-- ===========================================================================
select throws_ok(
  $$select public.create_invited_user(
      '9f000000-0000-0000-0000-00000000e003'::uuid, 'zzz.bad1@o.test', 'ZZZ Bad',
      'opndoor_manager', '9f000000-0000-0000-0000-0000000000a1'::uuid, null, false, null, null)$$,
  '22023',
  'An opndoor admin or manager belongs to no supplier or agency.',
  'an opndoor seat with a partner is refused by its own sentence');

select throws_ok(
  $$select public.create_invited_user(
      '9f000000-0000-0000-0000-00000000e004'::uuid, 'zzz.bad2@o.test', 'ZZZ Bad',
      'opndoor_manager', null, null, false, 'agency', '9f000000-0000-0000-0000-0000000000a1'::uuid)$$,
  '22023',
  'An opndoor admin or manager holds no position at an agency.',
  'and one with a position is refused too');

select throws_ok(
  $$select public.create_invited_user(
      '9f000000-0000-0000-0000-00000000e005'::uuid, 'zzz.bad3@o.test', 'ZZZ Bad',
      'tenant', null, null, false, null, null)$$,
  '22023',
  'A portal user is a manager, a referrer, a developer, an opndoor admin or an opndoor manager.',
  'and a role nobody has heard of is still refused, with the five named');

-- ===========================================================================
-- AS A SUPPLIER'S OWN MANAGEMENT: the agency ladder no longer applies
--
-- Before this migration `assert_may_grant_level` ran here and
-- `level_rank_of` is null for a supplier's people, so this was refused with
-- "You can only give someone a level at or below your own".
-- ===========================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"9f000000-0000-0000-0000-0000000000d2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.create_invited_user(
      '9f000000-0000-0000-0000-00000000e006'::uuid, 'zzz.sup.colleague@s.test', 'ZZZ Colleague',
      'management', '9f000000-0000-0000-0000-0000000000a1'::uuid, null, true, null, null)$$,
  'a supplier''s Management can invite a colleague, which the agency ladder refused');

-- AND THE COLLEAGUE SEES COMMISSION, which is the other half of the same
-- report: supplier Management is the top of its rail.
select is(
  (select sees_commission from public.users where id = '9f000000-0000-0000-0000-00000000e006'),
  true, 'and that colleague sees their own company''s commission');

-- AND A SUPPLIER STILL CANNOT MAKE AN OPNDOOR SEAT.
/* REFUSED, AND BY THE OLDER GUARD. The permission test at the top of the
   function asks `is_admin() or (management and p_partner = app_partner())`,
   and an opndoor seat carries no partner -- so `p_partner = app_partner()` is
   false and this is already 'not permitted' before the new check is reached.
   Asserted on the CODE rather than the sentence: which of the two refuses is
   an implementation detail, that it is refused is the rule, and the new
   check is the one that holds if the older ever widens. */
select throws_ok(
  $$select public.create_invited_user(
      '9f000000-0000-0000-0000-00000000e007'::uuid, 'zzz.climb@s.test', 'ZZZ Climb',
      'superadmin', null, null, true, null, null)$$,
  '42501',
  NULL,
  'while a supplier asking for an opndoor admin is refused');

reset role;
select * from finish();
rollback;
