-- R5. A TENANCY HAS ONE START DATE.
--
-- `amend_tenancy_start` corrects ONE application, by id. A joint tenancy is
-- two applications over one tenancy, each with its own Deed of Guarantee. So
-- correcting the start date moved one deed and left the other, and the pair
-- ended up as two executed instruments stating different dates for the same
-- let.
--
-- IT IS WORSE THAN A WRONG DATE. `expiry_date` is GENERATED from
-- `tenancy_start`, so the two deeds also expire on different days: the
-- underwriter is on risk for one share until one date and the other share
-- until another, for a single tenancy. The bordereau bills them separately,
-- so the discrepancy is carried out to the underwriter rather than staying
-- internal.
--
-- THE RULE: a tenancy has one start date, so the correction applies to the
-- whole tenancy or to none of it.
--
-- "OR TO NONE OF IT" IS THE HALF THAT NEEDS SAYING. Moving every sibling
-- unconditionally would swap one divergence for another: the two rows of a
-- joint tenancy can have DIFFERENT amendment rules, so a caller allowed to
-- move one could drag the other with it. Every sibling is therefore tested,
-- and if any one of them refuses, nothing moves. Assertions 5 and 6.
--
-- WHAT DIVERGES CHANGED ON 2026-10-04, and this test changed with it. It used
-- to be the deed state: one executed, one not, and `can_amend_tenancy_start`
-- was stricter on the executed one. Matt's start-date rule removed the deed
-- state from the predicate, so that pair no longer diverges and the old
-- fixture was asserting a refusal that is now, correctly, allowed.
--
-- OWNERSHIP IS WHAT DIVERGES NOW, and it is a better fixture besides: it is
-- the realistic joint tenancy, two negotiators in the same office each
-- having referred one applicant. The permission it exercises (a referrer
-- reaching only their own) is the one the rule change did not touch, so this
-- test now measures the all-or-nothing property and nothing else.
--
-- THE DATES ARE RELATIVE to current_date. They were fixed at 2026-08-01,
-- which the start-date rule turned from "a tenancy" into "a tenancy that
-- started two months ago" -- so every assertion here failed for a reason
-- that had nothing to do with what it was testing.

begin;
select plan(8);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled, partner_kind)
values ('cd000000-0000-0000-0000-0000000000d1','zzz-r5-supplier','ZZZ R5 Supplier',
        'pre_referenced_open', 0.30, 0.10, false, false, true, true, 'supplier');
insert into public.agencies (id, partner_id, name) values
  ('cd000000-0000-0000-0000-0000000000a1','cd000000-0000-0000-0000-0000000000d1','ZZZ R5 Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('cd000000-0000-0000-0000-0000000000b1','cd000000-0000-0000-0000-0000000000a1',
   'cd000000-0000-0000-0000-0000000000d1','ZZZ R5 Office');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       x.email,'',now(),now(),now()
from (values
  ('cd000000-0000-0000-0000-00000000c001'::uuid,'zzz.r5.dir@r.test'),
  ('cd000000-0000-0000-0000-00000000c002'::uuid,'zzz.r5.neg@r.test'),
  ('cd000000-0000-0000-0000-00000000c003'::uuid,'zzz.r5.neg2@r.test')
) as x(id,email);
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('cd000000-0000-0000-0000-00000000c001','ZZZ R5 Director','zzz.r5.dir@r.test','management',
   'cd000000-0000-0000-0000-0000000000d1','active',true),
  ('cd000000-0000-0000-0000-00000000c002','ZZZ R5 Negotiator','zzz.r5.neg@r.test','referrer',
   'cd000000-0000-0000-0000-0000000000d1','active',false),
  -- The co-tenant's own negotiator. Same office, different referral.
  ('cd000000-0000-0000-0000-00000000c003','ZZZ R5 Negotiator Two','zzz.r5.neg2@r.test','referrer',
   'cd000000-0000-0000-0000-0000000000d1','active',false);

-- ONE TENANCY, TWO APPLICANTS, TWO DEEDS. The Regent shape.
insert into public.tenancies (id, monthly_rent, tenancy_start, prop_addr1, prop_city, prop_postcode)
values ('cd000000-0000-0000-0000-00000000aa01', 2400, current_date + 30,
        '1 Joint Street','London','JT1 1AA');

insert into public.applications (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
       tenancy_id, tenancy_position,
       tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
       prop_addr1, prop_city, prop_postcode,
       monthly_rent, tenancy_start, partner_rate, agent_rate, referencing_mode,
       status, paid_at, deed_issued_at, deed_state)
values
  ('cd000000-0000-0000-0000-0000000000f1','GR-ZZR501',
   'cd000000-0000-0000-0000-0000000000d1','cd000000-0000-0000-0000-0000000000a1',
   'cd000000-0000-0000-0000-0000000000b1','cd000000-0000-0000-0000-00000000c002',
   'cd000000-0000-0000-0000-00000000aa01', 1,
   'Mx','Ann','Joint','1990-01-01','zzz.r5.a@r.test','07700900980',
   '1 Joint Street','London','JT1 1AA',
   2400, current_date + 30, 0.30, 0.10, 'pre_referenced_open',
   'deed', now(), now(), 'executed'),
  ('cd000000-0000-0000-0000-0000000000f2','GR-ZZR502',
   'cd000000-0000-0000-0000-0000000000d1','cd000000-0000-0000-0000-0000000000a1',
   'cd000000-0000-0000-0000-0000000000b1','cd000000-0000-0000-0000-00000000c002',
   'cd000000-0000-0000-0000-00000000aa01', 2,
   'Mx','Ben','Joint','1990-01-01','zzz.r5.b@r.test','07700900981',
   '1 Joint Street','London','JT1 1AA',
   2400, current_date + 30, 0.30, 0.10, 'pre_referenced_open',
   'deed', now(), now(), 'executed');

-- ===========================================================================
-- 1-3. THE CORRECTION MOVES THE WHOLE TENANCY.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"cd000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.amend_tenancy_start('cd000000-0000-0000-0000-0000000000f1', current_date + 45)$$,
  'a Director may correct the start date of an executed joint tenancy');

reset role;
select is(
  (select tenancy_start from public.applications where id='cd000000-0000-0000-0000-0000000000f1'),
  current_date + 45,
  'the named application moves');

select is(
  (select tenancy_start from public.applications where id='cd000000-0000-0000-0000-0000000000f2'),
  current_date + 45,
  'AND SO DOES ITS CO-TENANT, because a tenancy has one start date');

-- ===========================================================================
-- 4. AND SO DO THE EXPIRIES, which is what reaches the underwriter.
-- ===========================================================================
select is(
  (select count(distinct expiry_date) from public.applications
    where tenancy_id = 'cd000000-0000-0000-0000-00000000aa01'),
  1::bigint,
  'so the two deeds expire on the same day, and the bordereau cannot disagree with itself');

-- ===========================================================================
-- 5-6. ALL OR NOTHING. One sibling not amendable by this caller means the
-- whole correction is refused, rather than half of it applied.
-- ===========================================================================
-- The co-tenant was referred by a DIFFERENT negotiator in the same office. A
-- Negotiator reaches their own referrals and no one else's, so the pair has
-- two different answers and the stricter one has to win.
update public.applications set referrer_id='cd000000-0000-0000-0000-00000000c003'
 where id='cd000000-0000-0000-0000-0000000000f2';

select set_config('request.jwt.claims',
  '{"sub":"cd000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select throws_ok(
  $$select public.amend_tenancy_start('cd000000-0000-0000-0000-0000000000f1', current_date + 70)$$,
  '42501',
  'not permitted',
  'a Negotiator may not drag a colleague''s co-tenant along with their own');

reset role;
select is(
  (select tenancy_start from public.applications where id='cd000000-0000-0000-0000-0000000000f1'),
  current_date + 45,
  'and NOTHING moved -- not even the one they were allowed to touch');

-- ===========================================================================
-- 7-8. A SOLE TENANCY IS UNAFFECTED. Most of the book is single, and this is
-- the path that must not change.
-- ===========================================================================
insert into public.applications (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
       tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
       prop_addr1, prop_city, prop_postcode,
       monthly_rent, tenancy_start, partner_rate, agent_rate, referencing_mode,
       status, paid_at)
values ('cd000000-0000-0000-0000-0000000000f3','GR-ZZR503',
   'cd000000-0000-0000-0000-0000000000d1','cd000000-0000-0000-0000-0000000000a1',
   'cd000000-0000-0000-0000-0000000000b1','cd000000-0000-0000-0000-00000000c002',
   'Mx','Sol','Single','1990-01-01','zzz.r5.c@r.test','07700900982',
   '9 Single Street','London','SG1 1AA',
   1000, current_date + 30, 0.30, 0.10, 'pre_referenced_open',
   'paid', now());

select set_config('request.jwt.claims',
  '{"sub":"cd000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.amend_tenancy_start('cd000000-0000-0000-0000-0000000000f3', current_date + 90)$$,
  'a sole tenancy still amends exactly as it did');

reset role;
select is(
  (select tenancy_start from public.applications where id='cd000000-0000-0000-0000-0000000000f3'),
  current_date + 90,
  'and moves, without a tenancy row to belong to');

select * from finish();
rollback;
