-- R7. THE PARTNER API PRICES A REFERRAL EXACTLY AS THE PORTAL DOES.
--
-- Matt, 2026-09-29: "the partner API must work out the fee and commission
-- exactly as the portal does when the tenant pays, which is every route
-- today. Where a supplier is set so that someone other than the tenant pays,
-- the API refuses the application with a clear message until Matt decides how
-- that payment works; do not build that payment path."
--
-- WHAT WAS WRONG. `create_referral_api` read `partners.partner_rate` and
-- `partners.agent_rate` straight off the partner row and wrote them onto the
-- application, and set NO fee at all: `fee_amount`, `fee_basis_weeks`,
-- `fee_basis_unit` and `pricing_agreement_id` were all left null. So an
-- API-created referral ignored every pricing agreement, every negotiated
-- band, and the agency's own rate, and carried no record of what it was
-- charging or why.
--
-- The portal path, `create_referral`, resolves all of it -- resolve_fee,
-- resolve_rates, commission_total on the estate, and freeze_commission_lines.
-- "Exactly as the portal does" therefore means CALLING those, not writing a
-- second implementation that happens to agree today. Assertion 4 is the one
-- that enforces that reading: the two paths are run side by side over the
-- same branch and asserted EQUAL, so any future change to the portal's
-- pricing that misses the API breaks this test rather than the invoice.
--
-- THE REFUSAL. There is today no setting anywhere that says somebody other
-- than the tenant pays -- Matt's own "which is every route today" -- and
-- NM-A, which would add one, is parked. So the guard is written as a
-- fail-closed allowlist over the column that DOES describe the payment
-- journey, `referencing_mode`: the three known modes all end with the tenant
-- paying, and anything else is refused with the message Matt asked for. No
-- payment path is built, and nothing is decided on his behalf.

begin;
select plan(9);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled, partner_kind)
values ('cf000000-0000-0000-0000-0000000000d1','zzz-r7-supplier','ZZZ R7 Supplier',
        'pre_referenced_open', 0.30, 0.10, false, false, true, true, 'supplier');

-- An agency priced by AGREEMENT, which is precisely what the API ignored.
insert into public.agencies (id, partner_id, name, agent_rate) values
  ('cf000000-0000-0000-0000-0000000000a1','cf000000-0000-0000-0000-0000000000d1','ZZZ R7 Agency', null);
insert into public.branches (id, agency_id, partner_id, name) values
  ('cf000000-0000-0000-0000-0000000000b1','cf000000-0000-0000-0000-0000000000a1',
   'cf000000-0000-0000-0000-0000000000d1','ZZZ R7 Office');

insert into public.pricing_agreements (id, scope_level, scope_id, effective_from, is_standard)
values ('cf000000-0000-0000-0000-0000000000e1','agency','cf000000-0000-0000-0000-0000000000a1',
        current_date - 10, false);
-- Three weeks of rent at 20%: NOT the partner's one month at 10%.
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, agent_rate)
values ('cf000000-0000-0000-0000-0000000000e1', 1, null, 3.00, 0.20);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('cf000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.r7.api@r.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('cf000000-0000-0000-0000-00000000c001','ZZZ R7 API User','zzz.r7.api@r.test','referrer',
   'cf000000-0000-0000-0000-0000000000d1','active',false);

-- ===========================================================================
-- 1-3. THE API RESOLVES A FEE AT ALL, AND IT IS THE AGREEMENT'S.
-- A GBP 2,400 rent at three weeks is GBP 1,661.54, not one month's 2,400.
-- ===========================================================================
create temp table _api on commit drop as
select * from public.create_referral_api(
  'cf000000-0000-0000-0000-0000000000d1', true, 'cf000000-0000-0000-0000-00000000c001',
  'cf000000-0000-0000-0000-0000000000b1','Mx','Api','Priced','1990-01-01',
  'zzz.r7.api.t@r.test','07700900990','1 Api Street',null,'London',null,'AP1 1AA',
  2400, current_date + 30);

select isnt(
  (select fee_amount from _api), null,
  'the API resolves a fee at all, which it did not before');

select is(
  (select fee_basis_weeks from _api), 3.00::numeric,
  'and it is the agreement''s three-week basis, not the partner''s standard month');

/* AND HERE IS SOMETHING THE FIX DELIBERATELY DID NOT CHANGE.
   The band says agent_rate 0.20, and the rate that lands is 0.10 -- the
   partner's flat rate. On the SUPPLIER rail an agreement's band sets the FEE
   BASIS and not the agent rate; the band's rate is applied by
   commission_total, which only runs on the agency estate.

   This assertion therefore pins what the product actually does, not what
   looks right. Two reasons for that. It is the same figure the PORTAL
   produces -- assertion 4 proves the two agree -- so changing it here would
   have made the API disagree with the portal, which is the opposite of what
   Matt asked for. And whether a supplier-rail band ought to move the agent
   rate is a commercial question about money, not a defect: it is raised as
   NM-J rather than decided inside a fix to the API. */
select is(
  (select agent_rate from _api), 0.10::numeric,
  'the agent rate is the partner''s flat rate, because a supplier-rail band sets the basis and not the rate (NM-J)');

-- ===========================================================================
-- 4. THE ASSERTION THAT MAKES "EXACTLY AS THE PORTAL DOES" MEAN SOMETHING.
-- Same branch, same rent, same tenancy: the two paths must agree on every
-- figure. A second implementation that merely agrees today fails this the
-- moment either side changes.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"cf000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

create temp table _portal on commit drop as
select * from public.create_referral(
  'cf000000-0000-0000-0000-0000000000b1','Mx','Portal','Priced','1990-01-01',
  'zzz.r7.portal.t@r.test','07700900991','2 Api Street',null,'London',null,'AP2 2AA',
  2400, current_date + 30);

reset role;

select is(
  (select array[fee_amount, fee_basis_weeks, partner_rate, agent_rate] from _api),
  (select array[fee_amount, fee_basis_weeks, partner_rate, agent_rate]
     from public.applications where tenant_email = 'zzz.r7.portal.t@r.test'),
  'the API and the portal price the same referral identically, figure for figure');

select is(
  (select pricing_agreement_id from _api),
  'cf000000-0000-0000-0000-0000000000e1'::uuid,
  'and the API records WHICH agreement it charged under, as the portal does');

select is(
  (select fee_basis_unit from _api), 'weeks',
  'and the unit comes out with the quantity, so the basis cannot be misread');

-- ===========================================================================
-- 7-8. THE REFUSAL Matt asked for. Today every route is tenant-pays, so this
-- is proven by forcing the one field that describes the payment journey to a
-- value outside the known set. No payment path is built.
-- ===========================================================================
select is(
  (select count(*) from public.partners
    where referencing_mode not in ('pre_referenced_open','pre_referenced_screened','opndoor_referenced')),
  0::bigint,
  'every route today is one of the three the tenant pays on, which is Matt''s own statement');

-- The CHECK constraint stops a bad mode being stored, so the guard is proven
-- against the function that reads it rather than against a row that cannot
-- exist. This is the honest way to test a fail-closed allowlist.
--
-- AS `authenticated`, not as the owner. The guard is a plain plpgsql raise
-- and the role makes no difference to it, but a refusal asserted while
-- running as postgres is the shape that passes vacuously elsewhere, and
-- testsRunAsTheirRole rightly refuses to distinguish. Running it as the real
-- caller costs nothing and proves slightly more.
select set_config('request.jwt.claims',
  '{"sub":"cf000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select throws_ok(
  $$select public.assert_tenant_pays('someone_else_pays')$$,
  '42501',
  'This supplier is set so that someone other than the tenant pays the fee. Opndoor has not yet agreed how that payment is collected, so this referral cannot be accepted through the API yet.',
  'an unknown payment arrangement is refused, in words a partner can act on');

select lives_ok(
  $$select public.assert_tenant_pays('pre_referenced_open')$$,
  'while every arrangement that exists today passes straight through');

reset role;
select * from finish();
rollback;
