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
-- THE BRANCH READING, which is the one judgement in the rule. A branch
-- with no contacts of its own uses its AGENCY's: `effectiveContacts` has
-- always done that, and the deed panel prints it as "agency default for
-- X". The governing clause is "so one always exists", and for a branch
-- under an agency that has a contact, one does. So a branch is refused
-- only when its agency has nothing to fall back on -- which is exactly
-- the case that leaves a deed with nowhere to go. Both halves are
-- asserted below, because the permissive half is the one somebody would
-- otherwise "fix" into strictness without noticing it was a decision.

begin;
select plan(13);

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
  'onboarding an agency with no contact email is refused');

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

-- ===========================================================================
-- 2. ADDING A BRANCH, where the rule is about what it can fall back on.
-- ===========================================================================
select throws_ok(
  $$select public.admin_add_branch('93000000-0000-0000-0000-0000000c0012', 'ZZZ Bare Office')$$,
  '22023', null,
  'a branch under an agency with no contact is refused without one of its own');

select lives_ok(
  $$select public.admin_add_branch('93000000-0000-0000-0000-0000000c0012', 'ZZZ Bare Office',
      p_contact_email => 'office@bare.test')$$,
  'and goes through when it brings one');

/* THE PERMISSIVE HALF, which is a decision and not an oversight: an
   office under an agency that already has a contact inherits it. */
select lives_ok(
  $$select public.admin_add_branch('93000000-0000-0000-0000-0000000c0011', 'ZZZ Covered Office')$$,
  'while a branch under an agency that HAS one needs nothing, because it inherits');

select is(
  (select count(*)::int from public.agent_contacts c
    join public.branches b on b.id = c.branch_id
   where b.name = 'ZZZ Covered Office'),
  0, 'and no second contact is invented for it');

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
  'inventing an agency mid-referral with no contact email is refused');

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

select * from finish();
rollback;
