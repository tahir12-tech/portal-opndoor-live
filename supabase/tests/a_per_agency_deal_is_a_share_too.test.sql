/* A PER-AGENCY DEAL IS A SHARE TOO, AND IT IS CHECKED ON SAVE.
   Migration: 20261007990000.

   Matt, 2026-10-04: "when any deal is saved (supplier or agency-level within
   a supplier), refuse it if the agency's share could exceed the supplier's
   total at any tenant count or volume, with a plain message saying which
   band breaks it."

   THE CASE IS THE ONE MEASURED ON DEV: an AGENCY-scope commission deal whose
   top band pays the agency more than the supplier's own flat total. Before
   this migration supplier_share_breaches never looked at agency scope and
   create_agreement only consulted it when the deal being saved was the
   supplier's own, so this saved silently and showed up as a clamped GBP 0.00
   supplier line on a statement. */
begin;
select plan(13);

-- ===========================================================================
-- FIXTURES. A carved supplier on a flat 25%, and a siblings one beside it.
-- ===========================================================================
insert into public.partners (id, slug, name, referencing_mode, is_house_route,
                             status, partner_kind, partner_rate, agent_rate,
                             opndoor_pays_agents)
values ('ec000000-0000-0000-0000-00000000f001','zzz-carved-sup','ZZZ Carved Supplier',
        'pre_referenced_open', false, 'active', 'supplier', 0.2500, 0.1000, false),
       ('ec000000-0000-0000-0000-00000000f002','zzz-siblings-sup','ZZZ Siblings Supplier',
        'pre_referenced_open', false, 'active', 'supplier', 0.2500, 0.1000, true);

insert into public.agencies (id, partner_id, name) values
  ('ec000000-0000-0000-0000-00000000a001','ec000000-0000-0000-0000-00000000f001','ZZZ Carved Agency'),
  ('ec000000-0000-0000-0000-00000000a002','ec000000-0000-0000-0000-00000000f002','ZZZ Siblings Agency');
insert into public.branches (id, agency_id, partner_id, name) values
  ('ec000000-0000-0000-0000-00000000b001','ec000000-0000-0000-0000-00000000a001',
   'ec000000-0000-0000-0000-00000000f001','ZZZ Carved Office'),
  ('ec000000-0000-0000-0000-00000000b002','ec000000-0000-0000-0000-00000000a002',
   'ec000000-0000-0000-0000-00000000f002','ZZZ Siblings Office');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('ec000000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.perag@opndoor.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission) values
  ('ec000000-0000-0000-0000-00000000c001','ZZZ PerAgency Admin','zzz.perag@opndoor.test',
   'superadmin', null,'active',true);

/* THE BREACHING OVERRIDE, inserted directly so the checker can be tested on
   its own before the save path is tested through it. 12% / 20% / 26% against
   a flat total of 25%, which is dev's real Kestrel shape. */
insert into public.pricing_agreements
  (id, scope_level, scope_id, coverage, period, counting_scope, effective_from, is_standard, kind)
values ('ec000000-0000-0000-0000-00000000d001','agency','ec000000-0000-0000-0000-00000000a001',
        'additive','month','agency', current_date - 1, false, 'commission');
insert into public.pricing_agreement_bands
  (agreement_id, min_tenants, max_tenants, fee_basis_weeks, fee_basis_unit, agent_rate)
values ('ec000000-0000-0000-0000-00000000d001', 1, 1, 3, 'weeks', 0.12),
       ('ec000000-0000-0000-0000-00000000d001', 2, 2, 5, 'weeks', 0.20),
       ('ec000000-0000-0000-0000-00000000d001', 3, null, 6, 'weeks', 0.26);

-- ===========================================================================
-- 1. THE CHECKER NOW SEES IT.
-- ===========================================================================
select isnt_empty(
  $$select * from public.supplier_share_breaches('ec000000-0000-0000-0000-00000000f001')$$,
  'a per-agency commission deal over the supplier''s total is found');

/* AT THREE TENANTS AND NOT BEFORE, which is the whole reason this was
   invisible: at one and two tenants the same deal is inside the total. */
select is(
  (select min(tenants) from public.supplier_share_breaches('ec000000-0000-0000-0000-00000000f001')),
  3,
  'and the lowest breaching tenant count is 3, not 1');

select is(
  (select band from public.supplier_share_breaches('ec000000-0000-0000-0000-00000000f001')
    order by tenants limit 1),
  '3 or more tenants',
  'the band is named in the editor''s own words');

select is(
  (select agency_name from public.supplier_share_breaches('ec000000-0000-0000-0000-00000000f001')
    order by tenants limit 1),
  'ZZZ Carved Agency',
  'and so is the agency');

-- ===========================================================================
-- 2. THE MESSAGE, which Matt asked to be plain and to say which band breaks.
-- ===========================================================================
/* CAPTURED RATHER THAN MATCHED BY throws_like, WHICH THIS pgTAP DOES NOT
   HAVE. throws_ok compares the message for equality, and pinning a whole
   sentence of product copy in a test makes every rewording a test failure.
   What matters is that the four facts reach the reader, so the message is
   captured and each fact matched on its own. */
create or replace function public.zzz_breach_message(p uuid) returns text
language plpgsql as $f$
begin
  perform public.assert_supplier_share_within_total(p);
  return '(no breach)';
exception when others then return sqlerrm;
end $f$;

select matches(
  public.zzz_breach_message('ec000000-0000-0000-0000-00000000f001'),
  '3 or more tenants',
  'the refusal names the band that breaks it');
select matches(
  public.zzz_breach_message('ec000000-0000-0000-0000-00000000f001'),
  'ZZZ Carved Agency',
  'and the agency whose deal it is');
select matches(
  public.zzz_breach_message('ec000000-0000-0000-0000-00000000f001'),
  '26\.00% of the guarantee fee',
  'and what that agency would keep');
select matches(
  public.zzz_breach_message('ec000000-0000-0000-0000-00000000f001'),
  'more than the 25\.00%',
  'and the total it is more than');

-- ===========================================================================
-- 3. SIBLINGS ARE EXEMPT, which is 20261007230000's ruling and Matt's words:
--    with Opndoor paying the agents directly there is no total to sit inside.
-- ===========================================================================
insert into public.pricing_agreements
  (id, scope_level, scope_id, coverage, period, counting_scope, effective_from, is_standard, kind)
values ('ec000000-0000-0000-0000-00000000d002','agency','ec000000-0000-0000-0000-00000000a002',
        'additive','month','agency', current_date - 1, false, 'commission');
insert into public.pricing_agreement_bands
  (agreement_id, min_tenants, max_tenants, fee_basis_weeks, fee_basis_unit, agent_rate)
values ('ec000000-0000-0000-0000-00000000d002', 3, null, 6, 'weeks', 0.26);

select is_empty(
  $$select * from public.supplier_share_breaches('ec000000-0000-0000-0000-00000000f002')$$,
  'siblings: the same deal is not a breach, because there is no total to exceed');

-- ===========================================================================
-- 4. THE SAVE PATHS.
-- ===========================================================================
select set_config('request.jwt.claims',
  '{"sub":"ec000000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;

/* THE SAVE IS REFUSED. This is the half that was missing entirely:
   create_agreement tested `p_level = 'partner'` and an agency-scope deal
   never reached the guard. */
select throws_ok(
  $$select public.create_agreement('agency','ec000000-0000-0000-0000-00000000a001',
      'additive','month','agency',
      '[{"min":1,"weeks":3,"unit":"weeks","rate":0.12},
        {"min":3,"weeks":6,"unit":"weeks","rate":0.30}]'::jsonb,
      '[]'::jsonb, 'over the top', true, false, 'commission')$$,
  '22023', null,
  'saving a per-agency deal over the supplier''s total is refused');

/* AND A CORRECTED ONE SAVES, which matters more than the refusal: the
   conflicting deal is ended before the guard runs, so an administrator is
   never trapped by a breach that already exists. */
select lives_ok(
  $$select public.create_agreement('agency','ec000000-0000-0000-0000-00000000a001',
      'additive','month','agency',
      '[{"min":1,"weeks":3,"unit":"weeks","rate":0.12},
        {"min":3,"weeks":6,"unit":"weeks","rate":0.24}]'::jsonb,
      '[]'::jsonb, 'inside the total', true, false, 'commission')$$,
  'a corrected per-agency deal saves, so the breach is escapable');

/* READ BACK AS OURSELVES. supplier_share_breaches is granted to service_role
   only, so the checker cannot be read while the session is pretending to be
   the admin who just saved. */
reset role;
select is_empty(
  $$select * from public.supplier_share_breaches('ec000000-0000-0000-0000-00000000f001')$$,
  'and the estate is healthy afterwards');
set local role authenticated;

/* LOWERING THE TOTAL IS A SAVE TOO. The agency now keeps 24%; dropping the
   supplier to 20% puts it over without the agency deal being touched, and
   set_supplier_commission only ever compared its own two flat numbers. */
select throws_ok(
  $$select public.set_supplier_commission('zzz-carved-sup', 0.20, 0.10, false)$$,
  '22023', null,
  'lowering the supplier''s total under an existing per-agency deal is refused');

select * from finish();
rollback;
