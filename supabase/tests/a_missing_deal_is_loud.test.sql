-- A MISSING COMMISSION DEAL IS LOUD, ONCE PER SUPPLIER.
--
-- Matt, 2026-10-03: "Make a missing deal loud, not silent: when a referral is
-- created for a supplier with no commission deal set (rates null, coalesced to
-- 0), raise an ops alert once per supplier and show it on Health and the
-- supplier's Overview. A deliberate 0% deal like Letly's must not alert."
--
-- THE OTHER HALF OF 20261007680000, which stopped "Add supplier" inventing a
-- 25% deal and gave resolve_rates a final coalesce to 0 so a dealless
-- supplier's referrals are recorded rather than refused. The cost of not
-- refusing is silence; this is what replaces it.
--
-- "NOTHING RESOLVED" IS THE TEST, NOT "THE ANSWER WAS 0", and that is what
-- most of this file is about. Letly sits on 0.00/0.00 WITH an agreement: a
-- deal of nothing, agreed, and alerting on it would train everybody to ignore
-- the alert.

begin;
select plan(10);

-- ===========================================================================
-- TWO SUPPLIERS: one with nothing agreed, one with a deliberate 0% deal.
-- ===========================================================================
insert into public.partners (id, slug, name, referencing_mode, is_house_route, partner_kind)
values ('9d000000-0000-0000-0000-0000000000a1','zzz-loud-nodeal','ZZZ Loud No Deal',
        'pre_referenced_open', false, 'supplier');
insert into public.partners (id, slug, name, referencing_mode, is_house_route, partner_kind,
                             partner_rate, agent_rate)
values ('9d000000-0000-0000-0000-0000000000a2','zzz-loud-zero','ZZZ Loud Zero Deal',
        'pre_referenced_open', false, 'supplier', 0.00, 0.00);

insert into public.agencies (id, partner_id, name) values
  ('9d000000-0000-0000-0000-0000000000b1','9d000000-0000-0000-0000-0000000000a1','ZZZ Loud No Deal Agency'),
  ('9d000000-0000-0000-0000-0000000000b2','9d000000-0000-0000-0000-0000000000a2','ZZZ Loud Zero Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('9d000000-0000-0000-0000-0000000000c1','9d000000-0000-0000-0000-0000000000b1','9d000000-0000-0000-0000-0000000000a1','ZZZ Loud No Deal Office'),
  ('9d000000-0000-0000-0000-0000000000c2','9d000000-0000-0000-0000-0000000000b2','9d000000-0000-0000-0000-0000000000a2','ZZZ Loud Zero Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('9d000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.loud.ref@l.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('9d000000-0000-0000-0000-0000000000d1','ZZZ Loud Referrer','zzz.loud.ref@l.test',
        'referrer','9d000000-0000-0000-0000-0000000000a1','active',false);

-- ===========================================================================
-- 1. THE PREDICATE, which is the whole distinction
-- ===========================================================================
select ok(
  public.has_no_commission_deal('9d000000-0000-0000-0000-0000000000c1',
                                '9d000000-0000-0000-0000-0000000000a1', 1),
  'a supplier with nothing agreed has no commission deal');

select ok(
  not public.has_no_commission_deal('9d000000-0000-0000-0000-0000000000c2',
                                    '9d000000-0000-0000-0000-0000000000a2', 1),
  'and a deliberate 0% deal is a deal: Letly''s shape must never alert');

-- ===========================================================================
-- 2. A REFERRAL ON THE DEALLESS ONE LATCHES, ONCE
-- ===========================================================================
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, fee_amount, tenancy_start,
   referencing_mode, partner_rate, agent_rate, status, sent_at, livemode)
values ('9d000000-0000-0000-0000-0000000000e1','ZZZ-LOUD-1',
        '9d000000-0000-0000-0000-0000000000a1','9d000000-0000-0000-0000-0000000000b1',
        '9d000000-0000-0000-0000-0000000000c1','9d000000-0000-0000-0000-0000000000d1',
        'Ms','Loud','One','1990-01-01','zzz.loud1@l.test','07700900201',
        '1 ZZZ Loud Street','London','SW1A 1AA', 2000, 2000, '2026-12-01',
        'pre_referenced_open', 0, 0, 'sent', now(), true);

select is(
  (select count(*)::int from public.supplier_no_deal_alerts
    where partner_id = '9d000000-0000-0000-0000-0000000000a1'),
  1, 'the first referral latches the supplier, so somebody is told');

select is(
  (select first_application_id from public.supplier_no_deal_alerts
    where partner_id = '9d000000-0000-0000-0000-0000000000a1'),
  '9d000000-0000-0000-0000-0000000000e1'::uuid,
  'and the latch names the referral that found it');

-- A SECOND REFERRAL MUST NOT LATCH AGAIN. This is Matt's "once per supplier",
-- and the thing report_ops_incident's own (type, application, hour) dedupe
-- could not give: ten referrals an hour would have been ten alerts.
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, fee_amount, tenancy_start,
   referencing_mode, partner_rate, agent_rate, status, sent_at, livemode)
values ('9d000000-0000-0000-0000-0000000000e2','ZZZ-LOUD-2',
        '9d000000-0000-0000-0000-0000000000a1','9d000000-0000-0000-0000-0000000000b1',
        '9d000000-0000-0000-0000-0000000000c1','9d000000-0000-0000-0000-0000000000d1',
        'Mr','Loud','Two','1990-01-01','zzz.loud2@l.test','07700900202',
        '2 ZZZ Loud Street','London','SW1A 1AA', 2000, 2000, '2026-12-01',
        'pre_referenced_open', 0, 0, 'sent', now(), true);

select is(
  (select count(*)::int from public.supplier_no_deal_alerts
    where partner_id = '9d000000-0000-0000-0000-0000000000a1'),
  1, 'a second referral does not latch again: once per supplier, not per referral');

-- ===========================================================================
-- 3. AND THE 0% SUPPLIER NEVER LATCHES AT ALL
-- ===========================================================================
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, fee_amount, tenancy_start,
   referencing_mode, partner_rate, agent_rate, status, sent_at, livemode)
values ('9d000000-0000-0000-0000-0000000000e3','ZZZ-LOUD-3',
        '9d000000-0000-0000-0000-0000000000a2','9d000000-0000-0000-0000-0000000000b2',
        '9d000000-0000-0000-0000-0000000000c2','9d000000-0000-0000-0000-0000000000d1',
        'Mx','Loud','Three','1990-01-01','zzz.loud3@l.test','07700900203',
        '3 ZZZ Loud Street','London','SW1A 1AA', 2000, 2000, '2026-12-01',
        'pre_referenced_open', 0, 0, 'sent', now(), true);

select is(
  (select count(*)::int from public.supplier_no_deal_alerts
    where partner_id = '9d000000-0000-0000-0000-0000000000a2'),
  0, 'a supplier on a deliberate 0% deal is never latched');

-- ===========================================================================
-- 4. WHAT THE SCREENS READ IS DERIVED, so it needs no clearing up
-- ===========================================================================
/* AN OPNDOOR ADMIN TO DO THE READING. `suppliers_with_no_commission_deal`
   is admin-only -- it names every supplier that is being under-billed, which
   is Opndoor's own business -- so without a caller this asserts the gate and
   not the answer. Written as a bare `set local role postgres` first, and the
   test said so by returning NULL. */
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('9d000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.loud.admin@o.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('9d000000-0000-0000-0000-0000000000d2','ZZZ Loud Admin','zzz.loud.admin@o.test',
        'superadmin', null, 'active', true);
select set_config('request.jwt.claims',
  '{"sub":"9d000000-0000-0000-0000-0000000000d2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is(
  (select referrals::int from public.suppliers_with_no_commission_deal()
    where slug = 'zzz-loud-nodeal'),
  2, 'the screens see both of the dealless supplier''s referrals');

select is(
  (select count(*)::int from public.suppliers_with_no_commission_deal()
    where slug = 'zzz-loud-zero'),
  0, 'and never the one with a real 0% deal');

-- ===========================================================================
-- 5. SETTING A DEAL MAKES IT GO AWAY, WITHOUT TOUCHING THE LATCH
--
-- The screens are derived, so this is immediate and needs no cleanup. The
-- latch is bookkeeping for the email and is re-armed lazily on the next
-- insert, which is assertion 10.
-- ===========================================================================
reset role;
update public.partners set partner_rate = 0.25
 where id = '9d000000-0000-0000-0000-0000000000a1';
select set_config('request.jwt.claims',
  '{"sub":"9d000000-0000-0000-0000-0000000000d2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is(
  (select count(*)::int from public.suppliers_with_no_commission_deal()
    where slug = 'zzz-loud-nodeal'),
  0, 'setting a deal takes the supplier off the screens at once');

reset role;
-- AND THE LATCH IS RE-ARMED on the next referral anywhere, so a supplier that
-- loses its deal later is alerted about again rather than being permanently
-- marked as told. "Not again until it changes or recovers."
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, fee_amount, tenancy_start,
   referencing_mode, partner_rate, agent_rate, status, sent_at, livemode)
values ('9d000000-0000-0000-0000-0000000000e4','ZZZ-LOUD-4',
        '9d000000-0000-0000-0000-0000000000a2','9d000000-0000-0000-0000-0000000000b2',
        '9d000000-0000-0000-0000-0000000000c2','9d000000-0000-0000-0000-0000000000d1',
        'Ms','Loud','Four','1990-01-01','zzz.loud4@l.test','07700900204',
        '4 ZZZ Loud Street','London','SW1A 1AA', 2000, 2000, '2026-12-01',
        'pre_referenced_open', 0, 0, 'sent', now(), true);

select is(
  (select count(*)::int from public.supplier_no_deal_alerts
    where partner_id = '9d000000-0000-0000-0000-0000000000a1'),
  0, 'and the latch is cleared once that supplier has a deal, so it can alert again');

select * from finish();
rollback;
