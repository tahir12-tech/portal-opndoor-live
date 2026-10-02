-- R2, SUPERSEDED BY MATT'S RULING, AND WHAT SURVIVES OF IT.
--
-- This file replaces `a_partial_refund_is_not_a_total_refund.test.sql`,
-- which asserted the behaviour R2 built: a partial refund landing as
-- `partially_refunded` with an accumulating amount. Matt then ruled:
--
--   "Opndoor never gives partial refunds. A refund is always the full fee.
--    Make the refund action refuse any amount other than the full fee...
--    instead of changing how partial refunds affect commission."
--
-- So a partial is now REFUSED rather than recorded, and the assertions about
-- accumulation are unreachable by construction -- there is no longer a way
-- to reach a second partial refund. They are removed rather than left
-- passing vacuously, and this header is why, so the dropped assertion count
-- is explained rather than looking like coverage quietly going backwards.
--
-- The refusal itself is asserted in `a_refund_is_the_whole_fee.test.sql`.
-- What is asserted HERE is the half of R2 that Matt's ruling does NOT touch,
-- and which must keep holding:
--
--   * a full refund still cancels the guarantee and records the whole amount
--   * the same refund redelivered by Stripe does not count twice
--   * nothing is left half-written when a refund IS refused
--
-- The third is the one worth keeping most. R2's original defect was a
-- refund writing the wrong thing; the new rule's failure mode is a refund
-- writing HALF a thing, and a refusal that had already updated one column
-- would be worse than either.

begin;
select plan(6);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled, partner_kind)
values ('c9000000-0000-0000-0000-0000000000d1','zzz-r2-supplier','ZZZ R2 Supplier',
        'pre_referenced_open', 0.30, 0.10, false, false, true, true, 'supplier');
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
-- 1-3. A REFUSED REFUND LEAVES NOTHING BEHIND. The new failure mode.
-- ===========================================================================
select throws_ok(
  $$select public.apply_stripe_refund('pi_zzz_r2_one','re_zzz_r2_a', 10.00)$$,
  '22023',
  'A refund must be the whole fee of 1246.15. Opndoor does not give part refunds; 10.00 was reported by Stripe and has not been recorded.',
  'a part refund is refused');

select is(
  (select payment_state from public.applications where id='c9000000-0000-0000-0000-0000000000f1'),
  'paid',
  'and the application is untouched: still paid, not half-refunded');

select is(
  (select coalesce(stripe_refund_id,'(none)') || ' ' || coalesce(refunded_amount::text,'(none)')
     from public.applications where id='c9000000-0000-0000-0000-0000000000f1'),
  '(none) (none)',
  'and not one column of it was written, not even the refund id');

-- ===========================================================================
-- 4-5. THE FULL REFUND STILL WORKS, which is R2's surviving half.
-- ===========================================================================
select lives_ok(
  $$select public.apply_stripe_refund('pi_zzz_r2_one','re_zzz_r2_full', 1246.15)$$,
  'the whole fee goes through');

select is(
  (select payment_state || ' ' || refunded_amount::text
     from public.applications where id='c9000000-0000-0000-0000-0000000000f1'),
  'refunded 1246.15',
  'and cancels the guarantee with the whole amount recorded');

-- ===========================================================================
-- 6. AND STRIPE RETRYING THE SAME REFUND DOES NOT COUNT IT TWICE.
-- ===========================================================================
select public.apply_stripe_refund('pi_zzz_r2_one','re_zzz_r2_full', 1246.15);

select is(
  (select refunded_amount from public.applications where id='c9000000-0000-0000-0000-0000000000f1'),
  1246.15::numeric,
  'the same refund arriving twice records it once');

select * from finish();
rollback;
