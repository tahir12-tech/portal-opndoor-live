-- THE SINGLE-OFFICE BACKFILL, CORRECTED. THIS REPLACES 20261009110000.
--
-- 20261009110000 is DELETED in the same commit rather than corrected on top
-- of, and that is deliberate. It carried its own `do` block, so on a clean
-- filename-order apply it would have done its damage and only then been
-- fixed by this file. It was never applied anywhere but dev, where it placed
-- zero rows because dev has no branchless agency, so there is nothing to
-- undo and no ledger anywhere that holds it. Deleting it is the only way to
-- make the ORDER right.
--
-- WHAT A FIVE-DIMENSION ADVERSARIAL REVIEW FOUND, all three confirmed by
-- reading the source rather than taken on trust:
--
-- 1. A BRANCHLESS AGENCY IS A SUPPORTED PRODUCT STATE, not only the Regent
--    fault. 20260927100000_agency_without_branch.sql says it outright:
--
--      "Group onboarding is often a skeleton: the group and its agencies are
--       set up by Opndoor, and the director or each agency manager adds their
--       own branches on first login, because they are the ones who know them.
--       ... the only way to stand a group up was to invent branch names on
--       the operator's behalf and let somebody rename them later."
--
--    That migration rejected inventing offices BY NAME, and a backfill that
--    walks every branchless agency does exactly the rejected thing. The two
--    shapes are indistinguishable in the data: Regent came through
--    admin_add_agency (which created no office) and a skeleton comes through
--    admin_create_agency_and_branch with no branch name, and both leave an
--    agency with no branch.
--
--    SO IT IS BOUNDED RATHER THAN NARROWED. The function now takes the
--    number of agencies the caller EXPECTS to place, refuses and names them
--    if reality exceeds it, and places nothing in that case. The call below
--    passes 1, because exactly one agency is known to need this and Matt
--    named it. If live holds more, the deploy stops with their names instead
--    of inventing offices nobody asked for, which also makes
--    HANDOVER-BALAL.md 16.1a mandatory rather than advisory.
--
-- 2. `not is_supplier_estate` IS NOT "our own estate". This repo's own
--    predicate is is_our_estate_partner, `partner_kind = 'agency' or slug =
--    'opndoor-direct'`, and its comment says "`referencing-partner` is NOT
--    one ... it is the hand-over rail and holds no estate". That rail's
--    partner_kind is 'house', so is_supplier_estate is false for it and its
--    agencies were included. The reviewer proved it on dev in a rolled-back
--    transaction: an agency on a house partner came back with a confirmed,
--    live office. admin_add_agency had the same gap and is corrected below.
--
-- 3. AN INHERITED pending_review OFFICE COULD NEVER BE CONFIRMED.
--    confirm_org_entity sweeps an agency's pending office by NAME, and only
--    `lower(nm || ', Head office')`, "only that exact name". An office named
--    exactly after its agency is never swept, so a reviewer pressing Confirm
--    as new would confirm the agency and leave the office pending for ever,
--    whereupon reconciliation_queue stops folding it and it reappears as its
--    own queue item nobody created. Pending agencies are therefore SKIPPED:
--    an agency in the reconciliation queue is one a human is about to judge,
--    and inventing an office under it pre-empts that judgement. That is also
--    why the fix is not to rename the office to '<Agency>, Head office',
--    which confirm_org_entity would sweep: admin_add_agency lands its
--    agencies confirmed, so the exact name is right there and Matt asked for
--    it by name.
--
-- 4. AND THE REVOKE WAS A NO-OP. `revoke all ... from public, anon,
--    authenticated` removes three grants that were never there: the default
--    ACL for a function in this schema is
--    `{postgres=X/postgres,service_role=X/postgres}`. So the comment
--    claiming nobody could call it was false, and the one role that could
--    kept EXECUTE. The repo closes a function with `from authenticated,
--    service_role`, which 23 sites already do, and so does this one.

-- ---------------------------------------------------------------------------
-- 1. THE BACKFILL.
-- ---------------------------------------------------------------------------
create or replace function public.place_the_missing_single_offices(p_expected integer default 1)
returns integer
language plpgsql
set search_path to ''
as $function$
declare v_made integer := 0; v_found integer; v_names text; v_branch uuid; r record;
begin
  /* THE CANDIDATES, COUNTED BEFORE ANYTHING IS WRITTEN, because the whole
     point of the bound is that it refuses instead of half-finishing. */
  select count(*), string_agg(a.name, ', ' order by a.name)
    into v_found, v_names
  from public.agencies a
  where coalesce(public.is_our_estate_partner(a.partner_id), false)
    and not a.is_placeholder
    and a.review_state = 'confirmed'
    and not exists (select 1 from public.branches b where b.agency_id = a.id);

  if v_found > coalesce(p_expected, 1) then
    raise exception
      'There are % agencies on our own estate with no office, and this run expected %. They are: %. A branchless agency can be a deliberate skeleton (see 20260927100000), so somebody has to look at that list before offices are invented under it. Run HANDOVER-BALAL.md 16.1a, agree the names, then call place_the_missing_single_offices(%) yourself.',
      v_found, coalesce(p_expected, 1), v_names, v_found
      using errcode = '22023';
  end if;

  for r in
    select a.id, a.name, a.partner_id, a.livemode, a.review_state
    from public.agencies a
    /* OUR OWN ESTATE, by the repo's own definition rather than by "not a
       supplier". opndoor-direct is in it by slug; the referencing-partner
       hand-over rail is not, and nor is any supplier. */
    where coalesce(public.is_our_estate_partner(a.partner_id), false)
      /* NOT THE HOUSE PLACEHOLDERS. is_placeholder is the "Unattached" row
         that exists only because applications.branch_id is NOT NULL on a
         rail with no agency, and 20260812100000 is explicit that it must
         never appear anywhere a human judges a real letting agency. */
      and not a.is_placeholder
      /* AND NOT AN AGENCY STILL AWAITING REVIEW. See 3 in the header: a
         pending office named exactly after its agency can never be swept by
         confirm_org_entity, and an agency in the queue is one somebody is
         about to make a judgement about. */
      and a.review_state = 'confirmed'
      and not exists (select 1 from public.branches b where b.agency_id = a.id)
    order by a.created_at
  loop
    /* THE AGENCY'S OWN NAME. NM-P rules that a single-office agency IS the
       agency, so officeNameAddsNothing hides this name wherever one office is
       all there is, and 20261008290000 recognises an office named exactly
       after its agency as the system's own writing and renames it with the
       agency. Any other name would start showing on screen as a second thing
       the agency has, and would then be a name somebody had to maintain.

       livemode IS INHERITED, which is where a backfill must differ from
       admin_add_agency. branches.livemode defaults to TRUE, which is right
       for a function that writes an agency and its office in one breath; a
       sandbox agency walked over here would otherwise be handed a LIVE
       office, visible through branches_live_only and attachable to real
       money. review_state is inherited too, although the filter above means
       it is always 'confirmed': belt and braces, so a later widening of the
       filter cannot silently create the pending office of point 3.

       created_by IS LEFT NULL, which is honest, and matches the provenance
       20261008290000 measured on the offices the system had already written
       for itself. */
    insert into public.branches (name, agency_id, partner_id, review_state, livemode)
    values (btrim(r.name), r.id, r.partner_id, r.review_state, r.livemode)
    returning id into v_branch;

    insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
    values ('branch', v_branch, 'created',
            btrim(r.name) || ' (created for an agency that had no office)',
            /* NOT "an administrator", which is this codebase's string for a
               caller whose name cannot be resolved. None did this, and a
               Changes row naming an administrator who does not exist is a
               small lie that costs an afternoon later. */
            'opndoor', null);

    v_made := v_made + 1;
  end loop;

  return v_made;
end $function$;

comment on function public.place_the_missing_single_offices(integer) is
  'Give every CONFIRMED agency on Opndoor''s own estate that has no office exactly one, named after the agency and inheriting its livemode. Refuses, naming them, if there are more than p_expected: a branchless agency can be a deliberate skeleton (20260927100000) and somebody has to look at the list first. Idempotent, guarded on there being no office. Supplier estates, the referencing-partner hand-over rail, the house "Unattached" placeholders and agencies awaiting review are all excluded.';

/* CLOSED PROPERLY THIS TIME. The default ACL for a function in this schema is
   {postgres=X/postgres,service_role=X/postgres}, so revoking from public,
   anon and authenticated removes three grants that were never granted and
   leaves the only role that could call it holding EXECUTE. `public` is named
   because migrationPatterns requires it; service_role is named because it is
   the one that matters. */
revoke all on function public.place_the_missing_single_offices(integer) from public, anon, authenticated, service_role;

/* AND THE OLD ONE-ARGUMENTLESS SIGNATURE MUST GO, not merely be superseded.
   Every argument after the first has a default, so leaving both in place
   makes a named-argument call ambiguous ("function is not unique"), which is
   the lesson 20260927100000 recorded when it dropped the six-argument
   admin_create_agency_and_branch for exactly this reason. */
drop function if exists public.place_the_missing_single_offices();

-- ---------------------------------------------------------------------------
-- 2. AND admin_add_agency HAD THE SAME ESTATE GAP.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_add_agency(p_name text, p_group text DEFAULT NULL::text, p_partner_slug text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text, p_contact_name text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid(); who text; pid uuid; ag_id uuid; br_id uuid;
  v_admin boolean := public.is_admin();
  v_slug text := nullif(btrim(coalesce(p_partner_slug,'')),''); v_email text := btrim(coalesce(p_contact_email,''));
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  /* ON OUR OWN ESTATE, CREATING AN AGENCY IS OPNDOOR'S ACT. The house partner
     is shared, so a Manager creating an agency on it is creating a sibling
     beside their own, not adding to their own book. A SUPPLIER's manager
     still creates agencies under their own partner, which is their book. */
  if not coalesce((v_admin or (public.app_role() = 'management'
                      and not public.is_our_estate_partner(public.app_partner()))), false) then raise exception 'Not permitted.' using errcode = '42501'; end if;
  if btrim(coalesce(p_name,'')) = '' then raise exception 'Agency name is required' using errcode = '22023'; end if;
  if v_email <> '' and v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then raise exception 'Enter a valid agency contact email.' using errcode = '22023'; end if;
  pid := public.app_partner();
  if pid is null then
    if v_slug is null then raise exception 'Select a specific partner before adding an agency.' using errcode = '22023'; end if;
    select id into pid from public.partners where slug = v_slug;
    if pid is null then raise exception 'Unknown partner.' using errcode = '22023'; end if;
  end if;
  /* REQUIRED ON THE SUPPLIER SIDE ONLY. Matt, 2026-10-02, correcting the
     rule he had given an hour earlier:

       "Supplier side (agencies in a supplier's estate): an agency email
        is required at creation and is the default for all its branches
        ... Opndoor's own agencies (like Regent): no email required.
        Signed deeds go to whoever sent the referral (plus the people
        already ticked to receive them, as now)."

     The requirement moved AFTER the partner is resolved, because until
     then there is no estate to ask about. On our own estate the deed has
     a ladder of real people to go to, so a missing mailbox is not a gap
     and must not be reported as one. */
  if v_email = '' and coalesce(public.is_supplier_estate(pid), false) then
    raise exception 'An agency email is required for an agency that comes through a supplier. Signed deeds for its branches go there.'
      using errcode = '22023';
  end if;
  -- A deliberate org-tool add by admin OR management lands confirmed (instant).
  if exists (select 1 from public.agencies where partner_id = pid and lower(name) = lower(btrim(p_name))) then
    raise exception 'An agency with that name already exists for this partner.' using errcode = '23505';
  end if;
  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  insert into public.agencies(name, group_name, partner_id, review_state, created_by)
  values (btrim(p_name), nullif(btrim(coalesce(p_group,'')),''), pid, 'confirmed', me) returning id into ag_id;
  insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
  values ('agency', ag_id, 'created', btrim(p_name) || ' (added on the Agencies screen)', who, me);
  /* AND ITS ONE OFFICE, because an agency with none cannot be referred to,
     cannot receive a deed and could not even show its own deal.

     Matt, 2026-10-09: "An independent agency should get its one office
     created automatically when it's added." Regent went on to live with no
     office and that is what made its deal read as standard terms and its
     change log print a 0.00% total.

     NAMED AFTER THE AGENCY, which is not a placeholder: NM-P already rules
     that a single-office agency IS the agency, so `officeNameAddsNothing`
     hides this name wherever one office is all there is, and
     20261008290000 keeps it following the agency if the agency is renamed.
     A second office later makes this one visible under the agency's own
     name, which is the honest reading of where its first business sat.

     OUR OWN ESTATE ONLY. A supplier's agencies get their offices from the
     supplier, or from the referral that names one, and inventing one here
     would put a confirmed office on somebody else's book.

     `is_placeholder` is left at its default: this is a real office, the
     only one, and the agency's own name is its real name. */
  /* is_our_estate_partner, NOT "not a supplier". Corrected 2026-10-09 after
     an adversarial review of the backfill found the same gap in both: this
     repo's own definition of our estate is is_our_estate_partner, which is
     `partner_kind = 'agency' or slug = 'opndoor-direct'` and whose comment
     says in terms that "`referencing-partner` is NOT one ... it is the
     hand-over rail and holds no estate". `not is_supplier_estate` admits
     that rail, so an agency created on it was given a confirmed office on a
     book that holds none. */
  if coalesce(public.is_our_estate_partner(pid), false) then
    insert into public.branches(name, agency_id, partner_id, review_state, created_by)
    values (btrim(p_name), ag_id, pid, 'confirmed', me) returning id into br_id;
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('branch', br_id, 'created',
            btrim(p_name) || ' (created with the agency, which has one office)', who, me);
  end if;

  -- Only when there is one. On our own estate it is optional, and an
  -- empty contact row would be a mailbox with no address in it.
  if v_email <> '' then
    insert into public.agent_contacts(agency_id, partner_id, name, email, phone, is_primary, created_by)
    values (ag_id, pid, btrim(coalesce(p_contact_name,'')), v_email, nullif(btrim(p_contact_phone),''), true, me);
  end if;
  return ag_id;
end $function$;

-- ---------------------------------------------------------------------------
-- 3. RUN IT, EXPECTING ONE: Regent Letting & Property Management on live.
-- ---------------------------------------------------------------------------
do $$
declare v_made integer;
begin
  select public.place_the_missing_single_offices(1) into v_made;
  raise notice 'Single offices placed for agencies that had none: %', v_made;
end $$;
