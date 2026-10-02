-- A REFUND IS THE WHOLE FEE. THERE IS NO SUCH THING AS A PART REFUND.
--
-- Matt's ruling, 2026-09-30: "Opndoor never gives partial refunds. A refund
-- is always the full fee. Make the refund action refuse any amount other than
-- the full fee."
--
-- WHAT THIS IS NOT. It is not a way of deciding what a partial refund does to
-- the commission -- that question is withdrawn, because the case is not
-- supposed to arise. It is a rule that says the case is an error.
--
-- THE THING THAT MAKES THIS DELICATE, and it is recorded here because the
-- next person will not guess it: THERE IS NO REFUND ACTION IN THE PORTAL.
-- Nothing in the product creates a Stripe refund. `apply_stripe_refund` has
-- exactly one caller, `stripe-webhook`, and it is not performing a refund --
-- it is RECORDING one that has already happened inside Stripe because
-- somebody refunded there by hand.
--
-- You cannot refuse a fact. If this function simply raises and nothing else
-- changes, then: Stripe has moved the money, the webhook 500s, Stripe retries
-- for ever, and the application is never marked refunded AT ALL -- still
-- fully paid, commission still paid, deed still live, underwriter still
-- billed. That is worse than the over-correction it replaces.
--
-- So the refusal is paired with a change in stripe-webhook, which recognises
-- this exact error, raises a loud ops incident naming the guarantee and the
-- amount, and returns 200 so Stripe stops retrying. The divergence between
-- Stripe and the row is left VISIBLE rather than mis-applied or silently
-- looped. Assertion 7 pins the error code the webhook keys on, because if
-- that changes the webhook silently goes back to looping.

begin;
select plan(9);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled, partner_kind)
values ('d1000000-0000-0000-0000-0000000000d1','zzz-rf-supplier','ZZZ RF Supplier',
        'pre_referenced_open', 0.30, 0.10, false, false, true, true, 'supplier');
insert into public.agencies (id, partner_id, name) values
  ('d1000000-0000-0000-0000-0000000000a1','d1000000-0000-0000-0000-0000000000d1','ZZZ RF Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('d1000000-0000-0000-0000-0000000000b1','d1000000-0000-0000-0000-0000000000a1',
   'd1000000-0000-0000-0000-0000000000d1','ZZZ RF Office');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('d1000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.rf@r.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('d1000000-0000-0000-0000-00000000c001','ZZZ RF Ref','zzz.rf@r.test','referrer',
   'd1000000-0000-0000-0000-0000000000d1','active',false);

insert into public.applications (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
       tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
       prop_addr1, prop_city, prop_postcode,
       monthly_rent, tenancy_start, partner_rate, agent_rate, referencing_mode,
       status, payment_state, paid_at, paid_amount, fee_amount, stripe_payment_intent_id)
values ('d1000000-0000-0000-0000-0000000000f1','GR-ZZRF01',
        'd1000000-0000-0000-0000-0000000000d1','d1000000-0000-0000-0000-0000000000a1',
        'd1000000-0000-0000-0000-0000000000b1','d1000000-0000-0000-0000-00000000c001',
        'Mx','Full','Only','1990-01-01','zzz.rf.t@r.test','07700900995',
        '1 Refund Street','London','RF1 1AA',
        1246.15, current_date + 30, 0.30, 0.10, 'pre_referenced_open',
        'paid', 'paid', now(), 1246.15, 1246.15, 'pi_zzz_rf_one');

-- ===========================================================================
-- 1-3. A PART REFUND IS REFUSED, AND NOTHING IS WRITTEN.
-- The second half matters as much as the first: a refusal that had already
-- half-updated the row would be worse than no rule at all.
-- ===========================================================================
select throws_ok(
  $$select public.apply_stripe_refund('pi_zzz_rf_one','re_zzz_rf_part', 10.00)$$,
  '22023',
  'A refund must be the whole fee of 1246.15. Opndoor does not give part refunds; 10.00 was reported by Stripe and has not been recorded.',
  'ten pounds back on a GBP 1,246.15 fee is refused, and the message names both figures');

select is(
  (select payment_state from public.applications where id='d1000000-0000-0000-0000-0000000000f1'),
  'paid',
  'and the application is untouched -- still paid, not half-refunded');

select is(
  (select refunded_amount from public.applications where id='d1000000-0000-0000-0000-0000000000f1'),
  null::numeric,
  'and no amount was recorded');

-- ===========================================================================
-- 4. MORE THAN THE FEE IS REFUSED TOO. "Any amount other than the full fee"
-- is Matt's wording, and it has two sides.
-- ===========================================================================
select throws_ok(
  $$select public.apply_stripe_refund('pi_zzz_rf_one','re_zzz_rf_over', 2000.00)$$,
  '22023',
  'A refund must be the whole fee of 1246.15. Opndoor does not give part refunds; 2000.00 was reported by Stripe and has not been recorded.',
  'and so is more than was ever paid');

-- ===========================================================================
-- 5-6. THE WHOLE FEE GOES THROUGH, exactly as it always did.
-- ===========================================================================
select lives_ok(
  $$select public.apply_stripe_refund('pi_zzz_rf_one','re_zzz_rf_full', 1246.15)$$,
  'the whole fee is refunded without complaint');

select is(
  (select payment_state || ' ' || refunded_amount::text
     from public.applications where id='d1000000-0000-0000-0000-0000000000f1'),
  'refunded 1246.15',
  'and the guarantee is cancelled with the full amount recorded');

-- ===========================================================================
-- 7. THE ERROR CODE THE WEBHOOK KEYS ON. stripe-webhook has to tell this
-- refusal apart from a real failure: one means "tell somebody and stop", the
-- other means "let Stripe retry". If this code changes, the webhook silently
-- goes back to retrying for ever, so it is pinned here rather than left as an
-- implementation detail two files apart.
-- ===========================================================================
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='apply_stripe_refund'
      and pg_get_functiondef(p.oid) like '%22023%'),
  1,
  'the refusal raises 22023, which is what the webhook matches on');

-- ===========================================================================
-- 8-9. NO AMOUNT STATED IS STILL A FULL REFUND. Every existing caller relied
-- on this and must keep working: a refund event without an amount means the
-- whole thing, not an unknown amount to be refused.
-- ===========================================================================
insert into public.applications (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
       tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
       prop_addr1, prop_city, prop_postcode,
       monthly_rent, tenancy_start, partner_rate, agent_rate, referencing_mode,
       status, payment_state, paid_at, paid_amount, fee_amount, stripe_payment_intent_id)
values ('d1000000-0000-0000-0000-0000000000f2','GR-ZZRF02',
        'd1000000-0000-0000-0000-0000000000d1','d1000000-0000-0000-0000-0000000000a1',
        'd1000000-0000-0000-0000-0000000000b1','d1000000-0000-0000-0000-00000000c001',
        'Mx','Silent','Amount','1990-01-01','zzz.rf.t2@r.test','07700900996',
        '2 Refund Street','London','RF2 2AA',
        900.00, current_date + 30, 0.30, 0.10, 'pre_referenced_open',
        'paid', 'paid', now(), 900.00, 900.00, 'pi_zzz_rf_two');

select lives_ok(
  $$select public.apply_stripe_refund('pi_zzz_rf_two','re_zzz_rf_noamt')$$,
  'a refund with no amount stated is still the whole fee, as every caller assumes');

select is(
  (select payment_state || ' ' || refunded_amount::text
     from public.applications where id='d1000000-0000-0000-0000-0000000000f2'),
  'refunded 900.00',
  'and records the whole of what was paid');

select * from finish();
rollback;
