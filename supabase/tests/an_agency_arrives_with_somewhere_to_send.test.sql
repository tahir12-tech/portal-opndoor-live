-- AN AGENCY OR BRANCH IS NEVER CREATED WITH NOWHERE TO SEND A DEED.
--
-- Matt, 2026-10-02: "A contact email is required when any agency or
-- branch is created, in any estate, so one always exists; creating one
-- without it is refused with a clear message."
--
-- FOUR DOORS CREATE AN AGENCY OR A BRANCH, and only one of them asked:
--
--   admin_add_agency                required one since 20261006470000
--   admin_add_branch                took one and allowed it blank
--   admin_create_agency_and_branch  did not take one at all
--   create_referral_target          took one and allowed it blank, on
--                                   both arms, on both overloads
--
-- CORRECTED THE SAME DAY, and the file follows it. Matt, 2026-10-02:
--
--   "Supplier side (agencies in a supplier's estate): an agency email is
--    required at creation and is the default for all its branches; a
--    branch's own email, if set, overrides it for that branch ...
--    Opndoor's own agencies (like Regent): no email required. Signed
--    deeds go to whoever sent the referral (plus the people already
--    ticked to receive them, as now). The agency or a branch can
--    optionally add an email that also receives the deed; leave it blank
--    and nothing is missing."
--
-- So "in any estate" became the SUPPLIER estate only, and a branch is
-- never required to bring one: an override is optional by definition.
-- Both halves are asserted, because an absent requirement is exactly the
-- thing a later reader tightens without noticing it was a decision.

begin;
select plan(20);

-- ===========================================================================
-- THE FIXTURE: an admin to call as, and a supplier to fly-create under.
-- ===========================================================================
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled)
values ('93000000-0000-0000-0000-0000000c0001','zzz-contact-supplier','ZZZ Contact Supplier',
        'pre_referenced_open', 0.25, 0.10, false, false, true, true);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('93000000-0000-0000-0000-0000000c00a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zzz.contact.admin@c.test','',now(),now(),now()),
  ('93000000-0000-0000-0000-0000000c00a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','zzz.contact.supref@c.test','',now(),now(),now());

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('93000000-0000-0000-0000-0000000c00a1','ZZZ Contact Admin','zzz.contact.admin@c.test','superadmin',null,'active',true),
  ('93000000-0000-0000-0000-0000000c00a2','ZZZ Contact SupRef','zzz.contact.supref@c.test','referrer','93000000-0000-0000-0000-0000000c0001','active',false);

-- An agency WITH a contact, to prove the inheritance half.
insert into public.agencies (id, partner_id, name, review_state)
values ('93000000-0000-0000-0000-0000000c0011','93000000-0000-0000-0000-0000000c0001','ZZZ Covered Agency','confirmed');
insert into public.agent_contacts (agency_id, partner_id, name, email, is_primary)
values ('93000000-0000-0000-0000-0000000c0011','93000000-0000-0000-0000-0000000c0001','Covered','covered@c.test',true);

-- And one with none, which is the state the rule exists to stop arriving.
insert into public.agencies (id, partner_id, name, review_state)
values ('93000000-0000-0000-0000-0000000c0012','93000000-0000-0000-0000-0000000c0001','ZZZ Bare Agency','confirmed');

/* AND THE QUIET CASE: no agency address, and an office that holds its own.
   Nothing is stranded today and the DEFAULT is still missing, which is the
   distinction the reconciliation list has to be able to draw. Kestrel
   Lettings on dev is this shape. */
insert into public.agencies (id, partner_id, name, review_state)
values ('93000000-0000-0000-0000-0000000c0013','93000000-0000-0000-0000-0000000c0001','ZZZ Per Office Agency','confirmed');
insert into public.branches (id, agency_id, partner_id, name, review_state)
values ('93000000-0000-0000-0000-0000000c0023','93000000-0000-0000-0000-0000000c0013','93000000-0000-0000-0000-0000000c0001','ZZZ Per Office','confirmed');
insert into public.agent_contacts (branch_id, partner_id, name, email, is_primary)
values ('93000000-0000-0000-0000-0000000c0023','93000000-0000-0000-0000-0000000c0001','Per Office','peroffice@c.test',true);

select set_config('request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-0000000c00a1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ===========================================================================
-- 1. THE ONBOARDING CALL, which took no contact at all until today.
-- ===========================================================================
select throws_ok(
  $$select * from public.admin_create_agency_and_branch(
      p_agency_name => 'ZZZ Onboarded', p_branch_name => 'ZZZ Onboarded Office',
      p_partner_slug => 'zzz-contact-supplier')$$,
  '22023', null,
  'onboarding a SUPPLIER''S agency with no email is refused');

/* AND ONE OF OUR OWN IS NOT. The deed there goes to whoever sent the
   referral and the people ticked for it, so an address is an addition and
   "leave it blank and nothing is missing". */
select lives_ok(
  $$select * from public.admin_create_agency_and_branch(
      p_agency_name => 'ZZZ Ours No Email', p_branch_name => 'ZZZ Ours Office',
      p_partner_slug => 'opndoor-agents')$$,
  'while one of Opndoor''s own needs no email at all');

select is(
  (select count(*)::int from public.agent_contacts c
    join public.agencies a on a.id = c.agency_id
   where a.name = 'ZZZ Ours No Email'),
  0, 'and no empty contact row is invented for it');

select throws_ok(
  $$select * from public.admin_create_agency_and_branch(
      p_agency_name => 'ZZZ Onboarded', p_branch_name => 'ZZZ Onboarded Office',
      p_partner_slug => 'zzz-contact-supplier', p_agency_email => 'not-an-email')$$,
  '22023', null,
  'and so is one with something that is not an address');

/* AND NOTHING WAS LEFT BEHIND. The checks run before the first insert, so
   a refusal does not leave a half-made agency for the next attempt to
   collide with. throws_ok rolls back to a savepoint, which is why this is
   asserting the ORDER of the checks and not the rollback. */
select is(
  (select count(*)::int from public.agencies where name = 'ZZZ Onboarded'),
  0, 'and no agency is left behind on the way to being refused');

select lives_ok(
  $$select * from public.admin_create_agency_and_branch(
      p_agency_name => 'ZZZ Onboarded', p_branch_name => 'ZZZ Onboarded Office',
      p_partner_slug => 'zzz-contact-supplier', p_agency_email => 'hello@onboarded.test',
      p_agency_contact_name => 'Olive Onboarded')$$,
  'while one with a contact email goes through');

select is(
  (select c.email from public.agent_contacts c
    join public.agencies a on a.id = c.agency_id
   where a.name = 'ZZZ Onboarded'),
  'hello@onboarded.test', 'and the contact is really created, not just accepted');

/* AND THE OFFICE IT MADE CAN BE SENT A DEED, through the agency default.
   This is the assertion that makes "one always exists" true for the
   office as well, without a second address being typed for it. */
select is(
  (select count(*)::int from public.agent_contacts c
    where c.agency_id = (select id from public.agencies where name = 'ZZZ Onboarded')),
  1, 'and its first office inherits that one contact rather than needing its own');

/* THE INHERITANCE, ASKED OF THE RESOLVER THE DEED PATH USES rather than
   of the table. Matt: the agency email "is the default for all its
   branches; a branch's own email, if set, overrides it for that branch."
   `effective_primary_contact_route` is what both halves of that sentence
   come down to, and asserting it here is what stops a later change to
   either one being invisible. */
-- Read as the owner: `effective_primary_contact_route` is service-side
-- plumbing the deed path calls, not something `authenticated` may execute,
-- and this is ground truth rather than an authorisation claim.
reset role;
select is(
  (select email from public.effective_primary_contact_route(
     (select b.id from public.branches b join public.agencies a on a.id = b.agency_id
       where a.name = 'ZZZ Onboarded'),
     '93000000-0000-0000-0000-0000000c0001')),
  'hello@onboarded.test',
  'and the office resolves to the agency''s address, which is the default');
select set_config('request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-0000000c00a1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ===========================================================================
-- 2. ADDING A BRANCH, where the rule is about what it can fall back on.
-- ===========================================================================
/* A BRANCH IS NEVER ASKED FOR ONE, on either side. Matt's correction
   makes a branch email an OVERRIDE of the agency's, and an override is
   optional by definition. This agency has no contact at all, which under
   the hour-old version of the rule was the one case that WAS refused. */
select lives_ok(
  $$select public.admin_add_branch('93000000-0000-0000-0000-0000000c0012', 'ZZZ Bare Office')$$,
  'a branch needs no email of its own, even under an agency that has none');

select lives_ok(
  $$select public.admin_add_branch('93000000-0000-0000-0000-0000000c0011', 'ZZZ Covered Office')$$,
  'nor under one that has');

select is(
  (select count(*)::int from public.agent_contacts c
    join public.branches b on b.id = c.branch_id
   where b.name = 'ZZZ Covered Office'),
  0, 'and no contact is invented for it either way');

/* AND WHERE IT BRINGS ONE, IT OVERRIDES. The other half of the sentence,
   asked of the resolver rather than the table. */
select lives_ok(
  $$select public.admin_add_branch('93000000-0000-0000-0000-0000000c0011', 'ZZZ Own Office',
      p_contact_email => 'own@covered.test')$$,
  'while a branch that brings one is accepted');

reset role;
select is(
  (select email from public.effective_primary_contact_route(
     (select id from public.branches where name = 'ZZZ Own Office'),
     '93000000-0000-0000-0000-0000000c0001')),
  'own@covered.test',
  'and its own address overrides the agency''s for that branch');
select set_config('request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-0000000c00a1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ===========================================================================
-- 3. THE ON-THE-FLY PATH, where an agency is born mid-referral.
-- ===========================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-0000000c00a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select throws_ok(
  $$select public.create_referral_target(
      p_agency => 'ZZZ Fly Agency', p_branch => 'ZZZ Fly Office', p_partner_slug => null)$$,
  '22023', null,
  'inventing a supplier''s agency mid-referral with no email is refused');

select lives_ok(
  $$select public.create_referral_target(
      p_agency => 'ZZZ Fly Agency', p_branch => 'ZZZ Fly Office',
      p_agency_email => 'hello@fly.test', p_partner_slug => null)$$,
  'and goes through with one, because on the supplier rail that is the product');

reset role;
select is(
  (select c.email from public.agent_contacts c
    join public.agencies a on a.id = c.agency_id
   where a.name = 'ZZZ Fly Agency'),
  'hello@fly.test', 'and the agency it invented has somewhere to send a deed');

-- ===========================================================================
-- 4. AND WHO STILL NEEDS ONE IS A LIST SOMEBODY CAN WORK FROM.
-- ===========================================================================
/* Matt: "For supplier-estate agencies with no agency email, show a clear
   warning on the supplier's Agencies tab and list them on Reconciliation
   so Opndoor can add one. No warnings for Opndoor's own agencies without
   an email."

   THE AGENCY ADDRESS IS THE SUBJECT, not "can a deed reach anybody". The
   bare agency above has no contact anywhere and is on the list; the
   COVERED one has a mailbox on every office and no agency address, so
   nothing is stranded today and it is STILL on the list, because the
   next office added under it would inherit nothing. The two are told
   apart by branches_covered rather than by being on or off it. */
select set_config('request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-0000000c00a1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select bag_eq(
  $$select agency_name from public.supplier_agencies_without_an_email()
     where agency_name like 'ZZZ %'$$,
  $$values ('ZZZ Bare Agency'::text), ('ZZZ Per Office Agency'::text)$$,
  'both supplier agencies without an agency address are listed, and the one with an address is not');

select is(
  (select branches || '/' || branches_covered
     from public.supplier_agencies_without_an_email()
    where agency_name = 'ZZZ Per Office Agency'),
  '1/1', 'and the quiet one says its office has its own, so nothing is stranded today');

/* AND NOTHING OF OURS IS ON IT, which is the sentence "No warnings for
   Opndoor's own agencies without an email". ZZZ Ours No Email was created
   above with no address at all. */
select is(
  (select count(*)::int from public.supplier_agencies_without_an_email()
    where agency_name = 'ZZZ Ours No Email'),
  0, 'while Opndoor''s own agency with no email is not listed at all');

reset role;

select * from finish();
rollback;
