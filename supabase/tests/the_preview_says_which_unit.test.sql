/* THE FEE PREVIEW RETURNS THE UNIT WITH THE QUANTITY.
   Migration: 20261008000000.

   Matt, 2026-10-04, item 2 of four: the fee basis unit, "1 month", not
   "1 weeks".

   resolve_fee has returned the pair since 20261006120000. This function
   dropped the unit, so a band written in MONTHS reached the form as its
   quantity alone and the line under the figure said "1 weeks of rent" over
   one month's rent. The wording half is
   src/data/thePreviewSaysWhichUnit.test.ts; this is the half that carries
   the fact to it. */
begin;
select plan(6);

insert into public.partners (id, slug, name, referencing_mode, is_house_route,
                             status, partner_kind, partner_rate, agent_rate,
                             opndoor_pays_agents)
values ('ed000000-0000-0000-0000-00000000f001','zzz-unit-sup','ZZZ Unit Supplier',
        'pre_referenced_open', false, 'active', 'supplier', 0.2500, 0.1000, false);
insert into public.agencies (id, partner_id, name) values
  ('ed000000-0000-0000-0000-00000000a001','ed000000-0000-0000-0000-00000000f001','ZZZ Unit Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('ed000000-0000-0000-0000-00000000b001','ed000000-0000-0000-0000-00000000a001',
   'ed000000-0000-0000-0000-00000000f001','ZZZ Unit Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('ed000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.unit@opndoor.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('ed000000-0000-0000-0000-00000000c001','ZZZ Unit Admin','zzz.unit@opndoor.test',
   'superadmin', null,'active',true);

/* MATT'S OWN EXAMPLE: one tenant one month, two or more five weeks. The two
   bands differ in UNIT as well as in quantity, which is the case the dropped
   column made unreadable. */
insert into public.pricing_agreements
  (id, scope_level, scope_id, coverage, period, counting_scope, effective_from, is_standard, kind)
values ('ed000000-0000-0000-0000-00000000d001','partner','ed000000-0000-0000-0000-00000000f001',
        'additive','month','route', current_date - 1, false, 'commission');
insert into public.pricing_agreement_bands
  (agreement_id, min_tenants, max_tenants, fee_basis_weeks, fee_basis_unit, agent_rate)
values ('ed000000-0000-0000-0000-00000000d001', 1, 1, 1, 'months', 0.20),
       ('ed000000-0000-0000-0000-00000000d001', 2, null, 5, 'weeks', 0.20);

select set_config('request.jwt.claims',
  '{"sub":"ed000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

-- ===========================================================================
-- ONE TENANT: one month of a 2,000 rent, SAID to be months.
-- ===========================================================================
select is(
  (select fee_basis_unit from public.referral_fee_preview(
     'ZZZ Unit Agency','ZZZ Unit Office',null, 2000, array[100]::numeric[])),
  'months',
  'a one-month band reports its unit as months');

select is(
  (select fee_basis_weeks from public.referral_fee_preview(
     'ZZZ Unit Agency','ZZZ Unit Office',null, 2000, array[100]::numeric[])),
  1::numeric,
  'and its quantity as 1, which is why the unit was needed');

select is(
  (select fee_amount from public.referral_fee_preview(
     'ZZZ Unit Agency','ZZZ Unit Office',null, 2000, array[100]::numeric[])),
  2000::numeric,
  'and the fee is a whole month, not a week of it');

-- ===========================================================================
-- TWO TENANTS: five weeks, said to be weeks.
-- ===========================================================================
select is(
  (select fee_basis_unit from public.referral_fee_preview(
     'ZZZ Unit Agency','ZZZ Unit Office',null, 2000, array[50,50]::numeric[])),
  'weeks',
  'a five-week band reports its unit as weeks');

select is(
  (select fee_amount from public.referral_fee_preview(
     'ZZZ Unit Agency','ZZZ Unit Office',null, 2000, array[50,50]::numeric[])),
  2307.69::numeric,
  'and five weeks of a 2,000 rent is 2,307.69');

/* AND A SUPPLIER WITH NO DEAL AT ALL IS STANDARD TERMS, which is every
   supplier on the estate today and the state Matt's "existing suppliers keep
   one month's rent until changed" describes. A band always has a unit, the
   column is NOT NULL, so the only way the pair goes unqualified is for there
   to be no agreement to read, and then the answer is one month exactly. */
reset role;
update public.pricing_agreements set ended_at = now()
 where id = 'ed000000-0000-0000-0000-00000000d001';
set local role authenticated;
select is(
  (select is_standard from public.referral_fee_preview(
     'ZZZ Unit Agency','ZZZ Unit Office',null, 2000, array[100]::numeric[])),
  true,
  'with the deal ended the preview reports standard terms');

select * from finish();
rollback;
