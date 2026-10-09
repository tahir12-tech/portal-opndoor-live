/* THE BACKFILL: EVERY AGENCY ALREADY ON OUR ESTATE GETS ITS ONE OFFICE.
   Migration: 20261009110000.

   Matt, 2026-10-09: "Add to fix C: when the migration runs, it should also
   create the one office for any existing agency on our own estate that has
   none, named after the agency, the same as admin_add_agency now does for
   new ones. On live that includes Regent Letting & Property Management. Test
   it on dev with a branchless agency."

   DEV HAS NO BRANCHLESS AGENCY, which is why the backfill is a function and
   not a `do` block: every agency on dev already has an office, so the only
   way to test it is against a fixture this file makes itself. That is also
   the standing rule for every check on dev since a merge_agencies probe
   merged two real agencies.

   FOUR AGENCIES IN THE FIXTURE, because the interesting assertions are the
   ones about who is SKIPPED: a sandbox agency, an unreviewed agency, a
   supplier's agency and a house placeholder each have to come out
   differently, and three of them have to come out untouched. */
begin;
select plan(19);

insert into public.partners (id, slug, name, status, partner_kind, referencing_mode, partner_rate, agent_rate)
values
  ('ea300000-0000-0000-0000-00000000f001'::uuid, 'zzz-bf-ours', 'ZZZ BF Our Estate',
   'active', 'agency', 'opndoor_referenced', 0.25, 0.10),
  ('ea300000-0000-0000-0000-00000000f002'::uuid, 'zzz-bf-supp', 'ZZZ BF Supplier',
   'active', 'supplier', 'pre_referenced_open', 0.25, 0.10);

insert into public.agencies (id, name, partner_id, review_state, livemode, is_placeholder) values
  -- 1. The plain case, and the shape Regent is in on live.
  ('ea300000-0000-0000-0000-0000000000a1'::uuid, 'ZZZ BF Regent Shaped',
   'ea300000-0000-0000-0000-00000000f001'::uuid, 'confirmed', true, false),
  -- 2. Sandbox. Must NOT be handed a live office.
  ('ea300000-0000-0000-0000-0000000000a2'::uuid, 'ZZZ BF Sandbox Agency',
   'ea300000-0000-0000-0000-00000000f001'::uuid, 'confirmed', false, false),
  -- 3. Still in the reconciliation queue. Must not have half of that
  --    judgement settled by a confirmed office appearing under it.
  ('ea300000-0000-0000-0000-0000000000a3'::uuid, 'ZZZ BF Unreviewed Agency',
   'ea300000-0000-0000-0000-00000000f001'::uuid, 'pending_review', true, false),
  -- 4. The house "Unattached" placeholder shape.
  ('ea300000-0000-0000-0000-0000000000a4'::uuid, 'ZZZ BF Unattached',
   'ea300000-0000-0000-0000-00000000f001'::uuid, 'confirmed', true, true),
  -- 5. A supplier's agency, which needs the email its own rules require.
  ('ea300000-0000-0000-0000-0000000000a5'::uuid, 'ZZZ BF Supplier Agency',
   'ea300000-0000-0000-0000-00000000f002'::uuid, 'confirmed', true, false),
  -- 6. One that already has an office, to prove nothing gains a second.
  ('ea300000-0000-0000-0000-0000000000a6'::uuid, 'ZZZ BF Already Has One',
   'ea300000-0000-0000-0000-00000000f001'::uuid, 'confirmed', true, false);

insert into public.branches (id, name, agency_id, partner_id, review_state, livemode)
values ('ea300000-0000-0000-0000-0000000000b6'::uuid, 'ZZZ BF Battersea',
        'ea300000-0000-0000-0000-0000000000a6'::uuid,
        'ea300000-0000-0000-0000-00000000f001'::uuid, 'confirmed', true);

-- The fixture is the condition. If this is not five, nothing below measures it.
select is(
  (select count(*)::int from public.agencies a
    where a.id::text like 'ea300000%'
      and not exists (select 1 from public.branches b where b.agency_id = a.id)),
  5,
  'the fixture has five branchless agencies and one that already has an office');

-- ===========================================================================
-- 1. RUN IT, AND IT SAYS HOW MANY IT MADE.
-- ===========================================================================
create temporary table zzz_bf_run as select public.place_the_missing_single_offices() as made;

/* THREE, NOT FIVE. The supplier's agency and the placeholder are skipped, and
   that is the whole of the judgement in this function. Note the count is of
   ALL agencies it placed, so it is asserted against the fixture's own rows
   below rather than against this number, which a future row on dev could
   move. */
select cmp_ok((select made from zzz_bf_run), '>=', 3,
  'it reports placing at least the three it should have');

-- ===========================================================================
-- 2. THE PLAIN CASE: ONE OFFICE, THE AGENCY'S OWN NAME.
-- ===========================================================================
select results_eq(
  $$select b.name, b.review_state, b.livemode, b.created_by is null, b.is_placeholder
      from public.branches b
     where b.agency_id = 'ea300000-0000-0000-0000-0000000000a1'::uuid$$,
  $$values ('ZZZ BF Regent Shaped'::text, 'confirmed'::text, true, true, false)$$,
  'a branchless agency gets exactly one office, named after itself, confirmed, live, with no author');

-- ===========================================================================
-- 3. SANDBOX STAYS SANDBOX. This is the assertion that would have caught the
--    column default: branches.livemode defaults to TRUE, so inheriting it
--    from the agency is a decision and not a formality.
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
-- 4. AND AN UNREVIEWED AGENCY'S OFFICE IS UNREVIEWED TOO.
-- ===========================================================================
select is(
  (select review_state from public.branches where agency_id = 'ea300000-0000-0000-0000-0000000000a3'::uuid),
  'pending_review',
  'an agency still in the reconciliation queue gets an office in the same state');

-- ===========================================================================
-- 5. WHO IS SKIPPED, which is where the damage would have been.
-- ===========================================================================
select is(
  (select count(*)::int from public.branches where agency_id = 'ea300000-0000-0000-0000-0000000000a4'::uuid),
  0,
  'a house "Unattached" placeholder gets no office invented for it');

select is(
  (select count(*)::int from public.branches where agency_id = 'ea300000-0000-0000-0000-0000000000a5'::uuid),
  0,
  'and nor does a supplier''s agency');

select results_eq(
  $$select b.name from public.branches b
     where b.agency_id = 'ea300000-0000-0000-0000-0000000000a6'::uuid$$,
  $$values ('ZZZ BF Battersea'::text)$$,
  'an agency that already has an office keeps it, and gains no second one');

-- ===========================================================================
-- 6. IT IS IDEMPOTENT. Balal runs it on live, and a clean filename-order
--    apply runs it again; both must do the same thing.
-- ===========================================================================
select is(
  public.place_the_missing_single_offices(),
  0,
  'running it again places nothing');

select is(
  (select count(*)::int from public.branches b
     join public.agencies a on a.id = b.agency_id
    where a.id::text like 'ea300000%'),
  4,
  'and the fixture still has four offices, not seven');

-- ===========================================================================
-- 7. THE CHANGE LOG SAYS WHAT HAPPENED AND WHO DID IT.
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

/* NOT "an administrator", which is this codebase's string for a caller whose
   name cannot be resolved. A Changes row naming an administrator who does not
   exist is a small lie that costs an afternoon later. */
select unalike(
  (select oa.actor from public.org_audit oa
    where oa.entity_id = (select id from public.branches
                           where agency_id = 'ea300000-0000-0000-0000-0000000000a1'::uuid)),
  '%administrator%',
  'and it does not claim an administrator did it');

-- ===========================================================================
-- 8. THE OFFICE IS DERIVED, SO IT FOLLOWS A RENAME.
--
-- 20261008290000 recognises an office named exactly after its agency as the
-- system's own writing and renames it with the agency. The backfill's whole
-- naming choice depends on that still being true, so it is asserted rather
-- than assumed: a name this function invented and nobody maintains must not
-- become a stale name on a statement.
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
-- 9. AND THE DEAL READS THROUGH IT, which is the point of the whole pair of
--    migrations: C made a branchless agency's deal readable, and this makes
--    the branch exist so every other branch-keyed surface works too.
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

/* AND THE CHANGE LOG NOW HAS A BRANCH TO TOTAL, which is the other half of
   20261009090000 read from this side: with the office in place the honest
   sentence is the percentage, not "no office yet". */
select alike(
  (select detail from public.org_audit
    where entity_id = 'ea300000-0000-0000-0000-0000000000a1'::uuid
      and action = 'agreement_created' limit 1),
  '%worst branch total 25.00%',
  'and the change log totals the branch instead of saying there is no office');

select isnt_empty(
  $$select * from public.agreement_for_agency('ea300000-0000-0000-0000-0000000000a1'::uuid)$$,
  'and the Agreement card reads the deal');

reset role;

select * from finish();
rollback;
