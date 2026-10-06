-- A DELETED PERSON DISAPPEARS FROM PEOPLE AND KEEPS THEIR NAME.
--
-- Matt, 2026-10-03: "After access is removed, offer 'Delete': 'Delete Joe Joe?
-- They disappear from People. Their name stays on referrals and activity
-- they're part of.' The person is removed from People lists and can never sign
-- in, but their name stays wherever they appear on past records. Recorded in
-- Recent changes."
--
-- HIS SECOND SENTENCE IS WHY THIS IS A STATUS AND NOT A `delete from
-- public.users`. A real delete would take the row that
-- applications.referrer_id and user_audit.target_user point at, and would
-- either fail on the foreign keys or cascade and take a name off a guarantee
-- that person really did refer. The assertions below are mostly about that:
-- the application, its snapshotted referrer name and the audit trail all
-- survive the delete untouched.
--
-- AND IT IS TWO STEPS, NOT ONE. "After access is removed" is a precondition
-- the function enforces, so finding the RPC does not let somebody delete an
-- active person in one move.

begin;
select plan(12);

-- ===========================================================================
-- A SUPPLIER, AN AGENCY, A REFERRER WHO HAS REFERRED, AND AN ADMIN
-- ===========================================================================
insert into public.partners (id, slug, name, referencing_mode, is_house_route, partner_kind)
values ('9e000000-0000-0000-0000-0000000000a1','zzz-del','ZZZ Delete Co',
        'pre_referenced_open', false, 'supplier');
insert into public.agencies (id, partner_id, name)
values ('9e000000-0000-0000-0000-0000000000b1','9e000000-0000-0000-0000-0000000000a1','ZZZ Delete Agency');
insert into public.branches (id, agency_id, partner_id, name)
values ('9e000000-0000-0000-0000-0000000000c1','9e000000-0000-0000-0000-0000000000b1','9e000000-0000-0000-0000-0000000000a1','ZZZ Delete Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('9e000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.del.ref@l.test','',now(),now(),now()),
       ('9e000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.del.admin@o.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('9e000000-0000-0000-0000-0000000000d1','ZZZ Delete Referrer','zzz.del.ref@l.test',
        'referrer','9e000000-0000-0000-0000-0000000000a1','active',false),
       ('9e000000-0000-0000-0000-0000000000d2','ZZZ Delete Admin','zzz.del.admin@o.test',
        'superadmin', null, 'active', true);

-- Their referral, with the name snapshotted on it as #97 does.
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, referrer_name,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, fee_amount, tenancy_start,
   referencing_mode, partner_rate, agent_rate, status, sent_at, livemode)
values ('9e000000-0000-0000-0000-0000000000e1','ZZZ-DEL-1',
        '9e000000-0000-0000-0000-0000000000a1','9e000000-0000-0000-0000-0000000000b1',
        '9e000000-0000-0000-0000-0000000000c1','9e000000-0000-0000-0000-0000000000d1',
        'ZZZ Delete Referrer',
        'Ms','Del','One','1990-01-01','zzz.del1@l.test','07700900301',
        '1 ZZZ Delete Street','London','SW1A 1AA', 2000, 2000, '2026-12-01',
        'pre_referenced_open', 0.25, 0.1, 'sent', now(), true);

select set_config('request.jwt.claims',
  '{"sub":"9e000000-0000-0000-0000-0000000000d2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ===========================================================================
-- 1. ACCESS COMES OFF FIRST. Delete refuses an active person outright.
-- ===========================================================================
select throws_ok(
  $$select public.admin_delete_user('9e000000-0000-0000-0000-0000000000d1')$$,
  '42501',
  'Remove their access first, then delete them.',
  'an active person cannot be deleted in one move');

select is(
  (select status from public.users where id = '9e000000-0000-0000-0000-0000000000d1'),
  'active', 'and the refusal changed nothing');

-- ===========================================================================
-- 2. REMOVE ACCESS, THEN DELETE
-- ===========================================================================
select is(
  (select status from public.admin_set_user_status('9e000000-0000-0000-0000-0000000000d1','deactivated')),
  'deactivated', 'access comes off first, as the screens do it');

select is(
  (select status from public.admin_delete_user('9e000000-0000-0000-0000-0000000000d1')),
  'deleted', 'and then they can be deleted');

-- ===========================================================================
-- 3. OFF EVERY PEOPLE LIST, which is one clause in list_managed_users
-- ===========================================================================
select is(
  (select count(*)::int from public.list_managed_users()
    where id = '9e000000-0000-0000-0000-0000000000d1'),
  0, 'they disappear from People');

select is(
  (select count(*)::int from public.list_managed_users()
    where id = '9e000000-0000-0000-0000-0000000000d2'),
  1, 'and everybody else is still listed');

-- ===========================================================================
-- 4. THEIR NAME STAYS WHEREVER IT ALREADY IS
-- ===========================================================================
reset role;
select is(
  (select referrer_name from public.applications where id = '9e000000-0000-0000-0000-0000000000e1'),
  'ZZZ Delete Referrer', 'their name stays on the referral');

select is(
  (select referrer_id from public.applications where id = '9e000000-0000-0000-0000-0000000000e1'),
  '9e000000-0000-0000-0000-0000000000d1'::uuid,
  'and the row still points at them: nothing cascaded');

select is(
  (select count(*)::int from public.users where id = '9e000000-0000-0000-0000-0000000000d1'),
  1, 'because the person row is still there, with a status on it');

-- "Recorded in Recent changes": the feed reads user_audit.
select is(
  (select count(*)::int from public.user_audit
    where target_user = '9e000000-0000-0000-0000-0000000000d1'
      and action = 'status' and old_value = 'deactivated' and new_value = 'deleted'),
  1, 'and the delete is in Recent changes');

-- ===========================================================================
-- 5. THEY CAN NEVER SIGN IN
-- ===========================================================================
select is(
  (select banned_until from auth.users where id = '9e000000-0000-0000-0000-0000000000d1'),
  'infinity'::timestamptz, 'and they can never sign in');

-- ===========================================================================
-- 6. NOBODY DELETES THEMSELVES
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"9e000000-0000-0000-0000-0000000000d2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.admin_delete_user('9e000000-0000-0000-0000-0000000000d2')$$,
  '42501',
  NULL,
  'and nobody deletes their own account');

reset role;
select * from finish();
rollback;
