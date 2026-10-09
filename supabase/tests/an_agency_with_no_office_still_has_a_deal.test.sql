/* AN AGENCY WITH NO OFFICE STILL HAS A DEAL, AND GETS AN OFFICE.
   Migration: 20261009090000.

   Matt, 2026-10-09, after walking live: "An independent agency should get
   its one office created automatically when it's added. An agency with no
   office should still show its deal on the Agreement card and Commission
   tab, without the change log printing a 0.00% total."

   WHAT THIS PROVES, and the order matters. Assertions 1 to 4 are the
   REPAIR: an agency that already exists with no office reads its own deal,
   because that is Regent on live and no better creation path can help it.
   Assertions 5 to 7 are the change log. Assertions 8 to 12 remove the
   condition at source.

   EVERY ROW IS THIS TEST'S OWN and the whole file is begin/rollback, which
   is the standing rule since a merge_agencies check ran against two real
   dev agencies. */
begin;
select plan(14);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('ee100000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.no.office@opndoor.test','',now(),now(),now());

insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('ee100000-0000-0000-0000-00000000c001','ZZZ No Office Admin',
        'zzz.no.office@opndoor.test','superadmin', null,'active',true);

/* TWO ESTATES. The first is ours, so admin_add_agency should place an office
   in it; the second is a supplier, where offices come from the supplier or
   from the referral that names one, and inventing one would be putting a
   confirmed office on somebody else's book. */
insert into public.partners (id, slug, name, status, partner_kind, referencing_mode, partner_rate, agent_rate)
values
  ('ee100000-0000-0000-0000-00000000f001'::uuid, 'zzz-no-ours', 'ZZZ NoOffice Our Estate',
   'active', 'agency', 'opndoor_referenced', 0.25, 0.10),
  ('ee100000-0000-0000-0000-00000000f002'::uuid, 'zzz-no-supp', 'ZZZ NoOffice Supplier',
   'active', 'supplier', 'pre_referenced_open', 0.25, 0.10);

/* THE AGENCY AT THE HEART OF IT: no branch row at all, which is exactly the
   shape Regent arrived on live in. */
insert into public.agencies (id, name, partner_id, review_state, livemode)
values ('ee100000-0000-0000-0000-00000000f0a1'::uuid, 'ZZZ Officeless Agency',
        'ee100000-0000-0000-0000-00000000f001'::uuid, 'confirmed', true);

select is(
  (select count(*)::int from public.branches
    where agency_id = 'ee100000-0000-0000-0000-00000000f0a1'::uuid),
  0,
  'the fixture agency has no office, which is the whole condition');

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ee100000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);

-- ===========================================================================
-- 1. THE DEAL IS WRITTEN, AND THE CHANGE LOG DOES NOT CLAIM A BRANCH TOTAL.
--
-- Matt's own figures: 1 tenant at 3 weeks and 20%, 2 or more at 5 weeks and
-- 25%. The point of using his numbers is that 25% is the one the log should
-- have printed and 0.00% is what it did print.
-- ===========================================================================
select lives_ok(
  $$select public.create_agreement(
      'agency', 'ee100000-0000-0000-0000-00000000f0a1'::uuid,
      'additive', 'year', 'agency',
      '[{"min":1,"max":1,"weeks":3,"unit":"weeks","rate":0.20},
        {"min":2,"max":null,"weeks":5,"unit":"weeks","rate":0.25}]'::jsonb)$$,
  'a deal can be written for an agency that has no office');

reset role;

select alike(
  (select detail from public.org_audit
    where entity_id = 'ee100000-0000-0000-0000-00000000f0a1'::uuid
      and action = 'agreement_created' limit 1),
  '%no office yet, so there is no branch total%',
  'and the change log says there is no office, instead of a 0.00% total');

/* THE REGRESSION THIS REPLACES, stated as its own assertion so that putting
   the coalesce back fails here rather than only reading oddly. */
select unalike(
  (select detail from public.org_audit
    where entity_id = 'ee100000-0000-0000-0000-00000000f0a1'::uuid
      and action = 'agreement_created' limit 1),
  '%0.00%',
  'and 0.00% appears nowhere in it');

-- ===========================================================================
-- 2. AND THE AGREEMENT CARD READS IT. agreement_for_agency is what both the
--    card and the Commission tab's top panel are built from, so one assertion
--    covers both of the surfaces Matt named.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ee100000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);

select isnt_empty(
  $$select * from public.agreement_for_agency('ee100000-0000-0000-0000-00000000f0a1'::uuid)$$,
  'the agreement card reads a deal for an agency with no office');

/* NOT STANDARD TERMS, which is the sentence Matt saw. The card prints its
   standard-terms arm on `!agreement || agreement.isStandard`, so both halves
   have to be right and an is_standard row would read the same as no row. */
select is(
  (select is_standard from public.agreement_for_agency('ee100000-0000-0000-0000-00000000f0a1'::uuid)),
  false,
  'and it is not reported as standard terms');

/* THE BANDS ARE HIS BANDS. The card draws its sentence from these, so this
   is the assertion that says the screen will show 3 weeks at 20% and 5 weeks
   at 25% rather than a deal with no figures in it. */
select is(
  (select jsonb_array_length(bands) from public.agreement_for_agency('ee100000-0000-0000-0000-00000000f0a1'::uuid)),
  2,
  'with both tenant-count bands');

select is(
  (select (bands -> 1 ->> 'rate')::numeric
     from public.agreement_for_agency('ee100000-0000-0000-0000-00000000f0a1'::uuid)),
  0.2500::numeric,
  'and the top band is the 25% he entered');

/* VOLUME IS ZERO AND SAYS SO. An agency with no office cannot have been
   paid, so this is the honest count and not a missing one. */
select is(
  (select volume from public.agreement_for_agency('ee100000-0000-0000-0000-00000000f0a1'::uuid)),
  0,
  'and the volume counter reads nought rather than null');

-- ===========================================================================
-- 3. THE RESOLVER UNDERNEATH IT, named here because the definer allowlist
--    requires every name on it to be exercised by name.
-- ===========================================================================
select isnt_empty(
  $$select * from public.resolve_pricing_agreement_for_agency(
      'ee100000-0000-0000-0000-00000000f0a1'::uuid,
      'ee100000-0000-0000-0000-00000000f001'::uuid, 1)$$,
  'resolve_pricing_agreement_for_agency answers from the agency alone');

/* AND IT GIVES THE SAME ANSWER THE BRANCH-KEYED TWIN WOULD. The ladder is
   the money and the two must not fork: this is the assertion that catches a
   future edit to one and not the other. */
select results_eq(
  $$select id, scope_level from public.resolve_pricing_agreement_for_agency(
      'ee100000-0000-0000-0000-00000000f0a1'::uuid,
      'ee100000-0000-0000-0000-00000000f001'::uuid, 1)$$,
  $$select pa.id, pa.scope_level from public.pricing_agreements pa
     where pa.scope_level = 'agency'
       and pa.scope_id = 'ee100000-0000-0000-0000-00000000f0a1'::uuid
       and pa.ended_at is null$$,
  'and it resolves to the agency-scope deal, which is the most specific rung');

-- ===========================================================================
-- 4. AND A NEW INDEPENDENT AGENCY ARRIVES WITH ITS ONE OFFICE.
-- ===========================================================================
select lives_ok(
  $$select public.admin_add_agency('ZZZ Brand New Agency', null, 'zzz-no-ours', null, null, null)$$,
  'an independent agency can be added');

reset role;

/* ONE OFFICE, NAMED AFTER THE AGENCY. The name is not decoration: NM-P
   hides a single office whose name is the agency's, and 20261008290000
   keeps it following a rename, so any other name would start showing on
   screen as a second thing the agency has. */
select results_eq(
  $$select b.name from public.branches b
     join public.agencies a on a.id = b.agency_id
    where a.name = 'ZZZ Brand New Agency'$$,
  $$values ('ZZZ Brand New Agency'::text)$$,
  'and it has exactly one office, carrying the agency''s own name');

/* AND NOT ON A SUPPLIER'S ESTATE. An agency email is required there, so the
   call has to carry one; the office must still not appear. */
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ee100000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);
select public.admin_add_agency('ZZZ Supplier Agency', null, 'zzz-no-supp',
                               'zzz.supplier.agency@example.test', null, null);
reset role;

select is(
  (select count(*)::int from public.branches b
     join public.agencies a on a.id = b.agency_id
    where a.name = 'ZZZ Supplier Agency'),
  0,
  'a supplier''s agency gets no office invented for it');

select * from finish();
rollback;
