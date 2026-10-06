-- ONE SAVE WRITES A SHARE DEAL AND THE AGENCIES IT APPLIES TO.
--
-- Matt, 2026-10-01: "'Add' opens one dialog that asks which agencies first
-- (searchable list of this supplier's agencies, pick one or several), titled
-- with them, e.g. 'Deal for Frost Partnership and 2 others', then the
-- agencies' % editor below, one Save."
--
-- Migration: 20261007300000_one_save_for_a_share_deal_and_its_agencies.sql
--
-- =========================================================================
-- WHAT THIS SUITE EXISTS TO CATCH, AND WHY IT DID NOT EXIST BEFORE
-- =========================================================================
--
-- several_agents_share_deals.test.sql proves the TABLE holds several deals.
-- Every one of its fixtures is a direct insert, so none of it goes through
-- the function a screen calls, and the door was refusing the second deal the
-- whole time: agreement_conflicts reported 'already has a live agents'' share
-- deal', and confirming that ended the default and every other bespoke deal
-- before inserting the new one as the default.
--
-- So assertion 1 here is deliberately the dullest sentence in the file --
-- "a second deal can be written" -- because that is the one that was false.
-- Everything after it is about what must NOT move when it is.

begin;
select plan(24);

-- ---------------------------------------------------------------------------
-- FIXTURE. One supplier with a total and a default share deal, four agencies
-- under it, one agency under somebody else, one admin with MFA.
-- ---------------------------------------------------------------------------
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route, opndoor_pays_agents, partner_kind)
values ('98000000-0000-0000-0000-0000000000f1', 'zzz-onesave', 'ZZZ One Save', 'pre_referenced_open', 0.35, 0.10, false, false, 'supplier'),
       ('98000000-0000-0000-0000-0000000000f2', 'zzz-onesave-other', 'ZZZ One Save Other', 'pre_referenced_open', 0.30, 0.10, false, false, 'supplier');

insert into public.agencies (id, partner_id, name) values
  ('98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-0000000000f1', 'ZZZ Frost Partnership'),
  ('98000000-0000-0000-0000-0000000000a2', '98000000-0000-0000-0000-0000000000f1', 'ZZZ Harrow Lets'),
  ('98000000-0000-0000-0000-0000000000a3', '98000000-0000-0000-0000-0000000000f1', 'ZZZ Ivy Residential'),
  ('98000000-0000-0000-0000-0000000000a4', '98000000-0000-0000-0000-0000000000f1', 'ZZZ Kemp Street'),
  ('98000000-0000-0000-0000-0000000000a9', '98000000-0000-0000-0000-0000000000f2', 'ZZZ Not Ours');

insert into public.branches (id, agency_id, partner_id, name) values
  ('98000000-0000-0000-0000-0000000000b1', '98000000-0000-0000-0000-0000000000a1', '98000000-0000-0000-0000-0000000000f1', 'ZZZ Frost Office'),
  ('98000000-0000-0000-0000-0000000000b2', '98000000-0000-0000-0000-0000000000a2', '98000000-0000-0000-0000-0000000000f1', 'ZZZ Harrow Office'),
  ('98000000-0000-0000-0000-0000000000b4', '98000000-0000-0000-0000-0000000000a4', '98000000-0000-0000-0000-0000000000f1', 'ZZZ Kemp Office');

-- The supplier's own commission, so a share has a total to sit inside.
insert into public.pricing_agreements (id, scope_level, scope_id, coverage, period, counting_scope, is_standard, effective_from, kind)
values ('98000000-0000-0000-0000-0000000000c0','partner','98000000-0000-0000-0000-0000000000f1','additive','year','agency',false,current_date,'commission');
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, fee_basis_unit, agent_rate)
values ('98000000-0000-0000-0000-0000000000c0', 1, null, 1, 'months', 0.35);

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
values ('98000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'admin@zzz-onesave.test', now(), now(), '{}'::jsonb, '{}'::jsonb, '','','','','','','','');
insert into public.users (id, full_name, email, role, partner_id, status)
values ('98000000-0000-0000-0000-0000000000ff', 'One Save Admin', 'admin@zzz-onesave.test', 'superadmin', null, 'active');
select set_config('request.jwt.claims',
  '{"sub":"98000000-0000-0000-0000-0000000000ff","role":"authenticated","aal":"aal2"}', true);

-- ===========================================================================
-- 1. THE DEFAULT DEAL, WRITTEN THROUGH THE DOOR WITH NO AGENCIES NAMED
-- ===========================================================================
select lives_ok(
  $$ select public.save_share_deal(
       '98000000-0000-0000-0000-0000000000f1',
       '[{"min":1,"max":"","rate":0.10}]'::jsonb,
       '[]'::jsonb, 'The default', 'month', 'agency', '{}'::uuid[], null) $$,
  'a supplier with no share deal gets one, and naming no agency means the default');

select is(
  (select count(*)::int from public.pricing_agreements
    where scope_level = 'partner' and scope_id = '98000000-0000-0000-0000-0000000000f1'
      and kind = 'agent_share' and is_default_share and ended_at is null),
  1, 'exactly one live default');

-- ===========================================================================
-- 2. THE ASSERTION THAT WAS FALSE: A SECOND DEAL, FOR NAMED AGENCIES
-- ===========================================================================
/* Through create_agreement this raised 'already has a live agents'' share
   deal', and confirming it ended the default. One call, no confirmation, and
   nothing else moves. */
select lives_ok(
  $$ select public.save_share_deal(
       '98000000-0000-0000-0000-0000000000f1',
       '[{"min":1,"max":"","rate":0.20}]'::jsonb,
       '[]'::jsonb, 'Frost and Harrow', 'month', 'agency',
       array['98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000a2']::uuid[],
       null) $$,
  'a second deal for two named agencies is written, with no confirmation to press');

select is(
  (select count(*)::int from public.pricing_agreements
    where scope_level = 'partner' and scope_id = '98000000-0000-0000-0000-0000000000f1'
      and kind = 'agent_share' and ended_at is null),
  2, 'and both deals are live: the default was not ended');

select is(
  (select count(*)::int from public.pricing_agreements
    where scope_level = 'partner' and scope_id = '98000000-0000-0000-0000-0000000000f1'
      and kind = 'agent_share' and is_default_share and ended_at is null),
  1, 'the new one is not a second default');

select is(
  (select count(*)::int from public.pricing_agreement_members m
    join public.pricing_agreements pa on pa.id = m.agreement_id
   where pa.scope_id = '98000000-0000-0000-0000-0000000000f1' and not pa.is_default_share),
  2, 'both named agencies are on it, which is "several agencies can share one deal"');

-- ===========================================================================
-- 3. A THIRD DEAL LEAVES THE SECOND ALONE
-- ===========================================================================
select lives_ok(
  $$ select public.save_share_deal(
       '98000000-0000-0000-0000-0000000000f1',
       '[{"min":1,"max":"","rate":0.05}]'::jsonb,
       '[]'::jsonb, 'Ivy only', 'month', 'agency',
       array['98000000-0000-0000-0000-0000000000a3']::uuid[], null) $$,
  'a third deal is written');

select is(
  (select count(*)::int from public.pricing_agreements
    where scope_level = 'partner' and scope_id = '98000000-0000-0000-0000-0000000000f1'
      and kind = 'agent_share' and ended_at is null),
  3, 'and all three are live at once');

select is(
  (select count(*)::int from public.pricing_agreement_members m
    join public.pricing_agreements pa on pa.id = m.agreement_id
   where pa.scope_id = '98000000-0000-0000-0000-0000000000f1' and pa.ended_at is null),
  3, 'with three agencies named across them and nobody dropped');

-- ===========================================================================
-- 4. WHAT THE RESOLVER THEN PRICES EACH AGENCY AT
-- ===========================================================================
select is(
  (select agent_rate from public.resolve_pricing_agreement(
     '98000000-0000-0000-0000-0000000000b1', '98000000-0000-0000-0000-0000000000f1', 1, 'agent_share')),
  0.20::numeric, 'a named agency is priced by its own deal');

select is(
  (select agent_rate from public.resolve_pricing_agreement(
     '98000000-0000-0000-0000-0000000000b4', '98000000-0000-0000-0000-0000000000f1', 1, 'agent_share')),
  0.10::numeric, 'and an agency on nothing is priced by the default');

-- ===========================================================================
-- 5. CHANGING A DEAL CARRIES ITS AGENCIES ACROSS
-- ===========================================================================
/* The terms are re-cut under the agencies; the agencies did not move. So the
   membership follows the new agreement id and keeps its date, and a screen
   that reads "moved here 1 Oct by Rosa" still says something true. */
create temporary table zzz_before on commit drop as
select m.agency_id, m.added_at
  from public.pricing_agreement_members m
  join public.pricing_agreements pa on pa.id = m.agreement_id
 where pa.note = 'Frost and Harrow';

select lives_ok(
  $$ select public.save_share_deal(
       '98000000-0000-0000-0000-0000000000f1',
       '[{"min":1,"max":"","rate":0.22}]'::jsonb,
       '[]'::jsonb, 'Frost and Harrow, dearer', 'month', 'agency',
       array['98000000-0000-0000-0000-0000000000a1','98000000-0000-0000-0000-0000000000a2']::uuid[],
       (select id from public.pricing_agreements where note = 'Frost and Harrow')) $$,
  'a deal can be changed by id');

select is(
  (select count(*)::int from public.pricing_agreements
    where note = 'Frost and Harrow' and ended_at is not null),
  1, 'which ends the deal it replaces');

select is(
  (select count(*)::int from public.pricing_agreements
    where scope_level = 'partner' and scope_id = '98000000-0000-0000-0000-0000000000f1'
      and kind = 'agent_share' and ended_at is null),
  3, 'and ends nothing else: three deals are still live');

select is(
  (select agent_rate from public.resolve_pricing_agreement(
     '98000000-0000-0000-0000-0000000000b1', '98000000-0000-0000-0000-0000000000f1', 1, 'agent_share')),
  0.22::numeric, 'the named agencies are priced by the new terms');

select is(
  (select count(*)::int from public.pricing_agreement_members m
    join public.pricing_agreements pa on pa.id = m.agreement_id
   where pa.note = 'Frost and Harrow, dearer'),
  2, 'both agencies came across with it');

select is(
  (select count(*)::int from public.pricing_agreement_members m
    join zzz_before z on z.agency_id = m.agency_id
   where m.added_at <> z.added_at),
  0, 'and neither was re-dated, because neither moved deal');

-- ===========================================================================
-- 6. AN AGENCY DROPPED FROM A DEAL GOES BACK TO THE DEFAULT
-- ===========================================================================
select lives_ok(
  $$ select public.save_share_deal(
       '98000000-0000-0000-0000-0000000000f1',
       '[{"min":1,"max":"","rate":0.22}]'::jsonb,
       '[]'::jsonb, 'Frost alone', 'month', 'agency',
       array['98000000-0000-0000-0000-0000000000a1']::uuid[],
       (select id from public.pricing_agreements where note = 'Frost and Harrow, dearer')) $$,
  'saving the deal with one of the two named drops the other');

select is(
  (select agent_rate from public.resolve_pricing_agreement(
     '98000000-0000-0000-0000-0000000000b2', '98000000-0000-0000-0000-0000000000f1', 1, 'agent_share')),
  0.10::numeric, 'and the dropped agency is back on the default');

-- ===========================================================================
-- 7. WHAT THE DOOR REFUSES
-- ===========================================================================
select throws_ok(
  $$ select public.save_share_deal(
       '98000000-0000-0000-0000-0000000000f1',
       '[{"min":1,"max":"","rate":0.20}]'::jsonb,
       '[]'::jsonb, 'Someone else''s agency', 'month', 'agency',
       array['98000000-0000-0000-0000-0000000000a9']::uuid[], null) $$,
  '22023', null,
  'a deal cannot name an agency of another supplier');

select throws_ok(
  $$ select public.save_share_deal(
       '98000000-0000-0000-0000-0000000000f1',
       '[{"min":1,"max":"","rate":0.20}]'::jsonb,
       '[]'::jsonb, 'Default with members', 'month', 'agency',
       array['98000000-0000-0000-0000-0000000000a4']::uuid[],
       (select id from public.pricing_agreements
         where scope_id = '98000000-0000-0000-0000-0000000000f1'
           and is_default_share and ended_at is null)) $$,
  '22023', null,
  'and the default deal cannot be given named agencies');

/* THE GUARD THAT WAS ALREADY THERE STILL FIRES THROUGH THE NEW DOOR. A share
   above the supplier's own total is the one arithmetic that cannot be allowed
   to reach the resolver, and it is checked against every live share deal. */
select throws_ok(
  $$ select public.save_share_deal(
       '98000000-0000-0000-0000-0000000000f1',
       '[{"min":1,"max":"","rate":0.60}]'::jsonb,
       '[]'::jsonb, 'More than the total', 'month', 'agency',
       array['98000000-0000-0000-0000-0000000000a4']::uuid[], null) $$,
  '22023', null,
  'a share over the supplier''s own commission is refused');

-- ===========================================================================
-- 8. AND WHO MAY CALL IT
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"98000000-0000-0000-0000-0000000000ff","role":"authenticated","aal":"aal1"}', true);
/* AS THE ROLE THAT WILL ACTUALLY CALL IT. A refusal asserted as `postgres`
   proves the function's own `if` and nothing about the seat the browser
   sits in, which is what `testsRunAsTheirRole` is for. */
set local role authenticated;
select throws_ok(
  $$ select public.save_share_deal(
       '98000000-0000-0000-0000-0000000000f1',
       '[{"min":1,"max":"","rate":0.10}]'::jsonb,
       '[]'::jsonb, 'No MFA', 'month', 'agency', '{}'::uuid[], null) $$,
  '42501', null,
  'without MFA it refuses, because this decides what an agency is paid');
reset role;

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
values ('98000000-0000-0000-0000-0000000000fe', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'staff@zzz-onesave.test', now(), now(), '{}'::jsonb, '{}'::jsonb, '','','','','','','','');
insert into public.users (id, full_name, email, role, partner_id, status)
values ('98000000-0000-0000-0000-0000000000fe', 'One Save Staff', 'staff@zzz-onesave.test', 'opndoor_manager', null, 'active');
select set_config('request.jwt.claims',
  '{"sub":"98000000-0000-0000-0000-0000000000fe","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select throws_ok(
  $$ select public.save_share_deal(
       '98000000-0000-0000-0000-0000000000f1',
       '[{"min":1,"max":"","rate":0.10}]'::jsonb,
       '[]'::jsonb, 'Not an admin', 'month', 'agency', '{}'::uuid[], null) $$,
  '42501', null,
  'and a member of staff who is not an administrator cannot agree one either');
reset role;

select * from finish();
rollback;
