-- THE DEED GOES TO WHOEVER SENT THE REFERRAL.
--
-- Every assertion here fails against the code before 20261006160000, because
-- the old resolver read the BRANCH and never the application: four rungs,
-- nominated recipient then branch then agency then group scope,
-- `order by pri asc, email asc limit 1`. On dev that sent Tom Reeve's two
-- referrals to Rosa Vance, whose address sorts first.
--
-- The fixtures are built from scratch rather than leaning on dev's rows, so
-- the file says what it means on a clone and on an empty database.

begin;
select plan(18);

-- ---------------------------------------------------------------------------
-- AN AGENCY ON THE HOUSE ROUTE, with a negotiator, a manager and a director.
-- ---------------------------------------------------------------------------
insert into public.agencies (id, partner_id, name)
values ('95000000-0000-0000-0000-00000000000a',
        (select id from public.partners where slug = 'opndoor-agents'), 'ZZZ Notify Lettings');
insert into public.branches (id, agency_id, partner_id, name)
values ('95000000-0000-0000-0000-0000000000b1', '95000000-0000-0000-0000-00000000000a',
        (select id from public.partners where slug = 'opndoor-agents'), 'ZZZ Notify Park'),
       ('95000000-0000-0000-0000-0000000000b2', '95000000-0000-0000-0000-00000000000a',
        (select id from public.partners where slug = 'opndoor-agents'), 'ZZZ Notify Quay');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', x.email, '', now(), now(), now()
from (values
  ('95000000-0000-0000-0000-00000000e0a1'::uuid, 'zzz.neg@notify.test'),
  ('95000000-0000-0000-0000-00000000e0a2'::uuid, 'zzz.dir@notify.test'),
  ('95000000-0000-0000-0000-00000000e0a3'::uuid, 'zzz.branchmgr@notify.test'),
  ('95000000-0000-0000-0000-00000000e0a4'::uuid, 'zzz.other@notify.test')
) as x(id, email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, home_branch_id)
values
  -- The negotiator who sends the referral. Their address sorts LAST on purpose:
  -- under the old rule the alphabet decided, and this one would never have won.
  ('95000000-0000-0000-0000-00000000e0a1', 'ZZZ Neg', 'zzz.neg@notify.test', 'referrer',
   (select id from public.partners where slug='opndoor-agents'), 'active', false,
   '95000000-0000-0000-0000-0000000000b1'),
  ('95000000-0000-0000-0000-00000000e0a2', 'ZZZ Dir', 'zzz.dir@notify.test', 'management',
   (select id from public.partners where slug='opndoor-agents'), 'active', true, null),
  ('95000000-0000-0000-0000-00000000e0a3', 'ZZZ BranchMgr', 'zzz.branchmgr@notify.test', 'management',
   (select id from public.partners where slug='opndoor-agents'), 'active', false, null),
  -- Somebody at the OTHER branch of the same agency, to prove a branch position
  -- does not reach across.
  ('95000000-0000-0000-0000-00000000e0a4', 'ZZZ Other', 'zzz.other@notify.test', 'management',
   (select id from public.partners where slug='opndoor-agents'), 'active', false, null);

insert into public.user_scopes (user_id, kind, agency_id, branch_id, group_id)
values ('95000000-0000-0000-0000-00000000e0a2', 'agency', '95000000-0000-0000-0000-00000000000a', null, null),
       ('95000000-0000-0000-0000-00000000e0a3', 'branch', null, '95000000-0000-0000-0000-0000000000b1', null),
       ('95000000-0000-0000-0000-00000000e0a4', 'branch', null, '95000000-0000-0000-0000-0000000000b2', null);

insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, referrer_name,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode,
   monthly_rent, tenancy_start, status, livemode, partner_rate, agent_rate, referencing_mode,
   sent_at, paid_at, deed_issued_at)
values ('95000000-0000-0000-0000-0000000000f1', 'GR-ZZZ901',
        (select id from public.partners where slug='opndoor-agents'),
        '95000000-0000-0000-0000-00000000000a', '95000000-0000-0000-0000-0000000000b1',
        '95000000-0000-0000-0000-00000000e0a1', 'ZZZ Neg',
        'Mx', 'Zed', 'Tenant', '1990-01-01', 'zzz.tenant@notify.test', '07700 900900',
        '1 ZZZ Road', 'London', 'N1 1ZZ',
        1500, current_date + 30, 'deed', true, 0.25, 0.10, 'opndoor_referenced',
        now() - interval '10 days', now() - interval '9 days', now() - interval '8 days');

-- ---------------------------------------------------------------------------
-- THE RULE.
-- ---------------------------------------------------------------------------
select is(
  (select r.email from public.agency_notification_recipients('95000000-0000-0000-0000-0000000000f1') r),
  'zzz.neg@notify.test',
  'the person who sent the referral is the recipient');

select is(
  (select r.rung from public.agency_notification_recipients('95000000-0000-0000-0000-0000000000f1') r),
  'referrer', 'and is named as the referrer, not as an anonymous org person');

-- THE OLD ANSWER, stated so the difference is on the record. The branch ladder
-- still exists as the fallback, and on this fixture it resolves the branch
-- manager: that is who the deed used to go to instead of the sender.
select is(
  (select t.email from public.deed_people_target('95000000-0000-0000-0000-0000000000b1') t),
  'zzz.branchmgr@notify.test',
  'the branch ladder, which is what used to decide, answers somebody else entirely');

select is(
  (select t.email from public.deed_delivery_target('95000000-0000-0000-0000-0000000000f1') t),
  'zzz.neg@notify.test', 'so the executed deed now goes to the sender');
select is(
  (select t.source from public.deed_delivery_target('95000000-0000-0000-0000-0000000000f1') t),
  'referrer', 'and the row says why');
select ok(
  (select t.auto_send from public.deed_delivery_target('95000000-0000-0000-0000-0000000000f1') t),
  'automatically, without waiting for a person');

-- ---------------------------------------------------------------------------
-- WHO ELSE IS COPIED: the tick, scoped by the position somebody already holds.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.agency_notification_recipients('95000000-0000-0000-0000-0000000000f1')),
  1, 'nobody is copied by default');

-- The agency-positioned director.
select set_config('app.setting_notifications_tick', 'on', true);
update public.users set receives_notifications = true where id = '95000000-0000-0000-0000-00000000e0a2';
select set_config('app.setting_notifications_tick', 'off', true);

select is(
  (select string_agg(r.email, ',' order by r.email) from public.agency_notification_recipients('95000000-0000-0000-0000-0000000000f1') r),
  'zzz.dir@notify.test,zzz.neg@notify.test',
  'an agency-positioned tick is copied on a referral from any of its branches');

-- The OTHER branch's manager, ticked, must not be.
select set_config('app.setting_notifications_tick', 'on', true);
update public.users set receives_notifications = true where id = '95000000-0000-0000-0000-00000000e0a4';
select set_config('app.setting_notifications_tick', 'off', true);

select ok(
  not exists (select 1 from public.agency_notification_recipients('95000000-0000-0000-0000-0000000000f1') r
               where r.email = 'zzz.other@notify.test'),
  'a branch-positioned tick does not reach another branch');

-- And the branch-positioned manager at the RIGHT branch is.
select set_config('app.setting_notifications_tick', 'on', true);
update public.users set receives_notifications = true where id = '95000000-0000-0000-0000-00000000e0a3';
select set_config('app.setting_notifications_tick', 'off', true);

select ok(
  exists (select 1 from public.agency_notification_recipients('95000000-0000-0000-0000-0000000000f1') r
           where r.email = 'zzz.branchmgr@notify.test'),
  'a branch-positioned tick is copied on that branch');

-- ---------------------------------------------------------------------------
-- THE FALLBACK, when the sender has gone.
-- ---------------------------------------------------------------------------
update public.users set status = 'deactivated' where id = '95000000-0000-0000-0000-00000000e0a1';

select ok(
  not exists (select 1 from public.agency_notification_recipients('95000000-0000-0000-0000-0000000000f1') r
               where r.email = 'zzz.neg@notify.test'),
  'a deactivated sender is not emailed');
select ok(
  exists (select 1 from public.agency_notification_recipients('95000000-0000-0000-0000-0000000000f1') r
           where r.rung = 'copy'),
  'and the ticked people in scope carry it instead');

-- Untick everybody: it falls to a manager covering the branch.
select set_config('app.setting_notifications_tick', 'on', true);
update public.users set receives_notifications = false
 where id in ('95000000-0000-0000-0000-00000000e0a2','95000000-0000-0000-0000-00000000e0a3','95000000-0000-0000-0000-00000000e0a4');
select set_config('app.setting_notifications_tick', 'off', true);

select is(
  (select min(r.rung) from public.agency_notification_recipients('95000000-0000-0000-0000-0000000000f1') r),
  'branch_manager', 'with nobody ticked it falls to a manager covering the branch');

-- Nobody left at all: park, and do not auto-send.
update public.users set status = 'deactivated'
 where id in ('95000000-0000-0000-0000-00000000e0a2','95000000-0000-0000-0000-00000000e0a3','95000000-0000-0000-0000-00000000e0a4');

select is(
  (select count(*)::int from public.agency_notification_recipients('95000000-0000-0000-0000-0000000000f1')),
  0, 'with nobody left there is no recipient');
select ok(
  not (select t.auto_send from public.deed_delivery_target('95000000-0000-0000-0000-0000000000f1') t),
  'so the deed is not sent automatically, and the webhook parks it');

-- ---------------------------------------------------------------------------
-- THE OTHER RAILS, unchanged.
-- ---------------------------------------------------------------------------
-- DIRECT: the tenant's own named contact, which the people ladder used to beat
-- because opndoor-direct is itself seeded referencing_mode 'opndoor_referenced'.
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, referrer_name,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode,
   monthly_rent, tenancy_start, status, livemode, partner_rate, agent_rate, referencing_mode,
   sent_at, paid_at, deed_issued_at)
values ('95000000-0000-0000-0000-0000000000f2', 'GR-ZZZ902',
        (select id from public.partners where slug='opndoor-direct'),
        '95000000-0000-0000-0000-00000000000a', '95000000-0000-0000-0000-0000000000b1',
        null, null,
        'Mx', 'Dee', 'Rect', '1990-01-01', 'zzz.direct@notify.test', '07700 900901',
        '2 ZZZ Road', 'London', 'N1 2ZZ',
        1500, current_date + 30, 'deed', true, 0.25, 0.10, 'pre_referenced_open',
        now() - interval '10 days', now() - interval '9 days', now() - interval '8 days');
-- delivery_contact_named wants the agency name, a surname and a phone on a
-- letting_agent row: this is the contact the TENANT typed in, so it is
-- identified as fully as the form makes them identify it.
insert into public.application_delivery_contacts (application_id, kind, agency_name, first_name, last_name, phone, email)
values ('95000000-0000-0000-0000-0000000000f2', 'letting_agent', 'ZZZ Tenants Choice Lettings',
        'Tenants', 'Choice', '07700 900902', 'zzz.tenantschoice@notify.test');

select is(
  (select count(*)::int from public.agency_notification_recipients('95000000-0000-0000-0000-0000000000f2')),
  0, 'a direct application has no agency-rail recipients at all');
select is(
  (select t.email from public.deed_delivery_target('95000000-0000-0000-0000-0000000000f2') t),
  'zzz.tenantschoice@notify.test',
  'and its deed goes to the contact the TENANT named, not to the agency its branch points at');
select is(
  (select t.source from public.deed_delivery_target('95000000-0000-0000-0000-0000000000f2') t),
  'delivery_contact', 'said plainly in the source');

select * from finish();
rollback;
