-- A RESET REVOKES THE OLD AUTHENTICATOR, AND ENDS EVERY SESSION.
--
-- Matt, 2026-10-01: "Reset must remove every existing two-factor factor and
-- sign the person out of all sessions immediately; the old authenticator must
-- never work again, and enrolment must verify against the newly created
-- factor only."
--
-- =========================================================================
-- HOW "THE OLD AUTHENTICATOR NEVER WORKS AGAIN" IS ASSERTED HERE
-- =========================================================================
--
-- A TOTP code is computed from a secret. GoTrue verifies it by reading that
-- secret out of `auth.mfa_factors`. So "the old authenticator can never work
-- again" is exactly "its secret is no longer in the table", and that is what
-- these assertions say. Driving a real authenticator app is not something a
-- database test can do, and faking one would be testing arithmetic rather
-- than the revocation.
--
-- THE OTHER THREE TABLES MATTER AS MUCH AS THE FACTOR. A session surviving
-- its factor is a person still signed in at AAL2 with no second factor to
-- answer for; a live refresh token is the same thing with a delay on it.

begin;
select plan(12);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route, partner_kind)
values ('ab000000-0000-0000-0000-00000000000b','zzz-mfa','ZZZ MFA Partner','pre_referenced_open',0.25,0.1,false, 'supplier');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),now(),now()
from (values
  ('ab000000-0000-0000-0000-00000000000a'::uuid,'zzz.mfa.victim@o.test'),
  ('ab000000-0000-0000-0000-0000000000ad'::uuid,'zzz.mfa.admin@o.test'),
  ('ab000000-0000-0000-0000-0000000000bb'::uuid,'zzz.mfa.bystander@o.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('ab000000-0000-0000-0000-00000000000a','ZZZ MFA Victim','zzz.mfa.victim@o.test','management',
   'ab000000-0000-0000-0000-00000000000b','active',false),
  ('ab000000-0000-0000-0000-0000000000ad','ZZZ MFA Admin','zzz.mfa.admin@o.test','superadmin',null,'active',true),
  ('ab000000-0000-0000-0000-0000000000bb','ZZZ MFA Bystander','zzz.mfa.bystander@o.test','management',
   'ab000000-0000-0000-0000-00000000000b','active',false);

/* THE STATE A SIGNED-IN, ENROLLED PERSON IS IN: a verified factor, a live
   AAL2 session, the AMR claim that says they answered a second factor, and
   a refresh token that would mint them a new access token. */
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret) values
  ('ab000000-0000-0000-0000-0000000000c1','ab000000-0000-0000-0000-00000000000a','old app','totp','verified',now(),now(),'OLDSECRET'),
  /* A SECOND, UNVERIFIED FACTOR, from an abandoned attempt. "Every existing
     two-factor factor" includes the ones nobody finished. */
  ('ab000000-0000-0000-0000-0000000000c2','ab000000-0000-0000-0000-00000000000a','half-done','totp','unverified',now(),now(),'HALFSECRET'),
  -- And somebody else's, which must survive.
  ('ab000000-0000-0000-0000-0000000000c3','ab000000-0000-0000-0000-0000000000bb','their app','totp','verified',now(),now(),'THEIRSECRET');

insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
  ('ab000000-0000-0000-0000-0000000000d1','ab000000-0000-0000-0000-00000000000a',now(),now(),'aal2'),
  ('ab000000-0000-0000-0000-0000000000d2','ab000000-0000-0000-0000-0000000000bb',now(),now(),'aal2');
insert into auth.mfa_amr_claims (id, session_id, created_at, updated_at, authentication_method) values
  ('ab000000-0000-0000-0000-0000000000e1','ab000000-0000-0000-0000-0000000000d1',now(),now(),'totp'),
  ('ab000000-0000-0000-0000-0000000000e2','ab000000-0000-0000-0000-0000000000d2',now(),now(),'totp');
insert into auth.refresh_tokens (instance_id, token, user_id, revoked, created_at, updated_at, session_id) values
  ('00000000-0000-0000-0000-000000000000','zzz-tok-victim','ab000000-0000-0000-0000-00000000000a',false,now(),now(),'ab000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-000000000000','zzz-tok-other','ab000000-0000-0000-0000-0000000000bb',false,now(),now(),'ab000000-0000-0000-0000-0000000000d2');

-- Before: everything is in place.
select is((select count(*)::int from auth.mfa_factors where user_id='ab000000-0000-0000-0000-00000000000a'),
  2, 'before the reset they hold two factors, one verified and one abandoned');
select is((select count(*)::int from auth.sessions where user_id='ab000000-0000-0000-0000-00000000000a'),
  1, 'and a live session');

-- An Opndoor admin presses Reset two-factor.
select set_config('request.jwt.claims',
  '{"sub":"ab000000-0000-0000-0000-0000000000ad","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$select public.admin_reset_user_mfa('ab000000-0000-0000-0000-00000000000a')$$,
  'an admin may reset somebody''s two-factor');
reset role;

-- ===========================================================================
-- 1. THE OLD AUTHENTICATOR CAN NEVER WORK AGAIN
-- ===========================================================================
/* ITS SECRET IS GONE, which is the only thing that makes a TOTP code
   verifiable. Asserted on the SECRET and not just on the row count: a
   row left behind with its secret nulled would still fail this if it
   were ever read, and the count alone would not say so. */
select is_empty(
  $$select secret from auth.mfa_factors where user_id = 'ab000000-0000-0000-0000-00000000000a'$$,
  'the old authenticator''s secret is no longer anywhere in the table');

select is_empty(
  $$select id from auth.mfa_factors where secret = 'OLDSECRET'$$,
  'and not under any other user either');

select is((select count(*)::int from auth.mfa_factors where user_id='ab000000-0000-0000-0000-00000000000a'),
  0, 'EVERY factor goes, the abandoned one included');

-- ===========================================================================
-- 2. AND THEY ARE SIGNED OUT, EVERYWHERE, IMMEDIATELY
-- ===========================================================================
select is((select count(*)::int from auth.sessions where user_id='ab000000-0000-0000-0000-00000000000a'),
  0, 'every session is ended');

/* A LIVE REFRESH TOKEN IS A SESSION WITH A DELAY ON IT. If one survived,
   the person would be signed out and back in again within the hour, at
   the assurance level they no longer have a factor for. */
select is(
  (select count(*)::int from auth.refresh_tokens
    where user_id::text = 'ab000000-0000-0000-0000-00000000000a' and revoked = false),
  0, 'and no live refresh token is left to mint a new one');

/* AND THE AMR CLAIM, which is what tells GoTrue the session reached AAL2
   by answering a second factor. */
select is(
  (select count(*)::int from auth.mfa_amr_claims where session_id = 'ab000000-0000-0000-0000-0000000000d1'),
  0, 'and no claim that they ever answered one');

-- ===========================================================================
-- 3. NOBODY ELSE IS TOUCHED
-- ===========================================================================
/* THE ASSERTION THAT WOULD CATCH A MISSING WHERE CLAUSE, which on this
   function would sign out the entire estate. */
select is((select count(*)::int from auth.mfa_factors where user_id='ab000000-0000-0000-0000-0000000000bb'),
  1, 'the bystander keeps their factor');
select is((select count(*)::int from auth.sessions where user_id='ab000000-0000-0000-0000-0000000000bb'),
  1, 'and their session');

-- ===========================================================================
-- 4. A NEW FACTOR ENROLS CLEANLY AFTERWARDS
-- ===========================================================================
/* "The new authenticator's code was rejected" is the other half of the
   report. A new factor must be insertable and verifiable with nothing of
   the old one in its way -- no unique-name collision, no leftover row. */
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values ('ab000000-0000-0000-0000-0000000000c4','ab000000-0000-0000-0000-00000000000a','opndoor new','totp','unverified',now(),now(),'NEWSECRET');
update auth.mfa_factors set status = 'verified' where id = 'ab000000-0000-0000-0000-0000000000c4';

select results_eq(
  $$select secret from auth.mfa_factors where user_id = 'ab000000-0000-0000-0000-00000000000a'$$,
  $$values ('NEWSECRET'::text)$$,
  'and the only secret they have afterwards is the new one');

select * from finish();
rollback;
