-- ONE DOOR FOR WHO GETS TOLD.
--
-- notification_recipients is what every agent-facing send path asks. This is
-- the AFTER half of docs/NOTIFICATIONS.md, asserted: the three gaps that
-- document names, closed, and the things it says must not change, unchanged.
--
-- The three gaps, all on the supplier rail:
--   the executed deed does not reach the referrer
--   the four lifecycle notifications do not reach the agent contact
--   the expiry reminder adds partner management instead of the agent contact
--
-- And the case Q-02's last sentence names: a supplier referring through an API
-- key with no human user attached is told nothing at all today, because the
-- only recipient was a referrer who does not exist.

begin;
select plan(14);

-- ===========================================================================
-- A SUPPLIER WITH A BRANCH DESK, AND AN AGENCY WITH A LADDER
-- ===========================================================================
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled, partner_kind)
values ('90000000-0000-0000-0000-0000000000d1','zzz-door-supplier','ZZZ Door Supplier',
        'pre_referenced_open', 0.25, 0.10, false, false, true, true, 'supplier');

insert into public.agencies (id, partner_id, name) values
  ('90000000-0000-0000-0000-0000000000f1','90000000-0000-0000-0000-0000000000d1','ZZZ Door Supplier Agency'),
  ('90000000-0000-0000-0000-0000000000a1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Door Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('90000000-0000-0000-0000-0000000000f2','90000000-0000-0000-0000-0000000000f1','90000000-0000-0000-0000-0000000000d1','ZZZ Door Supplier Office'),
  ('90000000-0000-0000-0000-0000000000b1','90000000-0000-0000-0000-0000000000a1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Door Office');

-- agent_contacts_one_owner: a contact belongs to an agency OR a branch, not
-- both. This is the branch desk, which is what the supplier rail resolves to.
insert into public.agent_contacts (branch_id, partner_id, name, email, is_primary) values
  ('90000000-0000-0000-0000-0000000000f2','90000000-0000-0000-0000-0000000000d1','ZZZ Door Desk','desk@door.test',true);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),now(),now()
from (values
  ('90000000-0000-0000-0000-00000000c001'::uuid,'zzz.door.supref@door.test'),
  ('90000000-0000-0000-0000-00000000c002'::uuid,'zzz.door.neg@door.test'),
  ('90000000-0000-0000-0000-00000000c003'::uuid,'zzz.door.dir@door.test'),
  ('90000000-0000-0000-0000-0000000000ff'::uuid,'zzz.door.admin@door.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, home_branch_id) values
  ('90000000-0000-0000-0000-00000000c001','ZZZ Door Supplier Ref','zzz.door.supref@door.test','referrer','90000000-0000-0000-0000-0000000000d1','active',false,null),
  ('90000000-0000-0000-0000-00000000c002','ZZZ Door Neg','zzz.door.neg@door.test','referrer',(select id from public.partners where slug='opndoor-agents'),'active',false,'90000000-0000-0000-0000-0000000000b1'),
  ('90000000-0000-0000-0000-00000000c003','ZZZ Door Dir','zzz.door.dir@door.test','management',(select id from public.partners where slug='opndoor-agents'),'active',true,null),
  -- The matrix is edited by somebody. Opndoor admin may edit any party's.
  ('90000000-0000-0000-0000-0000000000ff','ZZZ Door Admin','zzz.door.admin@door.test','superadmin',null,'active',true,null);

insert into public.user_scopes (user_id, kind, agency_id, branch_id) values
  ('90000000-0000-0000-0000-00000000c002','branch',null,'90000000-0000-0000-0000-0000000000b1'),
  ('90000000-0000-0000-0000-00000000c003','agency','90000000-0000-0000-0000-0000000000a1',null);

insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, referrer_name,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start, status, livemode,
   partner_rate, agent_rate, referencing_mode, sent_at)
values
  ('90000000-0000-0000-0000-00000000e001','ZZZ-DOOR-SU','90000000-0000-0000-0000-0000000000d1',
   '90000000-0000-0000-0000-0000000000f1','90000000-0000-0000-0000-0000000000f2','90000000-0000-0000-0000-00000000c001','ZZZ Door Supplier Ref',
   'Mx','Sam','Supplier','1990-01-01','sam@door.test','07700900071','1 Door Street','London','DR1 1AA',1000,current_date+30,'sent',true,0.25,0.10,'pre_referenced_open',now()),
  ('90000000-0000-0000-0000-00000000e002','ZZZ-DOOR-AG',(select id from public.partners where slug='opndoor-agents'),
   '90000000-0000-0000-0000-0000000000a1','90000000-0000-0000-0000-0000000000b1','90000000-0000-0000-0000-00000000c002','ZZZ Door Neg',
   'Mx','Ann','Agency','1990-01-01','ann@door.test','07700900072','2 Door Street','London','DR2 2AA',1000,current_date+30,'sent',true,0.25,0.10,'opndoor_referenced',now());

-- ===========================================================================
-- GAP 1: THE EXECUTED DEED NOW REACHES THE SUPPLIER'S REFERRER
-- ===========================================================================
select set_eq(
  $$select email::text from public.notification_recipients('90000000-0000-0000-0000-00000000e001','deed_issued')$$,
  $$values ('zzz.door.supref@door.test'::text), ('desk@door.test'::text)$$,
  'the supplier deed goes to the referrer AND the branch agent contact');
select is(
  (select recipient_class from public.notification_recipients('90000000-0000-0000-0000-00000000e001','deed_issued')
    where email = 'desk@door.test'),
  'agent_contact',
  'and each address says which class put it there');

-- ===========================================================================
-- GAP 2 and 3: THE DEFAULTS DECIDE THE REST, and they are not "everything"
-- ===========================================================================
-- On a supplier, everything is on for the referrer and deed issued only for
-- the agent contact. So `sent` reaches the referrer alone until somebody
-- turns the desk on -- which is the whole point of doing Q-02 with Q-03.
select set_eq(
  $$select email::text from public.notification_recipients('90000000-0000-0000-0000-00000000e001','sent')$$,
  $$values ('zzz.door.supref@door.test'::text)$$,
  'a supplier "sent" reaches the referrer alone, by default');

-- Everything from here is done AS SOMEBODY: set_notification_setting is
-- MFA-gated and permission-checked, so a claimless session is refused before
-- it reaches the rule under test.
select set_config('request.jwt.claims',
  '{"sub":"90000000-0000-0000-0000-0000000000ff","role":"authenticated","aal":"aal2"}', true);
select lives_ok(
  $$select public.set_notification_setting('90000000-0000-0000-0000-0000000000d1', null, 'sent', 'agent_contact', true)$$,
  'and Opndoor can turn the desk on for it');
select set_eq(
  $$select email::text from public.notification_recipients('90000000-0000-0000-0000-00000000e001','sent')$$,
  $$values ('zzz.door.supref@door.test'::text), ('desk@door.test'::text)$$,
  'after which it reaches both');

-- The same switch the other way, on a type that is on by default.
select lives_ok(
  $$select public.set_notification_setting('90000000-0000-0000-0000-0000000000d1', null, 'lapse', 'referrer', false)$$,
  'and can turn the referrer off for the expiry reminder');
select is(
  (select count(*)::int from public.notification_recipients('90000000-0000-0000-0000-00000000e001','lapse')), 0,
  'after which nobody on that supplier is told about a lapse');

-- ===========================================================================
-- THE CASE Q-02'S LAST SENTENCE NAMES
-- ===========================================================================
-- "Where the referrer is an API partner with no human user attached, the agent
-- contact still receives what item 2 allows."
--
-- That shape is NOT a null referrer: assert_application_attributed refuses an
-- application with neither a referrer nor an applicant off a house route, so
-- attribution on the supplier rail is always present. What it actually looks
-- like is a referrer row that is not a live person -- a service account for the
-- key, or somebody who has left -- which is why the resolver tests
-- `u.status = 'active'` rather than testing for a row at all.
update public.users set status = 'deactivated'
 where id = '90000000-0000-0000-0000-00000000c001';
select set_eq(
  $$select email::text from public.notification_recipients('90000000-0000-0000-0000-00000000e001','deed_issued')$$,
  $$values ('desk@door.test'::text)$$,
  'with no live person behind the referral the deed still reaches the desk');
select set_eq(
  $$select email::text from public.notification_recipients('90000000-0000-0000-0000-00000000e001','sent')$$,
  $$values ('desk@door.test'::text)$$,
  'and so does anything else the matrix has turned on for it');

-- ===========================================================================
-- THE AGENCY RAIL IS THE LADDER, FILTERED, NOT REPLACED
-- ===========================================================================
select set_eq(
  $$select email::text from public.notification_recipients('90000000-0000-0000-0000-00000000e002','deed_issued')$$,
  $$values ('zzz.door.neg@door.test'::text)$$,
  'the agency deed goes to the referrer, with nobody ticked');

select set_config('app.setting_notifications_tick', 'on', true);
update public.users set receives_notifications = true where id = '90000000-0000-0000-0000-00000000c003';
select set_config('app.setting_notifications_tick', 'off', true);

select set_eq(
  $$select email::text from public.notification_recipients('90000000-0000-0000-0000-00000000e002','deed_issued')$$,
  $$values ('zzz.door.neg@door.test'::text), ('zzz.door.dir@door.test'::text)$$,
  'and picks up a ticked Director whose position covers it, as the ladder already said');

-- AND THE MATRIX CAN TURN THE COPIES OFF WITHOUT TOUCHING THE DEED ITSELF.
select lives_ok(
  $$select public.set_notification_setting(null, '90000000-0000-0000-0000-0000000000a1', 'deed_issued', 'ticked_users', false)$$,
  'an agency can stop copying its ticked users on the deed');
select set_eq(
  $$select email::text from public.notification_recipients('90000000-0000-0000-0000-00000000e002','deed_issued')$$,
  $$values ('zzz.door.neg@door.test'::text)$$,
  'and the deed still reaches the referrer, because that cell is locked');

-- ===========================================================================
-- THE DIRECT RAIL HAS NO AGENT-FACING PARTY
-- ===========================================================================
update public.applications set partner_id = (select id from public.partners where slug='opndoor-direct'),
                               referrer_id = null
 where id = '90000000-0000-0000-0000-00000000e002';
select is(
  (select count(*)::int from public.notification_recipients('90000000-0000-0000-0000-00000000e002','deed_issued')), 0,
  'a direct tenant''s deed resolves to nobody here: it goes to the contact they named, not to the agency they were matched to');

select * from finish();
rollback;
