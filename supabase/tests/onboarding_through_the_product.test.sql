-- ONBOARDING HAPPENS THROUGH THE PRODUCT, NOT THROUGH SQL.
--
-- The question this answers is Matt's: can an admin stand up a supplier, or an
-- agency in any of its three shapes, from the screens, and does it land? Every
-- call below is the RPC a button calls, made as a signed-in opndoor admin with
-- RLS on. Nothing here is written as service_role, because a walk that bypasses
-- the boundary proves nothing about the product.
--
-- WALKED AGAINST DEV FIRST, and this file is that walk made repeatable. The live
-- walk created ZZZ Walk Supplier, ZZZ Walk Group, ZZZ Walk Independent and
-- ZZZ Walk InGroup, then a real referral against the new branch, which is the
-- assertion that matters: onboarding is not finished when rows exist, it is
-- finished when the thing you built can take a referral and price it.
--
-- WHAT THIS FILE CANNOT COVER, said plainly. The first user's INVITE goes
-- through the invite-user edge function over HTTP, and every write path in this
-- product is AAL2-gated, so it cannot be driven from SQL or from a session
-- without a verified second factor. The invite's authorisation is asserted
-- instead in the_level_ladder.test.sql (assert_may_grant_level) and its refusal
-- was confirmed live against dev: as a Negotiator, invite-user answers
-- "Not permitted."

begin;
select plan(16);

-- Every call below is made as an opndoor admin, which is who onboards.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('99000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'onboard@zzzwalk.test', '', now(), now(), now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('99000000-0000-0000-0000-0000000000a1', 'Ada Onboarder', 'onboard@zzzwalk.test', 'superadmin', null, 'active', true);

/* ACT AS THE ADMIN, THEN ASSERT AS THE TEST.

   Every create below runs as a signed-in admin with RLS on, which is the point:
   it proves the product's own path. The assertions then reset the role, because
   `authenticated` holds no table grant on partners or agencies at all: the
   screens read them through hydrate's RPCs, not off the tables. Asserting as
   authenticated would therefore fail on a permission that has nothing to do
   with whether onboarding worked. */
select set_config('request.jwt.claims',
  '{"sub":"99000000-0000-0000-0000-0000000000a1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ---------------------------------------------------------------------------
-- A SUPPLIER, from the Suppliers page. Name, referencing mode, both rates and
-- API access are all set in the one call the form makes.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select public.create_partner('ZZZ Onboard Supplier','onboarding',null,0.30,0.12,'pre_referenced_screened',true,true)$$,
  'an admin can create a supplier from the Suppliers page');

reset role;
select is((select referencing_mode from public.partners where name = 'ZZZ Onboard Supplier'),
  'pre_referenced_screened', 'with the referencing mode it was given');
select is((select partner_rate from public.partners where name = 'ZZZ Onboard Supplier'),
  0.30::numeric, 'and the supplier rate');
select is((select agent_rate from public.partners where name = 'ZZZ Onboard Supplier'),
  0.12::numeric, 'and the agent rate');
select ok((select api_access_enabled from public.partners where name = 'ZZZ Onboard Supplier'),
  'and API access, which is a capability and not a key');

-- THE CRM MAPPING IS NOT A MANUAL STEP, and this is the assertion that says so.
-- Seven partners once held sync cursors with no map row, because the cursor had
-- a trigger and the map did not, so the sync ran every two minutes and wrote
-- nothing while reporting success. 20261005250000 backfilled them and added the
-- mirroring trigger. A partner created through the product is mapped by the time
-- the call returns. This is also what corrects HANDOVER 10.2, which told Balal
-- to insert these rows by hand.
select ok(
  exists (select 1 from public.hubspot_partner_map m
           join public.partners p on p.id = m.partner_id
          where p.name = 'ZZZ Onboard Supplier' and m.active),
  'and it is mapped for the CRM sync on creation, with no second step');

-- ---------------------------------------------------------------------------
-- AN AGENCY, IN ALL THREE SHAPES.
-- ---------------------------------------------------------------------------
-- 1. Independent: an agency and its first office, under no group.
set local role authenticated;
select lives_ok(
  $$select public.admin_create_agency_and_branch('ZZZ Onboard Independent','Onboard High Street',null,null,null,'opndoor-agents',null)$$,
  'shape one: an independent agency with its first office');
reset role;
select is((select group_id from public.agencies where name = 'ZZZ Onboard Independent'), null,
  'which belongs to no group, because that is what independent means');
select is((select count(*)::int from public.branches b join public.agencies a on a.id = b.agency_id
            where a.name = 'ZZZ Onboard Independent'), 1,
  'and has exactly the one office it was given');

-- 2. A group, with an agency and a branch inside it.
set local role authenticated;
select lives_ok(
  $$select public.create_agency_group('opndoor-agents','ZZZ Onboard Group')$$,
  'shape two: a group');
select lives_ok(
  $$select public.admin_create_agency_and_branch('ZZZ Onboard InGroup','Onboard Group Office',null,null,null,'opndoor-agents',
      (select id from public.agency_groups where name = 'ZZZ Onboard Group'))$$,
  'with an agency and an office created inside it');
reset role;
select is(
  (select g.name from public.agencies a join public.agency_groups g on g.id = a.group_id
    where a.name = 'ZZZ Onboard InGroup'),
  'ZZZ Onboard Group', 'and the agency sits under that group');

-- 3. An existing agency joining an existing group.
set local role authenticated;
select lives_ok(
  $$select public.set_agency_group(
      (select id from public.agencies where name = 'ZZZ Onboard Independent'),
      (select id from public.agency_groups where name = 'ZZZ Onboard Group'))$$,
  'shape three: an existing agency joins an existing group');
reset role;
select is(
  (select g.name from public.agencies a join public.agency_groups g on g.id = a.group_id
    where a.name = 'ZZZ Onboard Independent'),
  'ZZZ Onboard Group', 'and it is in the group now, with its office intact');

-- ---------------------------------------------------------------------------
-- AND THE THING YOU BUILT CAN TAKE A REFERRAL, which is the only test of
-- onboarding that matters. Rows existing is not the same as an agency working:
-- the branch has to resolve a route, a referencing mode and a price.
-- ---------------------------------------------------------------------------
set local role authenticated;
select lives_ok(
  $$select public.create_referral(
      (select id from public.branches where name = 'Onboard Group Office'),
      'Ms','Onboard','Tenant','1990-01-01','onboard.tenant@example.com','07700 900998',
      '1 Onboard Road',null,'London',null,'NW1 1OB', 1500, current_date + 30)$$,
  'a referral can be sent against the newly created office straight away');

-- PRICED AT ONE MONTH, EXACTLY. A new agency is on standard terms, and standard
-- terms are the rent: £1,500 on a £1,500 rent, answering unit 'months' rather
-- than 4.35 weeks. This is 20261006120000 working on a path nobody special-cased
-- for it.
reset role;
select is(
  (select fee_amount || ' ' || fee_basis_unit from public.applications
    where prop_postcode = 'NW1 1OB'),
  '1500.00 months',
  'and it is priced at exactly one month''s rent, said as a month');

select * from finish();
rollback;
