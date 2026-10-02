-- A MANAGER CANNOT OBTAIN A COMMISSION FIGURE BY ANY ROUTE.
--
-- The ruling gives an agency three levels. A Manager reaches every referral,
-- every branch and the team, and is shown no commission anywhere. That is a
-- claim about the DATABASE, not about screens: a screen can be read around,
-- and the person most likely to try is the one who used to be able to see it.
--
-- So this file enumerates the routes rather than testing a feature. There are
-- exactly four functions a signed-in user can call that yield a rate, because
-- applications.partner_rate and applications.agent_rate came off the
-- authenticated table grant entirely in 20260815030000 and cannot be selected:
--
--   application_commission_rates   the per-application snapshot
--   my_partner_rates               the partner's own rates
--   commission_split_batch         the payout table
--   commission_preview             the rate editor's what-if
--
-- Each is asserted twice, once as a Director and once as a Manager, because
-- "returns nothing" is only meaningful beside a case where it returns
-- something. A test that only checked the Manager would pass just as happily
-- against a function that was broken for everybody.
--
-- AND THE OTHER HALF, which is the one that would actually have shipped
-- broken: a Manager must still be able to CREATE a referral that earns their
-- agency the right commission. create_referral freezes the rate by calling
-- commission_total, running as SECURITY DEFINER but with the Manager's own
-- auth.uid(). Gating that function too, which is the obvious move, would have
-- had Managers silently creating referrals worth nothing.

begin;
select plan(14);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route, partner_kind)
values ('97000000-0000-0000-0000-000000000001', 'zzz-levels', 'Levels Estate', 'opndoor_referenced', 0.25, 0.10, true, 'agency');
insert into public.agencies (id, partner_id, name)
values ('97000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001', 'Levels Lettings');
insert into public.branches (id, agency_id, partner_id, name)
values ('97000000-0000-0000-0000-000000000003', '97000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001', 'Levels Branch');

-- Two people, same scope, same partner, same everything but the one bit.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('97000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'director@zzzlevels.test', '', now(), now(), now()),
  ('97000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manager@zzzlevels.test', '', now(), now(), now());

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('97000000-0000-0000-0000-00000000000d', 'Dee Director', 'director@zzzlevels.test', 'management', '97000000-0000-0000-0000-000000000001', 'active', true),
  ('97000000-0000-0000-0000-00000000000e', 'Mo Manager',   'manager@zzzlevels.test',  'management', '97000000-0000-0000-0000-000000000001', 'active', false);

-- BOTH HOLD THE SAME POSITION. On the agent rail, reach is granted by a
-- position and not by sharing a partner (app_reachable_agency), so without
-- these the Director could not see her own payout table either and the test
-- would prove nothing about the capability. Same agency, same level, so the
-- only difference between these two people remains the one bit.
insert into public.user_scopes (user_id, kind, agency_id) values
  ('97000000-0000-0000-0000-00000000000d', 'agency', '97000000-0000-0000-0000-000000000002'),
  ('97000000-0000-0000-0000-00000000000e', 'agency', '97000000-0000-0000-0000-000000000002');

insert into public.applications (
  id, guarantee_ref, branch_id, agency_id, partner_id, referrer_id,
  tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
  prop_addr1, prop_city, prop_postcode, monthly_rent, fee_amount, tenancy_start,
  status, sent_at, paid_at, partner_rate, agent_rate, livemode, referencing_mode
) values (
  '97000000-0000-0000-0000-00000000000a', 'GR-LVL-1',
  '97000000-0000-0000-0000-000000000003', '97000000-0000-0000-0000-000000000002',
  '97000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-00000000000d',
  'Ms', 'Tess', 'Tenant', '1990-01-01', 'tess@zzzlevels.test', '07700 900700',
  '1 Levels Road', 'London', 'NW1 1LV', 2000, 2000, current_date + 30,
  'paid', now() - interval '2 days', now() - interval '1 day', 0.25, 0.10, true, 'pre_referenced_open');

-- ---------------------------------------------------------------------------
-- THE DIRECTOR. Every route answers, which is what makes the Manager's
-- silence below mean something.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"97000000-0000-0000-0000-00000000000d","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select ok(public.may_see_commission(), 'a Director may see commission');
select is((select count(*)::int from public.application_commission_rates(null)
            where application_id = '97000000-0000-0000-0000-00000000000a'),
  1, 'and the per-application rates answer');
select is((select count(*)::int from public.my_partner_rates()), 1,
  'and the partner rates answer');
select is((select count(*)::int from public.commission_split_batch(
             array['97000000-0000-0000-0000-000000000003'::uuid])), 1,
  'and the payout split answers');
select ok((select worst_total from public.commission_preview(
             'branch', '97000000-0000-0000-0000-000000000003', 0.30)) > 0,
  'and the rate preview answers');

-- ---------------------------------------------------------------------------
-- THE MANAGER. Same scope, same partner, same application in reach.
-- ---------------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims',
  '{"sub":"97000000-0000-0000-0000-00000000000e","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select ok(not public.may_see_commission(), 'a Manager may not see commission');

-- THE APPLICATION IS STILL THEIRS. This is the assertion that stops the fix
-- from being "hide the application": a Manager reaches every referral, and
-- what is withheld is one number about it.
select is((select count(*)::int from public.applications
            where id = '97000000-0000-0000-0000-00000000000a'),
  1, 'and still sees the application itself, which is the point of the level');

select is((select count(*)::int from public.application_commission_rates(null)), 0,
  'the per-application rates give a Manager nothing');
select is((select count(*)::int from public.my_partner_rates()), 0,
  'nor do the partner rates');
select is((select count(*)::int from public.commission_split_batch(
             array['97000000-0000-0000-0000-000000000003'::uuid])), 0,
  'nor the payout split');
select is((select worst_total from public.commission_preview(
             'branch', '97000000-0000-0000-0000-000000000003', 0.30)),
  0::numeric, 'nor the rate preview');

-- Asking about somebody else's partner is not a way round it either.
select is((select count(*)::int from public.application_commission_rates(
             '97000000-0000-0000-0000-000000000001')), 0,
  'and naming the partner explicitly does not open it');

-- ---------------------------------------------------------------------------
-- BUT THE WORK STILL WORKS.
--
-- A Manager may cause commission to be computed and recorded; they may not be
-- told the answer. If create_referral were gated on the same predicate this
-- would return a null rate and the agency would earn nothing, silently.
-- ---------------------------------------------------------------------------
select lives_ok(
  $$select public.create_referral(
      '97000000-0000-0000-0000-000000000003', 'Mr', 'New', 'Referral', '1991-02-02',
      'new.referral@zzzlevels.test', '07700 900701', '2 Levels Road', null, 'London',
      null, 'NW1 1LV', 2000, current_date + 45)$$,
  'a Manager can still send a referral');

reset role;
select is(
  (select agent_rate from public.applications where tenant_email = 'new.referral@zzzlevels.test'),
  0.10::numeric,
  'and it froze the agency''s real commission, not a null');

select * from finish();
rollback;
