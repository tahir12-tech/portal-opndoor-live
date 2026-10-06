-- WHAT THE SIXTH ROUND FOUND.
--
-- Four findings from the escalation reviewer, all measured on dev before the
-- fix and all reproduced here.
--
-- HIGH 2 is the one that matters. `authenticated` held table-wide UPDATE on
-- public.users, and BOTH gates on that write read the pre-image:
-- users_mgmt_update tests level_rank_of(id), which reads the old row, and
-- users_level_ladder_guard tests may_act_on_user(old.id), explicitly old. So
-- nothing ever looked at the level the row BECAME. Measured, rolled back:
--
--   as Regent's Manager: update public.users set role='developer'
--     where id = <their own Negotiator>   ->   SUCCEEDED
--
-- which is the standing ruling -- no developer on the house partner BY ANY
-- PATH -- broken by the one path nobody had closed.

begin;
select plan(14);

-- ===========================================================================
-- A GROUP, TWO AGENCIES IN IT, AND A LADDER
-- ===========================================================================
insert into public.agency_groups (id, partner_id, name) values
  ('91000000-0000-0000-0000-0000000000c1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Six Group');
insert into public.agencies (id, partner_id, group_id, name) values
  ('91000000-0000-0000-0000-0000000000a1',(select id from public.partners where slug='opndoor-agents'),'91000000-0000-0000-0000-0000000000c1','ZZZ Six Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('91000000-0000-0000-0000-0000000000b1','91000000-0000-0000-0000-0000000000a1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Six Office'),
  ('91000000-0000-0000-0000-0000000000b2','91000000-0000-0000-0000-0000000000a1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Six Annexe');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),now(),now()
from (values
  ('91000000-0000-0000-0000-00000000c001'::uuid,'zzz.six.groupdir@s.test'),
  ('91000000-0000-0000-0000-00000000c002'::uuid,'zzz.six.mgr@s.test'),
  ('91000000-0000-0000-0000-00000000c003'::uuid,'zzz.six.neg@s.test'),
  ('91000000-0000-0000-0000-00000000c004'::uuid,'zzz.six.new@s.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, home_branch_id) values
  ('91000000-0000-0000-0000-00000000c001','ZZZ Six Group Dir','zzz.six.groupdir@s.test','management',(select id from public.partners where slug='opndoor-agents'),'active',true,null),
  ('91000000-0000-0000-0000-00000000c002','ZZZ Six Mgr','zzz.six.mgr@s.test','management',(select id from public.partners where slug='opndoor-agents'),'active',false,null),
  ('91000000-0000-0000-0000-00000000c003','ZZZ Six Neg','zzz.six.neg@s.test','referrer',(select id from public.partners where slug='opndoor-agents'),'active',false,'91000000-0000-0000-0000-0000000000b1');

insert into public.user_scopes (user_id, kind, group_id, agency_id, branch_id) values
  -- The group Director holds the GROUP and nothing else. That is the point:
  -- app_scoped_agencies matches them only via a.group_id = s.group_id.
  ('91000000-0000-0000-0000-00000000c001','group','91000000-0000-0000-0000-0000000000c1',null,null),
  ('91000000-0000-0000-0000-00000000c002','agency',null,'91000000-0000-0000-0000-0000000000a1',null),
  ('91000000-0000-0000-0000-00000000c003','branch',null,null,'91000000-0000-0000-0000-0000000000b1');

-- ===========================================================================
-- HIGH 2. THE LEVEL IS NOT A COLUMN ANYBODY MAY WRITE
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"91000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- THE REPRODUCTION, as measured on dev before the fix.
select throws_ok(
  $$update public.users set role = 'developer' where id = '91000000-0000-0000-0000-00000000c003'$$,
  '42501', null,
  'a Manager cannot PATCH their Negotiator into a developer on the house route');
select throws_ok(
  $$update public.users set sees_commission = true where id = '91000000-0000-0000-0000-00000000c003'$$,
  '42501', null,
  'nor hand them the commission capability');
select throws_ok(
  $$update public.users set status = 'deactivated' where id = '91000000-0000-0000-0000-00000000c003'$$,
  '42501', null,
  'nor deactivate them by writing the column, rather than through the door that asks the ladder');
select throws_ok(
  $$insert into public.users (id, full_name, email, role, partner_id, status)
    values ('91000000-0000-0000-0000-00000000c004','ZZZ Six New','zzz.six.new@s.test','developer',
            (select id from public.partners where slug='opndoor-agents'),'active')$$,
  '42501', null,
  'and cannot seat a developer by inserting one either');

-- A LADDER, NOT A WALL: the columns that carry no authority are still theirs.
select lives_ok(
  $$update public.users set full_name = 'ZZZ Six Neg Renamed' where id = '91000000-0000-0000-0000-00000000c003'$$,
  'while renaming somebody is still an ordinary edit');

-- And the sanctioned door still works, which is what makes this a grant
-- question rather than a lock.
select lives_ok(
  $$select public.set_agency_level('91000000-0000-0000-0000-00000000c003','Manager')$$,
  'and the Manager can still promote their Negotiator through set_agency_level');

-- ===========================================================================
-- HIGH 1. YOU CANNOT WALK YOUR OWN AGENCY OUT OF ITS GROUP
-- ===========================================================================
-- The group Director holds the group and nothing else, so detaching the agency
-- removes it, its branches and its people from their reach -- and
-- app_reachable_group then refuses to let anybody at that agency put it back.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"91000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.set_agency_group('91000000-0000-0000-0000-0000000000a1', null)$$,
  '42501', 'You can only move an agency out of a group you hold.',
  'an agency manager cannot detach their own agency from the group above them');

-- The group's own Director may, because they hold it.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"91000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$select public.set_agency_group('91000000-0000-0000-0000-0000000000a1', null)$$,
  'while the group Director, who holds it, still can');

-- ===========================================================================
-- M3 and M4. create_invited_user IS A DOOR, AND DOORS HAVE THE SAME RULES
-- ===========================================================================
reset role;
update public.agencies set group_id = '91000000-0000-0000-0000-0000000000c1'
 where id = '91000000-0000-0000-0000-0000000000a1';
insert into public.agencies (id, partner_id, name) values
  ('91000000-0000-0000-0000-0000000000a2',(select id from public.partners where slug='opndoor-agents'),'ZZZ Six Elsewhere');
insert into public.branches (id, agency_id, partner_id, name) values
  ('91000000-0000-0000-0000-0000000000b3','91000000-0000-0000-0000-0000000000a2',(select id from public.partners where slug='opndoor-agents'),'ZZZ Six Elsewhere Office');

select set_config('request.jwt.claims',
  '{"sub":"91000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- M3: the level assertion ran only `if p_role in ('management','referrer')`,
-- so any other role skipped the ladder entirely.
select throws_ok(
  $$select public.create_invited_user(
      '91000000-0000-0000-0000-00000000c004','zzz.six.new@s.test','ZZZ Six New','developer',
      (select id from public.partners where slug='opndoor-agents'),
      null, false, 'agency', '91000000-0000-0000-0000-0000000000a1')$$,
  '42501', 'There is no developer on our own estate.',
  'the invite RPC refuses a developer on the house route, as every other door already did');

-- M4: the home branch was never checked here, though set_home_branch checks
-- both ends and users_mgmt_insert was given the same test in 20261006500000.
select throws_ok(
  $$select public.create_invited_user(
      '91000000-0000-0000-0000-00000000c004','zzz.six.new@s.test','ZZZ Six New','referrer',
      (select id from public.partners where slug='opndoor-agents'),
      '91000000-0000-0000-0000-0000000000b3', false, 'branch', '91000000-0000-0000-0000-0000000000b1')$$,
  '42501', 'You can only place somebody at a branch you reach.',
  'and refuses to place an invitee at a branch the inviter does not reach');

-- ===========================================================================
-- THE SEND PATH IS NOT A BROWSER RPC
-- ===========================================================================
-- notification_recipients and notification_enabled answer "who should be
-- told". They contain no authorisation on purpose, because the server asks
-- them on behalf of a cron job. Granted to authenticated they were the only
-- two browser-callable definer functions in the schema with no reach test at
-- all, and a Negotiator read another agency's staff addresses through them.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"91000000-0000-0000-0000-00000000c003","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select * from public.notification_recipients('91000000-0000-0000-0000-00000000e001','deed_issued')$$,
  '42501', null,
  'the browser cannot ask who should be told about an application');
select throws_ok(
  $$select public.notification_enabled('agency', null, '91000000-0000-0000-0000-0000000000a1', 'paid', 'ticked_users')$$,
  '42501', null,
  'nor read another party''s notification settings directly');

-- AND THE SCREEN'S READER STILL WORKS, because inside a definer function the
-- owner's privileges apply. This is the half that makes it a grant question.
reset role;
select ok(has_function_privilege('authenticated', 'public.notification_matrix(uuid, uuid)', 'EXECUTE'),
  'while the matrix the screen draws is still callable, and gates itself');

-- ===========================================================================
-- AND THE LOCK THE SAME ROUND FOUND
-- ===========================================================================
-- dev_sandbox_application_document is the only way a supplier developer
-- reaches the deed their own rehearsal produced, and dev-centre calls it
-- caller-scoped on purpose. Revoked from authenticated, it was a hard 42501
-- for developer and admin alike.
select ok(has_function_privilege('authenticated', 'public.dev_sandbox_application_document(uuid)', 'EXECUTE'),
  'a developer can reach their own sandbox signing link again');

select * from finish();
rollback;
