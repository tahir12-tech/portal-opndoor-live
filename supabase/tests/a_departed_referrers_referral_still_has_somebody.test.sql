-- WHEN THE REFERRER HAS LEFT, THE DEED STILL HAS SOMEWHERE TO GO.
--
-- Matt, 2026-10-03: "When a referrer's access is removed or they're deleted,
-- their open referrals must still have someone to notify and to receive the
-- deed ... It should go to the office's or agency's email if set, otherwise
-- the agency's Directors, and the agency page should say 'N open referrals
-- from people who have left; deeds will go to [who]'."
--
-- THE LADDER IS THE WHOLE SUBJECT, and it has five rungs, each of which must
-- fire only when everything above it is empty. A test that only checked "is
-- somebody returned" would pass on every wrong answer, so each rung here is
-- reached by EMPTYING the one above it and the rung NAME is asserted, not just
-- the address.
--
--   1. referrer        the sender, while active
--   2. copy            everybody ticked whose position covers it
--   3. agency_contact  the office's own primary contact, else the agency's
--   4. director        active management WITH sees_commission
--   5. branch_manager  active management, the last resort
--
-- RUNG 5 IS NOT IN MATT'S SENTENCE and is tested hardest, because it is the
-- one I added reasoning rather than quoting: an agency with Managers and no
-- Director is a real shape, and a strict reading of "otherwise the Directors"
-- sends an executed Deed of Guarantee to nobody on it.

begin;
select plan(17);

insert into public.partners (id, slug, name, referencing_mode, is_house_route, partner_kind)
values ('d7000000-0000-0000-0000-0000000000a0','zzz-dep-house','ZZZ Departed House',
        'opndoor_referenced', false, 'agency');

insert into public.agencies (id, partner_id, name, review_state)
values ('d7000000-0000-0000-0000-0000000000b0','d7000000-0000-0000-0000-0000000000a0',
        'ZZZ Departed Agency','confirmed');

insert into public.branches (id, agency_id, partner_id, name, review_state)
values ('d7000000-0000-0000-0000-0000000000c0','d7000000-0000-0000-0000-0000000000b0',
        'd7000000-0000-0000-0000-0000000000a0','ZZZ Departed Office','confirmed');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       email, '', now(), now(), now()
from (values
  ('d7000000-0000-0000-0000-0000000000e1'::uuid,'zzz.dep.ref@a.test'),
  ('d7000000-0000-0000-0000-0000000000e2'::uuid,'zzz.dep.ticked@a.test'),
  ('d7000000-0000-0000-0000-0000000000e3'::uuid,'zzz.dep.director@a.test'),
  ('d7000000-0000-0000-0000-0000000000e4'::uuid,'zzz.dep.manager@a.test')
) as v(id, email);

-- THE NEGOTIATOR who sends it, A TICKED COLLEAGUE, A DIRECTOR and A MANAGER.
-- The last two differ only in sees_commission, which on this rail IS the
-- difference between the two levels.
insert into public.users (id, full_name, email, role, partner_id, status,
                          sees_commission, receives_notifications)
values ('d7000000-0000-0000-0000-0000000000e1','ZZZ Dep Referrer','zzz.dep.ref@a.test',
        'referrer','d7000000-0000-0000-0000-0000000000a0','active', false, true),
       ('d7000000-0000-0000-0000-0000000000e2','ZZZ Dep Ticked','zzz.dep.ticked@a.test',
        'referrer','d7000000-0000-0000-0000-0000000000a0','active', false, true),
       ('d7000000-0000-0000-0000-0000000000e3','ZZZ Dep Director','zzz.dep.director@a.test',
        'management','d7000000-0000-0000-0000-0000000000a0','active', true, false),
       ('d7000000-0000-0000-0000-0000000000e4','ZZZ Dep Manager','zzz.dep.manager@a.test',
        'management','d7000000-0000-0000-0000-0000000000a0','active', false, false);

insert into public.user_scopes (user_id, kind, branch_id, agency_id)
values ('d7000000-0000-0000-0000-0000000000e1','branch','d7000000-0000-0000-0000-0000000000c0', null),
       ('d7000000-0000-0000-0000-0000000000e2','branch','d7000000-0000-0000-0000-0000000000c0', null),
       ('d7000000-0000-0000-0000-0000000000e3','agency', null,'d7000000-0000-0000-0000-0000000000b0'),
       ('d7000000-0000-0000-0000-0000000000e4','agency', null,'d7000000-0000-0000-0000-0000000000b0');

/* A COMPLETE APPLICATION, because `assert_application_complete` refuses a
   half-filled one at 'sent' and the refusal is right: a referral the tenant
   can pay has to carry everything the deed needs. Every field below is here to
   satisfy that trigger, not because this file is about any of them. */
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, status,
   tenant_title, tenant_first_name, tenant_last_name, tenant_email, tenant_phone,
   tenant_dob, prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start,
   partner_rate, agent_rate, referencing_mode)
values ('d7000000-0000-0000-0000-0000000000f0','GR-ZZZ-DEP',
        'd7000000-0000-0000-0000-0000000000a0','d7000000-0000-0000-0000-0000000000b0',
        'd7000000-0000-0000-0000-0000000000c0','d7000000-0000-0000-0000-0000000000e1',
        'sent','Mr','ZZZ','Tenant','zzz.dep.tenant@t.test','07700 900000',
        '1990-01-01','1 ZZZ Street','London','SW1A 1AA', 1000, '2026-11-01',
        0.25, 0.10, 'opndoor_referenced');

-- ===========================================================================
-- RUNG 1. THE SENDER, WHILE ACTIVE
-- ===========================================================================
select is(
  (select rung from public.agency_notification_recipients('d7000000-0000-0000-0000-0000000000f0')
    where email = 'zzz.dep.ref@a.test'),
  'referrer', 'while the sender is active they are the referrer rung');

-- The ticked colleague is a copy at the same time, which is the pre-existing
-- behaviour and must survive every rung added below it.
select is(
  (select rung from public.agency_notification_recipients('d7000000-0000-0000-0000-0000000000f0')
    where email = 'zzz.dep.ticked@a.test'),
  'copy', 'and a ticked colleague is a copy');

-- Neither management rung fires while anybody above is there.
select is(
  (select count(*)::int from public.agency_notification_recipients('d7000000-0000-0000-0000-0000000000f0')
    where rung in ('agency_contact','director','branch_manager')),
  0, 'and no fallback rung fires while the sender is there');

-- ===========================================================================
-- RUNG 2. DELETED. The sender drops out; the ticked colleague carries it.
-- ===========================================================================
update public.users set status = 'deleted' where id = 'd7000000-0000-0000-0000-0000000000e1';

select is(
  (select count(*)::int from public.agency_notification_recipients('d7000000-0000-0000-0000-0000000000f0')
    where email = 'zzz.dep.ref@a.test'),
  0, 'a deleted sender is not written to');

select is(
  (select rung from public.agency_notification_recipients('d7000000-0000-0000-0000-0000000000f0')
    where email = 'zzz.dep.ticked@a.test'),
  'copy', 'and the ticked colleague still has it, so no fallback is needed yet');

select is(
  (select count(*)::int from public.agency_notification_recipients('d7000000-0000-0000-0000-0000000000f0')
    where rung in ('agency_contact','director','branch_manager')),
  0, 'and still no fallback rung');

-- ===========================================================================
-- RUNG 4. NOBODY TICKED AND NO CONTACT: the DIRECTOR, not the Manager.
-- Tested before rung 3 because the agency has no contact yet, which is
-- Regent's real shape on dev.
-- ===========================================================================
/* THROUGH THE GUARD'S OWN SWITCH. `users_notifications_tick_guard` refuses a
   direct UPDATE of this column -- "changed from the person's row, not by
   editing them directly" -- and `set_receives_notifications` is the door. A
   test is not an exception to that rule; it just has to say so. */
select set_config('app.setting_notifications_tick', 'on', true);
update public.users set receives_notifications = false
 where id = 'd7000000-0000-0000-0000-0000000000e2';
select set_config('app.setting_notifications_tick', 'off', true);

select is(
  (select rung from public.agency_notification_recipients('d7000000-0000-0000-0000-0000000000f0')
    where email = 'zzz.dep.director@a.test'),
  'director', 'with nobody ticked and no contact, the Director gets it');

/* THE ASSERTION THE INSTRUCTION TURNS ON. Management without
   sees_commission is a MANAGER, and Matt said Directors. */
select is(
  (select count(*)::int from public.agency_notification_recipients('d7000000-0000-0000-0000-0000000000f0')
    where email = 'zzz.dep.manager@a.test'),
  0, 'and the Manager does not, because the flag is the level on this rail');

-- ===========================================================================
-- RUNG 3. GIVE THE OFFICE AN EMAIL: it outranks the Directors.
-- ===========================================================================
insert into public.agent_contacts (branch_id, agency_id, partner_id, name, email, is_primary)
values ('d7000000-0000-0000-0000-0000000000c0', null,
        'd7000000-0000-0000-0000-0000000000a0','ZZZ Lettings Desk','desk@zzzdep.test', true);

select is(
  (select rung from public.agency_notification_recipients('d7000000-0000-0000-0000-0000000000f0')
    where email = 'desk@zzzdep.test'),
  'agency_contact', 'the office''s own email outranks the Directors');

select is(
  (select count(*)::int from public.agency_notification_recipients('d7000000-0000-0000-0000-0000000000f0')
    where rung in ('director','branch_manager')),
  0, 'and once it is set, no person rung fires at all');

-- The name is the contact's own where it has one, so the sender reads as a
-- desk rather than as a blank.
select is(
  (select display_name from public.agency_notification_recipients('d7000000-0000-0000-0000-0000000000f0')
    where email = 'desk@zzzdep.test'),
  'ZZZ Lettings Desk', 'and it is named');

-- ===========================================================================
-- RUNG 5. NO CONTACT, NO DIRECTOR: the Manager, rather than nobody.
-- ===========================================================================
delete from public.agent_contacts where email = 'desk@zzzdep.test';
update public.users set status = 'deactivated' where id = 'd7000000-0000-0000-0000-0000000000e3';

select is(
  (select rung from public.agency_notification_recipients('d7000000-0000-0000-0000-0000000000f0')
    where email = 'zzz.dep.manager@a.test'),
  'branch_manager',
  'an agency with Managers and no Director is not sent nothing at all');

-- ===========================================================================
-- AND THE DEED FOLLOWS THE SAME LADDER, which is the half Matt asked about
-- that is not an email: deed_delivery_target reads this function.
-- ===========================================================================
select is(
  (select count(*)::int from public.deed_delivery_target('d7000000-0000-0000-0000-0000000000f0')
    where email = 'zzz.dep.manager@a.test'),
  1, 'the signed deed goes to whoever the ladder answers');

select is(
  (select bool_and(auto_send) from public.deed_delivery_target('d7000000-0000-0000-0000-0000000000f0')),
  true, 'and goes automatically, so nobody has to notice the referrer left');

-- ===========================================================================
-- THE LINE ON THE AGENCY PAGE
-- ===========================================================================
select set_config('request.jwt.claims',
  json_build_object('sub','d7000000-0000-0000-0000-0000000000e4',
                    'role','authenticated','aal','aal2')::text, true);
set local role authenticated;

select is(
  (select open_count from public.org_departed_referrals()
    where agency_id = 'd7000000-0000-0000-0000-0000000000b0'),
  1, 'the agency page counts the one open referral of a departed person');

select is(
  (select goes_to from public.org_departed_referrals()
    where agency_id = 'd7000000-0000-0000-0000-0000000000b0'),
  array['ZZZ Dep Manager'],
  'and names who the deed will go to, read through the ladder itself');

reset role;

/* AND A CLOSED ONE IS NOT COUNTED. GR-20837 on dev is withdrawn, which is
   why Matt's own example produces no line today. */
update public.applications set status = 'withdrawn'
 where id = 'd7000000-0000-0000-0000-0000000000f0';

select set_config('request.jwt.claims',
  json_build_object('sub','d7000000-0000-0000-0000-0000000000e4',
                    'role','authenticated','aal','aal2')::text, true);
set local role authenticated;

select is(
  (select count(*)::int from public.org_departed_referrals()
    where agency_id = 'd7000000-0000-0000-0000-0000000000b0'),
  0, 'a withdrawn referral is closed, so it is not one of the N');

select finish();
rollback;
