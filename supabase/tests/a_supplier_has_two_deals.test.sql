-- A SUPPLIER HAS TWO DEALS, AND THE SHARE MAY NEVER EXCEED THE TOTAL.
--
-- Matt, 2026-10-01, verbatim: "Supplier Commission tab: use the same
-- commission deal editor agencies have, with all its options (flat rate,
-- volume tiers, bands by number of tenants, and per-agency overrides), for
-- both the supplier's total commission and the agents' share within it. Both
-- can be set independently per supplier. The agents' share can never exceed
-- the supplier's total on any referral, checked on save."
--
-- Migration: 20261007190000_a_supplier_has_two_deals.sql
--
-- =========================================================================
-- "ON ANY REFERRAL" IS THE WHOLE OF THE HARD PART
-- =========================================================================
--
-- With one flat rate on each side it is a single comparison, which
-- set_supplier_commission has always made. With bands on one side and tiers
-- on the other the two deals can CROSS at a combination neither editor shows
-- as wrong: a flat total of 35% against a share of 30% up to fifty referrals
-- and 40% after reads correctly in both screens and overpays on the
-- fifty-first. Assertion 9 is that case, and it is the reason this guard
-- checks a surface rather than a pair of numbers.

begin;
select plan(19);

-- ---------------------------------------------------------------------------
-- FIXTURE: one supplier, one agency under it, one branch, one admin.
-- ---------------------------------------------------------------------------
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route)
values ('94000000-0000-0000-0000-000000000001', 'zzz-two-deals', 'ZZZ Two Deals', 'pre_referenced_open', 0.35, 0.15, false);
insert into public.agencies (id, partner_id, name)
values ('94000000-0000-0000-0000-000000000002', '94000000-0000-0000-0000-000000000001', 'ZZZ Two Deals Agency');
insert into public.branches (id, agency_id, partner_id, name)
values ('94000000-0000-0000-0000-000000000003', '94000000-0000-0000-0000-000000000002', '94000000-0000-0000-0000-000000000001', 'ZZZ Two Deals Office');

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token)
values ('94000000-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'admin@zzz-two-deals.test', now(), now(), '{}'::jsonb, '{}'::jsonb, '','','','','','','','');
insert into public.users (id, full_name, email, role, partner_id, status)
values ('94000000-0000-0000-0000-0000000000ff', 'Two Deals Admin', 'admin@zzz-two-deals.test', 'superadmin', null, 'active');
select set_config('request.jwt.claims',
  '{"sub":"94000000-0000-0000-0000-0000000000ff","role":"authenticated","aal":"aal2"}', true);

-- ===========================================================================
-- 1. EVERY EXISTING AGREEMENT IS A COMMISSION DEAL
-- ===========================================================================
/* The column is new and defaulted, so this is really a check that the default
   went on the rows that were already there rather than leaving them NULL. */
select is(
  (select count(*)::int from public.pricing_agreements where kind is null),
  0, 'no agreement is left without a kind');

select is(
  (select count(*)::int from public.pricing_agreements where kind not in ('commission','agent_share')),
  0, 'and every one of them is one of the two');

-- ===========================================================================
-- 2. A SUPPLIER HOLDS BOTH AT ONCE
-- ===========================================================================
select lives_ok(
  $$ select public.create_agreement(
       'partner', '94000000-0000-0000-0000-000000000001', 'additive', 'year', 'agency',
       '[{"min":1,"max":null,"weeks":1,"unit":"months","rate":0.35}]'::jsonb,
       '[]'::jsonb, 'The total', false, false, 'commission') $$,
  'a supplier can be given a commission deal');

/* THE ONE THE OLD EXCLUSIVITY TRIGGER WOULD HAVE REFUSED. A party held one
   agreement; a supplier holds two, and they are not alternatives. */
select lives_ok(
  $$ select public.create_agreement(
       'partner', '94000000-0000-0000-0000-000000000001', 'additive', 'year', 'agency',
       '[{"min":1,"max":null,"weeks":1,"unit":"months","rate":0.15}]'::jsonb,
       '[]'::jsonb, 'The agents share', false, false, 'agent_share') $$,
  'and an agents'' share alongside it, without ending it');

select is(
  (select count(*)::int from public.pricing_agreements
    where scope_level = 'partner' and scope_id = '94000000-0000-0000-0000-000000000001'
      and ended_at is null),
  2, 'both are live at once');

-- ===========================================================================
-- 3. AND THE RESOLVER ANSWERS FOR EACH INDEPENDENTLY
-- ===========================================================================
select is(
  (select agent_rate from public.resolve_pricing_agreement(
     '94000000-0000-0000-0000-000000000003', '94000000-0000-0000-0000-000000000001', 1, 'commission')),
  0.35::numeric, 'the commission deal prices the supplier''s own total');

select is(
  (select agent_rate from public.resolve_pricing_agreement(
     '94000000-0000-0000-0000-000000000003', '94000000-0000-0000-0000-000000000001', 1, 'agent_share')),
  0.15::numeric, 'and the share deal prices the agents'' cut');

/* THE DEFAULT IS THE COMMISSION, which is what every existing caller means.
   resolve_fee, commission_total and create_referral all call this with two or
   three arguments and must keep getting the answer they always got. */
select is(
  (select agent_rate from public.resolve_pricing_agreement(
     '94000000-0000-0000-0000-000000000003', '94000000-0000-0000-0000-000000000001', 1)),
  0.35::numeric, 'and a caller that does not say which kind gets the commission');

-- ===========================================================================
-- 4. PER-AGENCY OVERRIDES, WHICH NEEDED NOTHING BUILT
-- ===========================================================================
/* An agency-scope deal already beats the partner-scope one in the resolver's
   ORDER BY. Matt lists it because it has to be true, not because it is new. */
select lives_ok(
  $$ select public.create_agreement(
       'agency', '94000000-0000-0000-0000-000000000002', 'additive', 'year', 'agency',
       '[{"min":1,"max":null,"weeks":1,"unit":"months","rate":0.10}]'::jsonb,
       '[]'::jsonb, 'This agency keeps less', false, false, 'agent_share') $$,
  'one agency under the supplier can hold its own share deal');

select is(
  (select agent_rate from public.resolve_pricing_agreement(
     '94000000-0000-0000-0000-000000000003', '94000000-0000-0000-0000-000000000001', 1, 'agent_share')),
  0.10::numeric, 'and it beats the supplier''s, which is what an override is');

select is(
  (select agent_rate from public.resolve_pricing_agreement(
     '94000000-0000-0000-0000-000000000003', '94000000-0000-0000-0000-000000000001', 1, 'commission')),
  0.35::numeric, 'while the supplier''s commission is untouched by it');

-- ===========================================================================
-- 5. THE SHARE MAY NOT EXCEED THE TOTAL, AT ANY COMBINATION
-- ===========================================================================
select is(
  (select count(*)::int from public.supplier_share_breaches('94000000-0000-0000-0000-000000000001')),
  0, 'a share under the total breaches nothing');

/* THE CASE NEITHER EDITOR SHOWS AS WRONG. A flat total of 35% against a share
   that is 30% up to fifty referrals and 40% after: both deals read correctly
   on their own screen and the fifty-first referral overpays the agents. */
select throws_ok(
  $$ select public.create_agreement(
       'partner', '94000000-0000-0000-0000-000000000001', 'additive', 'year', 'agency',
       '[{"min":1,"max":null,"weeks":1,"unit":"months","rate":null}]'::jsonb,
       '[{"from":0,"to":50,"rate":0.30},{"from":51,"to":null,"rate":0.40}]'::jsonb,
       'Crosses at 51', true, false, 'agent_share') $$,
  '22023', null,
  'a share that crosses the total at one volume step is refused');

select is(
  (select count(*)::int from public.pricing_agreements
    where scope_level = 'partner' and scope_id = '94000000-0000-0000-0000-000000000001'
      and kind = 'agent_share' and ended_at is null),
  1, 'and the refusal rolled the whole save back, leaving the old share standing');

/* AND THE SAME CROSSING FROM THE OTHER SIDE. Lowering the TOTAL under a share
   that was fine when it was written is the same breach, and an administrator
   editing the total has no reason to be looking at the share. */
select throws_ok(
  $$ select public.create_agreement(
       'partner', '94000000-0000-0000-0000-000000000001', 'additive', 'year', 'agency',
       '[{"min":1,"max":null,"weeks":1,"unit":"months","rate":0.05}]'::jsonb,
       '[]'::jsonb, 'Total below the share', true, false, 'commission') $$,
  '22023', null,
  'and lowering the total under the existing share is refused too');

-- ===========================================================================
-- 6. WHAT AN AGENTS' SHARE IS NOT
-- ===========================================================================
select throws_ok(
  $$ select public.create_agreement(
       'agency', '94000000-0000-0000-0000-000000000002', 'all_in', 'year', 'agency',
       '[{"min":1,"max":null,"weeks":1,"unit":"months","rate":0.10}]'::jsonb,
       '[]'::jsonb, null, true, false, 'agent_share') $$,
  '22023', null,
  'an agents'' share cannot be all-in: it is a part of the commission, not a cover for it');

select throws_ok(
  $$ insert into public.pricing_agreements (scope_level, scope_id, coverage, period, counting_scope, is_standard, effective_from, kind)
     values ('group', '94000000-0000-0000-0000-000000000002', 'additive', 'year', 'agency', false, current_date, 'agent_share') $$,
  '23514', null,
  'and it cannot sit on a group, where there is nothing for it to be a share of');

-- ===========================================================================
-- 7. RECORDED WITH WHO AND WHEN
-- ===========================================================================
select cmp_ok(
  (select count(*)::int from public.org_audit
    where entity_id = '94000000-0000-0000-0000-000000000001'
      and action = 'agent_share_created'
      and actor_id = '94000000-0000-0000-0000-0000000000ff'),
  '>=', 1,
  'an agents'' share records who created it');

select cmp_ok(
  (select count(*)::int from public.org_audit
    where entity_id = '94000000-0000-0000-0000-000000000001'
      and action = 'agreement_created'),
  '>=', 1,
  'and a commission deal is audited under its own action, so the two read apart');

select * from finish();
rollback;
