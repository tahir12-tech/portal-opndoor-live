-- THE SIGNED DEED COPIES THE REFERRER ON EVERY RAIL THAT HAS ONE.
--
-- Matt (bg): "GR-26262 (Kestrel joint, signed 21:47): the signed deed went to
-- the agency (test@lettings.com) and the tenant, but not to the referrer,
-- Test Referrer (test@referrer.com)."
--
-- IT WAS BUILT FOR ONE RAIL. Two gates, either of which alone was enough:
-- `agency_notification_recipients` filtered `channel = 'Agent referral'`,
-- and `deed_delivery_target`'s ladder arm carried the same test. The comment
-- on the first said "Direct and the supplier rail keep the contacts they
-- already had", which was true of the CONTACTS and silently also true of the
-- LADDER.
--
-- THE ORDER IS THE HALF THAT COULD HAVE GONE WRONG QUIETLY. The caller takes
-- the first row as the recipient and records it as `deed_delivered_to`. On
-- the supplier rail the deed is ADDRESSED to the agency and the referrer is a
-- copy, so adding the ladder without an explicit order would have made the
-- referrer the addressee of a legal instrument. Assertions 2 and 3 are that.

begin;
select plan(9);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled, partner_kind)
values ('d4000000-0000-0000-0000-0000000000d1','zzz-dr-supplier','ZZZ DR Supplier',
        'pre_referenced_open', 0.30, 0.10, false, false, true, true, 'supplier');
insert into public.agencies (id, partner_id, name) values
  ('d4000000-0000-0000-0000-0000000000a1','d4000000-0000-0000-0000-0000000000d1','ZZZ DR Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('d4000000-0000-0000-0000-0000000000b1','d4000000-0000-0000-0000-0000000000a1',
   'd4000000-0000-0000-0000-0000000000d1','ZZZ DR Office');
-- The agency's own mailbox: the addressee, and the one (ap) says can never
-- be switched off.
-- A contact belongs to a branch OR an agency, never both
-- (`agent_contacts_one_owner`). The branch is the rung deed_delivery_target
-- resolves first, so that is the one to set.
insert into public.agent_contacts (branch_id, partner_id, name, email, is_primary)
values ('d4000000-0000-0000-0000-0000000000b1',
        'd4000000-0000-0000-0000-0000000000d1','ZZZ DR Lettings','lettings@zzzdr.test', true);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('d4000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.dr.neg@r.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('d4000000-0000-0000-0000-00000000c001','Dee Referrer','zzz.dr.neg@r.test','referrer',
   'd4000000-0000-0000-0000-0000000000d1','active',false);

insert into public.applications (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
       tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
       prop_addr1, prop_city, prop_postcode,
       monthly_rent, fee_amount, tenancy_start, partner_rate, agent_rate, referencing_mode,
       status, paid_at, deed_issued_at, deed_state, payment_state, livemode)
values ('d4000000-0000-0000-0000-0000000000f1','GR-ZZDR01',
   'd4000000-0000-0000-0000-0000000000d1','d4000000-0000-0000-0000-0000000000a1',
   'd4000000-0000-0000-0000-0000000000b1','d4000000-0000-0000-0000-00000000c001',
   'Mx','Joint','Tenant','1990-01-01','zzz.dr.t@r.test','07700900860',
   '1 Referrer Road','London','RR1 1AA', 1800, 1800, current_date + 20, 0.30, 0.10,
   'pre_referenced_open', 'deed', now(), now(), 'executed', 'paid', true);

-- ===========================================================================
-- 1. THE RAIL. Named, because both gates turned on this exact string and a
--    test that assumed it would prove nothing about why the deed went astray.
-- ===========================================================================
select is(
  public.application_channel('d4000000-0000-0000-0000-0000000000f1'),
  'Partner referral',
  'this is the supplier rail, which is what both gates excluded');

-- ===========================================================================
-- 2-4. THE AGENCY IS STILL THE ADDRESSEE, and the referrer is a COPY.
-- ===========================================================================
select is(
  (select t.email from public.deed_delivery_target('d4000000-0000-0000-0000-0000000000f1') t limit 1),
  'lettings@zzzdr.test',
  'the agency is FIRST, so deed_delivered_to still records the addressee');

select is(
  (select string_agg(t.email, ' then ')
     from public.deed_delivery_target('d4000000-0000-0000-0000-0000000000f1') t),
  'lettings@zzzdr.test then zzz.dr.neg@r.test',
  'and the referrer follows as a copy, which is the whole of (bg)');

/* THE AGENCY LADDER IS DELIBERATELY STILL EMPTY HERE, which is the half I
   got wrong first. `agency_notification_recipients` has five rungs -- the
   referrer, ticked copies, the agency's own MAILBOX, and a Director and a
   branch Manager as fallbacks -- and widening it to this rail sent the
   agency its own deed twice while importing two rungs the supplier ladder
   does not have. It is the AGENCY ladder. The supplier rail gets one arm
   carrying one person instead, which is what assertions 2 and 3 prove. */
select is(
  (select count(*) from public.agency_notification_recipients('d4000000-0000-0000-0000-0000000000f1')),
  0::bigint,
  'and the AGENCY ladder is untouched: this rail is not served by widening it');

-- ===========================================================================
-- 5-6. A DEACTIVATED REFERRER DROPS OUT, which the agency rail already did
--      and which the supplier rail now inherits rather than reimplements.
-- ===========================================================================
update public.users set status = 'deactivated' where id = 'd4000000-0000-0000-0000-00000000c001';
/* AND EXACTLY ONCE, which is what caught the over-wide first attempt: with
   the referrer gone the agency was still being returned twice, once by the
   contact arm and once as the ladder's `agency_contact` rung. */
select is(
  (select string_agg(t.email, ' then ')
     from public.deed_delivery_target('d4000000-0000-0000-0000-0000000000f1') t),
  'lettings@zzzdr.test',
  'a deactivated referrer is not emailed a signed deed, and the agency is not sent two');
select is(
  (select t.email from public.deed_delivery_target('d4000000-0000-0000-0000-0000000000f1') t limit 1),
  'lettings@zzzdr.test',
  'and the agency still gets it, which is the half that can never be switched off');
update public.users set status = 'active' where id = 'd4000000-0000-0000-0000-00000000c001';

-- ===========================================================================
-- 7-8. THE AGENCY RAIL IS UNCHANGED, which is what the explicit ordering is
--      for: there the ladder IS the answer and the referrer is first.
-- ===========================================================================
/* THE REAL HOUSE PARTNER, not a fixture of one. Every agency Opndoor
   onboards shares `opndoor-agents`, and `application_channel` reads the
   partner to decide the rail -- my first attempt invented an agency partner
   with is_house_route true and the channel came back 'Direct', which is a
   fixture testing the fixture rather than the estate. */
insert into public.agencies (id, partner_id, name)
select 'd4000000-0000-0000-0000-0000000000a2', p.id, 'ZZZ DR Own Agency'
  from public.partners p where p.slug = 'opndoor-agents';
insert into public.branches (id, agency_id, partner_id, name)
select 'd4000000-0000-0000-0000-0000000000b2','d4000000-0000-0000-0000-0000000000a2', p.id, 'ZZZ DR Own Office'
  from public.partners p where p.slug = 'opndoor-agents';
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('d4000000-0000-0000-0000-00000000c002','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.dr.own@r.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
select 'd4000000-0000-0000-0000-00000000c002','Owen Own','zzz.dr.own@r.test','referrer',
       p.id,'active',false from public.partners p where p.slug = 'opndoor-agents';
insert into public.applications (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
       tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
       prop_addr1, prop_city, prop_postcode,
       monthly_rent, fee_amount, tenancy_start, partner_rate, agent_rate, referencing_mode,
       status, paid_at, deed_issued_at, deed_state, payment_state, livemode)
select 'd4000000-0000-0000-0000-0000000000f2','GR-ZZDR02',
   p.id,'d4000000-0000-0000-0000-0000000000a2',
   'd4000000-0000-0000-0000-0000000000b2','d4000000-0000-0000-0000-00000000c002',
   'Mx','Own','Tenant','1990-01-01','zzz.dr.t2@r.test','07700900861',
   '2 Own Road','London','OR1 1AA', 1500, 1500, current_date + 20, 0.30, 0.10,
   'opndoor_referenced', 'deed', now(), now(), 'executed', 'paid', true
from public.partners p where p.slug = 'opndoor-agents';

select is(
  public.application_channel('d4000000-0000-0000-0000-0000000000f2'),
  'Agent referral',
  'the agency rail is still the agency rail');

select is(
  (select t.email from public.deed_delivery_target('d4000000-0000-0000-0000-0000000000f2') t limit 1),
  'zzz.dr.own@r.test',
  'and there the referrer is FIRST, exactly as before: the ladder is the answer');

-- ===========================================================================
-- 9. DIRECT IS STILL OUT, and deliberately: a direct tenant nominates their
--    own contact and there is no referrer to copy.
-- ===========================================================================
/* A DIRECT APPLICATION OF OUR OWN, rather than reaching for a dev row:
   GR-20626 exists today and may not tomorrow, and a test that silently
   stops finding its fixture asserts nothing. */
-- A direct application is attributed to an APPLICANT, not a referrer:
-- `assert_application_attributed` wants one or the other, and this rail has
-- no staff member who sent it. That is the distinction the ladder turns on.
-- An applicant IS an auth user (applicants.id references auth.users): a
-- direct tenant signs in to fill their own form. They are not a
-- public.users row, which is what separates them from staff.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('d4000000-0000-0000-0000-00000000e001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.dr.t3@r.test','',now(),now(),now());
insert into public.applicants (id, email, first_name, last_name, dob)
values ('d4000000-0000-0000-0000-00000000e001','zzz.dr.t3@r.test','Direct','Tenant','1990-01-01');

insert into public.applications (id, guarantee_ref, partner_id, agency_id, branch_id,
       tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
       prop_addr1, prop_city, prop_postcode,
       monthly_rent, fee_amount, tenancy_start, partner_rate, agent_rate, referencing_mode,
       status, paid_at, deed_issued_at, deed_state, payment_state, livemode, applicant_id)
/* A BRANCH AND AGENCY, which a direct row really does carry: the
   auto-matcher rewrites both to a real agency so somebody can service the
   tenant, and pins partner_id to opndoor-direct. `sync_application_partner`
   refuses a null branch outright, so this is the shape, not a convenience. */
select 'd4000000-0000-0000-0000-0000000000f3','GR-ZZDR03', p.id,
   'd4000000-0000-0000-0000-0000000000a2','d4000000-0000-0000-0000-0000000000b2',
   'Mx','Direct','Tenant','1990-01-01','zzz.dr.t3@r.test','07700900862',
   '3 Direct Road','London','DR1 1AA', 1100, 1100, current_date + 20, 0.30, 0.10,
   'opndoor_referenced', 'deed', now(), now(), 'executed', 'paid', true,
   'd4000000-0000-0000-0000-00000000e001'
from public.partners p where p.slug = 'opndoor-direct';

select is(
  (select count(*) from public.agency_notification_recipients('d4000000-0000-0000-0000-0000000000f3')),
  0::bigint,
  'a direct application has no ladder, which is a decision and not a gap');

select * from finish();
rollback;
