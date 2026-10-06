-- AN OPNDOOR ADMIN HAS NO OFFICE AND NO POSITION.
--
-- Walk fix 5, the server half. Matt: "Opndoor admins see everything by their
-- role and must never be given an office or position. Remove this dialog for
-- Opndoor team members, and make sure a position can never narrow what an
-- Opndoor admin sees, even if one was set."
--
-- TWO DIFFERENT CLAIMS, and they need two different kinds of assertion.
--
--   "must never be GIVEN one"   -> set_user_scope and set_home_branch refuse
--                                  an Opndoor-staff target. This is new.
--   "can never NARROW what they  -> measured. A position is written directly
--    see, even if one was set"     onto an admin, behind the RPCs, and what
--                                  they can read is counted before and after.
--
-- The second one already held before this migration, by the ordering of the
-- read policies: every admin arm is OR-ed ahead of the scope test. It is
-- asserted anyway, and deliberately measured rather than argued, because it
-- holds as a consequence of how a dozen policies happen to be written and
-- nothing until now said it had to.
--
-- AND THE ROWS ARE WRITTEN DIRECTLY, not through set_user_scope, precisely
-- because set_user_scope now refuses. Going through the front door would
-- assert the new refusal a second time and would never reach the question.

begin;
select plan(7);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       x.email,'',now(),now(),now()
from (values
  ('e4000000-0000-0000-0000-00000000d001'::uuid,'zzz.oa.admin@opndoor.test'),
  ('e4000000-0000-0000-0000-00000000d002'::uuid,'zzz.oa.other@opndoor.test'),
  ('e4000000-0000-0000-0000-00000000d003'::uuid,'zzz.oa.mgr@opndoor.test')
) as x(id,email);
-- partner_id NULL: users_partner_by_role requires it of opndoor staff, who
-- sit on no rail.
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('e4000000-0000-0000-0000-00000000d001','OA Admin','zzz.oa.admin@opndoor.test','superadmin',null,'active',true),
  ('e4000000-0000-0000-0000-00000000d002','OA Other','zzz.oa.other@opndoor.test','superadmin',null,'active',true),
  ('e4000000-0000-0000-0000-00000000d003','OA Ops','zzz.oa.mgr@opndoor.test','opndoor_manager',null,'active',false);

insert into public.agencies (id, partner_id, name) values
  ('e4000000-0000-0000-0000-0000000000a1',
   (select id from public.partners where slug='opndoor-agents'),'ZZZ OA Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('e4000000-0000-0000-0000-0000000000b1','e4000000-0000-0000-0000-0000000000a1',
   (select id from public.partners where slug='opndoor-agents'),'ZZZ OA Office');

-- ===========================================================================
-- 1-4. MUST NEVER BE GIVEN ONE. An admin acting on another admin, and on an
-- opndoor manager, and on themselves.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"e4000000-0000-0000-0000-00000000d001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select throws_ok(
  $$select public.set_user_scope('e4000000-0000-0000-0000-00000000d002','branch',
      'e4000000-0000-0000-0000-0000000000b1')$$,
  '42501',
  'Opndoor staff see everything by their role, so they are never given an office or a position.',
  'an admin cannot give another admin a position');

select throws_ok(
  $$select public.set_user_scope('e4000000-0000-0000-0000-00000000d003','agency',
      'e4000000-0000-0000-0000-0000000000a1')$$,
  '42501',
  'Opndoor staff see everything by their role, so they are never given an office or a position.',
  'nor an opndoor manager one');

/* THE ONE THE WALK ACTUALLY FOUND: the dialog opened on your own row. */
select throws_ok(
  $$select public.set_user_scope('e4000000-0000-0000-0000-00000000d001','branch',
      'e4000000-0000-0000-0000-0000000000b1')$$,
  '42501',
  'Opndoor staff see everything by their role, so they are never given an office or a position.',
  'nor themselves');

select throws_ok(
  $$select public.set_home_branch('e4000000-0000-0000-0000-00000000d002',
      'e4000000-0000-0000-0000-0000000000b1')$$,
  '42501',
  'Opndoor staff see everything by their role, so they are never given an office or a position.',
  'and an admin cannot be placed at an office either');

-- ===========================================================================
-- 5. AND THE RULE IS ABOUT THE TARGET, NOT THE CALLER. An admin placing an
-- ordinary person still works, or this would have closed the screen instead
-- of the hole.
-- ===========================================================================
reset role;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('e4000000-0000-0000-0000-00000000d004','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.oa.neg@r.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('e4000000-0000-0000-0000-00000000d004','OA Negotiator','zzz.oa.neg@r.test','referrer',
   (select id from public.partners where slug='opndoor-agents'),'active',false);
insert into public.user_scopes (user_id, kind, branch_id) values
  ('e4000000-0000-0000-0000-00000000d004','branch','e4000000-0000-0000-0000-0000000000b1');

select set_config('request.jwt.claims',
  '{"sub":"e4000000-0000-0000-0000-00000000d001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.set_user_scope('e4000000-0000-0000-0000-00000000d004','agency',
      'e4000000-0000-0000-0000-0000000000a1')$$,
  'while an ordinary person can still be positioned, which is the point of the screen');

-- ===========================================================================
-- 6-7. AND A POSITION CANNOT NARROW AN ADMIN, EVEN IF ONE WAS SET.
--
-- Written straight into user_scopes, behind the RPC that now refuses, because
-- the question is what the READ path does with a row that exists.
-- ===========================================================================
reset role;
/* `on conflict do nothing` so this file reports its refusals as FAILURES
   rather than erroring out before it reaches them. Against a database where
   set_user_scope has not yet learned to refuse, assertion 3 above succeeds
   and leaves exactly this row; the run should then say "3 not ok", not
   "duplicate key". */
insert into public.user_scopes (user_id, kind, branch_id) values
  ('e4000000-0000-0000-0000-00000000d001','branch','e4000000-0000-0000-0000-0000000000b1')
on conflict do nothing;

/* THE READ IS COMPARED AGAINST WHAT AN ADMIN WITH NO POSITION SEES, in the
   same transaction over the same rows, rather than against a fixed number
   that would go stale the first time anybody added a seed row. The
   unpositioned reading is taken first, as the other admin. */
select set_config('request.jwt.claims',
  '{"sub":"e4000000-0000-0000-0000-00000000d002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
create temporary table unpositioned as
  select (select count(*) from public.applications) apps,
         (select count(*) from public.branches)     branches,
         (select count(*) from public.agencies)     agencies,
         (select count(*) from public.users)        users;
reset role;
grant select on unpositioned to public;

select set_config('request.jwt.claims',
  '{"sub":"e4000000-0000-0000-0000-00000000d001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

/* FOUR TABLES AT ONCE, so a narrowing anywhere shows up as a difference
   rather than as a number somebody has to recognise. */
select is(
  (select count(*) from public.applications)::text || '/'
    || (select count(*) from public.branches)::text || '/'
    || (select count(*) from public.agencies)::text || '/'
    || (select count(*) from public.users)::text,
  (select apps::text || '/' || branches::text || '/' || agencies::text || '/' || users::text
     from unpositioned),
  'an admin holding a branch position reads exactly what an admin with none reads');

/* AND THE SCOPE FUNCTION DOES REPORT THE POSITION. Without this the
   assertion above would pass for the wrong reason: not "the admin arm wins"
   but "there was no position to narrow by". */
select isnt_empty(
  $$select public.app_scope_branches()$$,
  'while app_scope_branches does report it, so the reads win on the admin arm and not on an empty scope');

reset role;
select * from finish();
rollback;
