-- A SUPPLIER MAY CORRECT ITS OWN AGENCIES AND OFFICES, AND ONLY ITS OWN.
--
-- Matt: "Supplier Management (not Referrers) can edit their own agencies'
-- and offices' name, address and email ... the same duplicate-name check as
-- adding ... recorded in Recent changes with who did it. Opndoor admins can
-- edit them too."
--
-- THERE WAS NO WAY TO EDIT ANY OF THE THREE. Dev had set_agency_group,
-- set_agency_level, set_agency_rates, set_agency_referencing_mode and
-- set_agency_share_deal -- every one a SETTING -- and nothing that changed
-- a name, an address or an email. An agency created with a typo stayed
-- that way, and most of them are created from a referral form by a
-- Referrer in a hurry.
--
-- "NOT REFERRERS" IS THE CLAUSE WORTH TESTING, because a Referrer is
-- exactly who adds these: creating one is not the right to rename it.

begin;
select plan(12);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate,
                             is_house_route, refers_own_stock, portal_referrals_enabled, api_access_enabled, partner_kind)
values ('d7000000-0000-0000-0000-0000000000d1','zzz-ed-supplier','ZZZ ED Supplier',
        'pre_referenced_open', 0.30, 0.10, false, false, true, true, 'supplier'),
       ('d7000000-0000-0000-0000-0000000000d2','zzz-ed-other','ZZZ ED Other Supplier',
        'pre_referenced_open', 0.30, 0.10, false, false, true, true, 'supplier');
insert into public.agencies (id, partner_id, name) values
  ('d7000000-0000-0000-0000-0000000000a1','d7000000-0000-0000-0000-0000000000d1','ZZZ ED Agency'),
  ('d7000000-0000-0000-0000-0000000000a2','d7000000-0000-0000-0000-0000000000d1','ZZZ ED Taken Name'),
  ('d7000000-0000-0000-0000-0000000000a9','d7000000-0000-0000-0000-0000000000d2','ZZZ ED Stranger');
insert into public.branches (id, agency_id, partner_id, name) values
  ('d7000000-0000-0000-0000-0000000000b1','d7000000-0000-0000-0000-0000000000a1',
   'd7000000-0000-0000-0000-0000000000d1','ZZZ ED Office');
insert into public.agent_contacts (agency_id, partner_id, name, email, is_primary) values
  ('d7000000-0000-0000-0000-0000000000a1','d7000000-0000-0000-0000-0000000000d1','Desk','desk@zzzed.test', true);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('d7000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.ed.mgmt@r.test','',now(),now(),now()),
       ('d7000000-0000-0000-0000-00000000c002','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.ed.ref@r.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('d7000000-0000-0000-0000-00000000c001','Ed Management','zzz.ed.mgmt@r.test','management',
   'd7000000-0000-0000-0000-0000000000d1','active',true),
  ('d7000000-0000-0000-0000-00000000c002','Ed Referrer','zzz.ed.ref@r.test','referrer',
   'd7000000-0000-0000-0000-0000000000d1','active',false);

select set_config('request.jwt.claims',
  '{"sub":"d7000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ===========================================================================
-- 1-4. THE EDIT ITSELF: all three fields, by the supplier's own Management.
-- ===========================================================================
select lives_ok(
  $$select public.set_agency_details('d7000000-0000-0000-0000-0000000000a1',
      'ZZZ ED Agency Ltd', '12 High Street, London W1A 1AA', 'newdesk@zzzed.test')$$,
  'a supplier''s Management may correct their own agency');
reset role;

select is((select name from public.agencies where id='d7000000-0000-0000-0000-0000000000a1'),
  'ZZZ ED Agency Ltd', 'the name changes');
select is((select address from public.agencies where id='d7000000-0000-0000-0000-0000000000a1'),
  '12 High Street, London W1A 1AA', 'and the address, which did not exist as a field before');
select is((select email from public.agent_contacts
            where agency_id='d7000000-0000-0000-0000-0000000000a1' and is_primary),
  'newdesk@zzzed.test', 'and the email signed deeds go to');

-- ===========================================================================
-- 5-6. RECORDED WITH WHO DID IT, which is Matt's own clause, and saying
--      WHAT changed rather than that something did.
-- ===========================================================================
select is(
  (select detail from public.org_audit
    where entity_id='d7000000-0000-0000-0000-0000000000a1' and action='renamed'),
  'ZZZ ED Agency renamed to ZZZ ED Agency Ltd',
  'the rename says both names');
select is(
  (select actor from public.org_audit
    where entity_id='d7000000-0000-0000-0000-0000000000a1' and action='email_changed'),
  'Ed Management',
  'and the email change names the person');

-- ===========================================================================
-- 7. A CASE-ONLY FIX IS STILL A RENAME. Correcting "asda" to "ASDA" is the
--    commonest edit this exists for, and a case-insensitive comparison --
--    which the DUPLICATE check must use -- would record nothing.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"d7000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select public.set_agency_details('d7000000-0000-0000-0000-0000000000a1',
  'ZZZ ED AGENCY LTD', null, 'newdesk@zzzed.test');
reset role;
select is(
  (select count(*) from public.org_audit
    where entity_id='d7000000-0000-0000-0000-0000000000a1' and action='renamed'),
  2::bigint,
  'a capitalisation fix is recorded, though it is not a duplicate of itself');

-- ===========================================================================
-- 8-9. THE DUPLICATE CHECK, the same one as adding, and ignoring case.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"d7000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.set_agency_details('d7000000-0000-0000-0000-0000000000a1',
      'zzz ed taken name', null, 'newdesk@zzzed.test')$$,
  '23505', null,
  'renaming onto a sibling''s name is refused, whatever the case');

select lives_ok(
  $$select public.set_agency_details('d7000000-0000-0000-0000-0000000000a1',
      'ZZZ ED AGENCY LTD', null, 'newdesk@zzzed.test')$$,
  'but keeping its own name is not a clash with itself');

-- ===========================================================================
-- 10-11. WHO MAY NOT. A Referrer adds these agencies and may not rename
--        them; another supplier's Management may not touch them at all.
-- ===========================================================================
reset role;
select set_config('request.jwt.claims',
  '{"sub":"d7000000-0000-0000-0000-00000000c002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.set_agency_details('d7000000-0000-0000-0000-0000000000a1',
      'Referrer Renamed This', null, 'newdesk@zzzed.test')$$,
  '42501', 'Not permitted.',
  'a Referrer may not rename an agency, though a Referrer is who added it');

reset role;
select set_config('request.jwt.claims',
  '{"sub":"d7000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$select public.set_agency_details('d7000000-0000-0000-0000-0000000000a9',
      'Reaching Into Another Estate', null, null)$$,
  '42501', 'Not permitted.',
  'and Management may not reach into another supplier''s estate');

-- ===========================================================================
-- 12. AN OFFICE'S EMAIL IS AN OVERRIDE, so clearing it is a real act: the
--     row is deleted rather than emptied, which is what makes the agency's
--     address take over.
-- ===========================================================================
reset role;
insert into public.agent_contacts (branch_id, partner_id, name, email, is_primary) values
  ('d7000000-0000-0000-0000-0000000000b1','d7000000-0000-0000-0000-0000000000d1','Office','office@zzzed.test', true);
select set_config('request.jwt.claims',
  '{"sub":"d7000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select public.set_branch_details('d7000000-0000-0000-0000-0000000000b1','ZZZ ED Office', null, '');
reset role;
select is(
  (select count(*) from public.agent_contacts where branch_id='d7000000-0000-0000-0000-0000000000b1'),
  0::bigint,
  'clearing an office email removes the override, so the agency''s applies again');

select * from finish();
rollback;
