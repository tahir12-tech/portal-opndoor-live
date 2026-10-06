-- THE SUPPLIER'S COMMISSION IS STORED, THE SAME WAY THE AGENCY'S IS.
--
-- Matt, 2026-10-02, verbatim: "Store supplier commission per application
-- the same way agency commission is stored, and read it everywhere
-- (statements, exports, reporting, settlements) instead of
-- recalculating, with a test that the supplier statement and exports
-- agree to the penny."
--
-- The penny itself is asserted in the client suite, where the export and
-- the statement documents are actually built. This file is the half that
-- only SQL can answer: that the line is written at all, that it is
-- written for suppliers and nobody else, and -- the one that would be
-- expensive to find later -- that it does NOT turn the supplier into a
-- payee on Opndoor's AGENT statement run.

begin;
select plan(12);

-- ---------------------------------------------------------------------------
-- THE LEVEL.
-- ---------------------------------------------------------------------------
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.application_commission_lines'::regclass
      and conname = 'application_commission_lines_level_check'),
  'CHECK ((level = ANY (ARRAY[''group''::text, ''agency''::text, ''branch''::text, ''supplier''::text])))',
  'the four levels a commission line may hold');

/* ONE PER LEVEL PER APPLICATION, which is what makes "the supplier's
   line" a thing you can look up rather than a set you have to sum. */
select is(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.application_commission_lines'::regclass
      and conname = 'application_commission_lines_application_id_level_key'),
  'UNIQUE (application_id, level)',
  'and one line per level per application');

-- ---------------------------------------------------------------------------
-- WHAT THE BACKFILL DID, measured on the rows dev actually holds.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.applications a
    where public.is_supplier_estate(a.partner_id)
      and coalesce(a.partner_rate, 0) > 0
      and coalesce(a.fee_amount, a.monthly_rent, 0) > 0
      and not exists (select 1 from public.application_commission_lines l
                       where l.application_id = a.id and l.level = 'supplier')),
  0, 'every supplier-estate application with a fee carries its supplier line');

/* AND NOBODY ELSE DOES. A house route's cut is Opndoor's own margin and
   an agency of ours has no supplier above it, so there is nothing to
   owe and no line -- not a line of zero, which would read as a payee. */
select is(
  (select count(*)::int
     from public.application_commission_lines l
     join public.applications a on a.id = l.application_id
    where l.level = 'supplier' and not public.is_supplier_estate(a.partner_id)),
  0, 'and no application outside a supplier estate has one');

select is(
  (select round(l.amount, 2) from public.application_commission_lines l
     join public.applications a on a.id = l.application_id
    where a.guarantee_ref = 'GR-FROST-KES' and l.level = 'supplier'),
  600.00::numeric,
  'GR-FROST-KES owes Kestrel 25% of the 2400 it is priced on');

/* THE AGENCY LINE ON THE SAME APPLICATION IS UNTOUCHED. A supplier whose
   agreement says Opndoor pays its agents directly has both, and they are
   different debts to different parties. */
select is(
  (select round(l.amount, 2) from public.application_commission_lines l
     join public.applications a on a.id = l.application_id
    where a.guarantee_ref = 'GR-FROST-KES' and l.level = 'agency'),
  240.00::numeric,
  'and the agency line beside it is unchanged');

-- ---------------------------------------------------------------------------
-- THE WRITER, on a new application.
-- ---------------------------------------------------------------------------
create temp table probe(id uuid) on commit drop;
insert into public.applications
  (id, guarantee_ref, partner_id, agency_id, branch_id, status,
   tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_phone, tenant_email,
   prop_addr1, prop_city, prop_postcode, monthly_rent, fee_amount, tenancy_start,
   partner_rate, agent_rate, referencing_mode, livemode, referrer_id)
select '97000000-0000-0000-0000-000000000001',
       'ZZZ-SUP-FREEZE',
       a.partner_id, a.id, b.id, 'sent',
       'Ms', 'Freeze', 'Probe', '1990-01-01', '07700 900111', 'zzz.freeze@example.test',
       '1 Test Road', 'London', 'NW1 8LH', 2000, 1061.54, current_date + 30,
       0.25, 0.10, 'pre_referenced_open', true,
       /* A REFERRER, because assert_application_attributed refuses an
          application with neither a referrer nor an applicant on a
          partner that is not a house route: "Attribution cannot be
          silently missing." A supplier's referral is made by one of its
          own people, so this is the honest shape and not a workaround. */
       (select u.id from public.users u where u.partner_id = a.partner_id limit 1)
  from public.agencies a
  join public.branches b on b.agency_id = a.id
 where a.name = 'Kestrel Lettings'
 limit 1;

select lives_ok(
  $$select public.freeze_commission_lines(
      '97000000-0000-0000-0000-000000000001',
      (select branch_id from public.applications where guarantee_ref = 'ZZZ-SUP-FREEZE'),
      (select partner_id from public.applications where guarantee_ref = 'ZZZ-SUP-FREEZE'),
      1, 1061.54)$$,
  'the freeze runs on a supplier application');

/* THE HALF PENNY, IN SQL. 1061.54 x 0.25 is 265.385; the stored amount
   is what every surface then reads, so the one rounding happens here and
   nowhere else. This is the same number the client suite asserts the
   export and the statement agree on. */
select is(
  (select l.amount from public.application_commission_lines l
    where l.application_id = '97000000-0000-0000-0000-000000000001' and l.level = 'supplier'),
  265.39::numeric,
  'and stores the supplier amount rounded once, here');

select is(
  (select l.org_name from public.application_commission_lines l
    where l.application_id = '97000000-0000-0000-0000-000000000001' and l.level = 'supplier'),
  'Kestrel Lettings',
  'naming the supplier it is owed to');

/* ONE LINE, AND THE UNIQUE CONSTRAINT IS WHAT KEEPS IT ONE. The freeze
   is not idempotent and never has been: the agency-side CTE has no
   conflict clause, so a second call raises on the agency line before
   the supplier arm is reached. 20261007580000 put an `on conflict` on
   the supplier arm and called it idempotent; this test is what proved
   that dead, and 20261007590000 removed it rather than leave a comment
   claiming a guard that cannot fire. */
select is(
  (select count(*)::int from public.application_commission_lines
    where application_id = '97000000-0000-0000-0000-000000000001' and level = 'supplier'),
  1, 'leaving exactly one supplier line');

-- ---------------------------------------------------------------------------
-- AND THE AGENT STATEMENT DOES NOT GAIN A SUPPLIER PAYEE.
-- ---------------------------------------------------------------------------
/* THE EXPENSIVE ONE TO FIND LATER. commission_statement_lines joins the
   whole table and every row it returns becomes a payee on Opndoor's
   AGENT statement run, which is posted to that payee's Directors. A
   supplier line reaching it would address an agency statement to a
   supplier. The supplier is paid on its own statement, from the same
   stored amount. */
select is(
  (select count(*)::int from public.commission_statement_lines(current_date) l
    where l.level = 'supplier'),
  0, 'no supplier line is ever a payee on the agent statement run');

select is(
  (select count(*)::int from public.commission_statement_payees(current_date) p
    where p.level = 'supplier'),
  0, 'nor a payee on the run built from it');

select * from finish();
rollback;
