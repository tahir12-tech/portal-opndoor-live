-- ONE CANCELLATION NOTICE PER TENANCY, AFTER THE LAST REFUND.
--
-- Matt, 2026-10-04 (bc): "the 'These guarantees have been cancelled' email
-- went twice each to joe@joe.com and landlord@landlord.com (once per refunded
-- tenant). Send it exactly once per tenancy, after the last tenant's refund,
-- and never again on webhook redeliveries. Add a test for a 2- and 3-tenant
-- cascade."
--
-- A BUG I SHIPPED THIS AFTERNOON. Each cascaded refund raises its own
-- charge.refunded and runs the whole per-tenant path, which is deliberate and
-- right for everything that IS per tenant. The notice to the agent and
-- landlord is per PROPERTY and was sitting inside it.
--
-- TWO AND THREE TENANTS, BY NAME, because they fail differently and a
-- two-tenant fixture would have passed a wrong implementation. With two, the
-- naive "is anybody left unrefunded" test is false exactly once -- on the
-- second refund -- so a counted condition with no record looks correct. With
-- three it is false on the third, and a condition-only implementation sends
-- again on every redelivery after it. Three is where the record earns its
-- place; two is where the condition does.

begin;
select plan(13);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled, partner_kind)
values ('d2000000-0000-0000-0000-0000000000d1','zzz-cn-agency','ZZZ CN Agency Partner',
        'opndoor_referenced', 0.30, 0.10, false, true, true, false, 'agency');
insert into public.agencies (id, partner_id, name) values
  ('d2000000-0000-0000-0000-0000000000a1','d2000000-0000-0000-0000-0000000000d1','ZZZ CN Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('d2000000-0000-0000-0000-0000000000b1','d2000000-0000-0000-0000-0000000000a1',
   'd2000000-0000-0000-0000-0000000000d1','ZZZ CN Office');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('d2000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.cn.neg@r.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('d2000000-0000-0000-0000-00000000c001','ZZZ CN Negotiator','zzz.cn.neg@r.test','referrer',
   'd2000000-0000-0000-0000-0000000000d1','active',false);

insert into public.tenancies (id, monthly_rent, tenancy_start, prop_addr1, prop_city, prop_postcode)
values ('d2000000-0000-0000-0000-00000000aa02', 1600, current_date + 20, '2 Pair Place','London','PP1 1AA'),
       ('d2000000-0000-0000-0000-00000000aa03', 2400, current_date + 20, '3 Trio Terrace','London','TT1 1AA');

-- Two tenancies: a pair and a trio, both fully paid, nothing refunded yet.
insert into public.applications (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
       tenancy_id, tenancy_position,
       tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
       prop_addr1, prop_city, prop_postcode,
       monthly_rent, fee_amount, tenancy_start, partner_rate, agent_rate, referencing_mode,
       status, paid_at, deed_issued_at, deed_state, payment_state, livemode)
select x.id, x.ref,
       'd2000000-0000-0000-0000-0000000000d1','d2000000-0000-0000-0000-0000000000a1',
       'd2000000-0000-0000-0000-0000000000b1','d2000000-0000-0000-0000-00000000c001',
       x.tenancy, x.pos,
       'Mx', x.first, 'Tenant', '1990-01-01', x.ref || '@r.test', '07700900840',
       x.addr,'London', x.pc, x.rent, 500, current_date + 20, 0.30, 0.10, 'opndoor_referenced',
       'deed', now(), now(), 'executed', 'paid', true
from (values
  ('d2000000-0000-0000-0000-000000000201'::uuid,'GR-ZZCN21','d2000000-0000-0000-0000-00000000aa02'::uuid,1,'Pair','2 Pair Place','PP1 1AA',1600),
  ('d2000000-0000-0000-0000-000000000202'::uuid,'GR-ZZCN22','d2000000-0000-0000-0000-00000000aa02'::uuid,2,'Pairtwo','2 Pair Place','PP1 1AA',1600),
  ('d2000000-0000-0000-0000-000000000301'::uuid,'GR-ZZCN31','d2000000-0000-0000-0000-00000000aa03'::uuid,1,'Trio','3 Trio Terrace','TT1 1AA',2400),
  ('d2000000-0000-0000-0000-000000000302'::uuid,'GR-ZZCN32','d2000000-0000-0000-0000-00000000aa03'::uuid,2,'Triotwo','3 Trio Terrace','TT1 1AA',2400),
  ('d2000000-0000-0000-0000-000000000303'::uuid,'GR-ZZCN33','d2000000-0000-0000-0000-00000000aa03'::uuid,3,'Triothree','3 Trio Terrace','TT1 1AA',2400)
) as x(id, ref, tenancy, pos, first, addr, pc, rent);

-- ===========================================================================
-- 1-4. THE PAIR. Refunding one is not the last; refunding both is, once.
-- ===========================================================================
update public.applications set payment_state='refunded', refunded_at=now(), deed_state='cancelled'
 where id='d2000000-0000-0000-0000-000000000201';
select is(public.claim_cancellation_notice('d2000000-0000-0000-0000-000000000201'), false,
  'the FIRST of two refunds does not send: a co-tenant is still paid');

update public.applications set payment_state='refunded', refunded_at=now(), deed_state='cancelled'
 where id='d2000000-0000-0000-0000-000000000202';
select is(public.claim_cancellation_notice('d2000000-0000-0000-0000-000000000202'), true,
  'the SECOND does, because nobody on the tenancy is left unrefunded');

-- THE REDELIVERY, which a counted condition alone cannot refuse: "nobody is
-- left" stays true for ever once it is true.
select is(public.claim_cancellation_notice('d2000000-0000-0000-0000-000000000202'), false,
  'and a redelivery of that same event sends nothing');

-- AND THE OTHER CO-TENANT'S EVENT, redelivered after the fact, is the same
-- claim on the same tenancy from a different application id. The record is
-- keyed on the TENANCY, so it refuses this too.
select is(public.claim_cancellation_notice('d2000000-0000-0000-0000-000000000201'), false,
  'nor does the first tenant''s event, arriving late, send a second one');

-- ===========================================================================
-- 5-9. THE TRIO, which is where a condition-only implementation fails. The
--      pair above is satisfied by "is anybody left" on its own; with three,
--      that test is also false on redeliveries of the third.
-- ===========================================================================
update public.applications set payment_state='refunded', refunded_at=now(), deed_state='cancelled'
 where id='d2000000-0000-0000-0000-000000000301';
select is(public.claim_cancellation_notice('d2000000-0000-0000-0000-000000000301'), false,
  'one of three is not the last');

update public.applications set payment_state='refunded', refunded_at=now(), deed_state='cancelled'
 where id='d2000000-0000-0000-0000-000000000302';
select is(public.claim_cancellation_notice('d2000000-0000-0000-0000-000000000302'), false,
  'two of three is not the last either');

update public.applications set payment_state='refunded', refunded_at=now(), deed_state='cancelled'
 where id='d2000000-0000-0000-0000-000000000303';
select is(public.claim_cancellation_notice('d2000000-0000-0000-0000-000000000303'), true,
  'the third is, and sends exactly one notice');

select is(public.claim_cancellation_notice('d2000000-0000-0000-0000-000000000303'), false,
  'and its redelivery sends none');

select is(
  (select count(*) from public.cancellation_notices
    where tenancy_id = 'd2000000-0000-0000-0000-00000000aa03'),
  1::bigint,
  'one row for the whole trio, however many events arrived');

-- ===========================================================================
-- 10-11. THE TWO TENANCIES DO NOT INTERFERE. A record keyed on the wrong
--        thing -- a partner, a property address, a date -- would have the
--        trio's notice suppressed by the pair's.
-- ===========================================================================
select is(
  (select count(*) from public.cancellation_notices),
  2::bigint,
  'one row each, for two separate tenancies');

select is(
  (select tenants from public.cancellation_notices
    where tenancy_id = 'd2000000-0000-0000-0000-00000000aa03'),
  3,
  'and it records how many tenants it was about');

-- ===========================================================================
-- 12. A TENANT WHO NEVER PAID DOES NOT HOLD THE NOTICE BACK FOR EVER. The
--     condition asks about paid tenants, not about every applicant: an
--     unpaid one has nothing to be refunded and will never become refunded,
--     so counting them would mean the agent is never told at all.
-- ===========================================================================
insert into public.applications (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
       tenancy_id, tenancy_position,
       tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
       prop_addr1, prop_city, prop_postcode,
       monthly_rent, fee_amount, tenancy_start, partner_rate, agent_rate, referencing_mode,
       status, paid_at, payment_state, livemode)
values ('d2000000-0000-0000-0000-000000000204','GR-ZZCN24',
   'd2000000-0000-0000-0000-0000000000d1','d2000000-0000-0000-0000-0000000000a1',
   'd2000000-0000-0000-0000-0000000000b1','d2000000-0000-0000-0000-00000000c001',
   'd2000000-0000-0000-0000-00000000aa02', 3,
   'Mx','Never','Paid','1990-01-01','zzz.cn.np@r.test','07700900849',
   '2 Pair Place','London','PP1 1AA', 1600, 500, current_date + 20, 0.30, 0.10, 'opndoor_referenced',
   'sent', null, 'awaiting', true);

delete from public.cancellation_notices where tenancy_id='d2000000-0000-0000-0000-00000000aa02';
select is(public.claim_cancellation_notice('d2000000-0000-0000-0000-000000000202'), true,
  'an applicant who never paid does not hold the notice back for ever');

-- ===========================================================================
-- 13. A SOLE APPLICATION IS KEYED ON ITSELF, having no tenancy to be keyed
--     on. Most of the book, and it must not collide with any other.
-- ===========================================================================
insert into public.applications (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
       tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
       prop_addr1, prop_city, prop_postcode,
       monthly_rent, fee_amount, tenancy_start, partner_rate, agent_rate, referencing_mode,
       status, paid_at, deed_issued_at, deed_state, payment_state, refunded_at, livemode)
values ('d2000000-0000-0000-0000-000000000901','GR-ZZCN91',
   'd2000000-0000-0000-0000-0000000000d1','d2000000-0000-0000-0000-0000000000a1',
   'd2000000-0000-0000-0000-0000000000b1','d2000000-0000-0000-0000-00000000c001',
   'Mx','Sol','Single','1990-01-01','zzz.cn.sole@r.test','07700900850',
   '9 Lone Lane','London','LL1 1AA', 900, 900, current_date + 20, 0.30, 0.10, 'opndoor_referenced',
   'deed', now(), now(), 'cancelled', 'refunded', now(), true);

select is(
  public.claim_cancellation_notice('d2000000-0000-0000-0000-000000000901')::text || '/' ||
  public.claim_cancellation_notice('d2000000-0000-0000-0000-000000000901')::text,
  'true/false',
  'a sole tenancy claims once and refuses the redelivery, keyed on itself');

select * from finish();
rollback;
