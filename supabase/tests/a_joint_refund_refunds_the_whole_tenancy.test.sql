-- A FULL REFUND ON A JOINT TENANCY REFUNDS THE WHOLE TENANCY.
--
-- Matt (al): "when one tenant's fee is fully refunded in Stripe, the tenancy
-- isn't going ahead, so automatically refund every other paid tenant on that
-- tenancy through Stripe ... Only a full refund triggers this, never a
-- partial one ... if any co-tenant's refund fails, alert ops and show it on
-- Home."
--
-- THE LEDGER IS THE DESIGN, and these assertions are about the ledger rather
-- than about Stripe. Stripe calls are not transactional: a rollback cannot
-- un-refund somebody. So the row is written BEFORE the money moves, and what
-- has to be proved here is that the ledger cannot enrol the wrong tenant,
-- cannot enrol anybody twice, and does not lose a failure.
--
-- THE FIXTURE IS FOUR TENANTS ON ONE TENANCY, which is one more than the
-- worked example needs, because each extra one is a case that must NOT be
-- enrolled: an unpaid applicant, and one already refunded by hand. A
-- three-tenant fixture would pass while silently refunding people who had
-- nothing to refund.

begin;
select plan(16);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled, partner_kind)
values ('d0000000-0000-0000-0000-0000000000d1','zzz-jr-agency','ZZZ JR Agency Partner',
        'opndoor_referenced', 0.30, 0.10, false, true, true, false, 'agency');
insert into public.agencies (id, partner_id, name) values
  ('d0000000-0000-0000-0000-0000000000a1','d0000000-0000-0000-0000-0000000000d1','ZZZ JR Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('d0000000-0000-0000-0000-0000000000b1','d0000000-0000-0000-0000-0000000000a1',
   'd0000000-0000-0000-0000-0000000000d1','ZZZ JR Office');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('d0000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.jr.neg@r.test','',now(),now(),now()),
       ('d0000000-0000-0000-0000-00000000c002','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.jr.ops@r.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('d0000000-0000-0000-0000-00000000c001','ZZZ JR Negotiator','zzz.jr.neg@r.test','referrer',
   'd0000000-0000-0000-0000-0000000000d1','active',false),
  -- Opndoor staff sit on no estate: users_partner_by_role requires a NULL
  -- partner_id for them, and that is exactly the shape the Home warning is
  -- gated on.
  ('d0000000-0000-0000-0000-00000000c002','ZZZ JR Ops','zzz.jr.ops@r.test','opndoor_manager',
   null,'active',true);

insert into public.tenancies (id, monthly_rent, tenancy_start, prop_addr1, prop_city, prop_postcode)
values ('d0000000-0000-0000-0000-00000000aa01', 2000, current_date + 20,
        '1 Cascade Court','London','CC1 1AA'),
       -- A second, sole tenancy: the overwhelming majority of the book, and
       -- the thing that must never cascade.
       ('d0000000-0000-0000-0000-00000000aa02', 900, current_date + 20,
        '9 Single Street','London','SG1 1AA');

insert into public.applications (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
       tenancy_id, tenancy_position,
       tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
       prop_addr1, prop_city, prop_postcode,
       monthly_rent, fee_amount, tenancy_start, partner_rate, agent_rate, referencing_mode,
       status, paid_at, deed_issued_at, deed_state, payment_state, refunded_at,
       stripe_payment_intent_id, livemode)
values
  -- THE TRIGGER. Fully refunded in Stripe.
  ('d0000000-0000-0000-0000-0000000000f1','GR-ZZJR01',
   'd0000000-0000-0000-0000-0000000000d1','d0000000-0000-0000-0000-0000000000a1',
   'd0000000-0000-0000-0000-0000000000b1','d0000000-0000-0000-0000-00000000c001',
   'd0000000-0000-0000-0000-00000000aa01', 1,
   'Mx','Tam','Trigger','1990-01-01','zzz.jr.a@r.test','07700900820',
   '1 Cascade Court','London','CC1 1AA', 2000, 500, current_date + 20, 0.30, 0.10, 'opndoor_referenced',
   'deed', now(), now(), 'executed', 'refunded', now(), 'pi_zzjr_01', true),
  -- ENROLLED: paid, signed, nothing back yet.
  ('d0000000-0000-0000-0000-0000000000f2','GR-ZZJR02',
   'd0000000-0000-0000-0000-0000000000d1','d0000000-0000-0000-0000-0000000000a1',
   'd0000000-0000-0000-0000-0000000000b1','d0000000-0000-0000-0000-00000000c001',
   'd0000000-0000-0000-0000-00000000aa01', 2,
   'Mx','Cora','Cotenant','1990-01-01','zzz.jr.b@r.test','07700900821',
   '1 Cascade Court','London','CC1 1AA', 2000, 500, current_date + 20, 0.30, 0.10, 'opndoor_referenced',
   'deed', now(), now(), 'executed', 'paid', null, 'pi_zzjr_02', true),
  -- NOT ENROLLED: never paid. There is nothing to send back, and asking
  -- Stripe to refund an unpaid tenant is the error this row exists to catch.
  ('d0000000-0000-0000-0000-0000000000f3','GR-ZZJR03',
   'd0000000-0000-0000-0000-0000000000d1','d0000000-0000-0000-0000-0000000000a1',
   'd0000000-0000-0000-0000-0000000000b1','d0000000-0000-0000-0000-00000000c001',
   'd0000000-0000-0000-0000-00000000aa01', 3,
   'Mx','Nils','Neverpaid','1990-01-01','zzz.jr.c@r.test','07700900822',
   '1 Cascade Court','London','CC1 1AA', 2000, 500, current_date + 20, 0.30, 0.10, 'opndoor_referenced',
   'sent', null, null, null, 'awaiting', null, null, true),
  -- NOT ENROLLED: already refunded by hand. A second refund is the mistake.
  ('d0000000-0000-0000-0000-0000000000f4','GR-ZZJR04',
   'd0000000-0000-0000-0000-0000000000d1','d0000000-0000-0000-0000-0000000000a1',
   'd0000000-0000-0000-0000-0000000000b1','d0000000-0000-0000-0000-00000000c001',
   'd0000000-0000-0000-0000-00000000aa01', 4,
   'Mx','Ada','Already','1990-01-01','zzz.jr.d@r.test','07700900823',
   '1 Cascade Court','London','CC1 1AA', 2000, 500, current_date + 20, 0.30, 0.10, 'opndoor_referenced',
   'deed', now(), now(), 'executed', 'refunded', now(), 'pi_zzjr_04', true),
  -- A SOLE TENANCY, fully refunded. Must cascade to nobody.
  ('d0000000-0000-0000-0000-0000000000f5','GR-ZZJR05',
   'd0000000-0000-0000-0000-0000000000d1','d0000000-0000-0000-0000-0000000000a1',
   'd0000000-0000-0000-0000-0000000000b1','d0000000-0000-0000-0000-00000000c001',
   'd0000000-0000-0000-0000-00000000aa02', 1,
   'Mx','Sol','Single','1990-01-01','zzz.jr.e@r.test','07700900824',
   '9 Single Street','London','SG1 1AA', 900, 900, current_date + 20, 0.30, 0.10, 'opndoor_referenced',
   'deed', now(), now(), 'executed', 'refunded', now(), 'pi_zzjr_05', true);

-- ===========================================================================
-- 1-4. WHO GETS ENROLLED, and who must not.
-- ===========================================================================
select is(public.start_refund_cascade('d0000000-0000-0000-0000-0000000000f1'), 1,
  'one co-tenant is enrolled out of three: the paid, unrefunded one');

/* SCOPED TO THIS FIXTURE'S TENANCY, and it was not until 2026-10-04.
   Matt's real cascade on dev wrote a refund_cascades row for GR-23854, and
   this assertion read the WHOLE table, so it started failing with
   "GR-23854,GR-ZZJR02". The test was only ever passing because the table
   happened to be empty -- a dependence on the rest of the database that a
   pgTAP file inside a rolled-back transaction has no business having. */
select is(
  (select string_agg(a.guarantee_ref, ',' order by a.guarantee_ref)
     from public.refund_cascades c join public.applications a on a.id = c.application_id
    where c.tenancy_id = 'd0000000-0000-0000-0000-00000000aa01'),
  'GR-ZZJR02',
  'by name, so "one" cannot be the right count for the wrong tenant');

select is(
  (select idempotency_key from public.refund_cascades
    where application_id='d0000000-0000-0000-0000-0000000000f2'),
  'refund-cascade-d0000000-0000-0000-0000-0000000000f2',
  'and the key is DERIVED from the application, so a retry computes the same one');

select is(
  (select count(*) from public.activity_log
    where application_id='d0000000-0000-0000-0000-0000000000f2'
      and kind='refund_cascade_started' and visibility='business'),
  1::bigint,
  'and the log says what triggered it, which Matt asked for by name');

-- ===========================================================================
-- 5-6. THE REDELIVERED WEBHOOK. Stripe sends the same event more than once
--      as ordinary behaviour, so this is the common path, not the rare one.
-- ===========================================================================
select is(public.start_refund_cascade('d0000000-0000-0000-0000-0000000000f1'), 0,
  'a second delivery of the same event enrols nobody new');

select is(
  (select count(*) from public.refund_cascades
    where tenancy_id = 'd0000000-0000-0000-0000-00000000aa01'),
  1::bigint,
  'and the ledger still holds exactly one row for this tenancy');

-- ===========================================================================
-- 7-8. THE TWO CASES THAT MUST NOT CASCADE AT ALL.
-- ===========================================================================
select is(public.start_refund_cascade('d0000000-0000-0000-0000-0000000000f5'), 0,
  'a SOLE tenancy cascades to nobody, which is most of the book');

update public.applications set payment_state='partially_refunded'
 where id='d0000000-0000-0000-0000-0000000000f4';
select is(public.start_refund_cascade('d0000000-0000-0000-0000-0000000000f4'), 0,
  'and a PART refund never unwinds a tenancy: Matt''s guard against a goodwill refund');

-- ===========================================================================
-- 9-11. RESUMABLE. A failure comes back round; a success does not.
-- ===========================================================================
/* refund_cascade_work() IS DELIBERATELY ESTATE-WIDE -- that is what makes
   the cascade resumable without a cron -- so these counts are scoped to the
   fixture rather than the function being changed. Same lesson as above. */
select is(
  (select count(*) from public.refund_cascade_work() w
    where w.guarantee_ref like 'GR-ZZJR%'),
  1::bigint,
  'the pending row is work to do');

select lives_ok(
  $$select public.record_refund_cascade('d0000000-0000-0000-0000-0000000000f2','failed',null,'Stripe timed out')$$,
  'a failure is recorded rather than thrown away');

select is(
  (select count(*) from public.refund_cascade_work() w
    where w.guarantee_ref like 'GR-ZZJR%'),
  1::bigint,
  'AND COMES BACK AS WORK, which is the whole of "resumable"');

-- ===========================================================================
-- 12-13. BUT NOT FOREVER. A permanent Stripe refusal fails exactly like a
--        timeout, and with no ceiling it is retried on every refund webhook
--        this estate ever receives, raising an alert each time and burying
--        itself. Five attempts, then it stops ASKING.
--
--        AND GOES ON MATTERING, which is the half that makes the cap safe:
--        the row stays failed, so it stays on Home until somebody deals with
--        it. Assertion 15 is the one that would catch a "fix" that cleared
--        the row instead of parking it.
-- ===========================================================================
update public.refund_cascades set attempts = 5
 where application_id='d0000000-0000-0000-0000-0000000000f2';

select is(
  (select count(*) from public.refund_cascade_work() w
    where w.guarantee_ref like 'GR-ZZJR%'),
  0::bigint,
  'after five attempts it stops being retried');

-- ===========================================================================
-- 14-15. THE HOME WARNING, and who may read it.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(
  (select count(*) from public.refund_cascade_failures()),
  0::bigint,
  'an agency Negotiator sees NO half-done cascade at all: it is opndoor''s to clear up');
reset role;

/* READ AS A REAL OPNDOOR READER, not as the table owner. The first draft of
   this assertion used a bare `reset role`, and it returned NULL -- correctly:
   `is_opndoor_staff()` reads auth.uid(), which is null outside a session, so
   the gate closed on the test itself. Worth keeping as a note, because a
   SECURITY DEFINER function with an is_* gate inside it will quietly answer
   "nothing" to an unauthenticated caller, and an assertion written as
   `count = 0` rather than by name would have passed on that nothing. */
select set_config('request.jwt.claims',
  '{"sub":"d0000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(
  (select f.guarantee_ref from public.refund_cascade_failures() f
    where f.guarantee_ref like 'GR-ZZJR%'),
  'GR-ZZJR02',
  'and opndoor sees it, named, for the Home warning');

select is(
  (select f.attempts from public.refund_cascade_failures() f
    where f.guarantee_ref like 'GR-ZZJR%'),
  5,
  'STILL on Home after it stopped being retried, which is the point of the cap');
reset role;

-- ===========================================================================
-- 16. A SUCCESS CLOSES IT, and clears the error that is no longer true. A
--     row that reads "succeeded" while still carrying last_error shows as a
--     failure in every list that renders the error.
-- ===========================================================================
select public.record_refund_cascade('d0000000-0000-0000-0000-0000000000f2','succeeded','re_zzjr_02',null);
select is(
  (select state || '/' || coalesce(last_error,'cleared') || '/' || stripe_refund_id
     from public.refund_cascades where application_id='d0000000-0000-0000-0000-0000000000f2'),
  'succeeded/cleared/re_zzjr_02',
  'succeeded, error cleared, refund id kept');

select * from finish();
rollback;
