-- A TWO-FACTOR RESET TELLS THE PERSON IT HAPPENED.
--
-- Matt, 2026-10-01: 'Two-factor reset email: add "Delete the old opndoor
-- entry from your authenticator app before scanning the new code."'
--
-- Migration: 20261007290000_a_reset_tells_the_person.sql
--
-- THERE WAS NO SUCH EMAIL. admin_reset_user_mfa destroys every factor and
-- every session and writes an audit row; the four screens that call it sent
-- nothing. `authorise_mfa_reset_notice` is the SQL half of fixing that: the
-- same judgement, asked again, so the edge function learns the address
-- WITHOUT the browser nominating one. An endpoint that emails whoever it is
-- handed is a spam relay with opndoor.co on it.

begin;
select plan(8);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route)
values ('ad000000-0000-0000-0000-00000000000b','zzz-notice','ZZZ Notice Partner','pre_referenced_open',0.25,0.1,false);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),now(),now()
from (values
  ('ad000000-0000-0000-0000-0000000000ad'::uuid,'zzz.notice.admin@o.test'),
  ('ad000000-0000-0000-0000-00000000000a'::uuid,'zzz.notice.victim@s.test'),
  ('ad000000-0000-0000-0000-0000000000bb'::uuid,'zzz.notice.peer@s.test')
) as x(id,email);
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('ad000000-0000-0000-0000-0000000000ad','ZZZ Notice Admin','zzz.notice.admin@o.test','superadmin',null,'active',true),
  ('ad000000-0000-0000-0000-00000000000a','ZZZ Notice Victim','zzz.notice.victim@s.test','referrer',
   'ad000000-0000-0000-0000-00000000000b','active',false),
  ('ad000000-0000-0000-0000-0000000000bb','ZZZ Notice Peer','zzz.notice.peer@s.test','referrer',
   'ad000000-0000-0000-0000-00000000000b','active',false);

-- ===========================================================================
-- 1. AN ADMIN LEARNS THE ADDRESS
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"ad000000-0000-0000-0000-0000000000ad","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is(
  (select public.authorise_mfa_reset_notice('ad000000-0000-0000-0000-00000000000a')),
  'zzz.notice.victim@s.test',
  'an admin is told where to send the notice');

/* AND NOTHING IS WRITTEN. The reset itself is already audited by
   admin_reset_user_mfa; a row here would make one action look like two,
   and this function is asked once per reset. */
select is(
  (select count(*)::int from public.user_audit
    where target_user = 'ad000000-0000-0000-0000-00000000000a'),
  0, 'and nothing is recorded, because the reset already was');

select throws_ok(
  $$select public.authorise_mfa_reset_notice('ad000000-0000-0000-0000-0000000000ff')$$,
  '22023', null, 'a user who does not exist is refused');

-- ===========================================================================
-- 2. AND NOBODY WHO COULD NOT HAVE DONE THE RESET
-- ===========================================================================
/* THE WHOLE POINT OF THE FUNCTION. If this admitted a peer, the edge
   function would hand somebody else's email address to anybody who asked,
   and the spam relay would be worse than the leak. */
select set_config('request.jwt.claims',
  '{"sub":"ad000000-0000-0000-0000-0000000000bb","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select public.authorise_mfa_reset_notice('ad000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'a peer at the same supplier may not learn their address');

select throws_ok(
  $$select public.authorise_mfa_reset_notice('ad000000-0000-0000-0000-0000000000ad')$$,
  '42501', null, 'and certainly not an admin''s');

/* AND NOT WITHOUT THE SECOND FACTOR, which is the first line of
   admin_reset_user_mfa and has to be the first line of its twin. */
select set_config('request.jwt.claims',
  '{"sub":"ad000000-0000-0000-0000-0000000000ad","role":"authenticated","aal":"aal1"}', true);
select throws_ok(
  $$select public.authorise_mfa_reset_notice('ad000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'and not by an admin who has not answered their own second factor');

-- ===========================================================================
-- 3. IT JUDGES THE SAME LADDER AS THE RESET ITSELF
-- ===========================================================================
/* The two must agree: a caller who may reset somebody must be able to tell
   them, and a caller who may not must learn nothing. Asserted as a pair
   rather than separately, because it is their AGREEMENT that matters. */
select set_config('request.jwt.claims',
  '{"sub":"ad000000-0000-0000-0000-0000000000bb","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select public.admin_reset_user_mfa('ad000000-0000-0000-0000-00000000000a')$$,
  '42501', null, 'the peer may not reset them either');

select set_config('request.jwt.claims',
  '{"sub":"ad000000-0000-0000-0000-0000000000ad","role":"authenticated","aal":"aal2"}', true);
select lives_ok(
  $$select public.admin_reset_user_mfa('ad000000-0000-0000-0000-00000000000a')$$,
  'and the admin who may be told may also reset');

select * from finish();
rollback;
