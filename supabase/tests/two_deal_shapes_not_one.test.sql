-- TWO DEAL SHAPES, AND THE SWITCH CHOOSES WHICH.
--
-- Matt, 2026-10-01: "Off (paid through the supplier): one total commission,
-- all paid to the supplier, which settles with its agents; the agents' share
-- sits within that total and is only used for the per-agency statements. On
-- (paid directly by Opndoor): the supplier's own commission and the agents'
-- commission are separate deals, each can be flat or tiered, and Opndoor pays
-- each party its own; the total is the sum."
--
-- Migration: 20261007230000_two_deal_shapes_not_one.sql
--
-- =========================================================================
-- THE ONE ARITHMETIC FACT THIS FILE EXISTS FOR
-- =========================================================================
--
-- Two suppliers, identical rates (35% and 15%) on identical referrals of a
-- £2,000 fee. The ONLY difference between them is the switch. So every
-- figure that differs below differs because of the shape and nothing else,
-- and the pair reads as a single statement:
--
--                        OFF (carved)        ON (siblings)
--   supplier is paid     £700 - £300 = £400  £700
--   agency is paid       nothing, by Opndoor £300
--   total                £700                £1,000
--
-- The OFF column is what every live figure on the estate comes from today
-- and is asserted to the penny, unchanged.

begin;
select plan(17);

-- ---------------------------------------------------------------------------
-- The pair. Same rates, opposite switches.
-- ---------------------------------------------------------------------------
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route, opndoor_pays_agents, partner_kind)
values ('96000000-0000-0000-0000-0000000000f1', 'zzz-shape-off', 'ZZZ Shape Off', 'pre_referenced_open', 0.35, 0.15, false, false, 'supplier'),
       ('96000000-0000-0000-0000-0000000000f2', 'zzz-shape-on',  'ZZZ Shape On',  'pre_referenced_open', 0.35, 0.15, false, true, 'supplier');

insert into public.agencies (id, partner_id, name) values
  ('96000000-0000-0000-0000-0000000000a1', '96000000-0000-0000-0000-0000000000f1', 'ZZZ Shape Off Agency'),
  ('96000000-0000-0000-0000-0000000000a2', '96000000-0000-0000-0000-0000000000f2', 'ZZZ Shape On Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('96000000-0000-0000-0000-0000000000b1', '96000000-0000-0000-0000-0000000000a1', '96000000-0000-0000-0000-0000000000f1', 'ZZZ Shape Off Office'),
  ('96000000-0000-0000-0000-0000000000b2', '96000000-0000-0000-0000-0000000000a2', '96000000-0000-0000-0000-0000000000f2', 'ZZZ Shape On Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
select x.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       x.email,'',now(),now(),now()
from (values
  ('96000000-0000-0000-0000-00000000c001'::uuid,'zzz.shape.off@s.test'),
  ('96000000-0000-0000-0000-00000000c002'::uuid,'zzz.shape.on@s.test')
) as x(id,email);

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('96000000-0000-0000-0000-00000000c001','ZZZ Shape Off Ref','zzz.shape.off@s.test','referrer',
   '96000000-0000-0000-0000-0000000000f1','active',false),
  ('96000000-0000-0000-0000-00000000c002','ZZZ Shape On Ref','zzz.shape.on@s.test','referrer',
   '96000000-0000-0000-0000-0000000000f2','active',false);

/* A PAID REFERRAL EACH, in the same past month, same fee, same frozen pair. */
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, referrer_id,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
   prop_addr1, prop_city, prop_postcode,
   monthly_rent, fee_amount, paid_amount, tenancy_start, referencing_mode,
   partner_rate, agent_rate, status, sent_at, paid_at, livemode, payment_state,
   stripe_payment_intent_id)
values
  ('96000000-0000-0000-0000-0000000000e1','ZZZ-SHAPE-1','96000000-0000-0000-0000-0000000000f1',
   '96000000-0000-0000-0000-0000000000a1','96000000-0000-0000-0000-0000000000b1',
   '96000000-0000-0000-0000-00000000c001',
   'Ms','Ada','Offshape','1990-01-01','ada@zzzshape.test','07700900000',
   '1 ZZZ Street','London','SW1A 1AA',
   2000, 2000, 2000, '2026-09-01', 'pre_referenced_open',
   0.35, 0.15, 'paid', '2026-08-05T10:00:00Z', '2026-08-10T10:00:00Z', true, 'paid',
   'pi_zzz_shape_1'),
  ('96000000-0000-0000-0000-0000000000e2','ZZZ-SHAPE-2','96000000-0000-0000-0000-0000000000f2',
   '96000000-0000-0000-0000-0000000000a2','96000000-0000-0000-0000-0000000000b2',
   '96000000-0000-0000-0000-00000000c002',
   'Mr','Ben','Onshape','1991-01-01','ben@zzzshape.test','07700900001',
   '2 ZZZ Street','London','SW1A 1AA',
   2000, 2000, 2000, '2026-09-01', 'pre_referenced_open',
   0.35, 0.15, 'paid', '2026-08-05T10:00:00Z', '2026-08-10T10:00:00Z', true, 'paid',
   'pi_zzz_shape_2');

-- ===========================================================================
-- 1. THE AGENTS' RATE: CAPPED WHERE IT IS A CARVE-OUT, FREE WHERE IT IS NOT
-- ===========================================================================
select is(public.supplier_agent_rate('96000000-0000-0000-0000-0000000000e1'),
  0.15::numeric, 'carved: the agents'' share is the frozen rate');
select is(public.supplier_agent_rate('96000000-0000-0000-0000-0000000000e2'),
  0.15::numeric, 'siblings: the agents'' commission is the frozen rate');

/* THE CAP, WHICH IS THE WHOLE DIFFERENCE BETWEEN THE TWO SHAPES AT THIS
   LEVEL. A supplier on 5% introducing agencies on 20% is an ordinary
   arrangement under ON and an impossible one under OFF, so the same pair of
   numbers has to be read two ways. */
update public.applications set partner_rate = 0.05, agent_rate = 0.20
 where id in ('96000000-0000-0000-0000-0000000000e1','96000000-0000-0000-0000-0000000000e2');

select is(public.supplier_agent_rate('96000000-0000-0000-0000-0000000000e1'),
  0.05::numeric, 'carved: a share bigger than the total is capped at the total');
select is(public.supplier_agent_rate('96000000-0000-0000-0000-0000000000e2'),
  0.20::numeric, 'siblings: the agencies'' own deal is NOT capped by the supplier''s');

-- Back to the pair the money assertions below are written for.
update public.applications set partner_rate = 0.35, agent_rate = 0.15
 where id in ('96000000-0000-0000-0000-0000000000e1','96000000-0000-0000-0000-0000000000e2');

-- ===========================================================================
-- 2. WHO OPNDOOR PAYS, AND HOW MUCH
-- ===========================================================================
/* OFF: one payee, the supplier, for the whole total. No agency payee at all,
   which is NM-C 5 and is unchanged by this migration. */
select is(
  (select count(*)::int from public.commission_statement_lines('2026-08-01')
    where guarantee_ref = 'ZZZ-SHAPE-1'),
  1, 'carved: one payee on Opndoor''s run');

select is(
  (select level from public.commission_statement_lines('2026-08-01')
    where guarantee_ref = 'ZZZ-SHAPE-1'),
  'partner', 'carved: and it is the supplier');

select is(
  (select commission from public.commission_statement_lines('2026-08-01')
    where guarantee_ref = 'ZZZ-SHAPE-1'),
  700.00::numeric, 'carved: paid the whole total, which it settles its agents from');

/* ON: two payees, each paid its own, and the two SUM to more than either --
   which is the change. Before this migration the supplier arm here was
   700 - 300 = 400 and the two divided the 700 between them. */
select is(
  (select count(*)::int from public.commission_statement_lines('2026-08-01')
    where guarantee_ref = 'ZZZ-SHAPE-2'),
  2, 'siblings: two payees on Opndoor''s run');

select is(
  (select commission from public.commission_statement_lines('2026-08-01')
    where guarantee_ref = 'ZZZ-SHAPE-2' and level = 'partner'),
  700.00::numeric, 'siblings: the supplier is paid its OWN commission, not the total less the agents''');

select is(
  (select commission from public.commission_statement_lines('2026-08-01')
    where guarantee_ref = 'ZZZ-SHAPE-2' and level = 'agency'),
  300.00::numeric, 'siblings: and the agency is paid its own beside it');

select is(
  (select sum(commission) from public.commission_statement_lines('2026-08-01')
    where guarantee_ref = 'ZZZ-SHAPE-2'),
  1000.00::numeric, 'siblings: so the total is the SUM of the two deals');

-- ===========================================================================
-- 3. THE SUPPLIER'S OWN STATEMENT SAYS THE SAME THING
-- ===========================================================================
/* And its three money columns reconcile under both shapes, which is the
   penny question: one of the three is always the remainder of the other
   two, and it has to be the one nobody is paid. */
select results_eq(
  $$select total_rate, agent_rate, total_amount, agent_amount, supplier_amount
      from public.supplier_statement_lines('96000000-0000-0000-0000-0000000000f1','2026-08-01')$$,
  $$values (0.35::numeric, 0.15::numeric, 700.00::numeric, 300.00::numeric, 400.00::numeric)$$,
  'carved: the total is what opndoor pays and the supplier keeps the remainder');

select results_eq(
  $$select total_rate, agent_rate, total_amount, agent_amount, supplier_amount
      from public.supplier_statement_lines('96000000-0000-0000-0000-0000000000f2','2026-08-01')$$,
  $$values (0.50::numeric, 0.15::numeric, 1000.00::numeric, 300.00::numeric, 700.00::numeric)$$,
  'siblings: each party''s own is what opndoor pays and the total is their sum');

-- ===========================================================================
-- 4. THE SHARE-WITHIN-TOTAL GUARD IS AN OFF-SHAPE RULE
-- ===========================================================================
/* The same pair of deals on both suppliers: a 20% share over a 10% total.
   Under OFF that is the breach the guard exists for. Under ON it is a
   supplier on 10% introducing agencies on 20%, which is the arrangement the
   ON shape was asked for. */
insert into public.pricing_agreements (id, scope_level, scope_id, coverage, period, counting_scope, is_standard, effective_from, kind)
values ('96000000-0000-0000-0000-0000000000d1','partner','96000000-0000-0000-0000-0000000000f1','additive','year','agency',false,current_date,'commission'),
       ('96000000-0000-0000-0000-0000000000d2','partner','96000000-0000-0000-0000-0000000000f1','additive','year','agency',false,current_date,'agent_share'),
       ('96000000-0000-0000-0000-0000000000d3','partner','96000000-0000-0000-0000-0000000000f2','additive','year','agency',false,current_date,'commission'),
       ('96000000-0000-0000-0000-0000000000d4','partner','96000000-0000-0000-0000-0000000000f2','additive','year','agency',false,current_date,'agent_share');
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, fee_basis_unit, agent_rate)
values ('96000000-0000-0000-0000-0000000000d1', 1, null, 1, 'months', 0.10),
       ('96000000-0000-0000-0000-0000000000d2', 1, null, null, 'months', 0.20),
       ('96000000-0000-0000-0000-0000000000d3', 1, null, 1, 'months', 0.10),
       ('96000000-0000-0000-0000-0000000000d4', 1, null, null, 'months', 0.20);

select isnt_empty(
  $$select * from public.supplier_share_breaches('96000000-0000-0000-0000-0000000000f1')$$,
  'carved: a share over the total is still found, and the guard still bites');

select is_empty(
  $$select * from public.supplier_share_breaches('96000000-0000-0000-0000-0000000000f2')$$,
  'siblings: there is no total for the share to sit within, so there is no breach');

select throws_ok(
  $$select public.assert_supplier_share_within_total('96000000-0000-0000-0000-0000000000f1')$$,
  '22023', null, 'carved: and the assertion refuses it');

select lives_ok(
  $$select public.assert_supplier_share_within_total('96000000-0000-0000-0000-0000000000f2')$$,
  'siblings: while the same two deals are allowed where opndoor pays each party');

select * from finish();
rollback;
