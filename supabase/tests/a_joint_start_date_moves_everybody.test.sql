-- A JOINT START-DATE CHANGE MOVES EVERY TENANT, AT TWO AND AT THREE.
--
-- Matt (bn), a blocker: "On a joint tenancy, a start-date change must move
-- every tenant's date together and reissue every tenant's deed (signed or
-- not) ... add a test for a 2- and 3-tenant start-date change."
--
-- THE DATE WAS NEVER THE BUG, and measuring that first is what kept this
-- test honest. GR-26262 and GR-26263 both read 2026-11-29 with matching
-- expiries, so `amend_tenancy_start` had done its job. What stayed behind
-- was the INSTRUMENT: John's deed was still executed and still said 20
-- November, which is a signed deed disagreeing with its own application.
--
-- SO THIS FILE COVERS THE HALF SQL OWNS, and says so rather than implying
-- the whole blocker is tested here. The reissue loop lives in the
-- amend-tenancy-start edge function; Deno is not installed on this machine,
-- so it is asserted by aJointAmendReissuesEveryDeed.test.ts instead.
--
-- TWO AND THREE BOTH, as Matt asked. Two is satisfied by any implementation
-- that handles "the other one"; three is what separates that from one that
-- handles "the rest".

begin;
select plan(8);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled, partner_kind)
values ('d5000000-0000-0000-0000-0000000000d1','zzz-js-supplier','ZZZ JS Supplier',
        'pre_referenced_open', 0.30, 0.10, false, false, true, true, 'supplier');
insert into public.agencies (id, partner_id, name) values
  ('d5000000-0000-0000-0000-0000000000a1','d5000000-0000-0000-0000-0000000000d1','ZZZ JS Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('d5000000-0000-0000-0000-0000000000b1','d5000000-0000-0000-0000-0000000000a1',
   'd5000000-0000-0000-0000-0000000000d1','ZZZ JS Office');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('d5000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.js.mgr@r.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('d5000000-0000-0000-0000-00000000c001','ZZZ JS Manager','zzz.js.mgr@r.test','management',
   'd5000000-0000-0000-0000-0000000000d1','active',true);

insert into public.tenancies (id, monthly_rent, tenancy_start, prop_addr1, prop_city, prop_postcode)
values ('d5000000-0000-0000-0000-00000000aa02', 2000, current_date + 30, '2 Pair Lane','London','PL1 1AA'),
       ('d5000000-0000-0000-0000-00000000aa03', 3000, current_date + 30, '3 Trio Lane','London','TL1 1AA');

/* MIXED DEED STATES ON ONE TENANCY, which is the shape that produced the
   blocker: on GR-26262/3 Jane was awaiting signature and John had signed,
   so one needed a void-and-regenerate and the other an archive-and-reissue.
   A fixture where everybody is in the same state would pass an
   implementation that only handles one branch. */
insert into public.applications (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
       tenancy_id, tenancy_position,
       tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
       prop_addr1, prop_city, prop_postcode,
       monthly_rent, fee_amount, tenancy_start, partner_rate, agent_rate, referencing_mode,
       status, paid_at, deed_issued_at, deed_state, payment_state, livemode)
select x.id, x.ref,
       'd5000000-0000-0000-0000-0000000000d1','d5000000-0000-0000-0000-0000000000a1',
       'd5000000-0000-0000-0000-0000000000b1','d5000000-0000-0000-0000-00000000c001',
       x.tenancy, x.pos,
       'Mx', x.first, 'Tenant', '1990-01-01', x.ref || '@r.test', '07700900870',
       x.addr, 'London', x.pc, x.rent, 600, current_date + 30, 0.30, 0.10, 'pre_referenced_open',
       x.status, now(), case when x.deed = 'executed' then now() end, x.deed, 'paid', true
from (values
  ('d5000000-0000-0000-0000-000000000201'::uuid,'GR-ZZJS21','d5000000-0000-0000-0000-00000000aa02'::uuid,1,'Pairone','2 Pair Lane','PL1 1AA',2000,'deed','executed'),
  ('d5000000-0000-0000-0000-000000000202'::uuid,'GR-ZZJS22','d5000000-0000-0000-0000-00000000aa02'::uuid,2,'Pairtwo','2 Pair Lane','PL1 1AA',2000,'paid','awaiting_tenant'),
  ('d5000000-0000-0000-0000-000000000301'::uuid,'GR-ZZJS31','d5000000-0000-0000-0000-00000000aa03'::uuid,1,'Trioone','3 Trio Lane','TL1 1AA',3000,'deed','executed'),
  ('d5000000-0000-0000-0000-000000000302'::uuid,'GR-ZZJS32','d5000000-0000-0000-0000-00000000aa03'::uuid,2,'Triotwo','3 Trio Lane','TL1 1AA',3000,'paid','awaiting_tenant'),
  ('d5000000-0000-0000-0000-000000000303'::uuid,'GR-ZZJS33','d5000000-0000-0000-0000-00000000aa03'::uuid,3,'Triothree','3 Trio Lane','TL1 1AA',3000,'deed','executed')
) as x(id, ref, tenancy, pos, first, addr, pc, rent, status, deed);

select set_config('request.jwt.claims',
  '{"sub":"d5000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ===========================================================================
-- 1-3. TWO TENANTS. Amending ONE moves BOTH, and the expiry with it.
-- ===========================================================================
select lives_ok(
  $$select public.amend_tenancy_start('d5000000-0000-0000-0000-000000000201', current_date + 45)$$,
  'a Manager may move a joint tenancy''s start date');
reset role;

select is(
  (select count(distinct tenancy_start) from public.applications
    where tenancy_id = 'd5000000-0000-0000-0000-00000000aa02'),
  1::bigint,
  'and BOTH tenants move: a tenancy has one start date');

select is(
  (select count(distinct expiry_date) from public.applications
    where tenancy_id = 'd5000000-0000-0000-0000-00000000aa02'),
  1::bigint,
  'so both deeds expire on the same day, which is what reaches the underwriter');

-- ===========================================================================
-- 4-6. THREE TENANTS, amended from the MIDDLE one. Two is satisfied by an
--      implementation that handles "the other one"; three is what separates
--      that from one that handles "the rest", and amending from position 2
--      is what stops a loop that only looks forwards from passing.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"d5000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select lives_ok(
  $$select public.amend_tenancy_start('d5000000-0000-0000-0000-000000000302', current_date + 50)$$,
  'and from the middle tenant of three');
reset role;

select is(
  (select count(*) from public.applications
    where tenancy_id = 'd5000000-0000-0000-0000-00000000aa03'
      and tenancy_start = current_date + 50),
  3::bigint,
  'all THREE move, not just the one amended and the one after it');

select is(
  (select count(distinct expiry_date) from public.applications
    where tenancy_id = 'd5000000-0000-0000-0000-00000000aa03'),
  1::bigint,
  'and all three expire together');

-- ===========================================================================
-- 7-8. THE OTHER TENANCY IS UNTOUCHED, which a loop keyed on anything
--      broader than the tenancy would break.
-- ===========================================================================
select is(
  (select distinct tenancy_start from public.applications
    where tenancy_id = 'd5000000-0000-0000-0000-00000000aa02'),
  current_date + 45,
  'the pair still sits where its own amend put it');

select is(
  (select count(*) from public.applications
    where tenancy_id = 'd5000000-0000-0000-0000-00000000aa02'
      and tenancy_start = current_date + 50),
  0::bigint,
  'and nothing from the trio''s amend leaked into it');

select * from finish();
rollback;
