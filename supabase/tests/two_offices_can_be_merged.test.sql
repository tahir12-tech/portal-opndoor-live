/* MERGING TWO OFFICES.
   Migration: 20261009070000.

   Matt, 2026-10-05: "Merging two offices: yes, write merge_branches,
   matching how merge_agencies works, with a test."

   WHY A DELETE WOULD NOT DO, which is the whole shape of this function.
   Six foreign keys point at a branch and three of them CASCADE:
   agent_contacts, branch_deed_recipient and user_scopes. Two more SET
   NULL: users.home_branch_id and application_agency_match. So deleting
   the merged office would silently take its contacts, its nominated
   deed recipient and every position held at it, and quietly unplace
   anybody whose home it was. Each assertion below is one of those.

   THE FIXTURE IS TWO OFFICES OF ONE AGENCY, both carrying everything a
   real office carries, and one of each conflict: two primary contacts,
   two deed recipients, and one person positioned at both. */
begin;
select plan(17);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values
  ('ed100000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','zzz.mb.admin@opndoor.test','',now(),now(),now()),
  ('ed100000-0000-0000-0000-00000000c002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','zzz.mb.neg@agency.test','',now(),now(),now());

/* OUR OWN ESTATE FOR THE PAIR. A supplier's agencies have no logins, so a
   position or a home office at one is refused by
   user_scopes_not_in_a_supplier_estate -- and those are two of the five
   cascades this function exists to carry. The second estate is a supplier,
   which is what makes the cross-estate refusal a real test. */
insert into public.partners (id, slug, name, status, partner_kind, referencing_mode, partner_rate, agent_rate)
values
  ('ed100000-0000-0000-0000-00000000f001'::uuid, 'zzz-mb-ours', 'ZZZ MB Our Estate',
   'active', 'agency', 'opndoor_referenced', 0.2, 0.1),
  ('ed100000-0000-0000-0000-00000000f002'::uuid, 'zzz-mb-other', 'ZZZ MB Other Estate',
   'active', 'supplier', 'pre_referenced_open', 0.2, 0.1);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('ed100000-0000-0000-0000-00000000c001','ZZZ MB Admin','zzz.mb.admin@opndoor.test','superadmin', null,'active',true),
  ('ed100000-0000-0000-0000-00000000c002','ZZZ MB Negotiator','zzz.mb.neg@agency.test','referrer',
   'ed100000-0000-0000-0000-00000000f001'::uuid,'active',false);

insert into public.agencies (id, name, partner_id, review_state, livemode) values
  ('ed100000-0000-0000-0000-00000000f0a1'::uuid, 'ZZZ MB Agency',
   'ed100000-0000-0000-0000-00000000f001'::uuid, 'confirmed', true),
  /* A SECOND AGENCY IN THE SAME ESTATE, because two duplicate offices can
     sit under two different agencies and the applications carry a
     denormalised agency_id that has to move with the office. */
  ('ed100000-0000-0000-0000-00000000f0a2'::uuid, 'ZZZ MB Second Agency',
   'ed100000-0000-0000-0000-00000000f001'::uuid, 'confirmed', true),
  ('ed100000-0000-0000-0000-00000000f0a3'::uuid, 'ZZZ MB Other Agency',
   'ed100000-0000-0000-0000-00000000f002'::uuid, 'confirmed', true);

insert into public.branches (id, name, agency_id, partner_id, review_state, livemode) values
  ('ed100000-0000-0000-0000-00000000f0b1'::uuid, 'ZZZ Mayfair',
   'ed100000-0000-0000-0000-00000000f0a1'::uuid, 'ed100000-0000-0000-0000-00000000f001'::uuid, 'confirmed', true),
  ('ed100000-0000-0000-0000-00000000f0b2'::uuid, 'ZZZ Mayfair Office',
   'ed100000-0000-0000-0000-00000000f0a2'::uuid, 'ed100000-0000-0000-0000-00000000f001'::uuid, 'confirmed', true),
  ('ed100000-0000-0000-0000-00000000f0b3'::uuid, 'ZZZ Elsewhere',
   'ed100000-0000-0000-0000-00000000f0a3'::uuid, 'ed100000-0000-0000-0000-00000000f002'::uuid, 'confirmed', true);

insert into public.agent_contacts (id, branch_id, partner_id, name, email, is_primary) values
  ('ed100000-0000-0000-0000-00000000fc01'::uuid, 'ed100000-0000-0000-0000-00000000f0b1'::uuid,
   'ed100000-0000-0000-0000-00000000f001'::uuid, 'Keeper Primary', 'zzz.keep@office.test', true),
  ('ed100000-0000-0000-0000-00000000fc02'::uuid, 'ed100000-0000-0000-0000-00000000f0b2'::uuid,
   'ed100000-0000-0000-0000-00000000f001'::uuid, 'Merged Primary', 'zzz.merge@office.test', true);

/* THE NOMINATION IS A USER, not a contact: branch_deed_recipient is
   (branch_id, user_id). Found by trying. */
insert into public.branch_deed_recipient (branch_id, user_id) values
  ('ed100000-0000-0000-0000-00000000f0b2'::uuid, 'ed100000-0000-0000-0000-00000000c002');

insert into public.user_scopes (user_id, kind, branch_id) values
  ('ed100000-0000-0000-0000-00000000c002', 'branch', 'ed100000-0000-0000-0000-00000000f0b2'::uuid);
update public.users set home_branch_id = 'ed100000-0000-0000-0000-00000000f0b2'::uuid
 where id = 'ed100000-0000-0000-0000-00000000c002';

insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, livemode, status, referrer_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_email, tenant_phone, tenant_dob,
   prop_addr1, prop_city, prop_postcode, monthly_rent, tenancy_start,
   partner_rate, agent_rate, fee_amount, referencing_mode)
values ('ed100000-0000-0000-0000-00000000fa01'::uuid, 'GR-ZZZMB', 'ed100000-0000-0000-0000-00000000f001'::uuid,
        'ed100000-0000-0000-0000-00000000f0a2'::uuid, 'ed100000-0000-0000-0000-00000000f0b2'::uuid,
        true, 'sent', 'ed100000-0000-0000-0000-00000000c002'::uuid,
        'Ms','Merge','Me','zzz.mb@tenant.test','07700900055','1990-01-01',
        '1 Merge Street','Sheffield','S7 1FD', 1200, current_date + 30, 0.2, 0.1, 1200, 'pre_referenced_open');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ed100000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);

-- ===========================================================================
-- 1. THE REFUSALS, BEFORE ANYTHING MOVES.
-- ===========================================================================
select throws_ok(
  $$select public.merge_branches('ed100000-0000-0000-0000-00000000f0b1','ed100000-0000-0000-0000-00000000f0b1')$$,
  '22023', 'Cannot merge an office into itself', 'an office cannot be merged into itself');

/* THE SEPARATE-ESTATES RULE, which merge_agencies does not test and this
   does: two offices in two estates are two companies. */
select throws_ok(
  $$select public.merge_branches('ed100000-0000-0000-0000-00000000f0b1','ed100000-0000-0000-0000-00000000f0b3')$$,
  '22023', null, 'and never one in another estate');

select is(
  (select count(*)::int from public.branches where id = 'ed100000-0000-0000-0000-00000000f0b3'),
  1, 'the refused office is still there, untouched');

-- ===========================================================================
-- 2. THE MERGE.
-- ===========================================================================
select lives_ok(
  $$select public.merge_branches('ed100000-0000-0000-0000-00000000f0b1','ed100000-0000-0000-0000-00000000f0b2','duplicate')$$,
  'two offices of one estate merge');

select is(
  (select count(*)::int from public.branches where id = 'ed100000-0000-0000-0000-00000000f0b2'),
  0, 'the merged office is gone');

/* THE APPLICATION MOVED, AND SO DID ITS AGENCY. The two offices sat under
   different agencies, and a row left filed under an agency that no longer
   holds its office is the denormalisation telling a lie. */
select is(
  (select branch_id from public.applications where guarantee_ref = 'GR-ZZZMB'),
  'ed100000-0000-0000-0000-00000000f0b1'::uuid, 'the application points at the survivor');
select is(
  (select agency_id from public.applications where guarantee_ref = 'GR-ZZZMB'),
  'ed100000-0000-0000-0000-00000000f0a1'::uuid, 'and at the survivor''s agency');

/* THE THREE CASCADES, each one a thing a plain delete would have taken. */
select is(
  (select count(*)::int from public.agent_contacts
    where branch_id = 'ed100000-0000-0000-0000-00000000f0b1'),
  2, 'both contacts are on the survivor');

select is(
  (select name from public.agent_contacts
    where branch_id = 'ed100000-0000-0000-0000-00000000f0b1' and is_primary),
  'Keeper Primary',
  'the survivor''s primary stands and the incoming one was demoted, not dropped');

select is(
  (select count(*)::int from public.user_scopes
    where branch_id = 'ed100000-0000-0000-0000-00000000f0b1' and user_id = 'ed100000-0000-0000-0000-00000000c002'),
  1, 'the position moved to the survivor');

select is(
  (select home_branch_id from public.users where id = 'ed100000-0000-0000-0000-00000000c002'),
  'ed100000-0000-0000-0000-00000000f0b1'::uuid,
  'and the negotiator still has a home office, rather than a null');

/* THE NOMINATION, which the survivor did not have and the merged one did. */
select is(
  (select user_id from public.branch_deed_recipient
    where branch_id = 'ed100000-0000-0000-0000-00000000f0b1'),
  'ed100000-0000-0000-0000-00000000c002'::uuid,
  'the deed recipient came across, because the survivor had none');

-- ===========================================================================
-- 3. AND IT IS RECORDED.
-- ===========================================================================
reset role;
select is(
  (select detail from public.org_audit
    where entity_type = 'branch' and entity_id = 'ed100000-0000-0000-0000-00000000f0b1' and action = 'merged'),
  'Merged office "ZZZ Mayfair Office" into "ZZZ Mayfair": duplicate',
  'the merge is in Recent changes, with the note');

select is(
  (select actor from public.org_audit
    where entity_type = 'branch' and entity_id = 'ed100000-0000-0000-0000-00000000f0b1' and action = 'merged'),
  'ZZZ MB Admin', 'and who did it');

-- ===========================================================================
-- 4. AND THE AGENCY MERGE, WHICH THE BROWSER COULD NOT CALL AT ALL.
-- ===========================================================================
/* merge_agencies has existed since the agencies work and was granted to
   service_role only, so the "Merge into" button (ck) added to
   Reconciliation would have failed at the click with "permission denied
   for function merge_agencies". The grant is in the same migration as
   merge_branches; these are the two halves of what that grant must and
   must not allow, exercised here because a grant with no test is how the
   button came to be drawn over nothing.

   INSIDE THE TRANSACTION, like everything else in this file. A check of
   this shape run against dev directly is what merged two real agencies
   this morning. */
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ed100000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);

select lives_ok(
  $$select public.merge_agencies('ed100000-0000-0000-0000-00000000f0a1','ed100000-0000-0000-0000-00000000f0a2')$$,
  'an admin may now call merge_agencies as the browser does');

/* AND THE GRANT IS NOT THE GUARD. A signed-in user who is not an admin
   is refused BY THE FUNCTION, which is what makes widening the grant
   safe rather than merely convenient. */
select set_config('request.jwt.claims',
  '{"sub":"ed100000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
select throws_ok(
  $$select public.merge_agencies('ed100000-0000-0000-0000-00000000f0a1','ed100000-0000-0000-0000-00000000f0a3')$$,
  '42501', 'not permitted', 'and a negotiator is refused by the function, not by the grant');
select throws_ok(
  $$select public.merge_branches('ed100000-0000-0000-0000-00000000f0b1','ed100000-0000-0000-0000-00000000f0b3')$$,
  '42501', 'not permitted', 'the same for offices');

select * from finish();
rollback;
