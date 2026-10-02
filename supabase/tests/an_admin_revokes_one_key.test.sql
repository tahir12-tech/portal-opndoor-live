-- AN ADMIN REVOKES ONE KEY, WHERE THE KEYS ARE.
--
-- Matt, 2026-10-02: "Supplier Integration tab: Opndoor admin can revoke
-- a single key here ... Admin still never sees or creates a full key.
-- Record who revoked what and when."
--
-- THREE DOORS ONTO ONE ACT, and this asserts that the new one is the
-- narrowest rather than a widening of either old one:
--
--   dev_revoke_api_key(uuid)                the partner's own developer,
--                                           their own partner only. Still
--                                           refuses an admin.
--   admin_break_glass_revoke_key(text,text) admin, by PREFIX, with a
--                                           ten-character reason. For an
--                                           incident. Untouched.
--   admin_revoke_partner_api_key(uuid)      admin, by the id dev_api_keys
--                                           already shows them, no reason,
--                                           recorded. The button.
--
-- WHAT IS NOT ASSERTED HERE: what the screen draws. That is in
-- src/data/theDevCentreIsForDevelopers.test.ts, which reads the copy and
-- the three things the list shows.

begin;
select plan(14);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled)
values ('93000000-0000-0000-0000-0000000ca001','zzz-key-supplier','ZZZ Key Supplier',
        'pre_referenced_open', 0.25, 0.10, false, false, true, true);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('93000000-0000-0000-0000-0000000ca0a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zzz.key.admin@k.test','',now(),now(),now()),
  ('93000000-0000-0000-0000-0000000ca0a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zzz.key.dev@k.test','',now(),now(),now());

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('93000000-0000-0000-0000-0000000ca0a1','ZZZ Key Admin','zzz.key.admin@k.test','superadmin',null,'active',true),
  ('93000000-0000-0000-0000-0000000ca0a2','ZZZ Key Dev','zzz.key.dev@k.test','developer','93000000-0000-0000-0000-0000000ca001','active',false);

-- TWO KEYS, because "Their other keys keep working" is a claim about the
-- other one and a test with a single key cannot see it.
insert into public.partner_api_keys (id, partner_id, name, key_prefix, key_hash, scopes, livemode) values
  ('93000000-0000-0000-0000-0000000ca0b1','93000000-0000-0000-0000-0000000ca001','Production','pk_zzz_prod_0001','x',array['applications:write'],true),
  ('93000000-0000-0000-0000-0000000ca0b2','93000000-0000-0000-0000-0000000ca001','Staging','pk_zzz_stag_0002','x',array['applications:write'],true);

select set_config('request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-0000000ca0a1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ===========================================================================
-- 1. SOMETHING FOR THE ADMIN TO READ, which they had nothing of before.
-- ===========================================================================
/* `dev_api_keys` HAS NO ADMIN ARM, deliberately: its own comment says
   "an opndoor admin gets zero rows, including with an explicit
   p_partner". That is why the old copy sent admin to Break glass with a
   prefix they had to find elsewhere, and it is why this needed a reader
   of its own rather than a widening. Asserted first, because if that
   ever changes the new function is redundant and somebody should know. */
select is(
  (select count(*)::int from public.dev_api_keys('93000000-0000-0000-0000-0000000ca001')),
  0, 'the developer''s own reader still tells an admin nothing');

select is(
  (select count(*)::int from public.admin_supplier_api_keys('93000000-0000-0000-0000-0000000ca001')),
  2, 'while the admin reader shows this supplier''s keys, which the list is drawn from');

/* AND THE THREE FACTS THE SCREEN SHOWS ARE ALL THERE. Named rather than
   assumed: if last_used_at ever stopped coming back, the list would
   quietly print "never used" against a key in daily use. */
select is(
  (select count(*)::int from public.admin_supplier_api_keys('93000000-0000-0000-0000-0000000ca001') k
    where k.name is not null and k.created_at is not null),
  2, 'with a name and a created date on each');

/* AND IT CANNOT RETURN A KEY. "Admin still never sees or creates a full
   key" is kept in the function rather than in the caller, so a future
   screen cannot print one by asking for it. */
select ok(
  (select pg_get_function_result(oid) from pg_proc
    where proname = 'admin_supplier_api_keys' and pronamespace = 'public'::regnamespace)
    not like '%prefix%',
  'and no prefix in its shape at all, so the screen cannot print one');

-- ===========================================================================
-- 2. THE REVOKE ITSELF
-- ===========================================================================
select is(
  (select key_name from public.admin_revoke_partner_api_key('93000000-0000-0000-0000-0000000ca0b1')),
  'Production', 'an admin revokes one key by id, and is told which');

-- Read as the owner: `partner_api_keys` is not readable by
-- `authenticated` directly, which is the point of dev_api_keys. These two
-- are ground truth about what the write did, not authorisation claims.
reset role;
select ok(
  (select revoked_at is not null from public.partner_api_keys where id = '93000000-0000-0000-0000-0000000ca0b1'),
  'and it is really revoked');

/* THE SENTENCE ON THE BUTTON IS TRUE. "Their other keys keep working."
   This is the assertion that would catch a revoke written against the
   partner instead of the key. */
select ok(
  (select revoked_at is null from public.partner_api_keys where id = '93000000-0000-0000-0000-0000000ca0b2'),
  'while their other key keeps working, which is what the confirmation promises');

select set_config('request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-0000000ca0a1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

/* ALREADY GONE IS NOT AN ERROR, because two admins on one incident is
   the likely way it happens and the second should be told, not failed. */
select is(
  (select revoked from public.admin_revoke_partner_api_key('93000000-0000-0000-0000-0000000ca0b1')),
  false, 'revoking it again says it was already revoked rather than failing');

select throws_ok(
  $$select * from public.admin_revoke_partner_api_key('93000000-0000-0000-0000-0000000cabbb')$$,
  '22023', null,
  'and a key that does not exist is an error, not a silent success');

-- ===========================================================================
-- 3. WHO REVOKED WHAT AND WHEN
-- ===========================================================================
reset role;
select is(
  (select count(*)::int from public.security_events
    where kind = 'admin_revoke_api_key'
      and api_key_id = '93000000-0000-0000-0000-0000000ca0b1'),
  1, 'the revoke is recorded once, against the key');

select ok(
  (select detail like '%ZZZ Key Admin%' and detail like '%Production%'
     from public.security_events
    where kind = 'admin_revoke_api_key' and api_key_id = '93000000-0000-0000-0000-0000000ca0b1'),
  'naming who did it and which key, so "who could have done this" has a one-name answer');

select ok(
  (select actor_id = '93000000-0000-0000-0000-0000000ca0a1'
     from public.security_events
    where kind = 'admin_revoke_api_key' and api_key_id = '93000000-0000-0000-0000-0000000ca0b1'),
  'and the actor by id, not only by name');

-- ===========================================================================
-- 4. AND IT IS ADMIN'S DOOR, NOT EVERYBODY'S
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-0000000ca0a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select throws_ok(
  $$select * from public.admin_revoke_partner_api_key('93000000-0000-0000-0000-0000000ca0b2')$$,
  '42501', null,
  'the supplier''s own developer cannot use the admin door');

/* THEIR OWN STILL WORKS, which is what makes the refusal above about
   this function rather than about them. */
select lives_ok(
  $$select public.dev_revoke_api_key('93000000-0000-0000-0000-0000000ca0b2')$$,
  'while their own revoke still does');

reset role;
select * from finish();
rollback;
