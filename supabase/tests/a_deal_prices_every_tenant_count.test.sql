/* A DEAL PRICES EVERY TENANT COUNT, OR IT IS NOT SAVED.
   Migration: 20261008030000.

   Matt, 2026-10-04: "refuse to save a deal that leaves any tenant count or
   volume unpriced."

   THE SHAPE UNDER TEST IS "1 TO 1", which is what the deal dialog produced
   when somebody chose banded and then switched to one price: it reads like a
   deal, prices single tenancies, and lets every joint tenancy fall back to
   standard terms without a word. */
begin;
select plan(9);

insert into public.partners (id, slug, name, referencing_mode, is_house_route,
                             status, partner_kind, partner_rate, agent_rate, opndoor_pays_agents)
values ('e2200000-0000-0000-0000-00000000f001','zzz-gap-sup','ZZZ Gap Supplier',
        'pre_referenced_open', false, 'active', 'supplier', 0.2500, 0.1000, false);
insert into public.agencies (id, partner_id, name) values
  ('e2200000-0000-0000-0000-00000000a001','e2200000-0000-0000-0000-00000000f001','ZZZ Gap Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('e2200000-0000-0000-0000-00000000b001','e2200000-0000-0000-0000-00000000a001',
   'e2200000-0000-0000-0000-00000000f001','ZZZ Gap Office');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('e2200000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.gap@opndoor.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('e2200000-0000-0000-0000-00000000c001','ZZZ Gap Admin','zzz.gap@opndoor.test','superadmin',null,'active',true);

-- ===========================================================================
-- 1. THE DETECTOR, on the shapes that matter.
-- ===========================================================================
insert into public.pricing_agreements (id, scope_level, scope_id, coverage, period,
                                       counting_scope, effective_from, is_standard, kind)
values ('e2200000-0000-0000-0000-00000000d001','partner','e2200000-0000-0000-0000-00000000f001',
        'additive','month','route', current_date - 1, false, 'commission');

/* ONE CLOSED BAND: the reported shape. */
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants,
                                            fee_basis_weeks, fee_basis_unit, agent_rate)
values ('e2200000-0000-0000-0000-00000000d001', 1, 1, 3, 'weeks', 0.20);
select is(public.agreement_tenant_gap('e2200000-0000-0000-0000-00000000d001'), 2,
  'a deal whose only band is 1 to 1 prices nothing from 2 tenants up');

/* A HOLE IN THE MIDDLE. */
delete from public.pricing_agreement_bands where agreement_id='e2200000-0000-0000-0000-00000000d001';
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants,
                                            fee_basis_weeks, fee_basis_unit, agent_rate)
values ('e2200000-0000-0000-0000-00000000d001', 1, 1, 3, 'weeks', 0.20),
       ('e2200000-0000-0000-0000-00000000d001', 3, null, 6, 'weeks', 0.26);
select is(public.agreement_tenant_gap('e2200000-0000-0000-0000-00000000d001'), 2,
  'and a hole between two bands is found at the hole');

/* A CLOSED TOP BAND ABOVE THE SERIES CEILING, the case a 1..12 scan alone
   would miss and report as healthy. */
delete from public.pricing_agreement_bands where agreement_id='e2200000-0000-0000-0000-00000000d001';
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants,
                                            fee_basis_weeks, fee_basis_unit, agent_rate)
values ('e2200000-0000-0000-0000-00000000d001', 1, 40, 3, 'weeks', 0.20);
select is(public.agreement_tenant_gap('e2200000-0000-0000-0000-00000000d001'), 41,
  'and a closed top band above the ceiling is still found');

/* THE HEALTHY SHAPES. */
delete from public.pricing_agreement_bands where agreement_id='e2200000-0000-0000-0000-00000000d001';
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants,
                                            fee_basis_weeks, fee_basis_unit, agent_rate)
values ('e2200000-0000-0000-0000-00000000d001', 1, null, 4, 'weeks', 0.20);
select is(public.agreement_tenant_gap('e2200000-0000-0000-0000-00000000d001'), null,
  'one open-ended band from 1 prices everything');

delete from public.pricing_agreement_bands where agreement_id='e2200000-0000-0000-0000-00000000d001';
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants,
                                            fee_basis_weeks, fee_basis_unit, agent_rate)
values ('e2200000-0000-0000-0000-00000000d001', 1, 1, 4, 'months', 0.20),
       ('e2200000-0000-0000-0000-00000000d001', 2, null, 5, 'weeks', 0.25);
select is(public.agreement_tenant_gap('e2200000-0000-0000-0000-00000000d001'), null,
  'and so does Regent''s real shape, 1 then 2-or-more');

-- ===========================================================================
-- 2. THE SAVE PATH REFUSES IT.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"e2200000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

select throws_ok(
  $$select public.create_agreement('partner','e2200000-0000-0000-0000-00000000f001',
      'additive','month','route',
      '[{"min":1,"max":1,"weeks":3,"unit":"weeks","rate":0.20}]'::jsonb,
      '[]'::jsonb, 'one price, wrongly', true, false, 'commission')$$,
  '22023', null,
  'a deal that stops at one tenant is refused on save');

/* THE MESSAGE NAMES THE COUNT, so an administrator knows which band to
   open rather than being told the deal is "invalid". */
reset role;
create or replace function public.zzz_gap_msg() returns text language plpgsql as $f$
begin
  perform public.create_agreement('partner','e2200000-0000-0000-0000-00000000f001',
    'additive','month','route',
    '[{"min":1,"max":1,"weeks":3,"unit":"weeks","rate":0.20}]'::jsonb,
    '[]'::jsonb, 'probe', true, false, 'commission');
  return '(saved)';
exception when others then return sqlerrm; end $f$;
set local role authenticated;
select matches(public.zzz_gap_msg(), 'prices nothing for 2 tenants',
  'and the refusal names the count that has no price');

/* AND THE SHAPE THE DIALOG NOW SENDS FOR "ONE PRICE FOR EVERYTHING" SAVES. */
select lives_ok(
  $$select public.create_agreement('partner','e2200000-0000-0000-0000-00000000f001',
      'additive','month','route',
      '[{"min":1,"weeks":3,"unit":"weeks","rate":0.20}]'::jsonb,
      '[]'::jsonb, 'one price, rightly', true, false, 'commission')$$,
  'a single band with no upper limit saves');

/* A TIER GAP IS NOT REFUSED, deliberately: an unmatched tier falls back to
   the band's rate, so it changes which rate applies rather than leaving the
   referral unpriced. Asserted so the asymmetry is a decision on the record. */
select lives_ok(
  $$select public.create_agreement('partner','e2200000-0000-0000-0000-00000000f001',
      'additive','month','route',
      '[{"min":1,"weeks":3,"unit":"weeks","rate":0.20}]'::jsonb,
      '[{"from":1,"to":10,"rate":0.2}]'::jsonb, 'tiers stop at ten', true, false, 'commission')$$,
  'but a tier that stops short is allowed, because the band still prices it');

select * from finish();
rollback;
