-- THE RATE ROUTES A MANAGER COULD STILL REACH.
--
-- manager_sees_no_commission.test.sql enumerates the four routes 20261005170000
-- gated, and its header names four MORE it deliberately did not gate:
-- commission_total, resolve_rates, commission_split, freeze_commission_lines.
-- Not gating them was right (create_referral calls commission_total under the
-- referring user's own auth.uid(), and gating it would make a Manager's
-- referrals worthless) but they were also GRANTED to authenticated, which made
-- them endpoints rather than helpers. Proved on dev before 20261005220000:
--
--   select * from public.commission_split(<branch>, <partner>, 1);
--     --> (agency, "Regent's Lettings", 0.2000, agreement)
--
-- And three tables stated a rate to anyone whose RLS let them read the row:
-- application_commission_lines (which hydrate.ts fetches on EVERY sign-in),
-- pricing_agreement_bands, and commission_tiers.
--
-- This file is the second half of the enumeration. It asserts the grant and the
-- rows, where the other file asserts the functions' answers.

begin;
select plan(11);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route)
values ('93000000-0000-0000-0000-000000000001', 'zzz-routes', 'ZZZ Routes', 'opndoor_referenced', 0.25, 0.10, true);
insert into public.agencies (id, partner_id, name)
values ('93000000-0000-0000-0000-00000000000a', '93000000-0000-0000-0000-000000000001', 'ZZZ Routes Lettings');
insert into public.branches (id, agency_id, partner_id, name)
values ('93000000-0000-0000-0000-00000000000b', '93000000-0000-0000-0000-00000000000a',
        '93000000-0000-0000-0000-000000000001', 'ZZZ Routes Park');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('93000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mgr@zzzroutes.test', '', now(), now(), now()),
  ('93000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dir@zzzroutes.test', '', now(), now(), now());

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('93000000-0000-0000-0000-00000000000d', 'Mo Manager',  'mgr@zzzroutes.test', 'management', '93000000-0000-0000-0000-000000000001', 'active', false),
  ('93000000-0000-0000-0000-00000000000e', 'Dee Director','dir@zzzroutes.test', 'management', '93000000-0000-0000-0000-000000000001', 'active', true);

insert into public.user_scopes (user_id, kind, agency_id) values
  ('93000000-0000-0000-0000-00000000000d', 'agency', '93000000-0000-0000-0000-00000000000a'),
  ('93000000-0000-0000-0000-00000000000e', 'agency', '93000000-0000-0000-0000-00000000000a');

insert into public.applications (
  id, guarantee_ref, branch_id, agency_id, partner_id, referrer_id,
  tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
  prop_addr1, prop_city, prop_postcode, monthly_rent, fee_amount, tenancy_start,
  status, sent_at, paid_at, partner_rate, agent_rate, livemode, referencing_mode
) values (
  '93000000-0000-0000-0000-00000000000c', 'GR-ROUTES-1',
  '93000000-0000-0000-0000-00000000000b', '93000000-0000-0000-0000-00000000000a',
  '93000000-0000-0000-0000-000000000001', '93000000-0000-0000-0000-00000000000e',
  'Ms', 'Tess', 'Tenant', '1990-01-01', 'tess@zzzroutes.test', '07700 900700',
  '1 Routes Road', 'London', 'NW1 1RT', 2000, 2000, current_date + 30,
  'paid', now() - interval '2 days', now() - interval '1 day', 0.25, 0.10, true, 'pre_referenced_open');

-- The frozen line, which is the row hydrate.ts asks for on every sign-in.
insert into public.application_commission_lines (application_id, level, org_id, org_name, rate, basis_amount, source)
values ('93000000-0000-0000-0000-00000000000c', 'agency', '93000000-0000-0000-0000-00000000000a',
        'ZZZ Routes Lettings', 0.1000, 2000, 'agreement');

-- And an agreement band, which states the rate the agency earns per band.
insert into public.pricing_agreements (id, scope_level, scope_id)
values ('93000000-0000-0000-0000-00000000000f', 'agency', '93000000-0000-0000-0000-00000000000a');
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, agent_rate)
values ('93000000-0000-0000-0000-00000000000f', 1, 1, 4.35, 0.1000);

-- ---------------------------------------------------------------------------
-- THE MANAGER.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-00000000000d","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select ok(not public.may_see_commission(), 'the fixture manager may not see commission');

-- THE FOUR HELPERS. Permission, not a gate: adding may_see_commission() inside
-- these would break create_referral for exactly this person.
select throws_ok(
  $$select public.commission_total(
      '93000000-0000-0000-0000-00000000000b'::uuid,
      '93000000-0000-0000-0000-000000000001'::uuid, 1)$$,
  '42501', null, 'commission_total is not callable by a signed-in user');

select throws_ok(
  $$select * from public.commission_split(
      '93000000-0000-0000-0000-00000000000b'::uuid,
      '93000000-0000-0000-0000-000000000001'::uuid, 1)$$,
  '42501', null, 'nor is commission_split, which named the rate and its source');

select throws_ok(
  $$select * from public.resolve_rates(
      '93000000-0000-0000-0000-00000000000b'::uuid,
      '93000000-0000-0000-0000-000000000001'::uuid)$$,
  '42501', null, 'nor resolve_rates');

select throws_ok(
  $$select public.freeze_commission_lines(
      '93000000-0000-0000-0000-00000000000c'::uuid,
      '93000000-0000-0000-0000-00000000000b'::uuid,
      '93000000-0000-0000-0000-000000000001'::uuid, 1, 2000)$$,
  '42501', null, 'nor freeze_commission_lines, which would have written one');

-- THE THREE TABLES.
select is((select count(*)::int from public.application_commission_lines
            where application_id = '93000000-0000-0000-0000-00000000000c'),
  0, 'the frozen commission line is not readable, though hydrate asks for it');

select is((select count(*)::int from public.pricing_agreement_bands
            where agreement_id = '93000000-0000-0000-0000-00000000000f'),
  0, 'nor the agreement band that states the rate');

select is((select count(*)::int from public.commission_tiers), 0,
  'nor any volume tier');

-- ---------------------------------------------------------------------------
-- THE DIRECTOR, or none of the above means anything.
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-00000000000e","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is((select count(*)::int from public.application_commission_lines
            where application_id = '93000000-0000-0000-0000-00000000000c'),
  1, 'a Director still reads the frozen line');

select is((select count(*)::int from public.pricing_agreement_bands
            where agreement_id = '93000000-0000-0000-0000-00000000000f'),
  1, 'and the agreement band');

-- AND THE WORK STILL WORKS. The helpers are off the grant for everybody, so this
-- is the assertion that proves that was safe: create_referral is SECURITY
-- DEFINER and calls commission_total as its OWNER, which keeps its own rights.
-- If the revoke had broken that, a Manager would be creating referrals that earn
-- the agency nothing, silently, which is the exact trap 20261005170000 avoided.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-00000000000d","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$select public.create_referral(
      '93000000-0000-0000-0000-00000000000b', 'Mr', 'New', 'Referral', '1991-02-02',
      'new.referral@zzzroutes.test', '07700 900701', '2 Routes Road', null, 'London',
      null, 'NW1 1RT', 2000, current_date + 45)$$,
  'and a Manager can still send a referral, which is what the grant had to keep');

select * from finish();
rollback;
