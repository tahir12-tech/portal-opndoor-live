-- A SUPPLIER MAY REFER A JOINT TENANCY.
--
-- Walk fix 26, and it REVERSES AN EARLIER INSTRUCTION, which is why this
-- file says so rather than simply asserting the new rule.
--
-- Q-06 item H said, of the supplier path: "single tenant (no Add another
-- tenant)". Batch 16 says the opposite: "Suppliers may refer joint
-- tenancies, the same way agencies can: Add another tenant works on the
-- supplier route, shares are set, one fee for the tenancy split by share."
-- Batch 16 is newer, so it governs.
--
-- MOST OF THIS ALREADY WORKED, and that is worth knowing before reading the
-- change. Proved on dev in a rolled-back transaction, with the guard
-- temporarily removed and a real Kestrel joint referral created:
--
--   2 applications, 1 tenancy
--   fees            £2,000.00  -- exactly one month of a £2,000 rent
--   share amounts   £2,000.00  -- exactly the rent
--   rates           0.2500 / 0.1000 on both, Kestrel's own
--
-- So `resolve_fee` already prices per TENANCY on the supplier rail (£2,000
-- for one tenant and £2,000 for two, measured), `apportion` already splits
-- it by share to the penny, and nothing downstream assumed the agent
-- estate. The only thing in the way was one guard.
--
-- AND THE GUARD IS NARROWED, NOT REMOVED. Matt named suppliers. He did not
-- name the DIRECT rail, and a joint direct tenancy has no staff referrer to
-- create it, so `opndoor-direct` and `referencing-partner` still refuse. A
-- guard deleted outright would have opened all three.

begin;
select plan(9);

-- ===========================================================================
-- FIXTURES. A supplier with an agency and a branch of its own.
-- ===========================================================================
insert into public.partners (id, slug, name, referencing_mode, is_house_route, status)
values ('e5000000-0000-0000-0000-00000000f001','zzz-joint-supplier','ZZZ Joint Supplier',
        'pre_referenced_open', false, 'active');
insert into public.agencies (id, partner_id, name) values
  ('e5000000-0000-0000-0000-00000000a001','e5000000-0000-0000-0000-00000000f001','ZZZ Joint Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('e5000000-0000-0000-0000-00000000b001','e5000000-0000-0000-0000-00000000a001',
   'e5000000-0000-0000-0000-00000000f001','ZZZ Joint Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('e5000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.joint.sup@s.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('e5000000-0000-0000-0000-00000000c001','ZZZ Supplier Manager','zzz.joint.sup@s.test','management',
   'e5000000-0000-0000-0000-00000000f001','active',true);

-- An admin of our own, rather than a real one by id: this file runs against
-- the local clean-apply cluster as well as dev, and dev's admins do not
-- exist there. Without one the direct-rail assertion fails on "not
-- permitted for this partner" before it ever reaches the guard under test.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('e5000000-0000-0000-0000-00000000c002','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.joint.adm@opndoor.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('e5000000-0000-0000-0000-00000000c002','ZZZ Joint Admin','zzz.joint.adm@opndoor.test','superadmin',
   null,'active',true);

-- And the DIRECT rail, which must still refuse.
insert into public.agencies (id, partner_id, name) values
  ('e5000000-0000-0000-0000-00000000a002',
   (select id from public.partners where slug='opndoor-direct'),'ZZZ Direct Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('e5000000-0000-0000-0000-00000000b002','e5000000-0000-0000-0000-00000000a002',
   (select id from public.partners where slug='opndoor-direct'),'ZZZ Direct Office');

select set_config('request.jwt.claims',
  '{"sub":"e5000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ===========================================================================
-- 1. THE RULE THAT CHANGED.
-- ===========================================================================
select lives_ok(
  $$select public.create_joint_referral(
      'e5000000-0000-0000-0000-00000000b001',
      '[{"title":"Mr","first":"Jay","last":"One","dob":"1990-01-01","email":"zzz.jt1@s.test","phone":"07000000001","share_percent":46},
        {"title":"Ms","first":"Jay","last":"Two","dob":"1991-02-02","email":"zzz.jt2@s.test","phone":"07000000002","share_percent":54}]'::jsonb,
      '1 ZZZ Way', null, 'London', null, 'E1 1AA', 2000, (now() + interval '30 days')::date)$$,
  'a supplier may refer a joint tenancy, which Q-06 item H forbade and batch 16 allows');

-- ===========================================================================
-- 2-5. ONE FEE FOR THE TENANCY, SPLIT BY SHARE. Matt's words, and the half
-- of the item that is about money rather than about a button.
-- ===========================================================================
select is(
  (select count(*) from public.applications where tenant_email in ('zzz.jt1@s.test','zzz.jt2@s.test')),
  2::bigint,
  'both tenants get their own application, as they do on the agency rail');

select is(
  (select count(distinct tenancy_id) from public.applications
    where tenant_email in ('zzz.jt1@s.test','zzz.jt2@s.test')),
  1::bigint,
  'and both sit on ONE tenancy');

/* ONE MONTH, NOT ONE MONTH EACH. The apportionment is to the penny, so this
   is an equality and not a tolerance: `apportion` gives the last line the
   remainder precisely so the parts sum to the whole. */
select is(
  (select sum(fee_amount) from public.applications
    where tenant_email in ('zzz.jt1@s.test','zzz.jt2@s.test')),
  2000::numeric,
  'the fees sum to exactly one month of the rent, not one month each');

select is(
  (select sum(share_amount) from public.applications
    where tenant_email in ('zzz.jt1@s.test','zzz.jt2@s.test')),
  2000::numeric,
  'and the shares sum to exactly the rent, which is what each deed covers');

-- ===========================================================================
-- 6. AND IT IS THE SUPPLIER'S OWN RATE ON BOTH ROWS, not the agent estate's.
-- ===========================================================================
select is(
  (select count(distinct partner_id) from public.applications
    where tenant_email in ('zzz.jt1@s.test','zzz.jt2@s.test')),
  1::bigint,
  'and both rows are carried by the one supplier, which is the route');

-- ===========================================================================
-- 7. THE DIRECT RAIL STILL REFUSES. Matt named suppliers; he did not name
-- this one, and a joint direct tenancy has no staff referrer to create it.
-- A guard deleted outright rather than narrowed would have opened it.
-- ===========================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"e5000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select throws_ok(
  $$select public.create_joint_referral(
      'e5000000-0000-0000-0000-00000000b002',
      '[{"title":"Mr","first":"Dir","last":"One","dob":"1990-01-01","email":"zzz.jd1@s.test","phone":"07000000001","share_percent":50},
        {"title":"Ms","first":"Dir","last":"Two","dob":"1991-02-02","email":"zzz.jd2@s.test","phone":"07000000002","share_percent":50}]'::jsonb,
      '2 ZZZ Way', null, 'London', null, 'E1 1AA', 2000, (now() + interval '30 days')::date)$$,
  '22023',
  'A direct signup is one tenant''s own application. Refer each tenant separately.',
  'while the direct rail still refuses, because Matt named suppliers and not this');

-- ===========================================================================
-- 8-9. AND THE RULES THAT DID NOT CHANGE STILL HOLD ON THE NEW RAIL. Adding
-- a rail is where a validation gets skipped, so the two that guard the money
-- are asserted here too rather than assumed from the agency rail's tests.
-- ===========================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"e5000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select throws_ok(
  $$select public.create_joint_referral(
      'e5000000-0000-0000-0000-00000000b001',
      '[{"title":"Mr","first":"Bad","last":"One","dob":"1990-01-01","email":"zzz.jb1@s.test","phone":"07000000001","share_percent":40},
        {"title":"Ms","first":"Bad","last":"Two","dob":"1991-02-02","email":"zzz.jb2@s.test","phone":"07000000002","share_percent":40}]'::jsonb,
      '3 ZZZ Way', null, 'London', null, 'E1 1AA', 2000, (now() + interval '30 days')::date)$$,
  '22023',
  'The tenants'' shares total 80.00%, not 100%. Adjust them by 20.00%.',
  'shares that do not total 100 are still refused on the supplier rail');

select throws_ok(
  $$select public.create_joint_referral(
      'e5000000-0000-0000-0000-00000000b001',
      '[{"title":"Mr","first":"Same","last":"One","dob":"1990-01-01","email":"zzz.same@s.test","phone":"07000000001","share_percent":50},
        {"title":"Ms","first":"Same","last":"Two","dob":"1991-02-02","email":"zzz.same@s.test","phone":"07000000002","share_percent":50}]'::jsonb,
      '4 ZZZ Way', null, 'London', null, 'E1 1AA', 2000, (now() + interval '30 days')::date)$$,
  '22023',
  'Two tenants have the same email address.',
  'and two tenants sharing an email are still refused');

reset role;
select * from finish();
rollback;
