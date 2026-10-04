/* THE SUPPLIER'S OWN TOTAL IS FROZEN AT THE REAL TENANT COUNT.
   Migration: 20261007980000.

   Matt, 2026-10-04: "freeze the supplier's total commission using the same
   real tenant count as the agency share".

   WHAT MAKES THIS TESTABLE AT ALL is a banded PARTNER-SCOPE commission deal.
   resolve_rates takes the supplier's own total from a partner-scope agreement
   and falls back to the flat partners.partner_rate, which has no bands; so a
   supplier priced flat -- which is every supplier on dev -- cannot show the
   defect even though it was there. The fixture therefore gives the supplier
   the banded deal the real estate will have once anybody uses the Commission
   tab, which is the case Matt is asking about. */
begin;
select plan(7);

insert into public.partners (id, slug, name, referencing_mode, is_house_route,
                             status, partner_kind, partner_rate, agent_rate,
                             opndoor_pays_agents)
values ('eb000000-0000-0000-0000-00000000f001','zzz-freeze-supplier','ZZZ Freeze Supplier',
        'pre_referenced_open', false, 'active', 'supplier', 0.2500, 0.1000, false);
insert into public.agencies (id, partner_id, name) values
  ('eb000000-0000-0000-0000-00000000a001','eb000000-0000-0000-0000-00000000f001','ZZZ Freeze Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('eb000000-0000-0000-0000-00000000b001','eb000000-0000-0000-0000-00000000a001',
   'eb000000-0000-0000-0000-00000000f001','ZZZ Freeze Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('eb000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.freeze@opndoor.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('eb000000-0000-0000-0000-00000000c001','ZZZ Freeze Admin','zzz.freeze@opndoor.test','superadmin',
   null,'active',true);

/* THE SUPPLIER'S OWN DEAL, BANDED: 30% for one tenant, 40% for two or more.
   Inserted directly rather than through create_agreement so the fixture does
   not depend on the save-path guard, which the sibling test covers. */
insert into public.pricing_agreements
  (id, scope_level, scope_id, coverage, period, counting_scope, effective_from,
   is_standard, kind)
values ('eb000000-0000-0000-0000-00000000d001','partner','eb000000-0000-0000-0000-00000000f001',
        'additive','month','route', current_date - 1, false, 'commission');
insert into public.pricing_agreement_bands
  (agreement_id, min_tenants, max_tenants, fee_basis_weeks, fee_basis_unit, agent_rate)
values ('eb000000-0000-0000-0000-00000000d001', 1, 1, 1, 'months', 0.30),
       ('eb000000-0000-0000-0000-00000000d001', 2, null, 5, 'weeks', 0.40);

-- ===========================================================================
-- 1. THE RESOLVER ITSELF, which is where the defect lived.
-- ===========================================================================
select is(
  (select r.partner_rate from public.resolve_rates(
     'eb000000-0000-0000-0000-00000000b001','eb000000-0000-0000-0000-00000000f001', 1) r),
  0.30::numeric,
  'one tenant resolves the one-tenant band');

select is(
  (select r.partner_rate from public.resolve_rates(
     'eb000000-0000-0000-0000-00000000b001','eb000000-0000-0000-0000-00000000f001', 3) r),
  0.40::numeric,
  'three tenants resolve the two-or-more band');

/* THE DEFECT, PINNED AS THE DEFAULT IT WAS. The two-argument call still
   exists and still answers for one tenant, which is correct for a sole
   referral and was the wrong answer for a joint one. This assertion is here
   so that a later change making the default anything else is caught. */
select is(
  (select r.partner_rate from public.resolve_rates(
     'eb000000-0000-0000-0000-00000000b001','eb000000-0000-0000-0000-00000000f001') r),
  0.30::numeric,
  'the two-argument call still means one tenant');

-- ===========================================================================
-- 2. AND WHAT A JOINT REFERRAL ACTUALLY FREEZES, which is the money.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"eb000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select lives_ok(
  $$select public.create_joint_referral(
      'eb000000-0000-0000-0000-00000000b001',
      '[{"title":"Mr","first":"Jo","last":"One","dob":"1990-01-01","email":"zzz.f1@t.test","phone":"07700900101","share_percent":50},
        {"title":"Ms","first":"Di","last":"Two","dob":"1991-01-01","email":"zzz.f2@t.test","phone":"07700900102","share_percent":50}]'::jsonb,
      '1 Freeze Street', null, 'London', null, 'SW1A 1AA', 2000, current_date + 30)$$,
  'a two-tenant joint referral through a supplier is created');

reset role;

/* BOTH ROWS CARRY THE TWO-OR-MORE BAND. Before the fix this was 0.30, the
   one-tenant band, on a two-tenant tenancy. */
select is(
  (select count(*)::int from public.applications
    where tenant_email in ('zzz.f1@t.test','zzz.f2@t.test') and partner_rate = 0.40),
  2,
  'both applications freeze the total from the two-or-more band');

/* AND THE TWO RATES NOW AGREE ABOUT THE TENANT COUNT, which is the sentence
   Matt wrote. Asserted as a relationship rather than as two numbers, because
   the point is that one count feeds both and not that either is 0.40. */
select is(
  (select count(*)::int from public.applications a
    where a.tenant_email in ('zzz.f1@t.test','zzz.f2@t.test')
      and a.partner_rate = (select r.partner_rate from public.resolve_rates(
            a.branch_id, a.partner_id, 2) r)
      and a.agent_rate = public.commission_total(a.branch_id, a.partner_id, 2)),
  2,
  'the frozen total and the frozen share both read the two-tenant band');

/* A SOLE REFERRAL IS UNCHANGED, which is the regression that matters most:
   create_referral is the referral path and this migration does not touch it. */
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"eb000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
select is(
  (select a.partner_rate from public.create_referral(
     'eb000000-0000-0000-0000-00000000b001','Mr','Sol','Only','1990-01-01',
     'zzz.f3@t.test','07700900103','2 Freeze Street', null,'London', null,'SW1A 1AA',
     2000, current_date + 30) a),
  0.30::numeric,
  'a sole referral still freezes the one-tenant band');

select * from finish();
rollback;
