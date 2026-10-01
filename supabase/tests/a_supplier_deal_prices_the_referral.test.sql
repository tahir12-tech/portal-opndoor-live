-- A SUPPLIER'S DEAL PRICES THE REFERRAL, AND ONLY THE NEXT ONE.
--
-- Matt, 2026-10-01: the supplier's two deals are set with the agency editor,
-- and "Changes apply to new referrals only".
--
-- Migration: 20261007200000_a_supplier_deal_prices_the_referral.sql
--
-- =========================================================================
-- WHAT THIS IS REALLY CHECKING
-- =========================================================================
--
-- 20261007190000 stored the two deals and guarded them. They priced nothing:
-- resolve_rates, which is the single point create_referral freezes from, still
-- read the partner's flat pair. This file asserts the wiring, and the three
-- ways it could have gone wrong:
--
--   the supplier's flat pair stops working for suppliers without a deal;
--   an AGENCY's own commission agreement leaks into the supplier's margin
--     column and gets counted twice on a statement;
--   a change reprices referrals that have already been sent.

begin;
select plan(11);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route)
values ('95000000-0000-0000-0000-000000000001', 'zzz-prices', 'ZZZ Prices', 'pre_referenced_open', 0.35, 0.15, false),
       ('95000000-0000-0000-0000-000000000009', 'zzz-prices-flat', 'ZZZ Prices Flat', 'pre_referenced_open', 0.30, 0.12, false);
insert into public.agencies (id, partner_id, name)
values ('95000000-0000-0000-0000-000000000002', '95000000-0000-0000-0000-000000000001', 'ZZZ Prices Agency'),
       ('95000000-0000-0000-0000-00000000000a', '95000000-0000-0000-0000-000000000009', 'ZZZ Flat Agency');
insert into public.branches (id, agency_id, partner_id, name)
values ('95000000-0000-0000-0000-000000000003', '95000000-0000-0000-0000-000000000002', '95000000-0000-0000-0000-000000000001', 'ZZZ Prices Office'),
       ('95000000-0000-0000-0000-00000000000b', '95000000-0000-0000-0000-00000000000a', '95000000-0000-0000-0000-000000000009', 'ZZZ Flat Office');

-- ===========================================================================
-- 1. NO DEAL AT ALL: THE FLAT PAIR, EXACTLY AS BEFORE
-- ===========================================================================
/* Every supplier on the estate today is this case. If this breaks, the
   migration has repriced the whole book. */
select is(
  (select partner_rate from public.resolve_rates(
     '95000000-0000-0000-0000-00000000000b', '95000000-0000-0000-0000-000000000009')),
  0.30::numeric, 'a supplier with no deal keeps its flat total');

select is(
  (select agent_rate from public.resolve_rates(
     '95000000-0000-0000-0000-00000000000b', '95000000-0000-0000-0000-000000000009')),
  0.12::numeric, 'and its flat agents'' share');

-- ===========================================================================
-- 2. A COMMISSION DEAL PRICES THE SUPPLIER'S OWN TOTAL
-- ===========================================================================
insert into public.pricing_agreements (id, scope_level, scope_id, coverage, period, counting_scope, is_standard, effective_from, kind)
values ('95000000-0000-0000-0000-0000000000c1', 'partner', '95000000-0000-0000-0000-000000000001', 'additive', 'year', 'agency', false, current_date, 'commission');
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, fee_basis_unit, agent_rate)
values ('95000000-0000-0000-0000-0000000000c1', 1, 1, 1, 'months', 0.40),
       ('95000000-0000-0000-0000-0000000000c1', 2, null, 5, 'weeks', 0.45);

select is(
  (select partner_rate from public.resolve_rates(
     '95000000-0000-0000-0000-000000000003', '95000000-0000-0000-0000-000000000001', 1)),
  0.40::numeric, 'a sole tenancy prices at the deal''s first band, not the flat rate');

select is(
  (select partner_rate from public.resolve_rates(
     '95000000-0000-0000-0000-000000000003', '95000000-0000-0000-0000-000000000001', 2)),
  0.45::numeric, 'and a joint tenancy at the band its tenant count falls in');

/* THE SHARE IS UNTOUCHED BY THE COMMISSION DEAL. Two deals, set
   independently, is the whole instruction. */
select is(
  (select agent_rate from public.resolve_rates(
     '95000000-0000-0000-0000-000000000003', '95000000-0000-0000-0000-000000000001', 1)),
  0.15::numeric, 'while the agents'' share is still the flat one, having no deal of its own');

-- ===========================================================================
-- 3. AND A SHARE DEAL PRICES THE AGENTS' CUT
-- ===========================================================================
insert into public.pricing_agreements (id, scope_level, scope_id, coverage, period, counting_scope, is_standard, effective_from, kind)
values ('95000000-0000-0000-0000-0000000000c2', 'partner', '95000000-0000-0000-0000-000000000001', 'additive', 'year', 'agency', false, current_date, 'agent_share');
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, fee_basis_unit, agent_rate)
values ('95000000-0000-0000-0000-0000000000c2', 1, null, 1, 'months', 0.20);

select is(
  (select agent_rate from public.resolve_rates(
     '95000000-0000-0000-0000-000000000003', '95000000-0000-0000-0000-000000000001', 1)),
  0.20::numeric, 'the share deal prices the agents'' cut');

select is(
  (select partner_rate from public.resolve_rates(
     '95000000-0000-0000-0000-000000000003', '95000000-0000-0000-0000-000000000001', 1)),
  0.40::numeric, 'and the commission deal is untouched by it');

-- ===========================================================================
-- 4. A PER-AGENCY OVERRIDE BEATS THE SUPPLIER'S SHARE
-- ===========================================================================
insert into public.pricing_agreements (id, scope_level, scope_id, coverage, period, counting_scope, is_standard, effective_from, kind)
values ('95000000-0000-0000-0000-0000000000c3', 'agency', '95000000-0000-0000-0000-000000000002', 'additive', 'year', 'agency', false, current_date, 'agent_share');
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, fee_basis_unit, agent_rate)
values ('95000000-0000-0000-0000-0000000000c3', 1, null, 1, 'months', 0.10);

select is(
  (select agent_rate from public.resolve_rates(
     '95000000-0000-0000-0000-000000000003', '95000000-0000-0000-0000-000000000001', 1)),
  0.10::numeric, 'one agency under the supplier can keep less, and does');

-- ===========================================================================
-- 5. AN AGENCY'S OWN COMMISSION DEAL IS NOT THE SUPPLIER'S MARGIN
-- ===========================================================================
/* THE DOUBLE-COUNT THIS AVOIDS. On the agency rail an agency-scope commission
   agreement is what THAT AGENCY is paid, and commission_total already
   resolves it. If resolve_rates took it as the supplier's own total as well,
   the same money would appear once as the supplier's margin and once as the
   agency's commission, on every statement. Hence the scope test on the
   commission side and none on the share side. */
insert into public.pricing_agreements (id, scope_level, scope_id, coverage, period, counting_scope, is_standard, effective_from, kind)
values ('95000000-0000-0000-0000-0000000000c4', 'agency', '95000000-0000-0000-0000-00000000000a', 'additive', 'year', 'agency', false, current_date, 'commission');
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, fee_basis_unit, agent_rate)
values ('95000000-0000-0000-0000-0000000000c4', 1, null, 1, 'months', 0.22);

select is(
  (select partner_rate from public.resolve_rates(
     '95000000-0000-0000-0000-00000000000b', '95000000-0000-0000-0000-000000000009', 1)),
  0.30::numeric, 'an agency''s own commission deal does not become its supplier''s margin');

-- ===========================================================================
-- 6. NEW REFERRALS ONLY
-- ===========================================================================
/* NOT A RULE THIS MIGRATION ENFORCES, but a property of WHERE the deal is
   read: create_referral resolves once and writes the numbers onto the
   application, and every money surface afterwards reads the frozen pair. An
   application written before the deal keeps what it was created with. */
/* A REFERRER, because assert_application_attributed refuses an application
   with neither referrer nor applicant unless the partner is a house route,
   and a real supplier is not one. On that rail the supplier's own staff do
   the referring. */
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
values ('95000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'ref@zzzprices.test', now(), now(), '{}'::jsonb, '{}'::jsonb, '','','','','','','','');
insert into public.users (id, full_name, email, role, partner_id, status)
values ('95000000-0000-0000-0000-0000000000f1', 'ZZZ Prices Referrer', 'ref@zzzprices.test', 'referrer',
        '95000000-0000-0000-0000-000000000001', 'active');

insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, fee_amount, tenancy_start,
   referencing_mode, partner_rate, agent_rate, status, sent_at, livemode, payment_state)
values ('95000000-0000-0000-0000-0000000000d1', 'ZZZ-PRICES-1', '95000000-0000-0000-0000-000000000001',
        '95000000-0000-0000-0000-000000000002', '95000000-0000-0000-0000-000000000003',
        '95000000-0000-0000-0000-0000000000f1',
        'Ms','Ada','Tester','1990-01-01','ada@zzzprices.test','07700900000',
        '1 ZZZ Street','London','SW1A 1AA', 2000, 2000, current_date + 30,
        'pre_referenced_open', 0.35, 0.15, 'sent', now() - interval '1 day', true, 'awaiting');

select is(
  (select partner_rate from public.applications where id = '95000000-0000-0000-0000-0000000000d1'),
  0.35::numeric, 'a referral sent before the deal keeps the total it was created with');

select is(
  (select agent_rate from public.applications where id = '95000000-0000-0000-0000-0000000000d1'),
  0.15::numeric, 'and the share it was created with');

select * from finish();
rollback;
