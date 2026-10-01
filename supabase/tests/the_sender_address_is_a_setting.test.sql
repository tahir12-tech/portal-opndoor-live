-- THE SENDER ADDRESS IS A SETTING, AND A BAD ONE IS REFUSED.
--
-- Matt, 2026-10-01: "Every email is sent from no-reply@opndoor.co (display
-- name 'opndoor') ... The sender address is a setting, not hardcoded."
--
-- Migration: 20261007280000_the_sender_address_is_a_setting.sql
--
-- WHY IT IS CHECKED HARDER THAN THE INVOICE ADDRESS BESIDE IT. A wrong
-- invoice address sends one document to the wrong place. A wrong sender
-- stops EVERY email in the product -- invites, password resets, payment
-- links, deeds -- and fails at Resend, after the send, where nobody is
-- watching.

begin;
select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),now(),now()
from (values
  ('ac000000-0000-0000-0000-0000000000ad'::uuid,'zzz.from.admin@o.test'),
  ('ac000000-0000-0000-0000-0000000000bb'::uuid,'zzz.from.other@o.test')
) as x(id,email);
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('ac000000-0000-0000-0000-0000000000ad','ZZZ From Admin','zzz.from.admin@o.test','superadmin',null,'active',true),
  ('ac000000-0000-0000-0000-0000000000bb','ZZZ From Other','zzz.from.other@o.test','opndoor_manager',null,'active',false);

-- ===========================================================================
-- 1. THE SHIPPED DEFAULT IS THE ADDRESS MATT NAMED
-- ===========================================================================
/* ASSERTED ON THE MIGRATION, NOT ON WHAT THIS DATABASE HOLDS.

   The first version read `email_from()` and expected the seed, which was
   true for about an hour: dev now sends from onboarding@resend.dev,
   because opndoor.co is not verified in Resend yet and a send from an
   unverified domain is refused. That divergence is the whole reason the
   sender became a setting, so a test that forbids it is testing against
   the feature.

   What must stay true everywhere is the value a FRESH environment is
   seeded with -- live included, when Balal applies the migrations. That
   lives in the file. */
-- ===========================================================================
-- 1. AN ADMIN MAY CHANGE IT, WITHOUT A DEPLOY
--    (the seeded DEFAULT is asserted in src/data/theSenderIsASetting.test.ts,
--     which reads the migration file -- dev's own value deliberately differs)
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"ac000000-0000-0000-0000-0000000000ad","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.set_app_setting_text('email_from', 'opndoor <hello@opndoor.co>')$$,
  'an admin may change the sender');
select is((select public.email_from()), 'opndoor <hello@opndoor.co>', 'and it takes effect at once');

/* AUDITED, like every other setting: who changed the address every email in
   the product comes from, and when. */
/* COUNTED SINCE THIS TRANSACTION STARTED, not for all time: dev has real
   rows from real changes, and a test that counts them all is a test about
   how often somebody has edited the setting. */
select is(
  (select count(*)::int from public.settings_audit
    where key = 'email_from' and at >= now() - interval '1 minute'),
  1, 'and the change is recorded');

-- A bare address, with no display name, is also valid.
select lives_ok(
  $$select public.set_app_setting_text('email_from', 'no-reply@opndoor.co')$$,
  'a bare address is allowed');

-- ===========================================================================
-- 3. AND A SENDER THAT WOULD STOP EVERY EMAIL IS REFUSED
-- ===========================================================================
select throws_ok(
  $$select public.set_app_setting_text('email_from', '')$$,
  '22023', null, 'it cannot be emptied');

select throws_ok(
  $$select public.set_app_setting_text('email_from', 'opndoor')$$,
  '22023', null, 'and a name with no address is refused');

/* THE SHAPE RESEND PARSES. A display name must put its address in angle
   brackets; "opndoor no-reply@opndoor.co" is rejected by Resend at send
   time, which is after the email is already lost. */
select throws_ok(
  $$select public.set_app_setting_text('email_from', 'opndoor no-reply@opndoor.co')$$,
  '22023', null, 'and a display name without angle brackets is refused');

select is((select public.email_from()), 'no-reply@opndoor.co',
  'and none of the refusals changed it');

-- ===========================================================================
-- 4. AND ONLY AN ADMIN
-- ===========================================================================
/* opndoor_manager reads the whole book and runs the daily queues, and still
   may not change where every email in the product comes from. */
select set_config('request.jwt.claims',
  '{"sub":"ac000000-0000-0000-0000-0000000000bb","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select public.set_app_setting_text('email_from', 'opndoor <evil@example.com>')$$,
  '42501', null, 'an opndoor manager may not change the sender');

select * from finish();
rollback;
