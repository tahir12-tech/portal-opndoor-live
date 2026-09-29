-- R2. A PARTIAL REFUND IS NOT A TOTAL REFUND.
--
-- `apply_stripe_refund` set `payment_state = 'refunded'` unconditionally,
-- whatever amount came back. Measured on dev: a GBP 10 refund against a
-- GBP 1,246.15 fee removed the agency's entire GBP 311.54 commission line,
-- and the payee list went from 5 lines / GBP 1,601.54 to 4 / GBP 1,290.00.
--
-- Three things follow from that one word, and all three are live today:
--   - the agency is short-paid the whole commission over a partial refund
--   - stripe-webhook voids an outstanding deed that is still owed
--   - the bordereau drops an executed guarantee that is still enforceable
--
-- THIS IS ALSO LIVE, AND WORSE THERE. origin/main carries the identical
-- unconditional flip at 20260702192702_refund_policy_anomaly.sql:10-21, and
-- additionally DISCARDS the RPC's error where this branch raises a 500 and an
-- ops incident. On live it also stops expiry reminders and skews the league.
--
-- WHAT 'partially_refunded' IS FOR. The guarantee is still in force: the
-- tenant is still covered, the deed still stands, the underwriter is still on
-- risk. Only the money moved. So the new state must read as NOT refunded
-- everywhere that asks "is this guarantee cancelled", and must reduce the fee
-- everywhere that asks "how much did we actually keep". Assertions 7 and 8
-- are the two directions of that, and they are the ones that would break if
-- somebody later "simplified" the state back to a boolean.

begin;
select plan(11);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled)
values ('c9000000-0000-0000-0000-0000000000d1','zzz-r2-supplier','ZZZ R2 Supplier',
        'pre_referenced_open', 0.30, 0.10, false, false, true, true);
insert into public.agencies (id, partner_id, name) values
  ('c9000000-0000-0000-0000-0000000000a1','c9000000-0000-0000-0000-0000000000d1','ZZZ R2 Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('c9000000-0000-0000-0000-0000000000b1','c9000000-0000-0000-0000-0000000000a1',
   'c9000000-0000-0000-0000-0000000000d1','ZZZ R2 Office');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('c9000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.r2@r.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('c9000000-0000-0000-0000-00000000c001','ZZZ R2 Ref','zzz.r2@r.test','referrer',
   'c9000000-0000-0000-0000-0000000000d1','active',false);

-- One paid guarantee. The fee is the measured one, so the arithmetic below is
-- the arithmetic that was actually wrong.
insert into public.applications (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
       tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
       prop_addr1, prop_city, prop_postcode,
       monthly_rent, tenancy_start, partner_rate, agent_rate, referencing_mode,
       status, payment_state, paid_at, paid_amount, fee_amount, stripe_payment_intent_id)
values ('c9000000-0000-0000-0000-0000000000f1','GR-ZZR201',
        'c9000000-0000-0000-0000-0000000000d1','c9000000-0000-0000-0000-0000000000a1',
        'c9000000-0000-0000-0000-0000000000b1','c9000000-0000-0000-0000-00000000c001',
        'Mx','Ray','Fund','1990-01-01','zzz.r2.tenant@r.test','07700900960',
        '1 Refund Street','London','RF1 1AA',
        1246.15, current_date + 30, 0.30, 0.10, 'pre_referenced_open',
        'paid', 'paid', now(), 1246.15, 1246.15, 'pi_zzz_r2_one');

-- ===========================================================================
-- 1-3. TEN POUNDS BACK IS TEN POUNDS BACK.
-- ===========================================================================
select public.apply_stripe_refund('pi_zzz_r2_one','re_zzz_r2_a', 10.00);

select is(
  (select payment_state from public.applications where id='c9000000-0000-0000-0000-0000000000f1'),
  'partially_refunded',
  'a GBP 10 refund on a GBP 1,246.15 fee is a PARTIAL refund, not a total one');

select is(
  (select refunded_amount from public.applications where id='c9000000-0000-0000-0000-0000000000f1'),
  10.00::numeric,
  'and the amount recorded is the ten pounds, not the whole fee');

-- The assertion for "the guarantee still stands": the row is not marked
-- refunded, which is what every deed, bordereau and renewal reader tests.
select isnt(
  (select payment_state from public.applications where id='c9000000-0000-0000-0000-0000000000f1'),
  'refunded',
  'so nothing downstream may treat the guarantee as cancelled');

-- ===========================================================================
-- 4-5. A SECOND PARTIAL REFUND ADDS UP. It did not before: the column was
-- overwritten, so two refunds of GBP 10 recorded GBP 10.
-- ===========================================================================
select public.apply_stripe_refund('pi_zzz_r2_one','re_zzz_r2_b', 15.00);

select is(
  (select refunded_amount from public.applications where id='c9000000-0000-0000-0000-0000000000f1'),
  25.00::numeric,
  'a second partial refund ACCUMULATES rather than overwriting');

select is(
  (select payment_state from public.applications where id='c9000000-0000-0000-0000-0000000000f1'),
  'partially_refunded',
  'and two small refunds still do not add up to a cancelled guarantee');

-- ===========================================================================
-- 6. THE SAME REFUND REDELIVERED ADDS NOTHING. Stripe retries, and the
-- accumulation above would otherwise double-count on every retry.
-- ===========================================================================
select public.apply_stripe_refund('pi_zzz_r2_one','re_zzz_r2_b', 15.00);

select is(
  (select refunded_amount from public.applications where id='c9000000-0000-0000-0000-0000000000f1'),
  25.00::numeric,
  'the same refund arriving twice does not count twice');

-- ===========================================================================
-- 7. AND WHEN THE MONEY IS ALL BACK, IT IS A TOTAL REFUND AFTER ALL.
-- ===========================================================================
select public.apply_stripe_refund('pi_zzz_r2_one','re_zzz_r2_c', 1221.15);

select is(
  (select payment_state from public.applications where id='c9000000-0000-0000-0000-0000000000f1'),
  'refunded',
  'once the refunds reach what was paid, the guarantee IS cancelled');

select is(
  (select refunded_amount from public.applications where id='c9000000-0000-0000-0000-0000000000f1'),
  1246.15::numeric,
  'and the total recorded is exactly what the tenant paid');

-- ===========================================================================
-- 8. THE REGRESSION GUARD. A refund with NO amount stated is a full refund,
-- which is how every existing caller behaved and must keep behaving.
-- ===========================================================================
insert into public.applications (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
       tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
       prop_addr1, prop_city, prop_postcode,
       monthly_rent, tenancy_start, partner_rate, agent_rate, referencing_mode,
       status, payment_state, paid_at, paid_amount, fee_amount, stripe_payment_intent_id)
values ('c9000000-0000-0000-0000-0000000000f2','GR-ZZR202',
        'c9000000-0000-0000-0000-0000000000d1','c9000000-0000-0000-0000-0000000000a1',
        'c9000000-0000-0000-0000-0000000000b1','c9000000-0000-0000-0000-00000000c001',
        'Mx','Full','Back','1990-01-01','zzz.r2.tenant2@r.test','07700900961',
        '2 Refund Street','London','RF2 2AA',
        900.00, current_date + 30, 0.30, 0.10, 'pre_referenced_open',
        'paid', 'paid', now(), 900.00, 900.00, 'pi_zzz_r2_two');

select public.apply_stripe_refund('pi_zzz_r2_two','re_zzz_r2_full');

select is(
  (select payment_state from public.applications where id='c9000000-0000-0000-0000-0000000000f2'),
  'refunded',
  'a refund with no amount stated is still a full refund, exactly as before');

select is(
  (select refunded_amount from public.applications where id='c9000000-0000-0000-0000-0000000000f2'),
  900.00::numeric,
  'and it records the whole of what was paid');

-- ===========================================================================
-- 9. THE ANOMALY FLAG STILL WORKS. It is the only thing telling an operator a
-- refund broke the policy, and it sits in the same statement.
-- ===========================================================================
select is(
  (select refund_after_start from public.applications where id='c9000000-0000-0000-0000-0000000000f2'),
  false,
  'and the policy-anomaly flag is still computed, for a tenancy not yet started');

select * from finish();
rollback;
