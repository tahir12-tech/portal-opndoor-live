-- DEEDS NOT GENERATING, AND THE THREE DATABASE PROPERTIES BEHIND THE SILENCE.
--
-- Reported as a recurring fault on the live portal. The source of the chain is
-- correct; what it lacked was any way for a failure in it to reach a person.
-- Three of those failure modes are database properties rather than edge-function
-- ones, and they are the three asserted here.
--
-- ONE. 'failed' AND 'cannot_deliver' ARE DIFFERENT EVENTS (20261005100000), and
-- until this branch nothing in the tree ever called record_delivery_attempt, so
-- delivery_failed_at was null on every row that has ever existed and the 'failed'
-- state my_application_delivery can return was unreachable. An executed deed
-- whose email the provider refused therefore read as DELIVERED. The first block
-- pins the difference in both directions, because the tempting fix (stamp
-- delivery_failed_at whenever a deed is queued) is the one the migration
-- explicitly refuses: it would put a Resend button in front of an agency for a
-- send that was never attempted.
--
-- TWO. A GENERATION THAT FAILED MUST NOT BE RETRIED BY A WEBHOOK REDELIVERY.
-- claim_tenancy_deed is the only thing standing between a broken template and a
-- Stripe retry loop minting documents. It must refuse a row that already carries
-- a deed_state, including 'error'.
--
-- THREE. apply_deed_executed IS A SILENT NO-OP FOR AN UNKNOWN DOCUMENT. That is
-- correct and deliberate (it is what makes a superseded document inert), and it
-- is also exactly why a completion for a document this project does not own
-- vanished without trace. Pinned here because pandadoc-webhook now raises an ops
-- incident for that case, and that alert is only worth having while this stays
-- silent underneath it.

begin;
select plan(15);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route, partner_kind)
values ('97000000-0000-0000-0000-000000000001', 'zzz-deed-silence', 'Deed Silence', 'opndoor_referenced', 0.25, 0.10, true, 'agency');
insert into public.agencies (id, partner_id, name)
values ('97000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001', 'Silent Lettings');
insert into public.branches (id, agency_id, partner_id, name)
values ('97000000-0000-0000-0000-000000000003', '97000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001', 'Silent Branch');

-- Two executed deeds at the same branch. One will have a send ATTEMPTED and
-- refused; the other has nobody to send to and was never attempted. Both end up
-- in front of a human, and the whole point is that they end up in front of a
-- DIFFERENT human with a different button.
insert into public.applications (
  id, guarantee_ref, branch_id, agency_id, partner_id,
  tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
  prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start, status, sent_at,
  partner_rate, agent_rate, livemode, fee_amount, paid_at, referencing_mode,
  deed_state, deed_sent_at, deed_issued_at, pandadoc_document_id
) values
  ('97000000-0000-0000-0000-000000000011', 'GR-ZZS-1', '97000000-0000-0000-0000-000000000003', '97000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001',
   'Mr','Ada','Refused','1990-01-01','zzs1@example.test','07700900601','1 Silent Row','London','N1 1ZZ',1500, current_date + 30, 'deed', now() - interval '5 days',
   0.25, 0.20, true, 1500, now() - interval '4 days', 'pre_referenced_open',
   'executed', now() - interval '2 days', now() - interval '2 days', 'zzs-doc-1'),
  ('97000000-0000-0000-0000-000000000012', 'GR-ZZS-2', '97000000-0000-0000-0000-000000000003', '97000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001',
   'Ms','Bee','Nobody','1991-01-01','zzs2@example.test','07700900602','2 Silent Row','London','N1 1ZZ',1500, current_date + 30, 'deed', now() - interval '5 days',
   0.25, 0.20, true, 1500, now() - interval '4 days', 'pre_referenced_open',
   'executed', now() - interval '2 days', now() - interval '2 days', 'zzs-doc-2'),
  -- Paid, no deed yet. The row generateDeed is about to act on.
  ('97000000-0000-0000-0000-000000000013', 'GR-ZZS-3', '97000000-0000-0000-0000-000000000003', '97000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001',
   'Mx','Cy','Unclaimed','1992-01-01','zzs3@example.test','07700900603','3 Silent Row','London','N1 1ZZ',1500, current_date + 30, 'paid', now() - interval '5 days',
   0.25, 0.20, true, 1500, now() - interval '4 days', 'pre_referenced_open',
   null, null, null, null),
  -- Paid, and a generation that already failed. deed_state is the scar.
  ('97000000-0000-0000-0000-000000000014', 'GR-ZZS-4', '97000000-0000-0000-0000-000000000003', '97000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001',
   'Mr','Dee','Errored','1993-01-01','zzs4@example.test','07700900604','4 Silent Row','London','N1 1ZZ',1500, current_date + 30, 'paid', now() - interval '5 days',
   0.25, 0.20, true, 1500, now() - interval '4 days', 'pre_referenced_open',
   'error', null, null, null);

-- ---------------------------------------------------------------------------
-- ONE. THE TWO STATES, AND THE LINE BETWEEN THEM.
-- ---------------------------------------------------------------------------

-- Nothing has been attempted for either yet, which is the state every row in
-- the live database is in today.
select is((select delivery_failed_at from public.applications where id = '97000000-0000-0000-0000-000000000011'),
  null::timestamptz, 'a deed with no attempt recorded carries no failure time');

-- CANNOT DELIVER. The queue, and nothing else: no address went anywhere and
-- nothing errored, so stamping a failure here would be a lie about an event
-- that never happened.
update public.applications set awaiting_staff_send = true
 where id = '97000000-0000-0000-0000-000000000012';

select is((select delivery_failed_at from public.applications where id = '97000000-0000-0000-0000-000000000012'),
  null::timestamptz, 'queueing for a staff send does not stamp a delivery failure');

-- DELIVERY FAILED. A send was made to a real address and the provider refused.
select lives_ok($$select public.record_delivery_attempt(
    '97000000-0000-0000-0000-000000000011'::uuid, false,
    'agent@silent.test', 'org_person', 'Resend rejected the recipient domain.')$$,
  'record_delivery_attempt accepts a failed attempt');

select isnt((select delivery_failed_at from public.applications where id = '97000000-0000-0000-0000-000000000011'),
  null::timestamptz, 'a refused send stamps delivery_failed_at');
select is((select delivery_attempted_to from public.applications where id = '97000000-0000-0000-0000-000000000011'),
  'agent@silent.test', 'and records where it was attempted, so a screen can say where the deed went');
select is((select delivery_reason from public.applications where id = '97000000-0000-0000-0000-000000000011'),
  'Resend rejected the recipient domain.', 'and why it did not arrive, in the provider''s terms');
select is((select delivery_source from public.applications where id = '97000000-0000-0000-0000-000000000011'),
  'org_person', 'and which rung of the ladder supplied the address');

-- A SUCCESS CLEARS BOTH. This is the manual resend working: the row leaves the
-- queue and stops being a failure, and the address it went to is KEPT, because
-- "where did it go" outlives "why did it not".
select lives_ok($$select public.record_delivery_attempt(
    '97000000-0000-0000-0000-000000000011'::uuid, true,
    'agent2@silent.test', 'explicit', null)$$,
  'record_delivery_attempt accepts a successful attempt');

select is((select delivery_failed_at from public.applications where id = '97000000-0000-0000-0000-000000000011'),
  null::timestamptz, 'a later success clears the failure');
select ok(not (select awaiting_staff_send from public.applications where id = '97000000-0000-0000-0000-000000000011'),
  'and takes the row out of the staff-send queue');
select is((select delivery_attempted_to from public.applications where id = '97000000-0000-0000-0000-000000000011'),
  'agent2@silent.test', 'and keeps the address it actually reached');

-- ---------------------------------------------------------------------------
-- TWO. ONE PAYMENT MINTS ONE DEED, AND A FAILURE IS RETRIED.
--
-- THIS ASSERTED THE OPPOSITE UNTIL 20261005260000, and the ruling reversed it: a
-- row at deed_state 'error' used to be refused for ever, on the reasoning that a
-- broken template must not loop. The cost was worse than the loop. deed_state
-- 'error' is what EVERY failure writes, including a transient RPC blip, and
-- nothing but an admin void could clear it, so a momentary fault buried the deed
-- permanently and the two ordinary recovery sequences (add the missing agent
-- contact and press Generate; the agency's first manager accepts their invite and
-- press Generate) both needed an admin.
--
-- The looping concern is now answered where it belongs, by counting: three
-- consecutive failures park the application as needs-attention with the last
-- error, which a person sees. Asserted in a_failed_deed_is_retried.test.sql.
-- What still refuses is a document that EXISTS, which is the one-deed guarantee.
-- ---------------------------------------------------------------------------
select ok((select public.claim_tenancy_deed('97000000-0000-0000-0000-000000000013')),
  'a paid application with no deed_state can be claimed for generation');
select ok(not (select public.claim_tenancy_deed('97000000-0000-0000-0000-000000000013')),
  'and cannot be claimed twice, so two deliveries of one payment mint one deed');
select ok((select public.claim_tenancy_deed('97000000-0000-0000-0000-000000000014')),
  'a row at deed_state error IS retried: a failure is not a decision');

-- ---------------------------------------------------------------------------
-- THREE. AN UNKNOWN DOCUMENT EXECUTES NOTHING, SILENTLY.
--
-- The property the webhook's new ops incident exists to narrate. If this ever
-- starts raising instead of returning, the alert is redundant and the webhook
-- should be simplified rather than left saying two things at once.
-- ---------------------------------------------------------------------------
select lives_ok($$select public.apply_deed_executed('zzs-doc-that-does-not-exist', 'nowhere.pdf')$$,
  'a completion for a document no application carries is inert, not an error');

select finish();
rollback;
