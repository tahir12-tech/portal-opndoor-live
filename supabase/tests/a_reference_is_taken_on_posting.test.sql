-- A REFERENCE IS TAKEN WHEN A STATEMENT IS POSTED, AND NEVER BY LOOKING.
--
-- Matt, 2026-10-03, three messages on one subject: "Statement references are
-- being assigned when a statement is viewed or exported (e.g. STMT-2026-10-0001
-- for October, which hasn't ended; STMT-2026-09-0004 for Frost via Kestrel
-- yesterday). A reference must only be assigned when the monthly run actually
-- posts a statement. Viewing, exporting or previewing shows 'Reference
-- assigned when the statement is posted'."
--
-- `commission_statement_ref` looked the number up and, finding none, INSERTED
-- one -- so every caller minted: the Reporting heading, all three statement
-- exports and the supplier's card. The client even had a comment working around
-- it: "commission_statement_ref MINTS on read. Asking for every payee in the
-- month would burn a sequence number for every party an admin merely scrolled
-- past."
--
-- 20261007650000 split it. This file is the proof that the reader cannot take a
-- number and that the run still can, and the first assertion is the one that
-- matters: a read of an unposted month leaves the counter where it was.

begin;
select plan(9);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled,
                             api_access_enabled, partner_kind)
values ('99000000-0000-0000-0000-0000000000d1','zzz-ref-route','ZZZ Ref Route',
        'opndoor_referenced', 0.25, 0.10, true, true, true, false, 'agency');
insert into public.agencies (id, partner_id, name) values
  ('99000000-0000-0000-0000-0000000000d2','99000000-0000-0000-0000-0000000000d1','ZZZ Ref Agency');

/* AN OPNDOOR ADMIN TO DO THE READING. The reach preamble admits an admin
   outright and puts everybody else through the agency/branch/group/user/partner
   arms, so without a caller this file would be testing the isolation it is not
   about. The isolation is asserted in tenant_isolation and
   every_repro_from_both_reviews, both unchanged by this migration. */
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('99000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.ref.admin@o.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('99000000-0000-0000-0000-0000000000d3','ZZZ Ref Admin','zzz.ref.admin@o.test',
        'superadmin', null, 'active', true);

-- A month of its own, so the counter below is this file's and nothing else's.
-- 2027-03 appears in no other test and in no dev data.

select set_config('request.jwt.claims',
  '{"sub":"99000000-0000-0000-0000-0000000000d3","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ===========================================================================
-- 1. READING AN UNPOSTED MONTH TAKES NO NUMBER.
-- ===========================================================================
select is(
  (select count(*)::int from public.commission_statement_refs where statement_month = '2027-03'),
  0, 'the month starts with no references');

select is(
  public.commission_statement_ref('2027-03','99000000-0000-0000-0000-0000000000d1|agency:99000000-0000-0000-0000-0000000000d2'),
  null, 'reading an unposted month answers null rather than a number');

/* THE ASSERTION THE WHOLE CHANGE IS FOR. Reading twice, then counting. On the
   old function this would be 1 after the first read. */
select is(
  public.commission_statement_ref('2027-03','99000000-0000-0000-0000-0000000000d1|agency:99000000-0000-0000-0000-0000000000d2'),
  null, 'and twice is still null');

select is(
  (select count(*)::int from public.commission_statement_refs where statement_month = '2027-03'),
  0, 'and the counter has not moved: looking at a statement takes no number');

-- ===========================================================================
-- 2. THE RUN TAKES ONE, AND THE READER THEN SEES IT.
-- ===========================================================================
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select is(
  public.mint_commission_statement_ref('2027-03','99000000-0000-0000-0000-0000000000d1|agency:99000000-0000-0000-0000-0000000000d2'),
  'STMT-2027-03-0001', 'the run takes the month''s first number');

/* IDEMPOTENT, which is what makes a re-run safe: the run mints before the send
   and a failed send must not burn a second number on the next attempt. */
select is(
  public.mint_commission_statement_ref('2027-03','99000000-0000-0000-0000-0000000000d1|agency:99000000-0000-0000-0000-0000000000d2'),
  'STMT-2027-03-0001', 'and asking again returns the same one, not the next');

reset role;
-- Back to the admin, who is the one who READS a statement.
select set_config('request.jwt.claims',
  '{"sub":"99000000-0000-0000-0000-0000000000d3","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

/* AND MINTING ALONE IS STILL NOT ENOUGH, since 20261007770000. Matt, after
   a screenshot of an October statement carrying a number: "don't show a
   reference even if one was assigned before the reference fix." The reader
   joins `commission_statement_sends`, so a number reserved by the run but
   not yet SENT is still invisible. This assertion used to expect the number
   here and is corrected rather than deleted: the two rules stack, and
   showing both in one file is the point. */
select is(
  public.commission_statement_ref('2027-03','99000000-0000-0000-0000-0000000000d1|agency:99000000-0000-0000-0000-0000000000d2'),
  null, 'a number that is reserved but not yet sent is still not shown');

reset role;
insert into public.commission_statement_sends (statement_month, payee_key, recipients, total)
values ('2027-03','99000000-0000-0000-0000-0000000000d1|agency:99000000-0000-0000-0000-0000000000d2', 1, 123.45);
select set_config('request.jwt.claims',
  '{"sub":"99000000-0000-0000-0000-0000000000d3","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is(
  public.commission_statement_ref('2027-03','99000000-0000-0000-0000-0000000000d1|agency:99000000-0000-0000-0000-0000000000d2'),
  'STMT-2027-03-0001', 'and once it is posted the reader sees exactly that number');

-- ===========================================================================
-- 3. AND NOBODY BUT THE RUN MAY TAKE ONE.
--
-- As postgres, which passes the reach preamble, so what is being tested is the
-- run check and not the isolation. The isolation is asserted in
-- tenant_isolation and every_repro_from_both_reviews and is unchanged.
-- ===========================================================================
/* TWO LOCKS, AND THE FIRST ONE IS THE GRANT. Written as one assertion and
   corrected by the test failing: `authenticated` does not hold EXECUTE on the
   minting function at all (20261007650000 revoked it from public, anon and
   authenticated), so a browser caller is refused before the guard inside is
   reached. That is the stronger refusal and it is worth asserting as itself
   rather than being hidden behind the message I expected. */
select throws_ok(
  $$select public.mint_commission_statement_ref('2027-03','99000000-0000-0000-0000-0000000000d1|agency:99000000-0000-0000-0000-0000000000d2')$$,
  '42501', 'permission denied for function mint_commission_statement_ref',
  'a browser role cannot even call the minting function');

/* AND THE GUARD INSIDE THE FUNCTION IS NOT ASSERTED HERE, deliberately.

   It exists -- `mint_commission_statement_ref` raises "A statement reference
   is taken when the statement is posted." for any caller that is not the run
   -- but reaching it needs a caller holding EXECUTE, and the only ones are
   service_role (which IS the run) and the owner. Asserting it therefore means
   running as postgres, and `testsRunAsTheirRole.test.ts` refuses that: a
   permission asserted as the owner proves very little, because the owner
   bypasses the things being asserted. The guard failed this file when it was
   written that way, and the guard is right.

   SO THE GRANT IS THE LOCK THAT OPERATES, and assertion 8 above is the one
   that matters: no browser role can call the minting function at all. The
   in-function raise is belt-and-braces for a future definer function that
   calls it from inside the database, where the grant would not apply. */

select * from finish();
rollback;
