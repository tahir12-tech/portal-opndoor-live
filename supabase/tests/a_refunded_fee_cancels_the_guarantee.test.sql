-- A REFUNDED FEE CANCELS THAT TENANT'S GUARANTEE.
--
-- Matt (ak): "when a tenant's fee is fully refunded, their guarantee ends.
-- Mark their deed 'Cancelled: fee refunded' everywhere ... never 'Deed
-- executed'."
--
-- WHAT THIS IS ACTUALLY GUARDING. Before it, `stripe-webhook` voided an
-- OUTSTANDING deed on refund and did nothing whatever to an executed one.
-- GR-25235 on dev was the evidence: refunded, payment_state 'refunded', and
-- still reading "Deed executed" on screen. A signed instrument on a
-- guarantee that has ended, in front of the agent who placed the tenant.
--
-- THE IDEMPOTENCE ASSERTIONS ARE NOT CEREMONY. Stripe redelivers webhooks
-- as ordinary behaviour and the cascade retries failed rows by design, so
-- the second call is the NORMAL case, not the edge one. Cancelling twice
-- would log the cancellation twice and, once the emails are wired, tell the
-- agent twice that the same guarantee ended.

begin;
select plan(12);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled, partner_kind)
values ('cf000000-0000-0000-0000-0000000000d1','zzz-rc-agency','ZZZ RC Agency Partner',
        'opndoor_referenced', 0.30, 0.10, false, true, true, false, 'agency');
insert into public.agencies (id, partner_id, name) values
  ('cf000000-0000-0000-0000-0000000000a1','cf000000-0000-0000-0000-0000000000d1','ZZZ RC Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('cf000000-0000-0000-0000-0000000000b1','cf000000-0000-0000-0000-0000000000a1',
   'cf000000-0000-0000-0000-0000000000d1','ZZZ RC Office');

-- A REFERRER, because `assert_application_attributed` refuses an application
-- with neither a referrer nor an applicant on a partner that is not a house
-- route. Attribution is never allowed to be silently missing, and a fixture
-- does not get an exemption from that.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('cf000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.rc.neg@r.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('cf000000-0000-0000-0000-00000000c001','ZZZ RC Negotiator','zzz.rc.neg@r.test','referrer',
   'cf000000-0000-0000-0000-0000000000d1','active',false);

-- FOUR APPLICATIONS, one per case the function has to tell apart.
insert into public.applications (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
       tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
       prop_addr1, prop_city, prop_postcode,
       monthly_rent, fee_amount, tenancy_start, partner_rate, agent_rate, referencing_mode,
       status, paid_at, deed_issued_at, deed_state, payment_state, refunded_at, livemode)
values
  -- Refunded, signed. The case that exists.
  ('cf000000-0000-0000-0000-0000000000f1','GR-ZZRC01',
   'cf000000-0000-0000-0000-0000000000d1','cf000000-0000-0000-0000-0000000000a1',
   'cf000000-0000-0000-0000-0000000000b1','cf000000-0000-0000-0000-00000000c001',
   'Mx','Rhea','Refunded','1990-01-01','zzz.rc.a@r.test','07700900810',
   '1 Refund Road','London','RF1 1AA', 1200, 1200, current_date + 20, 0.30, 0.10, 'opndoor_referenced',
   'deed', now(), now(), 'executed', 'refunded', now(), true),
  -- Paid, signed, NOT refunded. Must be refused.
  ('cf000000-0000-0000-0000-0000000000f2','GR-ZZRC02',
   'cf000000-0000-0000-0000-0000000000d1','cf000000-0000-0000-0000-0000000000a1',
   'cf000000-0000-0000-0000-0000000000b1','cf000000-0000-0000-0000-00000000c001',
   'Mx','Paul','Paid','1990-01-01','zzz.rc.b@r.test','07700900811',
   '2 Refund Road','London','RF1 1AA', 1200, 1200, current_date + 20, 0.30, 0.10, 'opndoor_referenced',
   'deed', now(), now(), 'executed', 'paid', null, true),
  -- PART refunded. Matt's rule: the guarantee stands. Must be refused.
  ('cf000000-0000-0000-0000-0000000000f3','GR-ZZRC03',
   'cf000000-0000-0000-0000-0000000000d1','cf000000-0000-0000-0000-0000000000a1',
   'cf000000-0000-0000-0000-0000000000b1','cf000000-0000-0000-0000-00000000c001',
   'Mx','Pia','Partial','1990-01-01','zzz.rc.c@r.test','07700900812',
   '3 Refund Road','London','RF1 1AA', 1200, 1200, current_date + 20, 0.30, 0.10, 'opndoor_referenced',
   'deed', now(), now(), 'executed', 'partially_refunded', null, true),
  -- Refunded before the deed was ever signed. Nothing to cancel, no error.
  ('cf000000-0000-0000-0000-0000000000f4','GR-ZZRC04',
   'cf000000-0000-0000-0000-0000000000d1','cf000000-0000-0000-0000-0000000000a1',
   'cf000000-0000-0000-0000-0000000000b1','cf000000-0000-0000-0000-00000000c001',
   'Mx','Una','Unsigned','1990-01-01','zzz.rc.d@r.test','07700900813',
   '4 Refund Road','London','RF1 1AA', 1200, 1200, current_date + 20, 0.30, 0.10, 'opndoor_referenced',
   'paid', now(), null, 'awaiting_tenant', 'refunded', now(), true);

-- ===========================================================================
-- 1-4. THE CANCELLATION ITSELF.
-- ===========================================================================
select is(public.cancel_guarantee_for_refund('cf000000-0000-0000-0000-0000000000f1'), true,
  'a refunded, signed deed cancels');

select is(
  (select deed_state from public.applications where id='cf000000-0000-0000-0000-0000000000f1'),
  'cancelled',
  'and the deed state says so, where the constraint used to forbid the word');

select ok(
  (select deed_cancelled_at is not null from public.applications where id='cf000000-0000-0000-0000-0000000000f1'),
  'and it is dated, so the audit trail can say when the instrument ended');

-- THE SIGNED PDF SURVIVES. Cancelling is not deleting: the instrument
-- existed, somebody signed it, and the record of that is what makes the
-- cancellation auditable rather than a disappearance.
select is(
  (select count(*) from public.activity_log
    where application_id='cf000000-0000-0000-0000-0000000000f1'
      and kind='deed_cancelled' and visibility='business'),
  1::bigint,
  'and the agent is told, in a business-visible row');

-- ===========================================================================
-- 5-6. IDEMPOTENCE, which is the normal case and not the edge one.
-- ===========================================================================
select is(public.cancel_guarantee_for_refund('cf000000-0000-0000-0000-0000000000f1'), false,
  'a second call -- a redelivered webhook -- does nothing and says so');

select is(
  (select count(*) from public.activity_log
    where application_id='cf000000-0000-0000-0000-0000000000f1' and kind='deed_cancelled'),
  1::bigint,
  'and writes no second row, so the agent is not told twice');

-- ===========================================================================
-- 7-9. THE THREE THINGS IT MUST NOT DO.
-- ===========================================================================
select throws_ok(
  $$select public.cancel_guarantee_for_refund('cf000000-0000-0000-0000-0000000000f2')$$,
  '22023',
  null,
  'an unrefunded guarantee cannot be cancelled, and the caller is told loudly');

select throws_ok(
  $$select public.cancel_guarantee_for_refund('cf000000-0000-0000-0000-0000000000f3')$$,
  '22023',
  null,
  'nor a PART refunded one: Matt''s rule is that the guarantee stands');

select is(
  (select deed_state from public.applications where id='cf000000-0000-0000-0000-0000000000f3'),
  'executed',
  'and the part-refunded deed is untouched');

-- ===========================================================================
-- 10. NOTHING TO CANCEL IS NOT A FAILURE. Refunded before signature: the
--     webhook has already voided the outstanding deed, and there is no
--     instrument to end.
-- ===========================================================================
select is(public.cancel_guarantee_for_refund('cf000000-0000-0000-0000-0000000000f4'), false,
  'a refund before signature cancels nothing, quietly');

-- ===========================================================================
-- 11-12. THE MONEY, which this function deliberately does not touch because
--        it was already handled. Asserted here anyway: "I checked and left
--        it alone" is only worth saying if something proves it.
-- ===========================================================================
select is(
  (select count(*) from public.commission_statement_lines(date_trunc('month', current_date)::date) l
    where l.guarantee_ref = 'GR-ZZRC01'),
  0::bigint,
  'the refunded application is already out of an unposted month''s statement');

select is(
  (select count(*) from public.commission_statement_lines(date_trunc('month', current_date)::date) l
    where l.guarantee_ref = 'GR-ZZRC02'),
  1::bigint,
  'and its unrefunded neighbour is still in it, so the exclusion is the refund and not the fixture');

select * from finish();
rollback;
