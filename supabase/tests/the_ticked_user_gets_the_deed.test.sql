-- THE TICKED USER GETS THE DEED.
--
-- The rule: on an agency referral the executed deed goes to the user who sent
-- it AND to every user ticked "Receives notifications" whose position covers
-- the referral, as one send with each as a recipient, the same as every other
-- per-application notification.
--
-- agency_notification_recipients has always returned that list, and the
-- expiry reminder and the renewal notice are sent to all of it.
-- deed_delivery_target read the same list and took `limit 1`, so the one
-- notification carrying the signed instrument went to a single address. A
-- Director who ticked themselves received every lesser notification and not
-- the deed.
--
-- EVERY ASSERTION BELOW FAILS AGAINST THAT VERSION: each one counts rows or
-- looks for a second address, and the old resolver could only ever return
-- one row.
--
-- The three rails are asserted together, because the fix must not make the
-- other two plural: a supplier referral has one branch contact and a direct
-- tenant has one nominated contact, and inventing a list for them would be
-- the same mistake in the other direction.
--
-- AND SINCE 2026-10-02 THE AGENCY RAIL CARRIES ONE MORE. Matt: "The agency
-- or a branch can optionally add an email that ALSO receives the deed;
-- leave it blank and nothing is missing." So on our own estate the deed's
-- recipients are the ladder PLUS that mailbox where somebody has set one,
-- which makes the deed a superset of the list every other notification
-- uses rather than the same list. That is the one place the sentence at
-- the top of this file is now narrower than it was, and the counts below
-- are the only thing that changed: this agency's fixture has a mailbox
-- (`agencydesk@t.test`), so every agency-rail count here is one higher.
-- The supplier and direct rails are untouched, and still singular.

begin;
select plan(16);

-- ===========================================================================
-- ONE AGENCY ON THE HOUSE PARTNER, A SUPPLIER, AND A DIRECT TENANT
-- ===========================================================================
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled)
values ('94000000-0000-0000-0000-0000000000d1', 'zzz-tick-supplier', 'ZZZ Tick Supplier',
        'pre_referenced_open', 0.25, 0.10, false, false, true, true);

insert into public.agencies (id, partner_id, name) values
  ('94000000-0000-0000-0000-0000000000a1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Tick Agency'),
  ('94000000-0000-0000-0000-0000000000a2','94000000-0000-0000-0000-0000000000d1','ZZZ Tick Supplier Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('94000000-0000-0000-0000-0000000000b1','94000000-0000-0000-0000-0000000000a1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Tick Office'),
  ('94000000-0000-0000-0000-0000000000b2','94000000-0000-0000-0000-0000000000a2','94000000-0000-0000-0000-0000000000d1','ZZZ Tick Supplier Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),now(),now()
from (values
  ('94000000-0000-0000-0000-00000000c001'::uuid,'zzz.tick.dir@t.test'),
  ('94000000-0000-0000-0000-00000000c002'::uuid,'zzz.tick.neg@t.test'),
  ('94000000-0000-0000-0000-00000000c003'::uuid,'zzz.tick.other@t.test'),
  ('94000000-0000-0000-0000-00000000c004'::uuid,'zzz.tick.supref@t.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, home_branch_id) values
  ('94000000-0000-0000-0000-00000000c001','ZZZ Tick Dir','zzz.tick.dir@t.test','management',(select id from public.partners where slug='opndoor-agents'),'active',true,null),
  ('94000000-0000-0000-0000-00000000c002','ZZZ Tick Neg','zzz.tick.neg@t.test','referrer',(select id from public.partners where slug='opndoor-agents'),'active',false,'94000000-0000-0000-0000-0000000000b1'),
  -- A Director at a DIFFERENT agency, ticked. Their position does not cover
  -- this referral, so the tick must not reach them: the scope is the position
  -- they already hold, never a second setting.
  ('94000000-0000-0000-0000-00000000c003','ZZZ Tick Other Dir','zzz.tick.other@t.test','management',(select id from public.partners where slug='opndoor-agents'),'active',true,null),
  -- The supplier's own referrer. Attribution is NOT NULL on a non-house route,
  -- and the supplier rail needs no position: there the partner IS the company.
  ('94000000-0000-0000-0000-00000000c004','ZZZ Supplier Ref','zzz.tick.supref@t.test','referrer','94000000-0000-0000-0000-0000000000d1','active',false,null);

insert into public.agencies (id, partner_id, name) values
  ('94000000-0000-0000-0000-0000000000a3',(select id from public.partners where slug='opndoor-agents'),'ZZZ Tick Elsewhere');
insert into public.branches (id, agency_id, partner_id, name) values
  ('94000000-0000-0000-0000-0000000000b3','94000000-0000-0000-0000-0000000000a3',(select id from public.partners where slug='opndoor-agents'),'ZZZ Tick Elsewhere Office');

insert into public.user_scopes (user_id, kind, agency_id, branch_id) values
  ('94000000-0000-0000-0000-00000000c001','agency','94000000-0000-0000-0000-0000000000a1',null),
  ('94000000-0000-0000-0000-00000000c002','branch',null,'94000000-0000-0000-0000-0000000000b1'),
  ('94000000-0000-0000-0000-00000000c003','agency','94000000-0000-0000-0000-0000000000a3',null);

insert into public.agent_contacts (agency_id, partner_id, name, email, is_primary) values
  ('94000000-0000-0000-0000-0000000000a1',(select id from public.partners where slug='opndoor-agents'),'ZZZ Tick Desk','agencydesk@t.test',true),
  ('94000000-0000-0000-0000-0000000000a2','94000000-0000-0000-0000-0000000000d1','ZZZ Supplier Desk','supplierdesk@t.test',true);

insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, referrer_name,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start, status, livemode,
   partner_rate, agent_rate, referencing_mode, sent_at, paid_at, deed_issued_at)
values
  ('94000000-0000-0000-0000-00000000e001','ZZZ-TICK-AG',(select id from public.partners where slug='opndoor-agents'),
   '94000000-0000-0000-0000-0000000000a1','94000000-0000-0000-0000-0000000000b1','94000000-0000-0000-0000-00000000c002','ZZZ Tick Neg',
   'Mx','Tess','Ticked','1990-01-01','tess@t.test','07700900021','1 Tick Street','London','TK1 1AA',1000,current_date+30,'deed',true,0.25,0.10,'opndoor_referenced',
   now()-interval '10 days', now()-interval '9 days', now()-interval '8 days'),
  ('94000000-0000-0000-0000-00000000e002','ZZZ-TICK-SU','94000000-0000-0000-0000-0000000000d1',
   '94000000-0000-0000-0000-0000000000a2','94000000-0000-0000-0000-0000000000b2','94000000-0000-0000-0000-00000000c004','ZZZ Supplier Ref',
   'Mx','Sam','Supplier','1990-01-01','sam@t.test','07700900022','2 Tick Street','London','TK2 2AA',1000,current_date+30,'deed',true,0.25,0.10,'pre_referenced_open',
   now()-interval '10 days', now()-interval '9 days', now()-interval '8 days'),
  ('94000000-0000-0000-0000-00000000e003','ZZZ-TICK-DI',(select id from public.partners where slug='opndoor-direct'),
   '94000000-0000-0000-0000-0000000000a1','94000000-0000-0000-0000-0000000000b1',null,'Direct',
   'Mx','Dora','Direct','1990-01-01','dora@t.test','07700900023','3 Tick Street','London','TK3 3AA',1000,current_date+30,'deed',true,0.25,0.10,'opndoor_referenced',
   now()-interval '10 days', now()-interval '9 days', now()-interval '8 days');

-- The direct tenant's own nominated contact. The application's branch_id
-- points at an agency, which is what the auto-matcher does, so this is the
-- case where the deed must NOT reach that agency.
insert into public.application_delivery_contacts (application_id, kind, agency_name, first_name, last_name, phone, email)
values ('94000000-0000-0000-0000-00000000e003','letting_agent','Doras Own Agents','Dee','Agent','07700900099','doras.agent@t.test');

-- ===========================================================================
-- BEFORE THE TICK: the referrer, and only the referrer
-- ===========================================================================
select is((select count(*)::int from public.deed_delivery_target('94000000-0000-0000-0000-00000000e001')), 2,
  'with nobody ticked, the agency deed resolves to the sender and the agency mailbox');
select is((select t.email from public.deed_delivery_target('94000000-0000-0000-0000-00000000e001') t
            where t.source = 'referrer'),
  'zzz.tick.neg@t.test',
  'and the person on it is the Negotiator who sent it');
/* THE SECOND ONE IS THE OPTIONAL MAILBOX, which this agency happens to
   have. Named here so the count above is not a number somebody has to
   work out, and so that removing the arm shows up as two failures rather
   than one off-by-one. */
select is((select t.email from public.deed_delivery_target('94000000-0000-0000-0000-00000000e001') t
            where t.source = 'branch_contact'),
  'agencydesk@t.test',
  'and the other is the agency''s own address, which also receives it');

-- ===========================================================================
-- TICK THE DIRECTOR, whose agency position covers the referral
-- ===========================================================================
select set_config('app.setting_notifications_tick', 'on', true);
update public.users set receives_notifications = true
 where id in ('94000000-0000-0000-0000-00000000c001', '94000000-0000-0000-0000-00000000c003');
select set_config('app.setting_notifications_tick', 'off', true);

-- THE ASSERTION THE WHOLE FILE IS FOR. More rows, not one. Three now: the
-- sender, the ticked Director, and the agency mailbox.
select is((select count(*)::int from public.deed_delivery_target('94000000-0000-0000-0000-00000000e001')), 3,
  'ticking a Director whose position covers the referral puts them on the deed');
select ok(exists (select 1 from public.deed_delivery_target('94000000-0000-0000-0000-00000000e001') t
                   where t.email = 'zzz.tick.dir@t.test'),
  'by name, so this is not two rows of the same person');
select ok(exists (select 1 from public.deed_delivery_target('94000000-0000-0000-0000-00000000e001') t
                   where t.email = 'zzz.tick.neg@t.test'),
  'and the referrer is still on it, first');
select is((select t.source from public.deed_delivery_target('94000000-0000-0000-0000-00000000e001') t
            where t.email = 'zzz.tick.dir@t.test'),
  'copy',
  'labelled as a copy, so "where did it go" distinguishes them from the sender');

-- THE SCOPE IS THE POSITION THEY HOLD. The other agency's Director is ticked
-- too and must not appear: a tick is not a subscription to the estate.
select ok(not exists (select 1 from public.deed_delivery_target('94000000-0000-0000-0000-00000000e001') t
                       where t.email = 'zzz.tick.other@t.test'),
  'a ticked Director at another agency is not on it, because their position does not cover the referral');

/* AND THE SAME PEOPLE THE OTHER NOTIFICATIONS REACH, PLUS THE MAILBOX.
   The original claim was equality, and it held until the agency address
   was allowed to receive the deed as well. Equality is still the right
   test of the PEOPLE half -- if those two ever disagree the deed is
   following a different rule from the reminder again -- so it is asked of
   the ladder rows, and the extra row is named rather than absorbed into a
   looser comparison. */
select is(
  (select count(*)::int from public.deed_delivery_target('94000000-0000-0000-0000-00000000e001') t
    where t.source in ('referrer', 'copy')),
  (select count(*)::int from public.agency_notification_recipients('94000000-0000-0000-0000-00000000e001')),
  'the deed reaches exactly the people every other per-application notification reaches');
select is(
  (select count(*)::int from public.deed_delivery_target('94000000-0000-0000-0000-00000000e001') t
    where t.source = 'branch_contact'),
  1, 'and one address besides, which only the deed goes to');

-- ===========================================================================
-- THE OTHER TWO RAILS STAY SINGULAR
-- ===========================================================================
select is((select count(*)::int from public.deed_delivery_target('94000000-0000-0000-0000-00000000e002')), 1,
  'a supplier referral still resolves to one contact');
select is((select t.email from public.deed_delivery_target('94000000-0000-0000-0000-00000000e002') t),
  'supplierdesk@t.test',
  'and it is the branch agent contact');
select is((select count(*)::int from public.deed_delivery_target('94000000-0000-0000-0000-00000000e003')), 1,
  'a direct referral still resolves to one contact');
select is((select t.email from public.deed_delivery_target('94000000-0000-0000-0000-00000000e003') t),
  'doras.agent@t.test',
  'and it is the contact the tenant named, not the agency its branch points at');

-- ===========================================================================
-- THE FALLBACK IS UNCHANGED WHEN THE REFERRER IS DEACTIVATED
-- ===========================================================================
/* Deactivating the sender must leave the ticked Director on it, not fall
   PAST them to the branch mailbox. That is the rung order, and it is
   unchanged.

   WHAT CHANGED IS WHAT "and not to the branch mailbox" MEANT. It meant
   two things at once: that the mailbox does not REPLACE the ladder, and
   that it is not on the deed at all. The first is the rung order and
   still holds; the second stopped being true on 2026-10-02, when Matt
   made the agency address a recipient as well. So the case is kept and
   its expectation widened by exactly one row -- the Director is still
   there, which is the thing that would have broken. */
update public.users set status = 'deactivated' where id = '94000000-0000-0000-0000-00000000c002';
select results_eq(
  $$select t.email::text from public.deed_delivery_target('94000000-0000-0000-0000-00000000e001') t order by 1$$,
  $$values ('agencydesk@t.test'::text), ('zzz.tick.dir@t.test'::text)$$,
  'with the referrer deactivated the deed still goes to the ticked user in scope, beside the agency address and not instead of them');
select is(
  (select t.source from public.deed_delivery_target('94000000-0000-0000-0000-00000000e001') t
    where t.email = 'zzz.tick.dir@t.test'),
  'copy', 'and they are still a copy on the ladder, not the fallback contact');

select * from finish();
rollback;
