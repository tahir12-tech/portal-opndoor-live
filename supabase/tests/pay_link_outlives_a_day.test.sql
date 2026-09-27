-- A PAY LINK STILL WORKS TOMORROW.
--
-- Reported as a recurring fault on the live portal: pay links die after about 24
-- hours. That number is the tell. Nothing in this schema has a 24 hour window:
-- payment_page_tokens live 90 days and are refreshed on every re-mint. What does
-- expire in 24 hours is a STRIPE CHECKOUT SESSION, which is Stripe's default when
-- no expires_at is set, and this codebase used to email session.url directly.
-- The comment that replaced it still carries the defect number:
--
--   // #1 The payment email now points at the opndoor-hosted confirmation page
--   // (/pay?token=...), not the raw Stripe URL.
--
-- So the fault is a deployment running code old enough to email the Stripe URL,
-- not a token lifetime. This file asserts the property that makes the current
-- design immune, so that if it ever regresses it fails here rather than in a
-- tenant's inbox a day later:
--
--   the token a tenant is emailed outlives a day by a wide margin,
--   it is refreshed rather than duplicated when re-minted,
--   it stops working when the application is finished with, not on a clock,
--   and an expired one is refused rather than half-honoured.
--
-- The Stripe session's own lifetime is deliberately SHORT (30 minutes, the floor
-- Stripe allows) and that is correct: the session is created when the tenant
-- clicks Pay, not when the email is sent, so it only has to outlive the checkout
-- it was opened for. A short session behind a long link is the whole design.

begin;
select plan(12);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route, refers_own_stock)
values ('91000000-0000-0000-0000-000000000001', 'zzz-paylink', 'ZZZ Paylink', 'pre_referenced_open', 0.25, 0.10, true, true);
insert into public.agencies (id, partner_id, name)
values ('91000000-0000-0000-0000-00000000000a', '91000000-0000-0000-0000-000000000001', 'ZZZ Paylink Lettings');
insert into public.branches (id, agency_id, partner_id, name)
values ('91000000-0000-0000-0000-00000000000b', '91000000-0000-0000-0000-00000000000a',
        '91000000-0000-0000-0000-000000000001', 'ZZZ Paylink Park');

insert into public.applications (
  id, guarantee_ref, branch_id, agency_id, partner_id,
  tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
  prop_addr1, prop_city, prop_postcode, monthly_rent, fee_amount, tenancy_start,
  status, sent_at, livemode, referencing_mode, partner_rate, agent_rate
) values (
  '91000000-0000-0000-0000-00000000000c', 'GR-PAYLINK-1',
  '91000000-0000-0000-0000-00000000000b', '91000000-0000-0000-0000-00000000000a',
  '91000000-0000-0000-0000-000000000001',
  'Mr', 'Tom', 'Tenant', '1990-01-01', 'tom@zzzpaylink.test', '07700 900700',
  '1 Paylink Road', 'London', 'NW1 1PL', 1000, 692.31, current_date + 30,
  'sent', now(), true, 'pre_referenced_open', 0.25, 0.10);

-- ---------------------------------------------------------------------------
-- THE LINK THE TENANT IS EMAILED.
-- ---------------------------------------------------------------------------
select isnt(public.mint_payment_page_token('GR-PAYLINK-1'), null,
  'a referral that has been sent has a pay token');

-- MORE THAN A DAY, and by a margin nobody has to think about. Asserting "> 24
-- hours" alone would pass on a 25 hour token and leave the reported fault one
-- config change away, so the real lifetime is asserted too.
select ok(
  (select expires_at from public.payment_page_tokens
    where guarantee_ref = 'GR-PAYLINK-1') > now() + interval '24 hours',
  'and it outlives the 24 hours a Stripe session would have died in');

select ok(
  (select expires_at from public.payment_page_tokens
    where guarantee_ref = 'GR-PAYLINK-1') > now() + interval '80 days',
  'and in fact lives for months, so a tenant who waits a fortnight is fine');

-- ---------------------------------------------------------------------------
-- OPENED THE NEXT DAY. The reported symptom, simulated by ageing the token
-- rather than by waiting: the row is rewritten to look as though it was minted
-- 25 hours ago, and the page's own validity test is then applied to it.
--
-- That test is `expires_at > now()`, which is what payment-page checks (in TS:
-- `new Date(tok.expires_at).getTime() < Date.now()` returns 410) and what
-- decline_application_by_token checks in SQL. One predicate, two callers.
-- ---------------------------------------------------------------------------
update public.payment_page_tokens
   set expires_at = now() + interval '90 days' - interval '25 hours'
 where guarantee_ref = 'GR-PAYLINK-1';

select ok(
  exists (select 1 from public.payment_page_tokens
           where guarantee_ref = 'GR-PAYLINK-1' and expires_at > now()),
  'a link minted 25 hours ago is still valid, which is the reported fault');

-- And a fortnight, genuinely aged rather than re-asserting the line above: this
-- was the same predicate on the same unchanged row, which proved nothing twice.
update public.payment_page_tokens
   set expires_at = now() + interval '90 days' - interval '14 days'
 where guarantee_ref = 'GR-PAYLINK-1';

select ok(
  exists (select 1 from public.payment_page_tokens
           where guarantee_ref = 'GR-PAYLINK-1' and expires_at > now()),
  'and so is one minted a fortnight ago');

-- THE SAME TOKEN, not a second one. Every reminder and every resend re-mints, and
-- an insert per send would leave a tenant with several live links and us unable to
-- say which one they used.
select is(
  (select count(*)::int from public.payment_page_tokens where guarantee_ref = 'GR-PAYLINK-1'),
  1, 're-minting refreshes one row rather than issuing a second link');

select is(
  public.mint_payment_page_token('GR-PAYLINK-1'),
  (select token from public.payment_page_tokens where guarantee_ref = 'GR-PAYLINK-1'),
  'so the reminder and the resend carry the link the first email carried');

-- AND RE-MINTING PUSHES THE EXPIRY BACK OUT, so a tenant who is chased on day 89
-- does not get a link that dies the next morning.
select ok(
  (select expires_at from public.payment_page_tokens
    where guarantee_ref = 'GR-PAYLINK-1') > now() + interval '80 days',
  'and a re-mint pushes the expiry back out rather than inheriting the old one');

-- ---------------------------------------------------------------------------
-- IT DOES END, and on the right thing.
-- ---------------------------------------------------------------------------
update public.payment_page_tokens
   set expires_at = now() - interval '1 minute'
 where guarantee_ref = 'GR-PAYLINK-1';

select ok(
  not exists (select 1 from public.payment_page_tokens
               where guarantee_ref = 'GR-PAYLINK-1' and expires_at > now()),
  'a genuinely expired token is refused rather than half-honoured');

select throws_ok(
  $$select public.decline_application_by_token(
      (select token from public.payment_page_tokens where guarantee_ref = 'GR-PAYLINK-1'),
      'other')$$,
  '22023', null,
  'and the token-scoped actions refuse it too, by the same predicate');

-- ---------------------------------------------------------------------------
-- AND THE TENANT WHOSE STRIPE SESSION NEVER OPENED IS STILL CHASED.
--
-- create-referral opens an eager Stripe session at referral time and that call
-- can fail: it records the send as failed and creates the referral anyway, so
-- somebody can resend. Such a row is status 'sent' with payment_url null.
-- fire_payment_reminders used to require `payment_url is not null`, so the
-- applications whose tenant never got a working link were the exact ones excluded
-- from every reminder, silently, for ever. The column is not even read by the
-- caller: the link is minted fresh on every run. Fixed in 20261005240000.
-- ---------------------------------------------------------------------------
update public.applications
   set payment_url = null, sent_at = now() - interval '6 days'
 where guarantee_ref = 'GR-PAYLINK-1';

select is(
  (select count(*)::int from public.fire_payment_reminders(current_date)
    where guarantee_ref = 'GR-PAYLINK-1'),
  1, 'an application with no Stripe URL is still chased, because it needs it most');

-- And only once: the claim is idempotent per threshold, which is what makes the
-- duplicated 07:00 and 08:00 crons harmless rather than a second email a day.
select is(
  (select count(*)::int from public.fire_payment_reminders(current_date)
    where guarantee_ref = 'GR-PAYLINK-1'),
  0, 'and only once a threshold, so a second cron run the same day sends nothing');

select * from finish();
rollback;
