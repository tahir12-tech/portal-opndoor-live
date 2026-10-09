-- THE SUPPLIER TEST IS A SUPPLIER TEST. REVERTING ONE HALF OF 20261009120000.
--
-- 20261009120000 switched the backfill's estate filter, and admin_add_agency's
-- with it, from `not is_supplier_estate` to `is_our_estate_partner`, on the
-- strength of a review finding that the comment said "OUR OWN ESTATE ONLY"
-- while the code tested only supplier-ness.
--
-- THE COMMENT WAS THE WRONG HALF TO CHANGE, and 20261009030000 had already
-- ruled on exactly this choice, the same day:
--
--   "'supplier' EXACTLY, not "anything that is not our estate". The hand-over
--    rail `referencing-partner` is neither a supplier estate nor ours, and its
--    Unattached agency does hold a mode of its own. Refusing there would be a
--    change Matt did not ask for."
--
-- The rail is Opndoor's own plumbing rather than a third party's book:
-- src/data/capabilities.ts calls `opndoor-agents`, `opndoor-direct` and
-- `referencing-partner` "our own plumbing, and a reader scoped to one of them
-- is Opndoor looking at its own rail", and on dev that partner has no portal
-- referrals, no API access, no API keys and no users. So there is no foreign
-- estate to protect there, and the thing the filter exists to keep out is a
-- SUPPLIER's agencies, which get their offices from the supplier or from the
-- referral that names one.
--
-- The three other corrections 20261009120000 made all stand and are untouched:
-- the bound that refuses to invent offices for more agencies than it was told
-- to, skipping agencies awaiting review, and revoking EXECUTE from service_role
-- (where the first revoke had named three roles that were never granted).
--
-- AND IT RUNS THE BACKFILL AGAIN, which is free: it is idempotent, guarded on
-- there being no office, and bounded at one. It is here only so that an agency
-- the narrowed filter skipped still gets its office on a clean apply. No such
-- row exists on dev.

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
  where not coalesce(public.is_supplier_estate(a.partner_id), false)
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
  /* 'supplier' EXACTLY, not "anything that is not our estate". Reverted
     2026-10-09, same day, because 20261009030000 already ruled on this
     choice in as many words:

       "'supplier' EXACTLY, not \"anything that is not our estate\". The
        hand-over rail `referencing-partner` is neither a supplier estate
        nor ours, and its Unattached agency does hold a mode of its own.
        Refusing there would be a change Matt did not ask for."

     I had switched this to is_our_estate_partner on the strength of a
     review finding that read the comment above it rather than the rule
     underneath, and that was the wrong half to change: the prose was
     loose, the predicate was right. `referencing-partner` is Opndoor's
     own plumbing, not a third party's book -- capabilities.ts calls it
     "our own plumbing, and a reader scoped to one of them is Opndoor
     looking at its own rail" -- so there is no foreign estate to protect
     and nothing to refuse. The thing being kept out is a SUPPLIER's
     agencies, which get their offices from the supplier or from the
     referral that names one. */
    where not coalesce(public.is_supplier_estate(a.partner_id), false)
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

revoke all on function public.place_the_missing_single_offices(integer) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. AND admin_add_agency, THE SAME WAY BACK.
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
  /* 'supplier' EXACTLY, not "anything that is not our estate". Reverted
     2026-10-09, same day, because 20261009030000 already ruled on this
     choice in as many words:

       "'supplier' EXACTLY, not \"anything that is not our estate\". The
        hand-over rail `referencing-partner` is neither a supplier estate
        nor ours, and its Unattached agency does hold a mode of its own.
        Refusing there would be a change Matt did not ask for."

     I had switched this to is_our_estate_partner on the strength of a
     review finding that read the comment above it rather than the rule
     underneath, and that was the wrong half to change: the prose was
     loose, the predicate was right. `referencing-partner` is Opndoor's
     own plumbing, not a third party's book -- capabilities.ts calls it
     "our own plumbing, and a reader scoped to one of them is Opndoor
     looking at its own rail" -- so there is no foreign estate to protect
     and nothing to refuse. The thing being kept out is a SUPPLIER's
     agencies, which get their offices from the supplier or from the
     referral that names one. */
  if not coalesce(public.is_supplier_estate(pid), false) then
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
-- 3. RUN IT, EXPECTING ONE.
-- ---------------------------------------------------------------------------
do $$
declare v_made integer;
begin
  select public.place_the_missing_single_offices(1) into v_made;
  raise notice 'Single offices placed for agencies that had none: %', v_made;
end $$;
