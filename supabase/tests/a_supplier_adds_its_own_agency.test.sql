-- A SUPPLIER'S OWN PEOPLE CAN ADD AN AGENCY OR AN OFFICE. NOBODY ELSE'S.
--
-- Matt, 2026-10-03: "Supplier users who can refer (Management and Referrers)
-- can add an agency or office for their own supplier while sending a
-- referral ... It belongs to that supplier's estate only, is usable straight
-- away for the referral, and lands in Opndoor's Reconciliation to check,
-- recorded in Recent changes with who added it ... Opndoor's own agencies are
-- unchanged: their users can't add agencies or offices."
--
-- THE THREE THINGS THIS FILE IS REALLY ABOUT, in order of how much damage
-- getting them wrong would do:
--
--   1. A supplier's person cannot create inside ANOTHER supplier's estate.
--      `p_partner_slug` is a parameter with a default, so without forcing it
--      to app_partner() a Kestrel referrer could name a competitor's slug.
--   2. Our own estate is excluded. `opndoor-agents` is one partner shared by
--      every agency Opndoor carries, so a Regent negotiator creating there
--      makes a sibling beside their own employer.
--   3. What they create waits for review, and says who made it.

begin;
select plan(14);

-- TWO suppliers, so the cross-estate test has somewhere to point, and the
-- house partner, so the our-estate test does too.
insert into public.partners (id, slug, name, referencing_mode, is_house_route, partner_kind)
values ('a1000000-0000-0000-0000-0000000000a1','zzz-sup-one','ZZZ Supplier One',
        'pre_referenced_open', false, 'supplier'),
       ('a1000000-0000-0000-0000-0000000000a2','zzz-sup-two','ZZZ Supplier Two',
        'pre_referenced_open', false, 'supplier');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
select id, '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       email, '', now(), now(), now()
from (values
  ('a1000000-0000-0000-0000-0000000000d1'::uuid,'zzz.s1.mgmt@s.test'),
  ('a1000000-0000-0000-0000-0000000000d2'::uuid,'zzz.s1.ref@s.test'),
  ('a1000000-0000-0000-0000-0000000000d3'::uuid,'zzz.house.ref@o.test')
) as v(id, email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('a1000000-0000-0000-0000-0000000000d1','ZZZ S1 Management','zzz.s1.mgmt@s.test',
        'management','a1000000-0000-0000-0000-0000000000a1','active', true),
       ('a1000000-0000-0000-0000-0000000000d2','ZZZ S1 Referrer','zzz.s1.ref@s.test',
        'referrer','a1000000-0000-0000-0000-0000000000a1','active', false),
       ('a1000000-0000-0000-0000-0000000000d3','ZZZ House Referrer','zzz.house.ref@o.test',
        'referrer',(select id from public.partners where slug = 'opndoor-agents'),'active', false);

-- ===========================================================================
-- 1. A SUPPLIER'S REFERRER CREATES, FOR THEIR OWN SUPPLIER, PENDING REVIEW
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"a1000000-0000-0000-0000-0000000000d2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.admin_create_agency_and_branch(
      p_agency_name => 'ZZZ Referrer Made This',
      p_branch_name => 'ZZZ Referrer Made This',
      p_branch_area => '1 ZZZ Street, London SW1A 1AA',
      p_agency_email => 'deeds@zzzreferrer.test')$$,
  'a supplier''s referrer can add an agency while referring');

select is(
  (select review_state from public.agencies where name = 'ZZZ Referrer Made This'),
  'pending_review', 'and it waits for Opndoor to check it');

select is(
  (select partner_id from public.agencies where name = 'ZZZ Referrer Made This'),
  'a1000000-0000-0000-0000-0000000000a1'::uuid,
  'and it belongs to their own supplier');

select is(
  (select created_by from public.agencies where name = 'ZZZ Referrer Made This'),
  'a1000000-0000-0000-0000-0000000000d2'::uuid,
  'and the row records who made it');

/* "Recorded in Recent changes with who added it", and saying how.

   READ WITH THE ROLE RESET, which is not a shortcut. `org_audit` is
   Opndoor-read-only -- two SELECT policies, both for staff -- so the supplier
   referrer who just wrote this row cannot read it back, correctly. The
   assertion is about what the FUNCTION WROTE, not about who may read it, so
   it is read as the writer. Who may read org_audit is its own question and is
   covered by its policies. */
reset role;
select is(
  (select detail from public.org_audit
    where entity_type = 'agency'
      and entity_id = (select id from public.agencies where name = 'ZZZ Referrer Made This')),
  'ZZZ Referrer Made This (added while referring)',
  'and Recent changes says what happened');

select is(
  (select actor from public.org_audit
    where entity_type = 'agency'
      and entity_id = (select id from public.agencies where name = 'ZZZ Referrer Made This')),
  'ZZZ S1 Referrer', 'named by the person who did it');

-- Back to the referrer for the cross-estate test below.
select set_config('request.jwt.claims',
  '{"sub":"a1000000-0000-0000-0000-0000000000d2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ITS OFFICE CAME WITH IT, carrying the address and the same review state.
select is(
  (select review_state from public.branches
    where agency_id = (select id from public.agencies where name = 'ZZZ Referrer Made This')),
  'pending_review', 'the office it created waits too');

select is(
  (select area from public.branches
    where agency_id = (select id from public.agencies where name = 'ZZZ Referrer Made This')),
  '1 ZZZ Street, London SW1A 1AA', 'and carries the address that was typed');

-- ===========================================================================
-- 2. AND NOT INSIDE ANOTHER SUPPLIER'S ESTATE, however they ask
-- ===========================================================================
select lives_ok(
  $$select public.admin_create_agency_and_branch(
      p_agency_name => 'ZZZ Cross Estate Attempt',
      p_partner_slug => 'zzz-sup-two',
      p_agency_email => 'deeds@zzzcross.test')$$,
  'naming another supplier''s slug does not fail...');

select is(
  (select p.slug from public.agencies a join public.partners p on p.id = a.partner_id
    where a.name = 'ZZZ Cross Estate Attempt'),
  'zzz-sup-one',
  '...it lands in their OWN estate: the slug they asked for is ignored');

-- ===========================================================================
-- 3. OUR OWN ESTATE IS UNCHANGED
-- ===========================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"a1000000-0000-0000-0000-0000000000d3","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select throws_ok(
  $$select public.admin_create_agency_and_branch(
      p_agency_name => 'ZZZ House Attempt',
      p_agency_email => 'deeds@zzzhouse.test')$$,
  '42501',
  'Not permitted.',
  'one of OUR agencies'' referrer cannot add an agency');

-- ===========================================================================
-- 4. MANAGEMENT KEEPS WHAT IT HAD, and an office under an existing agency
-- ===========================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"a1000000-0000-0000-0000-0000000000d1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.admin_create_agency_and_branch(
      p_agency_name => 'ZZZ Management Made This',
      p_agency_email => 'deeds@zzzmgmt.test')$$,
  'a supplier''s management can add an agency too');

select is(
  (select review_state from public.agencies where name = 'ZZZ Management Made This'),
  'pending_review', 'and theirs waits for review as well');

-- AND THE OFFICE DOOR, which a referrer reaches for an existing agency.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"a1000000-0000-0000-0000-0000000000d2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.admin_add_branch(
      (select id from public.agencies where name = 'ZZZ Management Made This'),
      'ZZZ New Office', '2 ZZZ Road, London SW1A 2AA', 'office@zzznew.test')$$,
  'and a referrer can add an office to one of their own agencies');

reset role;
select * from finish();
rollback;
