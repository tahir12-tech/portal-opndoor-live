-- THE TENANCY IS THE FIRING UNIT.
--
-- One guarantee over one property gets ONE deed, named for everybody on it,
-- generated only when everybody has paid, reminded and expired once. The
-- single-tenant path is asserted to be unchanged in the same file, because
-- "unchanged" is a claim and a claim needs a test.
--
-- The lead-election assertions are here because the first implementation elected
-- "the earliest created" applicant: every applicant on a joint tenancy is
-- inserted in ONE transaction, so created_at ties for all of them and the lead
-- was whichever row drew the lowest random uuid.

begin;
select plan(15);

-- is_house_route, because these fixtures are inserted directly and carry no
-- referrer: assert_application_attributed refuses an unattributed application on
-- any other kind of partner, which is exactly the guard it exists to be.
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route)
values ('92000000-0000-0000-0000-000000000001', 'zzz-tenancy-rail', 'Tenancy Rail', 'opndoor_referenced', 0.25, 0.10, true);
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

select is((select lead_id from public.tenancy_deed_target('92000000-0000-0000-0000-00000000000a')),
  '92000000-0000-0000-0000-00000000000a'::uuid, 'a solo application is its own lead');
select ok((select ready from public.tenancy_deed_target('92000000-0000-0000-0000-00000000000a')),
  'and is always ready: its payment gate belongs to the caller, unchanged');
select is((select tenant_names from public.tenancy_deed_target('92000000-0000-0000-0000-00000000000a')),
  'Solo Tenant', 'the deed names exactly the one person, character for character');
select is((select tenant_count from public.tenancy_deed_target('92000000-0000-0000-0000-00000000000a')),
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
select is((select tenant_names from public.tenancy_deed_target('92000000-0000-0000-0000-000000000011')),
  'Amelia Hartley, Daniel Okafor',
  'the one deed names them in the order the agent entered them, asked from either applicant');

-- HALF PAID: no deed.
update public.applications set paid_at = now() where id = '92000000-0000-0000-0000-0000000000ff';
select ok(not (select ready from public.tenancy_deed_target('92000000-0000-0000-0000-0000000000ff')),
  'one tenant paid is not a guarantee: no deed yet');
select is((select unpaid_count from public.tenancy_deed_target('92000000-0000-0000-0000-000000000011')),
  1, 'and the wait is expressed as the tenancy, not as two applications');

-- FULLY PAID: one deed, and only one caller may generate it.
update public.applications set paid_at = now() where id = '92000000-0000-0000-0000-000000000011';
select ok((select ready from public.tenancy_deed_target('92000000-0000-0000-0000-000000000011')),
  'everybody paid: the tenancy is ready for its deed');
select is(
  (select public.claim_tenancy_deed('92000000-0000-0000-0000-0000000000ff')::text
       || ',' || public.claim_tenancy_deed('92000000-0000-0000-0000-000000000011')::text),
  'true,false',
  'two payment events landing together produce one deed, not two');

select * from finish();
rollback;
