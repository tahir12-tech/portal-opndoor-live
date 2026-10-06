-- A REFUND AFTER A STATEMENT HAS BEEN SENT IS A QUESTION, NOT A CORRECTION.
--
-- Matt, 2026-10-01, verbatim: "Refund after a commission statement has been
-- sent: when a refund lands on an application whose commission was already on
-- a sent statement, raise an internal alert to Opndoor naming the payee, the
-- statement reference and the commission affected. On that alert, Opndoor
-- admin chooses, with a confirmation box: (a) reissue a corrected statement to
-- the payee, or (b) carry the amount as a deduction line on the payee's next
-- statement. Nothing happens automatically. Record who chose what and when."
--
-- Migration: 20261007180000_a_refund_after_a_statement_is_a_question.sql
--
-- =========================================================================
-- THE ORDER IS THE WHOLE OF THE CORRECTNESS, AND IT IS ASSERTION 7
-- =========================================================================
--
-- commission_statement_lines excludes refunded applications. One statement
-- after apply_stripe_refund writes payment_state = 'refunded', the line is
-- gone and the amount on the document already sent cannot be recovered from
-- live data at all. So the question has to be asked BEFORE the write, and a
-- test that only checked "a question exists" would pass just as happily with
-- the call in the wrong place and an amount of zero. Assertion 7 proves the
-- line really does vanish, which is what makes the ordering load-bearing
-- rather than a preference.
--
-- THE MONTH IS IN THE PAST, and that is not cosmetic: the first draft paid in
-- November 2026 and apply_stripe_refund was refused by the
-- `applications_journey_sequence` constraint, because refunded_at is now() and
-- a refund cannot precede the payment it reverses. The constraint was right
-- and the fixture was wrong.
--
-- THE FIXTURE IS ITS OWN SUPPLIER, in a month of its own, because dev's real
-- book has no refund on a statemented month and inventing one in it would
-- leave a question on the Reconciliation list for a real guarantee.
--
-- TWO PAYEES ON ONE APPLICATION is the shape worth testing, and it is why
-- opndoor_pays_agents is TRUE here: that is the one configuration where a
-- supplier referral produces both a partner payee and an agency payee, so a
-- refund raises two questions about one refund. With it false the agency arm
-- is suppressed (NM-C 5) and the case would never be exercised.

begin;
select plan(33);

-- ---------------------------------------------------------------------------
-- FIXTURE
-- ---------------------------------------------------------------------------
insert into public.partners (id, slug, name, status, is_house_route, partner_rate, agent_rate, opndoor_pays_agents)
values ('e7000000-0000-0000-0000-0000000000f1','zzz-refq-sup','ZZZ Refund Supplier','active',false,0.35,0.15,true)
on conflict (id) do nothing;

insert into public.agencies (id, partner_id, name)
values ('e7000000-0000-0000-0000-0000000000a9','e7000000-0000-0000-0000-0000000000f1','ZZZ Refund Agency');
insert into public.branches (id, agency_id, partner_id, name)
values ('e7000000-0000-0000-0000-0000000000b9','e7000000-0000-0000-0000-0000000000a9',
        'e7000000-0000-0000-0000-0000000000f1','ZZZ Refund Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       x.email,'',now(),now(),now()
from (values
  ('e7000000-0000-0000-0000-00000000c001'::uuid,'zzz.refq.admin@o.test'),
  ('e7000000-0000-0000-0000-00000000c002'::uuid,'zzz.refq.ref@s.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('e7000000-0000-0000-0000-00000000c001','ZZZ Refund Admin','zzz.refq.admin@o.test','superadmin',
   null,'active',true),
  -- A supplier-side director: holds commission, is NOT Opndoor, and must be
  -- refused both the list and the decision.
  ('e7000000-0000-0000-0000-00000000c002','ZZZ Refund Director','zzz.refq.ref@s.test','management',
   'e7000000-0000-0000-0000-0000000000f1','active',true);

/* TWO PAID REFERRALS, in a month of their own. The second exists only to
   prove the alert dedupe fix: two applications refunded in the same clock
   hour are two alerts, and before this migration the second was swallowed. */
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode,
   monthly_rent, fee_amount, paid_amount, tenancy_start, referencing_mode,
   partner_rate, agent_rate, status, sent_at, paid_at, livemode, payment_state,
   stripe_payment_intent_id)
values
  ('e7000000-0000-0000-0000-0000000000a1','ZZZ-REFQ-1','e7000000-0000-0000-0000-0000000000f1',
   'e7000000-0000-0000-0000-0000000000a9','e7000000-0000-0000-0000-0000000000b9',
   'e7000000-0000-0000-0000-00000000c002',
   'Ms','Ada','Tester','1990-01-01','ada@zzzrefq.test','07700900000',
   '1 ZZZ Street','London','SW1A 1AA',
   2000, 2000, 2000, '2026-09-01', 'pre_referenced_open',
   0.35, 0.15, 'paid', '2026-08-05T10:00:00Z', '2026-08-10T10:00:00Z', true, 'paid',
   'pi_zzz_refq_1'),
  ('e7000000-0000-0000-0000-0000000000a2','ZZZ-REFQ-2','e7000000-0000-0000-0000-0000000000f1',
   'e7000000-0000-0000-0000-0000000000a9','e7000000-0000-0000-0000-0000000000b9',
   'e7000000-0000-0000-0000-00000000c002',
   'Mr','Ben','Carter','1991-01-01','ben@zzzrefq.test','07700900001',
   '2 ZZZ Street','London','SW1A 1AA',
   1000, 1000, 1000, '2026-09-01', 'pre_referenced_open',
   0.35, 0.15, 'paid', '2026-08-05T10:00:00Z', '2026-08-12T10:00:00Z', true, 'paid',
   'pi_zzz_refq_2'),
  /* A SANDBOX ROW. The statement run reads livemode only, so this was never
     on a document and must raise nothing. */
  ('e7000000-0000-0000-0000-0000000000a3','ZZZ-REFQ-3','e7000000-0000-0000-0000-0000000000f1',
   'e7000000-0000-0000-0000-0000000000a9','e7000000-0000-0000-0000-0000000000b9',
   'e7000000-0000-0000-0000-00000000c002',
   'Mx','Cal','Nkemdirim','1992-01-01','cal@zzzrefq.test','07700900002',
   '3 ZZZ Street','London','SW1A 1AA',
   1000, 1000, 1000, '2026-09-01', 'pre_referenced_open',
   0.35, 0.15, 'paid', '2026-08-05T10:00:00Z', '2026-08-14T10:00:00Z', false, 'paid',
   'pi_zzz_refq_3'),
  /* UNTOUCHED UNTIL SECTION 8. The ordering test needs an application that
     has NEVER had its question raised by hand, or the assertion passes on a
     row that was already there. That is exactly how the first version of
     this file let the most important rule in the feature go unchecked: a
     mutant that moved the call to AFTER the write survived, because a2's
     question had been raised directly two sections earlier. */
  ('e7000000-0000-0000-0000-0000000000a4','ZZZ-REFQ-4','e7000000-0000-0000-0000-0000000000f1',
   'e7000000-0000-0000-0000-0000000000a9','e7000000-0000-0000-0000-0000000000b9',
   'e7000000-0000-0000-0000-00000000c002',
   'Dr','Dev','Raman','1993-01-01','dev@zzzrefq.test','07700900003',
   '4 ZZZ Street','London','SW1A 1AA',
   1500, 1500, 1500, '2026-09-01', 'pre_referenced_open',
   0.35, 0.15, 'paid', '2026-08-05T10:00:00Z', '2026-08-16T10:00:00Z', true, 'paid',
   'pi_zzz_refq_4');

/* THE FROZEN AGENCY SPLIT, which is what the agency arm reads. */
insert into public.application_commission_lines (application_id, level, org_id, org_name, rate, basis_amount, source, amount)
values
  ('e7000000-0000-0000-0000-0000000000a1','agency','e7000000-0000-0000-0000-0000000000a9','ZZZ Refund Agency',0.15,2000,'agreement',300),
  ('e7000000-0000-0000-0000-0000000000a2','agency','e7000000-0000-0000-0000-0000000000a9','ZZZ Refund Agency',0.15,1000,'agreement',150),
  ('e7000000-0000-0000-0000-0000000000a3','agency','e7000000-0000-0000-0000-0000000000a9','ZZZ Refund Agency',0.15,1000,'agreement',150),
  ('e7000000-0000-0000-0000-0000000000a4','agency','e7000000-0000-0000-0000-0000000000a9','ZZZ Refund Agency',0.15,1500,'agreement',225);

-- ===========================================================================
-- 1. THE FIXTURE REALLY DOES PRODUCE TWO PAYEES FOR ONE REFERRAL
-- ===========================================================================
-- Asserted before anything else, because every amount below is derived from
-- these rows. A fixture that silently produced one payee, or none, would make
-- the rest of this file pass by vacuity.
select is(
  (select count(*)::int from public.commission_statement_lines('2026-08-01'::date)
    where guarantee_ref = 'ZZZ-REFQ-1'),
  2, 'the fixture referral is on two payees: the supplier, and the agency Opndoor pays directly');

select is(
  (select count(distinct level)::int from public.commission_statement_lines('2026-08-01'::date)
    where guarantee_ref = 'ZZZ-REFQ-1'),
  2, 'and they are different levels, partner and agency, not two rows of one');

-- ===========================================================================
-- 2. NO STATEMENT SENT MEANS NO QUESTION
-- ===========================================================================
-- The correct behaviour when a refund beats the statement is that next
-- month's run simply does not include it. Asking a person about that would be
-- a queue of work that does not exist.
select is(
  public.raise_refund_after_statement('e7000000-0000-0000-0000-0000000000a1'), 0,
  'a refund on a month whose statement was never posted raises no question');

select is(
  (select count(*)::int from public.statement_refund_questions
    where application_id = 'e7000000-0000-0000-0000-0000000000a1'),
  0, 'and writes no row');

-- ===========================================================================
-- 3. A SENT STATEMENT MAKES IT A QUESTION
-- ===========================================================================
-- Posted for BOTH payees, and given both a stored reference, exactly as the
-- run would leave them.
insert into public.commission_statement_refs (statement_month, payee_key, seq)
select '2026-08', l.payee_key, row_number() over (order by l.payee_key) + 900
  from (select distinct payee_key from public.commission_statement_lines('2026-08-01'::date)
         where guarantee_ref = 'ZZZ-REFQ-1') l;

insert into public.commission_statement_sends (statement_month, payee_key, recipients, total, sent_at)
select '2026-08', l.payee_key, 1, 1, now()
  from (select distinct payee_key from public.commission_statement_lines('2026-08-01'::date)
         where guarantee_ref = 'ZZZ-REFQ-1') l;

select is(
  public.raise_refund_after_statement('e7000000-0000-0000-0000-0000000000a1'), 2,
  'once the statement has gone, the same refund raises one question per payee');

/* THE AMOUNT IS THE DOCUMENT'S, NOT A NUMBER WRITTEN HERE. Compared against
   commission_statement_lines itself, so changing the fixture's rates cannot
   leave this passing about a figure no statement ever carried. */
select is(
  (select sum(q.commission) from public.statement_refund_questions q
    where q.application_id = 'e7000000-0000-0000-0000-0000000000a1'),
  (select sum(l.commission) from public.commission_statement_lines('2026-08-01'::date) l
    where l.guarantee_ref = 'ZZZ-REFQ-1'),
  'and the commission in question is the commission the statement carried, to the penny');

select is(
  (select count(*)::int from public.statement_refund_questions
    where application_id = 'e7000000-0000-0000-0000-0000000000a1'
      and statement_reference is null),
  0, 'every question names the reference of the document it is about');

select alike(
  (select statement_reference from public.statement_refund_questions
    where application_id = 'e7000000-0000-0000-0000-0000000000a1' limit 1),
  'STMT-2026-08-%',
  'and the reference is the stored one, in the house format');

-- ===========================================================================
-- 4. IT IS READ, NEVER MINTED
-- ===========================================================================
/* commission_statement_ref MINTS on first read. If the raiser called it, a
   refund would burn the month's next sequence number on a question rather
   than on a document, and the sequence would have a hole in it. Proved by
   counting the rows it would have added. */
select is(
  (select count(*)::int from public.commission_statement_refs where statement_month = '2026-08'),
  2, 'asking the question minted no new statement number');

-- ===========================================================================
-- 5. ASKED ONCE, HOWEVER OFTEN STRIPE REDELIVERS
-- ===========================================================================
select is(
  public.raise_refund_after_statement('e7000000-0000-0000-0000-0000000000a1'), 0,
  'a redelivered refund adds no second question');

select is(
  (select count(*)::int from public.statement_refund_questions
    where application_id = 'e7000000-0000-0000-0000-0000000000a1'),
  2, 'and the two rows are still two rows');

-- ===========================================================================
-- 6. TWO APPLICATIONS IN ONE HOUR ARE TWO ALERTS
-- ===========================================================================
/* THE DEDUPE FIX, and the reason report_ops_incident had to change.
   ops_alerts dedupes on (type, coalesce(application_id, sentinel), hour), and
   the old two-argument form always passed NULL. Two refunds in one hour were
   one alert, and the second payee was never told about. A suppressed alert
   looks exactly like no alert, which is why this is asserted and not assumed. */
select lives_ok(
  $$ select public.raise_refund_after_statement('e7000000-0000-0000-0000-0000000000a2') $$,
  'a second application in the same hour can also raise');

select cmp_ok(
  (select count(*)::int from public.ops_alerts
    where alert_type = 'commission_refunded_after_statement'
      and application_id in ('e7000000-0000-0000-0000-0000000000a1','e7000000-0000-0000-0000-0000000000a2')),
  '=', 2,
  'and both refunds produced their own alert rather than one swallowing the other');

-- ===========================================================================
-- 7. A SANDBOX ROW WAS NEVER ON A DOCUMENT
-- ===========================================================================
insert into public.commission_statement_sends (statement_month, payee_key, recipients, total, sent_at)
select '2026-08', 'zzz-refq-sup|agency:e7000000-0000-0000-0000-0000000000a9', 1, 1, now()
 where not exists (select 1 from public.commission_statement_sends
                    where statement_month = '2026-08'
                      and payee_key = 'zzz-refq-sup|agency:e7000000-0000-0000-0000-0000000000a9');

select is(
  public.raise_refund_after_statement('e7000000-0000-0000-0000-0000000000a3'), 0,
  'a sandbox application raises nothing: the run reads livemode only, so it was never on a statement');

-- ===========================================================================
-- 8. WHY THE ORDER MATTERS, PROVED
-- ===========================================================================
/* apply_stripe_refund asks the question and then writes. This shows what the
   second half costs the first: after the write the line is GONE from the
   function the question is computed from, so a raiser called afterwards would
   find nothing and record a correction of zero. */
/* WHAT THE DOCUMENT SAID, captured while it can still be read. After the
   refund this number is not recoverable from live data at all, which is the
   entire reason the question is asked first. */
create temp table refq_before on commit drop as
  select sum(commission) as total, count(*)::int as lines
    from public.commission_statement_lines('2026-08-01'::date)
   where guarantee_ref = 'ZZZ-REFQ-4';

select is(
  (select lines from refq_before), 2,
  'before the refund is written the line is on the statement function');

select is(
  (select count(*)::int from public.statement_refund_questions
    where application_id = 'e7000000-0000-0000-0000-0000000000a4'),
  0, 'and this application has had no question raised about it by hand');

select lives_ok(
  $$ select public.apply_stripe_refund('pi_zzz_refq_4', 're_zzz_refq_4', 1500) $$,
  'and the refund path records the refund');

select is(
  (select count(*)::int from public.commission_statement_lines('2026-08-01'::date)
    where guarantee_ref = 'ZZZ-REFQ-4'),
  0, 'after it, the line has vanished from the recomputation, which is why the question is asked first');

/* THE ASSERTION THE WHOLE ORDERING RESTS ON. A raiser called after the write
   finds nothing, so this is 0 and the amount below is NULL. */
select is(
  (select count(*)::int from public.statement_refund_questions
    where application_id = 'e7000000-0000-0000-0000-0000000000a4'),
  2, 'and the refund path asked the question first, so both payees are recorded');

select is(
  (select sum(commission) from public.statement_refund_questions
    where application_id = 'e7000000-0000-0000-0000-0000000000a4'),
  (select total from refq_before),
  'for the amount the statement actually carried, read before the refund erased it');

-- ===========================================================================
-- 9. WHO MAY SEE AND ANSWER
-- ===========================================================================
/* THE IDS, TAKEN WHILE THEY CAN BE. statement_refund_questions has RLS on
   and no policies, so an authenticated role reading it directly gets nothing
   -- which is the design. A test that selects an id from it under that role
   gets NULL, and every refusal below then fires for the wrong reason: a
   mutant that let a question be answered TWICE survived the first version of
   this file, because the second call was refused as "No such question."
   rather than as "already decided". A temp table is not subject to RLS. */
create temp table refq_ids on commit drop as
  select id, payee_level, guarantee_ref
    from public.statement_refund_questions
   where application_id = 'e7000000-0000-0000-0000-0000000000a1';
-- Owned by postgres, so the role under test has to be let in explicitly.
grant select on refq_ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"e7000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);

/* A SUPPLIER'S OWN DIRECTOR, holding commission and MFA'd, and still refused:
   these are other companies' figures on documents Opndoor sent, and the
   decision is about what Opndoor sends next. */
select is(
  (select count(*)::int from public.refund_questions_open()), 0,
  'a supplier director sees no questions, not even their own');

select throws_ok(
  $$ select public.decide_refund_question(
       (select id from refq_ids order by payee_level limit 1), 'deduct') $$,
  '42501', null,
  'and cannot answer one, given a real id rather than a null one');

select set_config('request.jwt.claims',
  '{"sub":"e7000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);

select cmp_ok(
  (select count(*)::int from public.refund_questions_open()), '>=', 2,
  'Opndoor staff see the open questions');

-- ===========================================================================
-- 10. THE ANSWER IS RECORDED WITH WHO AND WHEN, AND GIVEN ONCE
-- ===========================================================================
/* THE ID COMES FROM THE LIST FUNCTION, not from the table, and that is the
   RLS working rather than a detail of the test. statement_refund_questions
   has RLS on and NO policies: an authenticated role reading it directly gets
   nothing at all, which is the intended design (read through
   refund_questions_open, write through the two definers). My first draft
   selected the id straight out of the table and got NULL, and the decision
   refused with "No such question." -- the right refusal for the wrong
   reason. This is also exactly how the screen does it. */
select lives_ok(
  $$ select public.decide_refund_question(
       (select id from public.refund_questions_open()
         where guarantee_ref = 'ZZZ-REFQ-1' and payee_level = 'agency'),
       'deduct') $$,
  'an admin can carry it as a deduction');

select is(
  (select count(*)::int from public.refund_questions_open()
    where guarantee_ref = 'ZZZ-REFQ-1' and payee_level = 'agency'),
  0, 'and it leaves the open list once it has been answered');

select throws_ok(
  $$ select public.decide_refund_question(
       (select id from refq_ids where payee_level = 'agency'), 'reissue') $$,
  '22023', 'That was already decided on ' || to_char(now(), 'DD/MM/YYYY') || '.',
  'and it cannot be answered a second time, which would deduct and reissue for one refund');

reset role;

select is(
  (select decided_by::text || '|' || (decided_at is not null)::text
     from public.statement_refund_questions
    where application_id = 'e7000000-0000-0000-0000-0000000000a1' and payee_level = 'agency'),
  'e7000000-0000-0000-0000-00000000c001|true',
  'and the row records who chose and that it happened at a moment');

/* THE AUDIT ROW, pointed at the decision. Same shape as the not-in-network
   one: an entity_type nothing joins to a real org, because the thing that
   happened is the decision. */
select is(
  (select count(*)::int from public.org_audit
    where entity_type = 'statement_refund'
      and action = 'refund_statement_deduct'
      and actor_id = 'e7000000-0000-0000-0000-00000000c001'),
  1, 'and an audit row says what was chosen, by whom');

-- ===========================================================================
-- 11. THE DEDUCTION ACTUALLY REACHES A STATEMENT
-- ===========================================================================
-- "A deduction line must actually appear on the next statement if (b) is
-- chosen, or the choice is a note to nobody."

select is(
  (select count(*)::int from public.statement_deductions('2026-12-01'::date)
    where question_id in (select id from public.statement_refund_questions
                           where application_id = 'e7000000-0000-0000-0000-0000000000a1')),
  1, 'the deduction is owed on the next statement, and only the one that was deducted');

select is(
  (select count(*)::int from public.statement_deductions('2026-12-01'::date) d
     join public.statement_refund_questions q on q.id = d.question_id
    where q.payee_level = 'partner'),
  0, 'a question nobody has answered is not a deduction');

/* SETTLED ONLY WHEN THE STATEMENT CARRYING IT HAS ACTUALLY BEEN POSTED. */
/* AND IT CANNOT BE CARRIED BACKWARDS. A deduction decided today belongs on a
   statement not yet sent. August's has already gone; putting it there would
   be editing a document in the past, which is the thing this whole feature
   exists to refuse. */
select is(
  (select count(*)::int from public.statement_deductions('2026-08-01'::date) d
     join public.statement_refund_questions q on q.id = d.question_id
    where q.application_id = 'e7000000-0000-0000-0000-0000000000a1'),
  0, 'and never onto a statement for a month that has already been sent');

select is(
  public.settle_statement_deductions('2026-12',
    (select payee_key from public.statement_refund_questions
      where application_id = 'e7000000-0000-0000-0000-0000000000a1' and payee_level = 'agency')),
  1, 'posting the statement settles it');

select is(
  (select count(*)::int from public.statement_deductions('2027-01-01'::date) d
     join public.statement_refund_questions q on q.id = d.question_id
    where q.application_id = 'e7000000-0000-0000-0000-0000000000a1'),
  0, 'and it is not carried a second time the month after');

select * from finish();
rollback;
