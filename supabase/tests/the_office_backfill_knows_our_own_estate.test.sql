/* THE BACKFILL: EVERY CONFIRMED AGENCY ON OUR OWN ESTATE GETS ITS ONE OFFICE.
   Migration: 20261009120000, which replaces 20261009110000.

   Matt, 2026-10-09: "Add to fix C: when the migration runs, it should also
   create the one office for any existing agency on our own estate that has
   none, named after the agency, the same as admin_add_agency now does for
   new ones. On live that includes Regent Letting & Property Management. Test
   it on dev with a branchless agency."

   DEV HAS NO BRANCHLESS AGENCY, which is why the backfill is a function and
   not a `do` block: every agency on dev already has an office, so the only
   way to test it is against a fixture this file makes itself, inside a
   transaction that rolls back.

   SEVEN AGENCIES, AND ONLY TWO OF THEM QUALIFY. The interesting assertions
   are all about who is SKIPPED, because a first version of this migration
   skipped too few and an adversarial review found three ways that mattered:
   the hand-over rail is not our estate, an agency awaiting review must not
   have an office invented under it, and a branchless agency can be a
   deliberate skeleton rather than the Regent fault. */
begin;
select plan(25);

insert into public.partners (id, slug, name, status, partner_kind, referencing_mode, partner_rate, agent_rate)
values
  ('ea300000-0000-0000-0000-00000000f001'::uuid, 'zzz-bf-ours', 'ZZZ BF Our Estate',
   'active', 'agency', 'opndoor_referenced', 0.25, 0.10),
  ('ea300000-0000-0000-0000-00000000f002'::uuid, 'zzz-bf-supp', 'ZZZ BF Supplier',
   'active', 'supplier', 'pre_referenced_open', 0.25, 0.10),
  /* THE HAND-OVER RAIL'S SHAPE. partner_kind 'house' is what
     referencing-partner carries, and it is the ONLY partner the two estate
     predicates disagree about: is_supplier_estate is false for it and
     is_our_estate_partner is false too. 20261009030000 ruled which one wins,
     the same day: "'supplier' EXACTLY, not \"anything that is not our
     estate\" ... Refusing there would be a change Matt did not ask for." So
     this row DOES get an office, and the fixture exists to hold that choice
     still rather than to leave it unstated. */
  ('ea300000-0000-0000-0000-00000000f003'::uuid, 'zzz-bf-house', 'ZZZ BF Hand-over Rail',
   'active', 'house', 'pre_referenced_open', 0.25, 0.10);

insert into public.agencies (id, name, partner_id, review_state, livemode, is_placeholder) values
  -- QUALIFIES. The plain case, and the shape Regent is in on live.
  ('ea300000-0000-0000-0000-0000000000a1'::uuid, 'ZZZ BF Regent Shaped',
   'ea300000-0000-0000-0000-00000000f001'::uuid, 'confirmed', true, false),
  -- QUALIFIES, and must not be handed a LIVE office.
  ('ea300000-0000-0000-0000-0000000000a2'::uuid, 'ZZZ BF Sandbox Agency',
   'ea300000-0000-0000-0000-00000000f001'::uuid, 'confirmed', false, false),
  -- SKIPPED: still in the reconciliation queue.
  ('ea300000-0000-0000-0000-0000000000a3'::uuid, 'ZZZ BF Unreviewed Agency',
   'ea300000-0000-0000-0000-00000000f001'::uuid, 'pending_review', true, false),
  -- SKIPPED: the house "Unattached" placeholder shape.
  ('ea300000-0000-0000-0000-0000000000a4'::uuid, 'ZZZ BF Unattached',
   'ea300000-0000-0000-0000-00000000f001'::uuid, 'confirmed', true, true),
  -- SKIPPED: a supplier's agency.
  ('ea300000-0000-0000-0000-0000000000a5'::uuid, 'ZZZ BF Supplier Agency',
   'ea300000-0000-0000-0000-00000000f002'::uuid, 'confirmed', true, false),
  -- SKIPPED: already has one.
  ('ea300000-0000-0000-0000-0000000000a6'::uuid, 'ZZZ BF Already Has One',
   'ea300000-0000-0000-0000-00000000f001'::uuid, 'confirmed', true, false),
  -- QUALIFIES: the rail is Opndoor's own plumbing, not a supplier's book.
  ('ea300000-0000-0000-0000-0000000000a7'::uuid, 'ZZZ BF Hand-over Agency',
   'ea300000-0000-0000-0000-00000000f003'::uuid, 'confirmed', true, false);

insert into public.branches (id, name, agency_id, partner_id, review_state, livemode)
values ('ea300000-0000-0000-0000-0000000000b6'::uuid, 'ZZZ BF Battersea',
        'ea300000-0000-0000-0000-0000000000a6'::uuid,
        'ea300000-0000-0000-0000-00000000f001'::uuid, 'confirmed', true);

-- The fixture is the condition. If this is not six, nothing below measures it.
select is(
  (select count(*)::int from public.agencies a
    where a.id::text like 'ea300000%'
      and not exists (select 1 from public.branches b where b.agency_id = a.id)),
  6,
  'the fixture has six branchless agencies and one that already has an office');

/* AND THREE OF THE SIX QUALIFY, which is the number every count below turns
   on: the Regent-shaped one, the sandbox one and the hand-over rail one. The
   other three are a supplier's agency, a house placeholder and an agency
   awaiting review. */

-- ===========================================================================
-- 1. THE DOOR IS SHUT. Checked first, because everything below is worthless
--    if a service key can call this during a skeleton-onboarding window.
--
--    The first version revoked from public, anon and authenticated, which are
--    three grants a function in this schema never has: the default ACL is
--    {postgres=X/postgres,service_role=X/postgres}. So the revoke was a no-op
--    and the one role that could call it kept EXECUTE.
-- ===========================================================================
select function_privs_are('public','place_the_missing_single_offices',array['integer'],
  'service_role', array[]::text[],
  'the service role may not call the backfill');
select function_privs_are('public','place_the_missing_single_offices',array['integer'],
  'authenticated', array[]::text[], 'nor may a signed-in user');
select function_privs_are('public','place_the_missing_single_offices',array['integer'],
  'anon', array[]::text[], 'nor anon');

/* AND THERE IS ONE SIGNATURE. The argumentless version had to be dropped
   rather than superseded: every argument has a default, so two signatures
   make a named-argument call ambiguous. */
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'place_the_missing_single_offices'),
  1,
  'and there is exactly one signature, so no call can be ambiguous');

-- ===========================================================================
-- 2. IT REFUSES RATHER THAN INVENTING MORE THAN IT WAS TOLD TO.
--
-- A branchless agency is a SUPPORTED state, not only the Regent fault:
-- 20260927100000 stood the skeleton-group case up deliberately and rejected
-- "invent branch names on the operator's behalf" by name. The two shapes
-- cannot be told apart in the data, so the bound is what stops a backfill
-- doing the rejected thing to six agencies nobody looked at.
-- ===========================================================================
select throws_ok(
  $$select public.place_the_missing_single_offices(1)$$,
  '22023', null,
  'asked to place one when three qualify, it refuses');

select throws_like(
  $$select public.place_the_missing_single_offices(1)$$,
  '%ZZZ BF Regent Shaped%',
  'and it names the agencies in the refusal, so somebody can look at the list');

/* AND IT PLACED NOTHING. A bound that half-finishes is worse than no bound:
   the count is taken before the loop for exactly this reason. */
select is(
  (select count(*)::int from public.branches b
     join public.agencies a on a.id = b.agency_id
    where a.id::text like 'ea300000%'),
  1,
  'and nothing was written: still only the office the fixture made');

-- ===========================================================================
-- 3. RUN IT PROPERLY, AND IT PLACES EXACTLY THE TWO THAT QUALIFY.
-- ===========================================================================
select is(
  public.place_the_missing_single_offices(3),
  3,
  'told three, it places exactly three');

/* THE BLAST RADIUS, ASSERTED. The function walks the WHOLE agencies table, so
   an exact count of what it wrote across the whole database is the only thing
   that pins what it would do on live. A `>=` here would be green at two, at
   four and at forty. */
select is(
  (select count(*)::int from public.org_audit
    where detail like '%created for an agency that had no office%'),
  3,
  'and wrote three offices in total, nowhere else in the database');

-- ===========================================================================
-- 4. THE PLAIN CASE: ONE OFFICE, THE AGENCY'S OWN NAME.
-- ===========================================================================
select results_eq(
  $$select b.name, b.review_state, b.livemode, b.created_by is null, b.is_placeholder
      from public.branches b
     where b.agency_id = 'ea300000-0000-0000-0000-0000000000a1'::uuid$$,
  $$values ('ZZZ BF Regent Shaped'::text, 'confirmed'::text, true, true, false)$$,
  'a branchless agency gets exactly one office, named after itself, confirmed, live, with no author');

-- ===========================================================================
-- 5. SANDBOX STAYS SANDBOX. branches.livemode defaults to TRUE, so inheriting
--    it is a decision and not a formality.
-- ===========================================================================
select is(
  (select livemode from public.branches where agency_id = 'ea300000-0000-0000-0000-0000000000a2'::uuid),
  false,
  'a sandbox agency is not handed a live office');

select is(
  (select count(*)::int from public.branches where agency_id = 'ea300000-0000-0000-0000-0000000000a2'::uuid),
  1,
  'and it does get one');

-- ===========================================================================
-- 6. WHO IS SKIPPED, which is where the damage would have been.
-- ===========================================================================
select is(
  (select count(*)::int from public.branches where agency_id = 'ea300000-0000-0000-0000-0000000000a3'::uuid),
  0,
  'an agency still awaiting review gets no office, because confirm_org_entity could never confirm it');

select is(
  (select count(*)::int from public.branches where agency_id = 'ea300000-0000-0000-0000-0000000000a4'::uuid),
  0,
  'a house "Unattached" placeholder gets no office invented for it');

select is(
  (select count(*)::int from public.branches where agency_id = 'ea300000-0000-0000-0000-0000000000a5'::uuid),
  0,
  'and nor does a supplier''s agency');

/* AND THE ONE THE TWO PREDICATES DISAGREE ABOUT GETS ITS OFFICE. The filter
   is supplier-ness, by 20261009030000's ruling, and the hand-over rail is
   Opndoor's own plumbing rather than a third party's book: capabilities.ts
   calls it "our own plumbing, and a reader scoped to one of them is Opndoor
   looking at its own rail". This assertion exists so that a future reader of
   the loose phrase "our own estate" cannot quietly narrow it again, which is
   what 20261009120000 did before 20261009130000 put it back. */
select is(
  (select count(*)::int from public.branches where agency_id = 'ea300000-0000-0000-0000-0000000000a7'::uuid),
  1,
  'an agency on the hand-over rail does get one: that rail is ours, not a supplier''s');

select results_eq(
  $$select b.name from public.branches b
     where b.agency_id = 'ea300000-0000-0000-0000-0000000000a6'::uuid$$,
  $$values ('ZZZ BF Battersea'::text)$$,
  'an agency that already has an office keeps it, and gains no second one');

-- ===========================================================================
-- 7. IT IS IDEMPOTENT.
-- ===========================================================================
select is(
  public.place_the_missing_single_offices(1),
  0,
  'running it again places nothing, and does not even trip its own bound');

-- ===========================================================================
-- 8. THE CHANGE LOG SAYS WHAT HAPPENED AND WHO DID IT.
-- ===========================================================================
select results_eq(
  $$select oa.action, oa.actor, oa.actor_id is null
      from public.org_audit oa
     where oa.entity_id = (select id from public.branches
                            where agency_id = 'ea300000-0000-0000-0000-0000000000a1'::uuid)$$,
  $$values ('created'::text, 'opndoor'::text, true)$$,
  'the office is recorded as created by opndoor, with no person attached');

select alike(
  (select oa.detail from public.org_audit oa
    where oa.entity_id = (select id from public.branches
                           where agency_id = 'ea300000-0000-0000-0000-0000000000a1'::uuid)),
  '%created for an agency that had no office%',
  'and the row says why it exists');

-- ===========================================================================
-- 9. THE OFFICE IS DERIVED, SO IT FOLLOWS A RENAME.
--
-- 20261008290000 recognises an office named exactly after its agency as the
-- system's own writing and renames it with the agency. The naming choice
-- depends on that still being true, so it is asserted rather than assumed: a
-- name this function invented and nobody maintains must not become a stale
-- name on a statement.
-- ===========================================================================
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('ea300000-0000-0000-0000-00000000c001','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','zzz.bf.admin@opndoor.test','',now(),now(),now());
insert into public.users (id, full_name, email, role, partner_id, status, sees_commission)
values ('ea300000-0000-0000-0000-00000000c001','ZZZ BF Admin','zzz.bf.admin@opndoor.test',
        'superadmin', null,'active',true);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ea300000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);

select lives_ok(
  $$select public.set_agency_details('ea300000-0000-0000-0000-0000000000a1'::uuid,
      'ZZZ BF Regent Renamed', null, null)$$,
  'the agency can be renamed');

reset role;

select results_eq(
  $$select b.name from public.branches b
     where b.agency_id = 'ea300000-0000-0000-0000-0000000000a1'::uuid$$,
  $$values ('ZZZ BF Regent Renamed'::text)$$,
  'and the office the backfill made follows the rename, because it is derived');

-- ===========================================================================
-- 10. AND THE DEAL READS THROUGH IT, which is the point of the whole pair of
--     migrations: 20261009090000 made a branchless agency's deal readable,
--     and this makes the branch exist so every branch-keyed surface works.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"ea300000-0000-0000-0000-00000000c001","role":"authenticated","aal":"aal2"}', true);

select lives_ok(
  $$select public.create_agreement(
      'agency', 'ea300000-0000-0000-0000-0000000000a1'::uuid,
      'additive', 'year', 'agency',
      '[{"min":1,"max":1,"weeks":3,"unit":"weeks","rate":0.20},
        {"min":2,"max":null,"weeks":5,"unit":"weeks","rate":0.25}]'::jsonb)$$,
  'a deal can be written for it');

select alike(
  (select detail from public.org_audit
    where entity_id = 'ea300000-0000-0000-0000-0000000000a1'::uuid
      and action = 'agreement_created' limit 1),
  '%worst branch total 25.00%',
  'and the change log totals the branch instead of saying there is no office');

reset role;

select * from finish();
rollback;
