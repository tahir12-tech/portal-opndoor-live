-- A PAID APPLICATION WITH NO DEED IS FOUND.
--
-- 20261005260000 ruled that a failed deed is retried by "the next automatic
-- pass". There was no automatic pass: none of the eight cron-invoked functions
-- called generateDeed, so the only automatic generation was inside stripe-webhook
-- at the moment of payment, and past Stripe's own redelivery window a paid
-- application with no deed stayed that way until a person opened it. On dev,
-- eleven paid applications carried no document and two of them had never been
-- attempted at all.
--
-- deeds_awaiting_generation is the selection half of the sweep that closes that.
-- What it must NOT return matters more than what it must, because every row it
-- returns becomes a real PandaDoc document and a real email, so each exclusion
-- below is a document that would otherwise be created wrongly.

begin;
select plan(15);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route, refers_own_stock, partner_kind)
values ('96000000-0000-0000-0000-000000000001', 'zzz-sweep', 'ZZZ Sweep Estate', 'opndoor_referenced', 0.25, 0.10, true, true, 'agency');
insert into public.agencies (id, partner_id, name)
values ('96000000-0000-0000-0000-00000000000a', '96000000-0000-0000-0000-000000000001', 'ZZZ Sweep Lettings');
insert into public.branches (id, agency_id, partner_id, name)
values ('96000000-0000-0000-0000-0000000000b1', '96000000-0000-0000-0000-00000000000a', '96000000-0000-0000-0000-000000000001', 'Sweep Park');

/* Ten applications differing in exactly one property each, so a failure names the
   property rather than the fixture. All paid two days ago unless the assertion is
   about the window. */
insert into public.applications (
  id, guarantee_ref, branch_id, agency_id, partner_id,
  tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
  prop_addr1, prop_city, prop_postcode, monthly_rent, fee_amount, tenancy_start,
  status, sent_at, paid_at, livemode, referencing_mode, partner_rate, agent_rate,
  pandadoc_document_id, deed_state, payment_state, deed_attempts, deed_generating_since, withdrawn_at
)
select
  ('96000000-0000-0000-0000-0000000000' || suffix)::uuid, 'GR-SWEEP-' || suffix,
  '96000000-0000-0000-0000-0000000000b1', '96000000-0000-0000-0000-00000000000a', '96000000-0000-0000-0000-000000000001',
  'Mr', 'Sweep', name, '1990-01-01', 'sweep' || suffix || '@zzzsweep.test', '07700 900900',
  '1 Sweep Road', 'London', 'NW1 1SW', 1000, 692.31, current_date + 30,
  'paid', now() - interval '5 days', now() - paid_ago, true, 'pre_referenced_open', 0.25, 0.10,
  doc, state, pay, attempts, leased, withdrawn
from (values
  -- suffix, name,          paid_ago,               doc,      state,            pay,        attempts, leased,                    withdrawn
  ('c1', 'Plain',           interval '2 days',      null,     null,             'paid',     0,        null::timestamptz,         null::timestamptz),
  ('c2', 'Errored',         interval '2 days',      null,     'error',          'paid',     1,        null,                      null),
  ('c3', 'Hasdoc',          interval '2 days',      'DOC-X',  'awaiting_tenant','paid',     0,        null,                      null),
  ('c4', 'Justpaid',        interval '4 minutes',   null,     null,             'paid',     0,        null,                      null),
  ('c5', 'Voided',          interval '2 days',      null,     'voided',         'paid',     0,        null,                      null),
  ('c6', 'Declined',        interval '2 days',      null,     'declined',       'paid',     0,        null,                      null),
  ('c7', 'Refunded',        interval '2 days',      null,     null,             'refunded', 0,        null,                      null),
  ('c8', 'Parked',          interval '2 days',      null,     'error',          'paid',     3,        null,                      null),
  ('c9', 'Leasednow',       interval '2 days',      null,     null,             'paid',     0,        now() - interval '10 seconds', null),
  ('ca', 'Leasedstale',     interval '2 days',      null,     null,             'paid',     0,        now() - interval '1 hour', null)
) v(suffix, name, paid_ago, doc, state, pay, attempts, leased, withdrawn);

-- ---------------------------------------------------------------------------
-- WHAT IT FINDS.
-- ---------------------------------------------------------------------------
select ok(exists (select 1 from public.deeds_awaiting_generation() where guarantee_ref = 'GR-SWEEP-c1'),
  'a paid application with no document and nothing wrong with it');

select ok(exists (select 1 from public.deeds_awaiting_generation() where guarantee_ref = 'GR-SWEEP-c2'),
  'a previous failure is swept again, because a failure is retried and not buried');

select ok(exists (select 1 from public.deeds_awaiting_generation() where guarantee_ref = 'GR-SWEEP-ca'),
  'and one whose lease went stale, or a crashed run would lock it out for ever');

-- ---------------------------------------------------------------------------
-- WHAT IT MUST NOT FIND. Every one of these is a document that would otherwise
-- be created wrongly, and an email sent to a real tenant.
-- ---------------------------------------------------------------------------
select ok(not exists (select 1 from public.deeds_awaiting_generation() where guarantee_ref = 'GR-SWEEP-c3'),
  'not one that already has a document, which is the one-document guarantee');

select ok(not exists (select 1 from public.deeds_awaiting_generation() where guarantee_ref = 'GR-SWEEP-c4'),
  'not one that paid four minutes ago: stripe-webhook is probably still generating it');

select ok(not exists (select 1 from public.deeds_awaiting_generation() where guarantee_ref = 'GR-SWEEP-c5'),
  'not a voided deed, which is a decision a person made');

select ok(not exists (select 1 from public.deeds_awaiting_generation() where guarantee_ref = 'GR-SWEEP-c6'),
  'nor a declined one');

select ok(not exists (select 1 from public.deeds_awaiting_generation() where guarantee_ref = 'GR-SWEEP-c7'),
  'not a refunded application: the money went back, so the guarantee must not be issued');

-- WITHDRAWN CANNOT ARISE, and that is worth asserting rather than simulating.
-- applications_no_stale_closure_markers forbids withdrawn_at (and expired_at) on a
-- paid or deed row, so status='paid' already implies not withdrawn. The clause in
-- deeds_awaiting_generation is therefore a belt against that constraint being
-- relaxed later, not a live filter, and a fixture pretending otherwise would be a
-- row the database will not hold.
-- Four-arg form: the third slot is the expected MESSAGE, and null there means
-- "any message with this errcode". Passing a description as the third argument
-- silently turns it into a message expectation that can never match.
select throws_ok(
  $$update public.applications set withdrawn_at = now() where guarantee_ref = 'GR-SWEEP-c1'$$,
  '23514', null,
  'a paid application cannot be marked withdrawn at all, so the sweep never meets one');

-- PARKED IS NOT A LOCK, AND IS STILL NOT SWEPT. After three consecutive failures
-- a person has been asked to look, and an hourly robot retrying a known-broken row
-- would raise an ops incident every hour and bury the alert that matters. Generate
-- on the application still works on it, which is the recovery path both rails'
-- sequences depend on, and that is asserted in a_failed_deed_is_retried.
select ok(not exists (select 1 from public.deeds_awaiting_generation() where guarantee_ref = 'GR-SWEEP-c8'),
  'not one already parked for staff after three failures');

select ok(public.claim_tenancy_deed('96000000-0000-0000-0000-0000000000c8'),
  'though that parked application can still be generated by hand, which is the ruling');

select ok(not exists (select 1 from public.deeds_awaiting_generation() where guarantee_ref = 'GR-SWEEP-c9'),
  'and not one somebody is generating right now, so the sweep is never the second presser');

-- ---------------------------------------------------------------------------
-- THE WINDOW AND THE CAP ARE ARGUMENTS, so a caller that knows better can say so.
-- ---------------------------------------------------------------------------
select ok(exists (select 1 from public.deeds_awaiting_generation(interval '1 minute') where guarantee_ref = 'GR-SWEEP-c4'),
  'the four-minute-old one is found against a one-minute window');

select is((select count(*)::int from public.deeds_awaiting_generation(interval '30 minutes', 1)), 1,
  'the cap is honoured, so one bad afternoon cannot fire a hundred documents at once');

-- OLDEST FIRST. A backlog should clear in the order the tenants paid, because the
-- person who has waited longest is the one being let down most.
--
-- Asserted as a PROPERTY of the returned list rather than by naming a row. This
-- file runs against a database that already holds candidates of its own, so
-- "the first row is my fixture" is a claim about the rest of the table, not about
-- the ordering. Non-decreasing paid_at is the actual guarantee and is true
-- whatever else is in there.
select is(
  (select count(*)::int from (
     select paid_at, lag(paid_at) over (order by rn) as prev
       from (select paid_at, row_number() over () as rn
               from public.deeds_awaiting_generation(interval '30 minutes', 100)) t
   ) u where prev is not null and paid_at < prev),
  0,
  'and they come back oldest first, so a backlog clears in the order people paid');

select * from finish();
rollback;
