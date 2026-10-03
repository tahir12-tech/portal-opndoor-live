/* =====================================================================
   A CREATION ROW SAYS WHERE IT CAME FROM.

   Matt, 2026-10-03: "Record agency, branch, group and supplier creation in
   Recent changes and the audit trail (who, when, and from where), the same way
   edits are recorded."

   MEASURED FIRST, AND MOST OF IT WAS ALREADY THERE. Every creation path in the
   product already writes a row with WHO and WHEN:

     admin_add_agency                org_audit 'created'
     admin_add_branch                org_audit 'created'
     create_agency_group             org_audit 'created'
     admin_create_agency_and_branch  org_audit 'created'   (20261007840000)
     create_referral_target          org_audit 'created'
     partner_api_create_org          org_audit 'created'   (20261007930000)
     create_partner                  partner_audit 'created'

   SO THE HARBORVIEW GAP WAS NOT A MISSING AUDIT. It was a direct SQL fixture:
   the agency appeared on 2026-09-23 and the last org_audit creation row before
   it is 2026-09-18, because a seed written straight into the table bypasses
   every one of the functions above. That is expected of a fixture and is not
   something to build for.

   WHAT WAS GENUINELY MISSING IS "FROM WHERE", and it was uneven: the two paths
   written this week say it ("added while referring", "created through the
   API") and the older admin paths said only the name. So a row read six months
   from now cannot tell an agency somebody typed into the Agencies screen from
   one that arrived on a referral, which is exactly the question the Harborview
   investigation could not answer.

   IN THE DETAIL, NOT A NEW COLUMN. `org_audit.detail` is already the free-text
   half of a creation row -- it holds the name, which the row's entity_id
   already gives -- and `changeSentence` prints it as the subject. A column
   would have to be backfilled for every historical row with a value nobody
   knows, and the honest value for those is "we do not know".
   ===================================================================== */

CREATE OR REPLACE FUNCTION public.admin_add_agency(p_name text, p_group text DEFAULT NULL::text, p_partner_slug text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text, p_contact_name text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid(); who text; pid uuid; ag_id uuid;
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
  -- Only when there is one. On our own estate it is optional, and an
  -- empty contact row would be a mailbox with no address in it.
  if v_email <> '' then
    insert into public.agent_contacts(agency_id, partner_id, name, email, phone, is_primary, created_by)
    values (ag_id, pid, btrim(coalesce(p_contact_name,'')), v_email, nullif(btrim(p_contact_phone),''), true, me);
  end if;
  return ag_id;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_add_branch(p_agency_id uuid, p_name text, p_area text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text, p_contact_name text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid(); who text; pid uuid; br_id uuid; v_admin boolean := public.is_admin(); v_own_supplier boolean; v_email text := btrim(coalesce(p_contact_email,''));
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if btrim(coalesce(p_name,'')) = '' then raise exception 'Branch name is required' using errcode = '22023'; end if;
  select partner_id into pid from public.agencies where id = p_agency_id;
  if pid is null then raise exception 'Agency not found.' using errcode = '22023'; end if;
  /* AND A SUPPLIER'S REFERRER TOO, 2026-10-03. Matt: "Supplier users who can
     refer (Management and Referrers) can add an agency or office for their
     own supplier while sending a referring" -- the office half of the same
     instruction. Management could already; the referral form is where a
     referrer meets a new office, so refusing them there refuses the case
     this is for.

     OUR OWN ESTATE IS STILL EXCLUDED for the referrer arm, and management's
     own arm is untouched: `app_may_reach_agency` is what confines a manager
     to the agencies they reach, and a referrer holds no position, so the
     estate test is what confines them instead. */
  v_own_supplier := not v_admin
    and public.app_role() = 'referrer'
    and pid = public.app_partner()
    and not coalesce(public.is_our_estate_partner(pid), false);
  if not coalesce((v_admin or v_own_supplier or (public.app_role() = 'management' and pid = public.app_partner()
                      and public.app_may_reach_agency(p_agency_id))), false) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  /* A CONTACT HAS TO EXIST FOR THIS BRANCH. Matt, 2026-10-02: "A contact
     email is required when any agency or branch is created, in any
     estate, so one always exists."

     UNLESS IT INHERITS ONE. A branch with no contacts of its own uses its
     agency's -- that is what `effectiveContacts` has always done and what
     the deed panel prints as "agency default for X". The clause that
     matters in the instruction is "so one always exists", and for a
     branch under an agency that has a contact, one does. Requiring a
     second address per office would undo the default rather than add to
     it. The branch of an agency with NO contact is the case that was
     leaving a deed with nowhere to go, and it is refused. */
  if v_email <> '' and v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Enter a valid branch contact email, or leave it blank to use the agency''s.' using errcode = '22023';
  end if;
  /* NOT REQUIRED OF A BRANCH AT ALL, since Matt's correction of
     2026-10-02: "a branch's own email, if set, OVERRIDES it for that
     branch". An override is optional by definition. On the supplier side
     the AGENCY email is the required one and every branch inherits it;
     on our own estate nothing is required, because the deed goes to the
     referrer and the ticked people. */
  -- A deliberate org-tool add by admin OR management lands confirmed (instant).
  if exists (select 1 from public.branches where agency_id = p_agency_id and lower(name) = lower(btrim(p_name))) then
    raise exception 'A branch with that name already exists for this agency.' using errcode = '23505';
  end if;
  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  insert into public.branches(name, agency_id, partner_id, area, review_state, created_by)
  /* A REFERRER'S OFFICE WAITS FOR REVIEW, an admin's does not, and a
     manager's keeps the behaviour it had. An admin using the org tool IS the
     check; a referrer typing a name mid-referral is not, and
     Reconciliation's queue is where that gets looked at. */
  values (btrim(p_name), p_agency_id, pid, nullif(btrim(coalesce(p_area,'')),''),
          case when v_own_supplier then 'pending_review' else 'confirmed' end, me) returning id into br_id;
  insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
  values ('branch', br_id, 'created', btrim(p_name) || ' (added on the Agencies screen)', who, me);
  if v_email <> '' then
    insert into public.agent_contacts(branch_id, partner_id, name, email, phone, is_primary, created_by)
    values (br_id, pid, btrim(coalesce(p_contact_name,'')), v_email, nullif(btrim(p_contact_phone),''), true, me);
  end if;
  return br_id;
end $function$;

CREATE OR REPLACE FUNCTION public.create_agency_group(p_partner_slug text, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := auth.uid(); pid uuid; gid uuid; nm text := btrim(coalesce(p_name, ''));
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if nm = '' then raise exception 'Group name is required' using errcode = '22023'; end if;
  if public.is_admin() then
    select id into pid from public.partners where slug = p_partner_slug;
    if pid is null then raise exception 'Select a valid partner for this group.' using errcode = '22023'; end if;
  -- Same as admin_add_agency: a group on the shared house partner is an
  -- Opndoor-level object, not one agency's.
  elsif public.app_role() = 'management'
        and not public.is_our_estate_partner(public.app_partner()) then
    pid := public.app_partner();
    if pid is null then raise exception 'Unknown partner.' using errcode = '22023'; end if;
  else
    raise exception 'not permitted' using errcode = '42501';
  end if;
  -- name_key is a generated column; do not write it.
  insert into public.agency_groups(partner_id, name, created_by)
  values (pid, nm, me) returning id into gid;
  insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
  values ('agency_group', gid, 'created', nm || ' (added on the Agencies screen)', coalesce((select full_name from public.users where id = me), 'an administrator'), me);
  return gid;
exception when unique_violation then
  raise exception 'A group with that name already exists for this partner.' using errcode = '23505';
end $function$;

CREATE OR REPLACE FUNCTION public.create_referral_target(p_agency text, p_branch text, p_agency_email text DEFAULT NULL::text, p_agency_contact_name text DEFAULT NULL::text, p_agency_phone text DEFAULT NULL::text, p_branch_email text DEFAULT NULL::text, p_branch_contact_name text DEFAULT NULL::text, p_branch_phone text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pid uuid; me uuid := auth.uid(); who text; ag_id uuid; br_id uuid;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  pid := public.app_partner();
  if pid is null then
    raise exception 'Creating an agency or branch on the fly is only available to partner users; opndoor admins should pick an existing branch.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_agency,'')) = '' or btrim(coalesce(p_branch,'')) = '' then
    raise exception 'Agency and branch are required' using errcode = '22023';
  end if;

  who := coalesce((select full_name from public.users where id = me), 'a referrer');

  -- NARROWED TO WHAT THE CALLER HOLDS. This resolved any agency NAME on the
  -- partner to its uuid, and on the house route that is every agency we
  -- carry -- reachable by a Negotiator, because the only tests above are
  -- is_aal2() and a non-null partner. Being definer, it read straight past
  -- agencies_select. It was also a three-way oracle: unknown agency, known
  -- agency with an unknown office, and a uuid. Narrowing the LOOKUP (rather
  -- than adding a fourth message) collapses the first two into one answer.
  select a.id into ag_id from public.agencies a
   where a.partner_id = pid and lower(a.name) = lower(btrim(p_agency))
     and (not public.is_our_estate_partner(pid) or a.id in (select public.app_scoped_agencies()))
   limit 1;
  if ag_id is null then
    -- THE GUARD. Mirrors agencies_insert, which this function's DEFINER rights
    -- would otherwise walk straight past, including its is_admin() arm.
    if coalesce(not public.is_admin() and public.is_our_estate_partner(pid), true) then
      raise exception 'A new agency is set up by opndoor, not on a referral. Choose one of your own agencies.'
        using errcode = '42501';
    end if;
/* AND ON THE SUPPLIER SIDE IT ARRIVES WITH A DEFAULT ADDRESS. Matt,
       2026-10-02, correcting the rule he gave an hour earlier: "an agency
       email is required at creation and is the default for all its
       branches ... Opndoor's own agencies (like Regent): no email
       required."

       In practice this path only ever creates on the supplier rail -- the
       guard just above refuses an agency invented on our own estate --
       but the test is written on the ESTATE rather than leaning on that
       guard, because they are two different rules and either could be
       relaxed without the other. */
    if coalesce(btrim(p_agency_email),'') = '' and coalesce(public.is_supplier_estate(pid), false) then
      raise exception 'An agency email is required for an agency that comes through a supplier. Signed deeds for its branches go there.'
        using errcode = '22023';
    end if;
    if coalesce(btrim(p_agency_email),'') <> ''
       and btrim(p_agency_email) !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
      raise exception 'Enter a valid agency contact email.' using errcode = '22023';
    end if;
    insert into public.agencies(name, partner_id, review_state, created_by)
    values (btrim(p_agency), pid, 'pending_review', me) returning id into ag_id;
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('agency', ag_id, 'created', btrim(p_agency) || ' (added while referring)', who, me);
  end if;

  select id into br_id from public.branches where agency_id = ag_id and lower(name) = lower(btrim(p_branch)) limit 1;
  if br_id is null then
    -- Mirrors branches_insert, for the same reason.
    if coalesce(not public.is_admin() and public.is_our_estate_partner(pid), true) then
      raise exception 'A new office is set up by opndoor, not on a referral. Choose one of your own offices.'
        using errcode = '42501';
    end if;
/* NOTHING IS REQUIRED OF THE OFFICE. Matt's correction of 2026-10-02
       makes a branch email an OVERRIDE of the agency's, and an override is
       optional by definition. */
    insert into public.branches(name, agency_id, partner_id, review_state, created_by)
    values (btrim(p_branch), ag_id, pid, 'pending_review', me) returning id into br_id;
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('branch', br_id, 'created', btrim(p_branch) || ' (added while referring)', who, me);
  end if;

  -- Agency-default contact: only when an email was given and the agency has none yet.
  if coalesce(btrim(p_agency_email),'') <> '' and not exists (select 1 from public.agent_contacts where agency_id = ag_id) then
    insert into public.agent_contacts(agency_id, partner_id, name, email, phone, is_primary, created_by)
    values (ag_id, pid, coalesce(nullif(btrim(p_agency_contact_name),''), btrim(p_agency_email)), btrim(p_agency_email), nullif(btrim(p_agency_phone),''), true, me);
  end if;

  -- Optional branch contact.
  if coalesce(btrim(p_branch_email),'') <> '' then
    insert into public.agent_contacts(branch_id, partner_id, name, email, phone, is_primary, created_by)
    values (br_id, pid, coalesce(nullif(btrim(p_branch_contact_name),''), btrim(p_branch_email)), btrim(p_branch_email), nullif(btrim(p_branch_phone),''), true, me);
  end if;

  return br_id;
end $function$;
