-- TWO ESTATES HOLDING THE SAME COMPANY NEVER MEET.
--
-- Matt, 2026-10-01, replacing the "one agency record across routes" plan
-- he had sent an hour earlier:
--
--   "Opndoor's estate: agencies that are Opndoor's own clients (like
--    Regent) ... Each supplier's estate (e.g. Rightmove): the agencies and
--    branches that come through that supplier. They never have logins ...
--    The same real company can exist in both estates (Frost as Opndoor's
--    client and Frost under Rightmove). They are two separate records that
--    never link, share nothing, and never show each other's data. Remove
--    the duplicate-name warning across estates; keep it only within one
--    estate ... Supplier-route data belongs to the supplier only. Frost's
--    own login never sees anything from Rightmove's estate: no referrals,
--    no commission, no statements ... Signed deeds on supplier referrals
--    go to the branch contact in the supplier's estate."
--
-- WHAT THIS FILE IS FOR. Most of the separation was already true, because
-- `agencies.partner_id` is NOT NULL and the unique index is on
-- (partner_id, name): two estates have always been two rows, and every
-- authorisation predicate reads a row and not a name. A property that is
-- true by accident of an older design is exactly the one a later migration
-- removes without noticing, and the fixture here is the one Matt asked to
-- be able to repeat: two same-named Frosts, one referral each way.
--
-- THE ONE THING THAT CHANGED IN SQL is the duplicate detector
-- (20261007370000). It grouped by name across the whole table and marked
-- the cross-partner groups urgent, which under separate estates reports
-- the designed state as a defect.
--
-- WHAT IS NOT ASSERTED HERE. Which screen draws which agency: admin's
-- Agencies tab, the supplier's own page and the office columns are client
-- rules and are in src/data/twoEstatesNeverMeet.test.ts.

begin;
select plan(17);

-- ===========================================================================
-- THE FIXTURE: ONE COMPANY, TWO ESTATES
-- ===========================================================================
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled)
values ('93000000-0000-0000-0000-0000000e5000','zzz-estate-supplier','ZZZ Estate Supplier',
        'pre_referenced_open', 0.25, 0.10, false, false, true, true);

-- The same real company, twice. Same name, two partners, two rows.
insert into public.agencies (id, partner_id, name, review_state) values
  ('93000000-0000-0000-0000-0000000e5001',(select id from public.partners where slug='opndoor-agents'),'ZZZ Frost','confirmed'),
  ('93000000-0000-0000-0000-0000000e5002','93000000-0000-0000-0000-0000000e5000','ZZZ Frost','confirmed'),
  -- AND A REAL DUPLICATE, inside one estate: "Ltd" is stripped by name_key,
  -- so this collides with the row above it and should be reported.
  ('93000000-0000-0000-0000-0000000e5003','93000000-0000-0000-0000-0000000e5000','ZZZ Frost Ltd','confirmed');

insert into public.branches (id, agency_id, partner_id, name, review_state) values
  ('93000000-0000-0000-0000-0000000e5011','93000000-0000-0000-0000-0000000e5001',(select id from public.partners where slug='opndoor-agents'),'ZZZ Frost Mayfair','confirmed'),
  ('93000000-0000-0000-0000-0000000e5012','93000000-0000-0000-0000-0000000e5002','93000000-0000-0000-0000-0000000e5000','ZZZ Frost Mayfair','confirmed');

-- A branch mailbox in EACH estate, with the same branch name and a
-- different address. Which one a deed goes to is the whole question.
-- One owner each: `agent_contacts_one_owner` allows a contact to hang off a
-- branch OR an agency, never both.
insert into public.agent_contacts (id, agency_id, branch_id, partner_id, name, email, is_primary) values
  ('93000000-0000-0000-0000-0000000e5021',null,'93000000-0000-0000-0000-0000000e5011',(select id from public.partners where slug='opndoor-agents'),'Ours Mayfair','mayfair@ours.test',true),
  ('93000000-0000-0000-0000-0000000e5022',null,'93000000-0000-0000-0000-0000000e5012','93000000-0000-0000-0000-0000000e5000','Theirs Mayfair','mayfair@theirs.test',true);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',x.email,'',now(),now(),now()
from (values
  ('93000000-0000-0000-0000-0000000e50a1'::uuid,'zzz.frost.director@e.test'),
  ('93000000-0000-0000-0000-0000000e50a2'::uuid,'zzz.supplier.ref@e.test'),
  ('93000000-0000-0000-0000-0000000e50a3'::uuid,'zzz.supplier.director@e.test'),
  ('93000000-0000-0000-0000-0000000e50d1'::uuid,'zzz.estate.tenant1@e.test'),
  ('93000000-0000-0000-0000-0000000e50d2'::uuid,'zzz.estate.tenant2@e.test')
) as x(id,email);

-- FROST'S OWN LOGIN. It exists in OPNDOOR's estate and nowhere else, which
-- is the rule: "Each supplier's estate ... They never have logins."
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission, receives_commission_statements, home_branch_id) values
  ('93000000-0000-0000-0000-0000000e50a1','ZZZ Frost Director','zzz.frost.director@e.test','management',
   (select id from public.partners where slug='opndoor-agents'),'active',true,true,'93000000-0000-0000-0000-0000000e5011'),
  ('93000000-0000-0000-0000-0000000e50a2','ZZZ Supplier Ref','zzz.supplier.ref@e.test','referrer',
   '93000000-0000-0000-0000-0000000e5000','active',false,false,null),
  -- The person the supplier-estate statement must NOT reach: Management,
  -- sees commission, ticked for statements, and positioned on the agency.
  ('93000000-0000-0000-0000-0000000e50a3','ZZZ Supplier Director','zzz.supplier.director@e.test','management',
   '93000000-0000-0000-0000-0000000e5000','active',true,true,null);
insert into public.user_scopes (user_id, kind, agency_id) values
  ('93000000-0000-0000-0000-0000000e50a1','agency','93000000-0000-0000-0000-0000000e5001');

insert into public.applicants (id, email, first_name, last_name) values
  ('93000000-0000-0000-0000-0000000e50d1','zzz.estate.tenant1@e.test','Tess','Ours'),
  ('93000000-0000-0000-0000-0000000e50d2','zzz.estate.tenant2@e.test','Tom','Theirs');

-- ONE REFERRAL EACH WAY, as Matt asked: "refer once each way".
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id, referrer_name, applicant_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start, status, livemode,
   partner_rate, agent_rate, referencing_mode, sent_at, paid_at)
values
  ('93000000-0000-0000-0000-0000000e5101','GR-ZZZOURS',
   (select id from public.partners where slug='opndoor-agents'),
   '93000000-0000-0000-0000-0000000e5001','93000000-0000-0000-0000-0000000e5011',
   '93000000-0000-0000-0000-0000000e50a1','ZZZ Frost Director','93000000-0000-0000-0000-0000000e50d1',
   'Ms','Tess','Ours','1992-04-04','zzz.estate.tenant1@e.test','07000000001',
   '1 Ours Street','London','N1 1AA',2000, current_date + 30,'paid',true,
   0.25,0.10,'opndoor_referenced', now() - interval '3 days', now() - interval '2 days'),
  ('93000000-0000-0000-0000-0000000e5102','GR-ZZZTHEIRS',
   '93000000-0000-0000-0000-0000000e5000',
   '93000000-0000-0000-0000-0000000e5002','93000000-0000-0000-0000-0000000e5012',
   '93000000-0000-0000-0000-0000000e50a2','ZZZ Supplier Ref','93000000-0000-0000-0000-0000000e50d2',
   'Mr','Tom','Theirs','1990-02-02','zzz.estate.tenant2@e.test','07000000002',
   '2 Theirs Street','London','N2 2BB',2000, current_date + 30,'paid',true,
   0.25,0.10,'pre_referenced_open', now() - interval '3 days', now() - interval '2 days');

-- A commission line against each, naming the agency it was earned by.
insert into public.application_commission_lines (application_id, level, org_id, org_name, rate, basis_amount, amount, source)
values
  ('93000000-0000-0000-0000-0000000e5101','agency','93000000-0000-0000-0000-0000000e5001','ZZZ Frost',0.10,2000,200,'standard'),
  ('93000000-0000-0000-0000-0000000e5102','agency','93000000-0000-0000-0000-0000000e5002','ZZZ Frost',0.10,2000,200,'standard');

-- ===========================================================================
-- 1. TWO RECORDS, AND THE DATABASE IS HAPPY ABOUT IT
-- ===========================================================================
select is(
  (select count(*)::int from public.agencies where name = 'ZZZ Frost'),
  2, 'the same company is two agency rows, one per estate');

select is(
  (select count(distinct partner_id)::int from public.agencies where name = 'ZZZ Frost'),
  2, 'and the two rows sit under two different partners');

/* AND THE UNIQUENESS RULE IS PER ESTATE, which is what makes both of the
   above possible and what still stops a real duplicate inside one. */
select throws_ok(
  $$insert into public.agencies (partner_id, name)
    values ((select id from public.partners where slug='opndoor-agents'), 'ZZZ Frost')$$,
  '23505', null,
  'while a second ZZZ Frost in the SAME estate is still refused');

-- ===========================================================================
-- 2. THE DUPLICATE WARNING IS WITHIN AN ESTATE ONLY  (20261007370000)
-- ===========================================================================
select is(
  (select count(*)::int from public.duplicate_agency_groups() g
    where '93000000-0000-0000-0000-0000000e5001' = any(g.agency_ids)),
  0, 'our ZZZ Frost is not reported as a duplicate of the supplier''s');

select is(
  (select count(*)::int from public.duplicate_agency_groups() g
    where g.agency_names @> array['ZZZ Frost','ZZZ Frost Ltd']),
  1, 'while two of them inside ONE estate are still reported');

select is(
  (select g.partner_id from public.duplicate_agency_groups() g
    where g.agency_names @> array['ZZZ Frost','ZZZ Frost Ltd']),
  '93000000-0000-0000-0000-0000000e5000'::uuid,
  'and the report names the estate the duplicate is in');

/* THE COLUMN THAT CARRIED THE OLD MODEL IS GONE, not left returning false.
   `cross_partner` meant "this collision spans two partners, which sharing
   makes urgent" -- a question that should no longer be asked at all. */
/* `unlike` and `throws_like` are not in this pgTAP install, so the shape is
   read and compared rather than matched. */
select ok(
  (select pg_get_function_result(oid) from pg_proc
    where proname = 'duplicate_agency_groups'
      and pronamespace = 'public'::regnamespace) not like '%cross_partner%',
  'and nothing still asks whether a collision crosses estates');

-- ===========================================================================
-- 3. FROST'S OWN LOGIN SEES NOTHING OF THE OTHER FROST
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-0000000e50a1","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is(
  (select count(*)::int from public.applications
    where id in ('93000000-0000-0000-0000-0000000e5101','93000000-0000-0000-0000-0000000e5102')),
  1, 'Frost''s Director reads one of the two referrals');

select is(
  (select guarantee_ref from public.applications
    where id in ('93000000-0000-0000-0000-0000000e5101','93000000-0000-0000-0000-0000000e5102')),
  'GR-ZZZOURS', 'and it is their own, not the supplier-estate one');

select is(
  (select count(*)::int from public.application_commission_lines
    where application_id = '93000000-0000-0000-0000-0000000e5102'),
  0, 'no commission from the supplier estate reaches their login');

/* AND NOT BY NAME EITHER. The commission line names "ZZZ Frost", which is
   their own agency's name exactly; what keeps it out is the row it hangs
   off, not the string on it. */
select is(
  (select count(*)::int from public.application_commission_lines
    where org_name = 'ZZZ Frost'),
  1, 'even though the supplier estate''s line carries their own name');

reset role;

-- ===========================================================================
-- 4. AND THE SUPPLIER'S OWN USER SEES ONLY THE SUPPLIER'S
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-0000000e50a2","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

/* THE POSITIVE CONTROL FIRST, so the refusal below is a boundary and not an
   empty session. A referrer reads their own referrals; this is one. */
select is(
  (select guarantee_ref from public.applications
    where id = '93000000-0000-0000-0000-0000000e5102'),
  'GR-ZZZTHEIRS', 'the supplier''s referrer reads their own referral');

select is(
  (select count(*)::int from public.applications
    where id = '93000000-0000-0000-0000-0000000e5101'),
  0, 'and cannot read Opndoor''s ZZZ Frost referral');

reset role;

-- ===========================================================================
-- 5. THE DEED GOES TO THE BRANCH CONTACT IN ITS OWN ESTATE
-- ===========================================================================
/* Both branches are called "ZZZ Frost Mayfair" and both have a mailbox.
   `deed_delivery_target` resolves off the application's branch_id, so it
   is a row question and not a name question -- which is why the SEND was
   never wrong here, only the client's prediction of it. */
select is(
  (select count(*)::int from public.deed_delivery_target('93000000-0000-0000-0000-0000000e5102') t
    where t.email = 'mayfair@theirs.test'),
  1, 'a supplier-route deed resolves to the supplier estate''s branch contact');

select is(
  (select count(*)::int from public.deed_delivery_target('93000000-0000-0000-0000-0000000e5102') t
    where t.email = 'mayfair@ours.test'),
  0, 'and never to the same-named branch in Opndoor''s estate');

-- ===========================================================================
-- 6. A SUPPLIER-ESTATE STATEMENT REACHES NO LOGIN  (20261007390000)
-- ===========================================================================
/* Matt: "that commission is paid to the Rightmove-estate agency and its
   statement goes to that agency's contact email, never into any login."
   The agency arm of commission_statement_recipients resolves people
   through user_scopes and never asked which estate the party was in, so
   a Management user positioned on one of the supplier's agencies was
   addressed beside the finance address. */
update public.agencies set finance_email = 'finance@theirs.test'
 where id = '93000000-0000-0000-0000-0000000e5002';
insert into public.user_scopes (user_id, kind, agency_id)
values ('93000000-0000-0000-0000-0000000e50a3','agency','93000000-0000-0000-0000-0000000e5002');

select bag_eq(
  $$select email, source from public.commission_statement_recipients('agency','93000000-0000-0000-0000-0000000e5002')$$,
  $$values ('finance@theirs.test','finance')$$,
  'a supplier-estate agency''s statement goes to its finance address and to no login');

/* AND THE SAME PERSON ARM STILL WORKS IN OPNDOOR'S ESTATE, so the
   exclusion above is about the estate and not about the arm. */
update public.agencies set finance_email = 'finance@ours.test'
 where id = '93000000-0000-0000-0000-0000000e5001';
select bag_eq(
  $$select email, source from public.commission_statement_recipients('agency','93000000-0000-0000-0000-0000000e5001')$$,
  $$values ('finance@ours.test','finance'),
           ('zzz.frost.director@e.test','person')$$,
  'while our own estate still addresses its Director beside the finance address');

select * from finish();
rollback;
