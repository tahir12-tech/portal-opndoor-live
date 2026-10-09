-- EVERY AGENCY ON OUR OWN ESTATE HAS ITS OFFICE, INCLUDING THE ONES ALREADY THERE.
--
-- Matt, 2026-10-09: "Add to fix C: when the migration runs, it should also
-- create the one office for any existing agency on our own estate that has
-- none, named after the agency, the same as admin_add_agency now does for new
-- ones. On live that includes Regent Letting & Property Management."
--
-- WHY A SEPARATE FILE. 20261009090000 is committed and applied, and a
-- correction to an earlier migration goes in a NEW migration here, never by
-- editing or re-running one. The effect is identical: the files run in
-- filename order, so this runs "when the migration runs".
--
-- WHY A FUNCTION AND NOT A `do` BLOCK, which is the only real design choice
-- in the file. Matt asked for it to be tested on dev with a branchless
-- agency, and dev has none: every agency on it already has an office. A `do`
-- block can only be proved by running the migration, which is the one thing
-- the rules forbid doing twice. A function can be called by a pgTAP test
-- against a fixture the test makes itself, inside a transaction that rolls
-- back, which is the standing rule for every check since a merge_agencies
-- probe merged two real dev agencies.
--
-- AND IT IS IDEMPOTENT, guarded on there being no office rather than on the
-- migration not having run. So Balal's live run, a rerun, and a clean
-- filename-order apply all do the same thing, and an agency that gains an
-- office by hand before the migration reaches live is simply skipped.

create or replace function public.place_the_missing_single_offices()
returns integer
language plpgsql
set search_path to ''
as $function$
declare v_made integer := 0; v_branch uuid; r record;
begin
  for r in
    select a.id, a.name, a.partner_id, a.livemode, a.review_state
    from public.agencies a
    /* OUR OWN ESTATE ONLY, the same test admin_add_agency uses. A supplier's
       agencies get their offices from the supplier or from the referral that
       names one, and a confirmed office invented here would be an office on
       somebody else's book that nobody asked for. */
    where not coalesce(public.is_supplier_estate(a.partner_id), false)
      /* AND NOT THE HOUSE PLACEHOLDERS. `is_placeholder` is the "Unattached"
         row that exists only because applications.branch_id is NOT NULL on a
         rail with no agency, and 20260812100000 is explicit that it "must
         never appear in duplicate detection, in the reconciliation queue, or
         anywhere a human is asked to make a judgement about a real letting
         agency". One of those with a confirmed office called "Unattached"
         would be exactly that. They are flagged in pairs and so already have
         their branch; this is here for the one that somehow does not. */
      and not a.is_placeholder
      and not exists (select 1 from public.branches b where b.agency_id = a.id)
    order by a.created_at
  loop
    /* THE AGENCY'S OWN NAME, which is not a placeholder name and is the whole
       reason this is safe to do unasked. NM-P rules that a single-office
       agency IS the agency, so officeNameAddsNothing hides this name wherever
       one office is all there is, and 20261008290000 recognises an office
       named exactly after its agency as DERIVED and renames it with the
       agency. Any other name would start showing on screen as a second thing
       the agency has, and would then be a name a person had to maintain.

       livemode AND review_state ARE INHERITED, and this is where a backfill
       MUST differ from admin_add_agency. That function takes the column
       defaults, which are `true` and `'confirmed'`, and it is right to:
       everything it creates it creates in one breath, so the agency it just
       wrote is live and confirmed too. Walking over rows that already exist
       is a different problem. A sandbox agency (livemode false) would
       otherwise be given a LIVE office, visible to everyone through
       branches_live_only and attachable to real money; and an agency still
       sitting in the reconciliation queue would be given a confirmed office,
       quietly settling half of the judgement somebody is waiting to make.

       created_by IS LEFT NULL, which is honest: no person did this. It also
       matches the provenance 20261008290000 measured on the offices the
       system had already written for itself. */
    insert into public.branches (name, agency_id, partner_id, review_state, livemode)
    values (btrim(r.name), r.id, r.partner_id, r.review_state, r.livemode)
    returning id into v_branch;

    insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
    values ('branch', v_branch, 'created',
            btrim(r.name) || ' (created for an agency that had no office)',
            /* NOT "an administrator", which is the string this codebase uses
               when auth.uid() resolves to no name. None did this, and a
               Changes row naming an administrator who does not exist is the
               kind of small lie that costs an afternoon later. */
            'opndoor', null);

    v_made := v_made + 1;
  end loop;

  return v_made;
end $function$;

comment on function public.place_the_missing_single_offices() is
  'Give every agency on our own estate that has no office exactly one, named after the agency, inheriting its livemode and review_state. Idempotent: guarded on there being no office, so a rerun does nothing. Supplier estates and the house "Unattached" placeholders are excluded. Written as a function rather than a do block so a pgTAP test can prove it against its own fixture inside a transaction.';

/* NOBODY MAY CALL THIS FROM ANYWHERE. It is an invoker function with no
   grants: the migration below runs it as the migration role, and the test runs
   it as the owner. It is deliberately NOT security definer, so it never
   appears on the definer allowlist and the browser has no door to it even by
   accident. */
revoke all on function public.place_the_missing_single_offices() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- AND RUN IT. On live this is Regent Letting & Property Management, which Matt
-- found with no office, which is what made its 25% deal read as standard terms
-- and its change log print a 0.00% total.
-- ---------------------------------------------------------------------------
do $$
declare v_made integer;
begin
  select public.place_the_missing_single_offices() into v_made;
  raise notice 'Single offices placed for agencies that had none: %', v_made;
end $$;
