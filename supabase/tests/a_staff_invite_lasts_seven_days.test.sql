/* A STAFF INVITE LASTS SEVEN DAYS, AND THERE IS ONLY EVER ONE.
   Migration: 20261009100000.

   Matt, 2026-10-09: "Build the invite change I asked for earlier (7-day
   links, Accept invite page, sent date, expiry, resend and cancel)."

   THE ASSERTIONS THAT MATTER ARE THE REFUSALS AND THE REPLACEMENT.

   The replacement is the bug he watched: he pressed Resend for Ethan Li at
   about 11:20 and Ethan then opened an older email and was told the link was
   not valid. Both links really were live, because an invite writes
   auth.users.confirmation_token and a resend wrote recovery_token, two
   different columns in two different rows of nothing. One row per person
   here, replaced in place, is what makes "the previous link no longer works"
   a true sentence rather than a reassuring one.

   The refusals matter because "This link is not valid" was the sentence he
   spent two days behind. Expired, already used, cancelled and never issued
   are four different things to tell somebody and only one of them means
   "ask your administrator for another".

   Every row is this test's own, and the file is begin/rollback. */
begin;
select plan(27);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  ('ef200000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','zzz.si.admin@opndoor.test','',now(),now(),now()),
  ('ef200000-0000-0000-0000-00000000c002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','zzz.si.invitee@supplier.test','',now(),now(),now());

insert into public.partners (id, slug, name, status, partner_kind, referencing_mode, partner_rate, agent_rate)
values ('ef200000-0000-0000-0000-00000000f001'::uuid, 'zzz-si-supplier', 'ZZZ SI Supplier',
        'active', 'supplier', 'pre_referenced_open', 0.25, 0.10);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('ef200000-0000-0000-0000-00000000c001','ZZZ SI Admin','zzz.si.admin@opndoor.test',
   'superadmin', null,'active',true),
  /* A SUPPLIER'S MANAGEMENT, which is Ethan Li's shape: management on a
     supplier partner, holding no position, because positions belong to our
     own estate. */
  ('ef200000-0000-0000-0000-00000000c002','ZZZ SI Invitee','zzz.si.invitee@supplier.test',
   'management', 'ef200000-0000-0000-0000-00000000f001'::uuid,'pending',true);

-- ===========================================================================
-- 1. THE DOORS ARE SHUT TO THE BROWSER.
--
-- The token IS the credential: holding it is how somebody proves an
-- invitation is theirs. So neither function and not the table may be reached
-- by anon or by a signed-in user, and this is the first thing checked because
-- everything else below is worthless if it is not true.
-- ===========================================================================
select function_privs_are('public','mint_staff_invite',array['uuid','integer'],
  'anon', array[]::text[], 'anon may not mint a staff invitation');
select function_privs_are('public','mint_staff_invite',array['uuid','integer'],
  'authenticated', array[]::text[], 'nor may a signed-in user');
select function_privs_are('public','claim_staff_invite',array['uuid'],
  'authenticated', array[]::text[], 'nor claim one');
select function_privs_are('public','mint_staff_invite',array['uuid','integer'],
  'service_role', array['EXECUTE'], 'the service role may, which is invite-user');
select table_privs_are('public','staff_invites','authenticated', array[]::text[],
  'and the token table itself is unreadable from the browser');

-- ===========================================================================
-- 2. MINTING ONE.
-- ===========================================================================
select lives_ok(
  $$select public.mint_staff_invite('ef200000-0000-0000-0000-00000000c002'::uuid)$$,
  'an invitation can be minted for a pending user');

select is(
  (select (expires_at::date - sent_at::date) from public.staff_invites
    where user_id = 'ef200000-0000-0000-0000-00000000c002'::uuid),
  7,
  'and it lasts seven days by default');

select throws_ok(
  $$select public.mint_staff_invite('ef200000-0000-0000-0000-00000000c002'::uuid, 90)$$,
  '22023', null,
  'and a caller cannot ask for an invitation that lasts three months');

-- ===========================================================================
-- 3. A RESEND REPLACES IT. THIS IS THE ONE MATT REPORTED.
-- ===========================================================================
create temporary table zzz_si_first as
  select token from public.staff_invites where user_id = 'ef200000-0000-0000-0000-00000000c002'::uuid;

select lives_ok(
  $$select public.mint_staff_invite('ef200000-0000-0000-0000-00000000c002'::uuid)$$,
  'and it can be sent again');

select is(
  (select count(*)::int from public.staff_invites
    where user_id = 'ef200000-0000-0000-0000-00000000c002'::uuid),
  1,
  'there is still exactly one invitation for that person');

select isnt(
  (select token from public.staff_invites where user_id = 'ef200000-0000-0000-0000-00000000c002'::uuid),
  (select token from zzz_si_first),
  'and it is a different token from the first');

/* THE OLD LINK IS DEAD, which is the assertion the defect needed: before
   this migration both the first email's link and the resent one worked, and
   the invitee opened the wrong one. */
select throws_ok(
  format($$select public.claim_staff_invite(%L::uuid)$$, (select token from zzz_si_first)),
  '22023', null,
  'and the link from the first email no longer works');

-- ===========================================================================
-- 4. CLAIMING IT, ONCE.
-- ===========================================================================
select results_eq(
  format($$select email from public.claim_staff_invite(%L::uuid)$$,
         (select token from public.staff_invites where user_id = 'ef200000-0000-0000-0000-00000000c002'::uuid)),
  $$values ('zzz.si.invitee@supplier.test'::text)$$,
  'claiming it says which address it was issued to');

select throws_like(
  format($$select public.claim_staff_invite(%L::uuid)$$,
         (select token from public.staff_invites where user_id = 'ef200000-0000-0000-0000-00000000c002'::uuid)),
  '%already been used%',
  'and claiming it twice says it has already been used, not that it is invalid');

-- ===========================================================================
-- 5. EXPIRED AND CANCELLED EACH SAY SO, IN THEIR OWN WORDS.
-- ===========================================================================
select public.mint_staff_invite('ef200000-0000-0000-0000-00000000c002'::uuid);
update public.staff_invites
   set sent_at = now() - interval '9 days', expires_at = now() - interval '2 days'
 where user_id = 'ef200000-0000-0000-0000-00000000c002'::uuid;

select throws_like(
  format($$select public.claim_staff_invite(%L::uuid)$$,
         (select token from public.staff_invites where user_id = 'ef200000-0000-0000-0000-00000000c002'::uuid)),
  '%expired on%',
  'an expired invitation says when it expired');

update public.staff_invites set cancelled_at = now()
 where user_id = 'ef200000-0000-0000-0000-00000000c002'::uuid;

select throws_like(
  format($$select public.claim_staff_invite(%L::uuid)$$,
         (select token from public.staff_invites where user_id = 'ef200000-0000-0000-0000-00000000c002'::uuid)),
  '%was cancelled%',
  'and a cancelled one says it was cancelled');

/* AND A TOKEN WE NEVER ISSUED IS ITS OWN ANSWER, rather than the same
   sentence as an expired one. A guessed uuid must not be able to find out
   whether some other invitation exists. */
select throws_like(
  $$select public.claim_staff_invite('ef200000-0000-0000-0000-0000000000ff'::uuid)$$,
  '%not one we issued%',
  'and a token we never issued says exactly that');

-- ===========================================================================
-- 6. THE SENT DATE AND THE EXPIRY REACH THE TEAM LIST.
-- ===========================================================================
update public.staff_invites
   set sent_at = now(), expires_at = now() + interval '7 days',
       claimed_at = null, cancelled_at = null
 where user_id = 'ef200000-0000-0000-0000-00000000c002'::uuid;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ef200000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);

select results_eq(
  $$select invite_state from public.list_managed_users()
     where email = 'zzz.si.invitee@supplier.test'$$,
  $$values ('live'::text)$$,
  'the people screens read the invitation as live');

/* THE TOKEN NEVER LEAVES THE DATABASE. The dates are the whole of what a
   screen needs, and a read that handed the secret to every manager who can
   see the row would be worse than the problem it solves.

   STILL UNDER THE authenticated ROLE, which is what makes this measure
   something. information_schema.columns shows a role only the columns it
   holds a privilege on, so nought here is the grant being absent and not
   the table being absent. The assertion after it, as the owner, is what
   proves the table really is there. */
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'staff_invites'),
  0,
  'a signed-in user cannot see so much as the shape of the token table');

reset role;

select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'staff_invites'
      and column_name = 'token'),
  1,
  'and the token is a column of that table, which does exist');

-- ===========================================================================
-- 7. ASKING IS NOT SPENDING (20261013000000).
--
-- Found by probing the deployed function rather than by reading it: this
-- used to CLAIM the token and mint the sign-in link afterwards, so a failure
-- in between left an invitation marked used and a person who got nothing.
-- The retry then said "That invitation has already been used" about an
-- invitation nobody had ever used.
-- ===========================================================================
select public.mint_staff_invite('ef200000-0000-0000-0000-00000000c002'::uuid);

select function_privs_are('public','peek_staff_invite',array['uuid'],
  'authenticated', array[]::text[], 'the browser may not peek at an invitation');
select function_privs_are('public','peek_staff_invite',array['uuid'],
  'service_role', array['EXECUTE'], 'the service role may, which is accept-invite');

select results_eq(
  format($$select email from public.peek_staff_invite(%L::uuid)$$,
         (select token from public.staff_invites where user_id = 'ef200000-0000-0000-0000-00000000c002'::uuid)),
  $$values ('zzz.si.invitee@supplier.test'::text)$$,
  'a peek says whose invitation it is');

/* AND IT WROTE NOTHING, which is the whole of it: the token is still
   unclaimed and still works. */
select is(
  (select claimed_at from public.staff_invites where user_id = 'ef200000-0000-0000-0000-00000000c002'::uuid),
  null::timestamptz,
  'and leaves it unspent, so a failure after it costs the holder nothing');

/* TWICE IS STILL NOT SPENDING, because peeking is the question and asking it
   again is not using anything up. */
select lives_ok(
  format($$select public.peek_staff_invite(%L::uuid)$$,
         (select token from public.staff_invites where user_id = 'ef200000-0000-0000-0000-00000000c002'::uuid)),
  'and peeking twice is still not spending');

/* THE SAME FOUR SENTENCES AS THE CLAIM, so a reader cannot get different
   words depending on which half of the flow refused them. */
select throws_like(
  $$select public.peek_staff_invite('ef200000-0000-0000-0000-0000000000ff'::uuid)$$,
  '%not one we issued%',
  'and it refuses an unknown token in the claim''s own words');

update public.staff_invites set claimed_at = now()
 where user_id = 'ef200000-0000-0000-0000-00000000c002'::uuid;
select throws_like(
  format($$select public.peek_staff_invite(%L::uuid)$$,
         (select token from public.staff_invites where user_id = 'ef200000-0000-0000-0000-00000000c002'::uuid)),
  '%already been used%',
  'and a spent one in the claim''s own words too');

select * from finish();
rollback;
