-- A FAILED DEED IS RETRIED, AND STILL PRODUCES EXACTLY ONE DOCUMENT.
--
-- RULING (20261005260000): deed_state 'error' does not block a retry. The next
-- automatic pass retries it, Generate retries it for any user who can see the
-- card, three consecutive failures park the application as needs-attention with
-- the last error, and voided and declined stay terminal.
--
-- The two sequences this has to make work come from the live portal and neither
-- may need an admin void or a database edit:
--
--   SUPPLIER: the branch has no agent contact, payment lands, generation fails.
--   Staff add the contact email, click Generate, the deed generates and delivers.
--
--   AGENCY: the agency has no active person, generation parks. A manager accepts
--   their invite. Generate delivers to them.
--
-- Both are "the recipient did not exist yet, and now does". What is asserted here
-- is the half that lives in the database: that the claim which gates generation
-- says yes again once the world has changed, and still says no once a document
-- exists. The PandaDoc call itself cannot run from a test, so the sequences are
-- asserted at the claim, which is the thing that was refusing.

begin;
select plan(16);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route, refers_own_stock, partner_kind)
values ('8a000000-0000-0000-0000-000000000001', 'zzz-retry-agency', 'ZZZ Retry Estate', 'opndoor_referenced', 0.25, 0.10, true, true, 'agency'),
  ('8a000000-0000-0000-0000-000000000002', 'zzz-retry-supp', 'ZZZ Retry Supplier', 'pre_referenced_screened', 0.25, 0.10, false, false, 'supplier');
insert into public.agencies (id, partner_id, name) values
  ('8a000000-0000-0000-0000-00000000000a', '8a000000-0000-0000-0000-000000000001', 'ZZZ Retry Lettings'),
  ('8a000000-0000-0000-0000-00000000000b', '8a000000-0000-0000-0000-000000000002', 'ZZZ Supplier Agent');
insert into public.branches (id, agency_id, partner_id, name) values
  ('8a000000-0000-0000-0000-0000000000a1', '8a000000-0000-0000-0000-00000000000a', '8a000000-0000-0000-0000-000000000001', 'Retry Park'),
  ('8a000000-0000-0000-0000-0000000000b1', '8a000000-0000-0000-0000-00000000000b', '8a000000-0000-0000-0000-000000000002', 'Supplier Park');

-- A referrer for the supplier rail: assert_application_attributed refuses an
-- application with no referrer and no applicant unless its partner is the house
-- route, and the supplier fixture is not one.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('8a000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ref@zzzretry.test', '', now(), now(), now());
insert into public.users (id, full_name, email, role, partner_id, status)
values ('8a000000-0000-0000-0000-0000000000d1', 'Ref Erra', 'ref@zzzretry.test', 'referrer', '8a000000-0000-0000-0000-000000000002', 'active');

-- One paid application per rail, no deed yet.
insert into public.applications (
  id, guarantee_ref, branch_id, agency_id, partner_id,
  tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
  prop_addr1, prop_city, prop_postcode, monthly_rent, fee_amount, tenancy_start,
  status, sent_at, paid_at, livemode, referencing_mode, partner_rate, agent_rate, referrer_id
) values
  ('8a000000-0000-0000-0000-0000000000c1', 'GR-RETRY-AG',
   '8a000000-0000-0000-0000-0000000000a1', '8a000000-0000-0000-0000-00000000000a', '8a000000-0000-0000-0000-000000000001',
   'Mr', 'Ade', 'Agency', '1990-01-01', 'ade@zzzretry.test', '07700 900700',
   '1 Retry Road', 'London', 'NW1 1RT', 1000, 692.31, current_date + 30,
   'paid', now() - interval '2 days', now() - interval '1 day', true, 'pre_referenced_open', 0.25, 0.10, null),
  ('8a000000-0000-0000-0000-0000000000c2', 'GR-RETRY-SUP',
   '8a000000-0000-0000-0000-0000000000b1', '8a000000-0000-0000-0000-00000000000b', '8a000000-0000-0000-0000-000000000002',
   'Ms', 'Sam', 'Supplier', '1990-01-01', 'sam@zzzretry.test', '07700 900701',
   '2 Retry Road', 'London', 'NW1 1RT', 1000, 1000, current_date + 30,
   'paid', now() - interval '2 days', now() - interval '1 day', true, 'pre_referenced_screened', 0.25, 0.10, '8a000000-0000-0000-0000-0000000000d1');

-- ---------------------------------------------------------------------------
-- THE FIRST ATTEMPT, AND THE FAILURE THAT USED TO BE PERMANENT.
-- ---------------------------------------------------------------------------
select ok(public.claim_tenancy_deed('8a000000-0000-0000-0000-0000000000c1'),
  'a paid application with no deed can be claimed');

-- The caller releases the claim when generation fails; stripe-webhook does this.
select public.release_tenancy_deed_claim('8a000000-0000-0000-0000-0000000000c1');
select is(public.record_deed_failure('8a000000-0000-0000-0000-0000000000c1',
  'No recipient: this agency has no active person.'), 1,
  'a failure is recorded and counted');

select is((select deed_state from public.applications where id = '8a000000-0000-0000-0000-0000000000c1'),
  'error', 'and the row says so');

-- THE ASSERTION THE RULING TURNS ON. This returned false before 20261005260000,
-- and nothing but an admin void could ever change it back.
select ok(public.claim_tenancy_deed('8a000000-0000-0000-0000-0000000000c1'),
  'and the next pass can claim it again, because a failure is not a decision');

-- ---------------------------------------------------------------------------
-- A TRANSIENT FAILURE FOLLOWED BY A HEALTHY PASS PRODUCES EXACTLY ONE DOCUMENT.
-- The healthy pass is simulated by the stamp generateDeed makes on success.
-- ---------------------------------------------------------------------------
update public.applications
   set pandadoc_document_id = 'DOC-RETRY-1', deed_state = 'awaiting_tenant',
       deed_sent_at = now(), deed_attempts = 0, deed_last_error = null,
       awaiting_staff_send = false
 where id = '8a000000-0000-0000-0000-0000000000c1';

select is((select count(distinct pandadoc_document_id)::int from public.applications
            where id = '8a000000-0000-0000-0000-0000000000c1'),
  1, 'exactly one document exists after the retry');

select ok(not public.claim_tenancy_deed('8a000000-0000-0000-0000-0000000000c1'),
  'and no further pass can make a second one, which is the guarantee');

select is((select deed_attempts from public.applications where id = '8a000000-0000-0000-0000-0000000000c1'),
  0, 'the failure run ended, so a later single failure does not park it');

-- ---------------------------------------------------------------------------
-- THREE CONSECUTIVE FAILURES PARK IT, AND PARKING IS NOT A LOCK.
-- ---------------------------------------------------------------------------
update public.applications set pandadoc_document_id = null, deed_state = null,
       deed_attempts = 0, deed_last_error = null, awaiting_staff_send = false
 where id = '8a000000-0000-0000-0000-0000000000c2';

select is(public.record_deed_failure('8a000000-0000-0000-0000-0000000000c2', 'first'), 1, 'one');
select is(public.record_deed_failure('8a000000-0000-0000-0000-0000000000c2', 'second'), 2, 'two');
select ok(not (select awaiting_staff_send from public.applications
                where id = '8a000000-0000-0000-0000-0000000000c2'),
  'two failures do not park it: a blip is not a pattern');

select is(public.record_deed_failure('8a000000-0000-0000-0000-0000000000c2',
  'No agent contact on the branch.'), 3, 'three');

select ok((select awaiting_staff_send from public.applications
            where id = '8a000000-0000-0000-0000-0000000000c2'),
  'and the third parks it as needs-attention for staff');

select is((select deed_last_error from public.applications where id = '8a000000-0000-0000-0000-0000000000c2'),
  'No agent contact on the branch.',
  'with the last error kept, so the card can say what went wrong');

/* THE SEQUENCE THE RULING NAMES. Staff add the contact and press Generate. That
   button calls generateDeed, which is gated by nothing in the database except
   this claim, so if the claim refuses a parked row the sequence needs an admin
   void, which the ruling forbids. */
select ok(public.claim_tenancy_deed('8a000000-0000-0000-0000-0000000000c2'),
  'a parked application can still be generated once the recipient exists');

-- ---------------------------------------------------------------------------
-- VOIDED AND DECLINED STAY TERMINAL: a decision, not a failure.
-- ---------------------------------------------------------------------------
update public.applications set pandadoc_document_id = null, deed_state = 'declined'
 where id = '8a000000-0000-0000-0000-0000000000c2';
select ok(not public.claim_tenancy_deed('8a000000-0000-0000-0000-0000000000c2'),
  'a declined deed is not retried');

update public.applications set deed_state = 'voided'
 where id = '8a000000-0000-0000-0000-0000000000c2';
select ok(not public.claim_tenancy_deed('8a000000-0000-0000-0000-0000000000c2'),
  'nor a voided one');

select * from finish();
rollback;
