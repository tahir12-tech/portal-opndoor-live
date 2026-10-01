-- SEVERAL AGENTS'-SHARE DEALS, AND WHICH AGENCIES ARE ON EACH.
--
-- Matt, 2026-10-01: "allow several deals. One default deal for all agencies,
-- plus extra deals that each apply to agencies picked from a searchable list
-- of that supplier's agencies (several agencies can share one deal). Show
-- which agencies are on which deal, and every agency not picked uses the
-- default. An agency can only be on one deal at a time; moving it is one
-- click."
--
-- Migration: 20261007240000_several_agents_share_deals.sql
--
-- =========================================================================
-- THE FIXTURE IS THE INSTRUCTION
-- =========================================================================
--
-- One supplier, FOUR agencies, and three share deals:
--
--   default   10%   every agency not named on another  -> Delta
--   premium   20%   Alpha AND Bravo, on ONE deal       -> "several agencies
--                                                          can share one"
--   thin       5%   Charlie
--
-- Alpha and Bravo being on one agreement id, not two copies of a deal, is
-- the whole point: it is what makes "show which agencies are on which deal"
-- answerable and "change the premium deal" one edit rather than two.

begin;
select plan(30);

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route, opndoor_pays_agents)
values ('97000000-0000-0000-0000-0000000000f1', 'zzz-many', 'ZZZ Many Deals', 'pre_referenced_open', 0.35, 0.10, false, false),
       ('97000000-0000-0000-0000-0000000000f2', 'zzz-other', 'ZZZ Other Supplier', 'pre_referenced_open', 0.30, 0.10, false, false);

insert into public.agencies (id, partner_id, name) values
  ('97000000-0000-0000-0000-0000000000a1', '97000000-0000-0000-0000-0000000000f1', 'ZZZ Alpha'),
  ('97000000-0000-0000-0000-0000000000a2', '97000000-0000-0000-0000-0000000000f1', 'ZZZ Bravo'),
  ('97000000-0000-0000-0000-0000000000a3', '97000000-0000-0000-0000-0000000000f1', 'ZZZ Charlie'),
  ('97000000-0000-0000-0000-0000000000a4', '97000000-0000-0000-0000-0000000000f1', 'ZZZ Delta'),
  ('97000000-0000-0000-0000-0000000000a9', '97000000-0000-0000-0000-0000000000f2', 'ZZZ Foreign');

insert into public.branches (id, agency_id, partner_id, name) values
  ('97000000-0000-0000-0000-0000000000b1', '97000000-0000-0000-0000-0000000000a1', '97000000-0000-0000-0000-0000000000f1', 'ZZZ Alpha Office'),
  ('97000000-0000-0000-0000-0000000000b2', '97000000-0000-0000-0000-0000000000a2', '97000000-0000-0000-0000-0000000000f1', 'ZZZ Bravo Office'),
  ('97000000-0000-0000-0000-0000000000b3', '97000000-0000-0000-0000-0000000000a3', '97000000-0000-0000-0000-0000000000f1', 'ZZZ Charlie Office'),
  ('97000000-0000-0000-0000-0000000000b4', '97000000-0000-0000-0000-0000000000a4', '97000000-0000-0000-0000-0000000000f1', 'ZZZ Delta Office');

-- The supplier's own commission, so the share deals have a total to sit in.
insert into public.pricing_agreements (id, scope_level, scope_id, coverage, period, counting_scope, is_standard, effective_from, kind)
values ('97000000-0000-0000-0000-0000000000c0','partner','97000000-0000-0000-0000-0000000000f1','additive','year','agency',false,current_date,'commission');
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, fee_basis_unit, agent_rate)
values ('97000000-0000-0000-0000-0000000000c0', 1, null, 1, 'months', 0.35);

-- ===========================================================================
-- 1. SEVERAL SHARE DEALS AT ONCE, WHICH THE EXCLUSIVITY TRIGGER USED TO REFUSE
-- ===========================================================================
insert into public.pricing_agreements (id, scope_level, scope_id, coverage, period, counting_scope, is_standard, effective_from, kind, is_default_share)
values ('97000000-0000-0000-0000-0000000000d0','partner','97000000-0000-0000-0000-0000000000f1','additive','year','agency',false,current_date,'agent_share', true);

select lives_ok(
  $$insert into public.pricing_agreements (id, scope_level, scope_id, coverage, period, counting_scope, is_standard, effective_from, kind, is_default_share)
    values ('97000000-0000-0000-0000-0000000000d1','partner','97000000-0000-0000-0000-0000000000f1','additive','year','agency',false,current_date,'agent_share', false)$$,
  'a supplier may hold a SECOND agents'' share deal, which "one of each, never two" refused');

insert into public.pricing_agreements (id, scope_level, scope_id, coverage, period, counting_scope, is_standard, effective_from, kind, is_default_share)
values ('97000000-0000-0000-0000-0000000000d2','partner','97000000-0000-0000-0000-0000000000f1','additive','year','agency',false,current_date,'agent_share', false);

insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, fee_basis_unit, agent_rate)
values ('97000000-0000-0000-0000-0000000000d0', 1, null, null, 'months', 0.10),
       ('97000000-0000-0000-0000-0000000000d1', 1, null, null, 'months', 0.20),
       ('97000000-0000-0000-0000-0000000000d2', 1, null, null, 'months', 0.05);

-- ONE DEFAULT ONLY, and it is an index rather than a rule to remember.
select throws_ok(
  $$insert into public.pricing_agreements (id, scope_level, scope_id, coverage, period, counting_scope, is_standard, effective_from, kind, is_default_share)
    values ('97000000-0000-0000-0000-0000000000d8','partner','97000000-0000-0000-0000-0000000000f1','additive','year','agency',false,current_date,'agent_share', true)$$,
  '23505', null, 'but only ONE of them can be the default');

-- And a commission deal cannot be marked one at all.
select throws_ok(
  $$insert into public.pricing_agreements (id, scope_level, scope_id, coverage, period, counting_scope, is_standard, effective_from, kind, is_default_share)
    values ('97000000-0000-0000-0000-0000000000d7','agency','97000000-0000-0000-0000-0000000000a1','additive','year','agency',false,current_date,'commission', true)$$,
  '23514', null, 'and only an agents'' share deal at partner scope may be a default');

-- ===========================================================================
-- 2. SEVERAL AGENCIES SHARE ONE DEAL
-- ===========================================================================
insert into public.pricing_agreement_members (agreement_id, agency_id) values
  ('97000000-0000-0000-0000-0000000000d1', '97000000-0000-0000-0000-0000000000a1'),
  ('97000000-0000-0000-0000-0000000000d1', '97000000-0000-0000-0000-0000000000a2'),
  ('97000000-0000-0000-0000-0000000000d2', '97000000-0000-0000-0000-0000000000a3');

/* ONE AGREEMENT ID, TWO AGENCIES. The assertion that distinguishes this from
   N identical copies, and therefore the one that would still pass if
   somebody "simplified" it back into copies -- so it is asserted on the id,
   not on the rate. */
select is(
  (select count(distinct agreement_id)::int from public.pricing_agreement_members
    where agency_id in ('97000000-0000-0000-0000-0000000000a1','97000000-0000-0000-0000-0000000000a2')),
  1, 'Alpha and Bravo are on ONE deal, not two copies of one');

-- ===========================================================================
-- 3. EVERY AGENCY RESOLVES TO THE RIGHT DEAL
-- ===========================================================================
select is(
  (select agent_rate from public.resolve_pricing_agreement(
     '97000000-0000-0000-0000-0000000000b1', '97000000-0000-0000-0000-0000000000f1', 1, 'agent_share')),
  0.20::numeric, 'Alpha is on the premium deal');

select is(
  (select agent_rate from public.resolve_pricing_agreement(
     '97000000-0000-0000-0000-0000000000b2', '97000000-0000-0000-0000-0000000000f1', 1, 'agent_share')),
  0.20::numeric, 'and so is Bravo, off the same deal');

select is(
  (select agent_rate from public.resolve_pricing_agreement(
     '97000000-0000-0000-0000-0000000000b3', '97000000-0000-0000-0000-0000000000f1', 1, 'agent_share')),
  0.05::numeric, 'Charlie is on its own deal');

/* "EVERY AGENCY NOT PICKED USES THE DEFAULT", which is the half that breaks
   silently: an agency nobody has thought about must not fall through to
   nothing, and must not pick up another agency's deal because it sorted
   first. */
select is(
  (select agent_rate from public.resolve_pricing_agreement(
     '97000000-0000-0000-0000-0000000000b4', '97000000-0000-0000-0000-0000000000f1', 1, 'agent_share')),
  0.10::numeric, 'and Delta, named on nothing, takes the default');

/* AND THE SUPPLIER'S OWN COMMISSION IS UNTOUCHED BY ANY OF IT. The members
   belong to the share deals; a commission lookup must not see them. */
select is(
  (select agent_rate from public.resolve_pricing_agreement(
     '97000000-0000-0000-0000-0000000000b1', '97000000-0000-0000-0000-0000000000f1', 1, 'commission')),
  0.35::numeric, 'while the supplier''s own commission is the same for all four');

-- AND THE FREEZE READS THE SAME ANSWER, which is what actually prices a referral.
select is(
  (select agent_rate from public.resolve_rates(
     '97000000-0000-0000-0000-0000000000b1', '97000000-0000-0000-0000-0000000000f1', 1)),
  0.20::numeric, 'and resolve_rates, the freeze point, agrees for a membered agency');

select is(
  (select agent_rate from public.resolve_rates(
     '97000000-0000-0000-0000-0000000000b4', '97000000-0000-0000-0000-0000000000f1', 1)),
  0.10::numeric, 'and for one on the default');

-- ===========================================================================
-- 4. AN AGENCY IS ON ONE DEAL AT A TIME, AND MOVING IT IS ONE WRITE
-- ===========================================================================
select throws_ok(
  $$insert into public.pricing_agreement_members (agreement_id, agency_id)
    values ('97000000-0000-0000-0000-0000000000d2', '97000000-0000-0000-0000-0000000000a1')$$,
  '23505', null, 'an agency cannot be on two deals at once');

/* "MOVING IT IS ONE CLICK", which is this upsert: no remove-then-add, so it
   cannot leave the agency on neither deal if the second half fails. */
select lives_ok(
  $$insert into public.pricing_agreement_members (agreement_id, agency_id)
    values ('97000000-0000-0000-0000-0000000000d2', '97000000-0000-0000-0000-0000000000a1')
    on conflict (agency_id) do update set agreement_id = excluded.agreement_id$$,
  'and moving it between deals is one upsert');

select is(
  (select agent_rate from public.resolve_pricing_agreement(
     '97000000-0000-0000-0000-0000000000b1', '97000000-0000-0000-0000-0000000000f1', 1, 'agent_share')),
  0.05::numeric, 'and the move takes effect on the next referral');

-- Put it back for the rest of the file.
insert into public.pricing_agreement_members (agreement_id, agency_id)
values ('97000000-0000-0000-0000-0000000000d1', '97000000-0000-0000-0000-0000000000a1')
on conflict (agency_id) do update set agreement_id = excluded.agreement_id;

-- ===========================================================================
-- 5. THE THREE THINGS A MEMBERSHIP MAY NOT BE
-- ===========================================================================
select throws_ok(
  $$insert into public.pricing_agreement_members (agreement_id, agency_id)
    values ('97000000-0000-0000-0000-0000000000d0', '97000000-0000-0000-0000-0000000000a4')$$,
  '22023', null, 'nobody is added to the default: it already applies to everyone not named elsewhere');

select throws_ok(
  $$insert into public.pricing_agreement_members (agreement_id, agency_id)
    values ('97000000-0000-0000-0000-0000000000c0', '97000000-0000-0000-0000-0000000000a4')$$,
  '22023', null, 'and not to a commission deal, which applies to the party it is written for');

/* ANOTHER SUPPLIER'S AGENCY. Without this the row would sit there pricing
   nothing -- the resolver reaches a deal THROUGH the agency, so it would
   never read it -- while the screen listed it as being on the deal. */
select throws_ok(
  $$insert into public.pricing_agreement_members (agreement_id, agency_id)
    values ('97000000-0000-0000-0000-0000000000d1', '97000000-0000-0000-0000-0000000000a9')$$,
  '22023', null, 'and not an agency belonging to a different supplier');

-- ===========================================================================
-- 6. THE GUARD CHECKS EVERY SHARE DEAL, NOT THE ONE IT HAPPENS TO FIND
-- ===========================================================================
/* The premium deal at 20% is inside the 35% total; raise it over the top and
   the breach must be found even though the DEFAULT deal is still healthy.
   Before this migration supplier_share_breaches asked
   active_agreement_of_kind for one row and compared only that. */
update public.pricing_agreement_bands set agent_rate = 0.40
 where agreement_id = '97000000-0000-0000-0000-0000000000d1';

select isnt_empty(
  $$select * from public.supplier_share_breaches('97000000-0000-0000-0000-0000000000f1')$$,
  'a breach on a non-default deal is still found');

select throws_ok(
  $$select public.assert_supplier_share_within_total('97000000-0000-0000-0000-0000000000f1')$$,
  '22023', null, 'and the assertion refuses it');

-- ===========================================================================
-- 7. A SHARE DEAL THAT NOBODY MARKED STILL PRICES SOMETHING
-- ===========================================================================
/* THE HOLE THE MARK COULD HAVE OPENED. A partner-scope share deal written by
   anything that does not know about `is_default_share` -- a direct insert, a
   fixture, a migration written next year -- would reach no agency at all and
   price nothing, silently, while sitting on the screen looking live. Two
   existing tests found it the minute the column existed.

   So "no members" means "everybody else" whether or not the mark is there,
   and the mark buys only the unique index. */
update public.pricing_agreement_bands set agent_rate = 0.20
 where agreement_id = '97000000-0000-0000-0000-0000000000d1';

insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route)
values ('97000000-0000-0000-0000-0000000000f3', 'zzz-unmarked', 'ZZZ Unmarked', 'pre_referenced_open', 0.30, 0.08, false);
insert into public.agencies (id, partner_id, name)
values ('97000000-0000-0000-0000-0000000000a5', '97000000-0000-0000-0000-0000000000f3', 'ZZZ Unmarked Agency');
insert into public.branches (id, agency_id, partner_id, name)
values ('97000000-0000-0000-0000-0000000000b5', '97000000-0000-0000-0000-0000000000a5', '97000000-0000-0000-0000-0000000000f3', 'ZZZ Unmarked Office');

insert into public.pricing_agreements (id, scope_level, scope_id, coverage, period, counting_scope, is_standard, effective_from, kind)
values ('97000000-0000-0000-0000-0000000000d5','partner','97000000-0000-0000-0000-0000000000f3','additive','year','agency',false,current_date,'agent_share');
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, fee_basis_unit, agent_rate)
values ('97000000-0000-0000-0000-0000000000d5', 1, null, null, 'months', 0.18);

select is(
  (select agent_rate from public.resolve_pricing_agreement(
     '97000000-0000-0000-0000-0000000000b5', '97000000-0000-0000-0000-0000000000f3', 1, 'agent_share')),
  0.18::numeric, 'a share deal with no members and no mark still applies to every agency');

/* AND A MARKED DEFAULT OUTRANKS AN UNMARKED ONE, so the fallback above can
   never quietly beat the real default. */
insert into public.pricing_agreements (id, scope_level, scope_id, coverage, period, counting_scope, is_standard, effective_from, kind, is_default_share)
values ('97000000-0000-0000-0000-0000000000d6','partner','97000000-0000-0000-0000-0000000000f3','additive','year','agency',false,current_date,'agent_share', true);
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, fee_basis_unit, agent_rate)
values ('97000000-0000-0000-0000-0000000000d6', 1, null, null, 'months', 0.12);

select is(
  (select agent_rate from public.resolve_pricing_agreement(
     '97000000-0000-0000-0000-0000000000b5', '97000000-0000-0000-0000-0000000000f3', 1, 'agent_share')),
  0.12::numeric, 'and a marked default beats an unmarked deal beside it');

-- ===========================================================================
-- 8. AND THE SCREEN CAN READ THEM AND MOVE ONE
-- ===========================================================================
/* An admin with the second factor, because both readers refuse everybody
   else and a test that ran as the owner would prove nothing about either. */
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('97000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
        'zzz.many.admin@o.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('97000000-0000-0000-0000-00000000c001','ZZZ Many Admin','zzz.many.admin@o.test','superadmin',null,'active',true);

select set_config('request.jwt.claims',
  '{"sub":"97000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select is(
  (select count(*)::int from public.supplier_share_deals('zzz-many')),
  3, 'the screen reads all three of the supplier''s share deals, not just one');

/* THE DEFAULT IS FIRST, because the extra deals are read as exceptions to
   it and a list that buries it reads as four equals. */
select is(
  (select is_default from public.supplier_share_deals('zzz-many') limit 1),
  true, 'with the default first');

/* "SHOW WHICH AGENCIES ARE ON WHICH DEAL" -- the premium deal names both. */
select is(
  (select jsonb_array_length(members) from public.supplier_share_deals('zzz-many')
    where agreement_id = '97000000-0000-0000-0000-0000000000d1'),
  2, 'and the deal Alpha and Bravo share names both of them');

select is(
  (select jsonb_array_length(members) from public.supplier_share_deals('zzz-many')
    where agreement_id = '97000000-0000-0000-0000-0000000000d0'),
  0, 'while the default names nobody, because it is everybody else');

-- "MOVING IT IS ONE CLICK", through the door the screen actually uses.
select lives_ok(
  $$select public.set_agency_share_deal(
      '97000000-0000-0000-0000-0000000000d2', '97000000-0000-0000-0000-0000000000a1')$$,
  'an admin moves Alpha onto Charlie''s deal in one call');

/* AND IT CAME OFF THE OLD ONE, which is the half a delete-then-insert gets
   wrong: the agency must not be on two, and must not be on none. */
select is(
  (select count(*)::int from public.pricing_agreement_members
    where agency_id = '97000000-0000-0000-0000-0000000000a1'),
  1, 'on exactly one deal afterwards, never two and never none');

/* BACK TO THE OWNER TO ASK THE RESOLVER. `resolve_pricing_agreement` is
   service_role only -- it is what create_referral freezes from, not
   something a session calls -- so the admin seat that moved the agency
   cannot be the one that checks the price. That split is the point: the
   screen moves the agency, the server prices the referral. */
reset role;

select is(
  (select agent_rate from public.resolve_pricing_agreement(
     '97000000-0000-0000-0000-0000000000b1', '97000000-0000-0000-0000-0000000000f1', 1, 'agent_share')),
  0.05::numeric, 'and the next referral is priced by the deal it moved to');

-- And taking it off entirely returns it to the default.
select set_config('request.jwt.claims',
  '{"sub":"97000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.clear_agency_share_deal('97000000-0000-0000-0000-0000000000a1')$$,
  'and taking it off a named deal is one call too');

reset role;

select is(
  (select agent_rate from public.resolve_pricing_agreement(
     '97000000-0000-0000-0000-0000000000b1', '97000000-0000-0000-0000-0000000000f1', 1, 'agent_share')),
  0.10::numeric, 'which puts it back on the default');

select * from finish();
rollback;
