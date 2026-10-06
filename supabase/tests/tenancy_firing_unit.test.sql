-- WHAT SURVIVED THE FIRING-UNIT RULING.
--
-- This file used to assert "the tenancy is the firing unit": one deed for the
-- whole let, carried by an elected lead, generated only once everybody had
-- paid. That ruling is superseded. Each tenant now signs their own deed, for
-- their own share, as soon as THEY have paid, and the replacement rule is
-- asserted in deed_per_tenant.test.sql.
--
-- The assertions kept here are the ones the supersession did NOT touch, and
-- they are worth keeping precisely because it would be easy to assume otherwise:
--
--   APPORTIONMENT   still the one implementation, and now used for the share of
--                   RENT as well as the share of the fee.
--   TENANT NAMES    still assembled per tenancy: every deed names everybody, so
--                   the document says what it is part of.
--   LEAD ELECTION   still meaningful, and still worth the test that found the
--                   original bug: every applicant on a joint tenancy is inserted
--                   in ONE transaction, so created_at ties and an election that
--                   falls through to the uuid picks whoever drew the lowest one.
--                   "Lead" no longer means "carries the deed"; it means first
--                   entered, and it still anchors tenancy-level ordering.
--   THE SOLO PATH   unchanged, which is a claim and therefore a test.
--
-- Deleted with the ruling: the readiness gate on the whole tenancy, and the
-- lead-carries-the-deed target. Both now live in deed_per_tenant.test.sql,
-- asserting the opposite.

begin;
select plan(17);

-- is_house_route, because these fixtures are inserted directly and carry no
-- referrer: assert_application_attributed refuses an unattributed application on
-- any other kind of partner, which is exactly the guard it exists to be.
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route, partner_kind)
values ('92000000-0000-0000-0000-000000000001', 'zzz-tenancy-rail', 'Tenancy Rail', 'opndoor_referenced', 0.25, 0.10, true, 'agency');
insert into public.agencies (id, partner_id, name)
values ('92000000-0000-0000-0000-000000000003', '92000000-0000-0000-0000-000000000001', 'Tenancy Agency');
insert into public.branches (id, agency_id, partner_id, name)
values ('92000000-0000-0000-0000-000000000004', '92000000-0000-0000-0000-000000000003', '92000000-0000-0000-0000-000000000001', 'Tenancy Branch');

-- ---------------------------------------------------------------------------
-- APPORTIONMENT. One fee, N shares, to the penny, the last taking the rounding.
-- ---------------------------------------------------------------------------
select is(public.apportion(1000.01, array[50,50]::numeric[]), array[500.01, 500.00]::numeric[],
  'an odd penny goes to the last share rather than vanishing');
select is(public.apportion(100, array[33.333,33.333,33.334]::numeric[]), array[33.33, 33.33, 33.34]::numeric[],
  'three thirds of a hundred still make a hundred');
select is((select sum(x) from unnest(public.apportion(2307.69, array[40,35,25]::numeric[])) x), 2307.69::numeric,
  'the parts sum to exactly the whole, which is the only property that matters');
select is(public.apportion(2450, array[100]::numeric[]), array[2450.00]::numeric[],
  'one tenant takes the whole fee');

-- ---------------------------------------------------------------------------
-- A SOLO APPLICATION is its own tenancy of one, and nothing about it moves.
-- ---------------------------------------------------------------------------
insert into public.applications (
  id, guarantee_ref, branch_id, agency_id, partner_id,
  tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
  prop_addr1, prop_city, prop_postcode, monthly_rent, fee_amount, tenancy_start, status, livemode, referencing_mode,
  partner_rate, agent_rate
) values (
  '92000000-0000-0000-0000-00000000000a', 'GR-TEST-SOLO',
  '92000000-0000-0000-0000-000000000004', '92000000-0000-0000-0000-000000000003', '92000000-0000-0000-0000-000000000001',
  'Ms', 'Solo', 'Tenant', '1990-01-01', 'solo@example.test', '07700 900000',
  '1 Test Road', 'London', 'NW1 8LH', 2000, 2000, current_date + 30, 'sent', true, 'opndoor_referenced',
  0.25, 0.10);

select is((select application_id from public.deed_target('92000000-0000-0000-0000-00000000000a')),
  '92000000-0000-0000-0000-00000000000a'::uuid, 'a solo application is its own deed target');

/* A BEHAVIOUR CHANGE WORTH NAMING. This used to assert that a solo application
   was ALWAYS ready, on the reasoning that its payment gate belonged to the
   caller: stripe-webhook only reaches generateDeed on the paid transition, and
   the manual retry paths deliberately did not re-check. The ruling is now "a
   deed is generated once THAT tenant has paid", with no exemption, so the gate
   moved into the function and an unpaid solo application is not ready. Every
   real caller still passes, because all four of them act on rows that have
   paid; what closes is the gap where a hand-called retry could have generated a
   deed for an unpaid application. */
select ok(not (select ready from public.deed_target('92000000-0000-0000-0000-00000000000a')),
  'an unpaid solo application is NOT ready: the gate is payment, with no exemption');
update public.applications set paid_at = now() where id = '92000000-0000-0000-0000-00000000000a';
select ok((select ready from public.deed_target('92000000-0000-0000-0000-00000000000a')),
  'and is ready the moment it has paid');

/* BYTE IDENTITY, and where it now lives. tenant_names is NULL for a tenancy of
   one, which is what makes createAndSend fall back to the applicant's own name
   and omit the two joint-only merge tokens. The old function returned the name
   here and pandadoc.ts discarded it when tenant_count was 1; the answer on the
   document is character-for-character the same, decided one layer earlier. */
select is((select tenant_names from public.deed_target('92000000-0000-0000-0000-00000000000a')),
  null, 'a solo deed has no tenancy name list, so the token falls back to the applicant');
select is((select co_tenant_names from public.deed_target('92000000-0000-0000-0000-00000000000a')),
  null, 'and no co-tenants, which is what drops the two joint-only tokens entirely');
select is((select tenant_count from public.deed_target('92000000-0000-0000-0000-00000000000a')),
  1, 'a tenancy of one counts as one, not zero');

-- ---------------------------------------------------------------------------
-- A JOINT TENANCY. Tenant 1 leads, however the uuids fall.
-- ---------------------------------------------------------------------------
insert into public.tenancies (id, monthly_rent, tenancy_start, prop_addr1, prop_city, prop_postcode)
values ('92000000-0000-0000-0000-0000000000f0', 2000, current_date + 30, '14 Chalcot Road', 'London', 'NW1 8LH');

-- The uuids are DELIBERATELY out of entry order: tenant 1 has the higher id, so
-- an election that falls through to the uuid picks the wrong person.
insert into public.applications (
  id, guarantee_ref, tenancy_id, tenancy_position, share_percent, share_amount,
  branch_id, agency_id, partner_id,
  tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
  prop_addr1, prop_city, prop_postcode, monthly_rent, fee_amount, tenancy_start, status, livemode, referencing_mode,
  partner_rate, agent_rate
) values
  ('92000000-0000-0000-0000-0000000000ff', 'GR-TEST-J1', '92000000-0000-0000-0000-0000000000f0', 1, 50, 1000,
   '92000000-0000-0000-0000-000000000004', '92000000-0000-0000-0000-000000000003', '92000000-0000-0000-0000-000000000001',
   'Ms', 'Amelia', 'Hartley', '1994-03-11', 'amelia@example.test', '07700 900111',
   '14 Chalcot Road', 'London', 'NW1 8LH', 2000, 1153.85, current_date + 30, 'sent', true, 'opndoor_referenced', 0.25, 0.10),
  ('92000000-0000-0000-0000-000000000011', 'GR-TEST-J2', '92000000-0000-0000-0000-0000000000f0', 2, 50, 1000,
   '92000000-0000-0000-0000-000000000004', '92000000-0000-0000-0000-000000000003', '92000000-0000-0000-0000-000000000001',
   'Mr', 'Daniel', 'Okafor', '1992-07-02', 'daniel@example.test', '07700 900222',
   '14 Chalcot Road', 'London', 'NW1 8LH', 2000, 1153.84, current_date + 30, 'sent', true, 'opndoor_referenced', 0.25, 0.10);

select ok(public.is_tenancy_lead('92000000-0000-0000-0000-0000000000ff'),
  'Tenant 1 leads the tenancy even though their uuid sorts last');
select ok(not public.is_tenancy_lead('92000000-0000-0000-0000-000000000011'),
  'and Tenant 2 does not');
select is((select tenant_names from public.deed_target('92000000-0000-0000-0000-000000000011')),
  'Amelia Hartley, Daniel Okafor',
  'the one deed names them in the order the agent entered them, asked from either applicant');

update public.applications set paid_at = now() where id = '92000000-0000-0000-0000-0000000000ff';
-- HALF PAID. Under the old ruling neither tenant could have a deed while the
-- other had not paid, and that was the point of the gate. Now the paid tenant
-- gets theirs and the unpaid one does not: deed_per_tenant.test.sql asserts both
-- halves. What is still true, and still needed by the screen, is that the
-- tenancy knows how many are outstanding.
select is((select unpaid_count from public.deed_target('92000000-0000-0000-0000-000000000011')),
  1, 'one of the two is still to pay, and the tenancy says so');

update public.applications set paid_at = now() where id = '92000000-0000-0000-0000-000000000011';
select ok((select ready from public.deed_target('92000000-0000-0000-0000-000000000011')),
  'and once they have, they are ready for their own deed');

-- THE RACE GUARD, which survives the ruling with its meaning narrowed. It used
-- to stop two payment events for the same TENANCY generating two documents for
-- one deed; each tenant now has a deed of their own, so the race it guards is
-- the ordinary one, two deliveries of the SAME tenant's event. Claiming twice
-- for one application still yields exactly one generation.
select is(
  (select public.claim_tenancy_deed('92000000-0000-0000-0000-0000000000ff')::text
       || ',' || public.claim_tenancy_deed('92000000-0000-0000-0000-0000000000ff')::text),
  'true,false',
  'the same payment event delivered twice produces one deed, not two');
select ok(public.claim_tenancy_deed('92000000-0000-0000-0000-000000000011'),
  'and the co-tenant claims their OWN deed independently, which is the ruling');

select * from finish();
rollback;
