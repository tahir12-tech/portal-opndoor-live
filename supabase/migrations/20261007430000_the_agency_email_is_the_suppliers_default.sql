-- =========================================================================
-- THE CONTACT EMAIL RULE, CORRECTED: REQUIRED ON THE SUPPLIER SIDE ONLY.
--
-- Matt, 2026-10-02, correcting what he had asked for an hour earlier:
--
--   "Supplier side (agencies in a supplier's estate): an agency email is
--    required at creation and is the default for all its branches; a
--    branch's own email, if set, overrides it for that branch. Signed
--    deeds go there.
--    Opndoor's own agencies (like Regent): no email required. Signed
--    deeds go to whoever sent the referral (plus the people already
--    ticked to receive them, as now). The agency or a branch can
--    optionally add an email that also receives the deed; leave it blank
--    and nothing is missing."
--
-- WHAT NARROWS. 20261007420000 required a contact at creation in EVERY
-- estate. That stays for a supplier's agencies and is lifted for ours.
-- A branch is never required to bring one on either side, because the
-- corrected rule makes a branch email an OVERRIDE of the agency's and an
-- override is optional by definition.
--
-- WHAT WIDENS, and this is the half that is a real gap rather than a
-- loosened rule. On our own estate a mailbox set on an agency or a
-- branch was stored, shown on the Agencies screen, and never written to:
-- `deed_delivery_target` returns the ladder on that rail and its second
-- arm only runs when the ladder is EMPTY. GR-FROST-OURS on dev proves
-- it -- its branch holds mayfair@frost.example and the deed resolves to
-- the referrer alone. A third arm adds that address to the ladder, which
-- is the "also" in the instruction.
--
-- WHAT IS NOT DONE: nothing is invented or copied. "Don't invent or copy
-- addresses" rules out backfilling an agency email from a branch's, or
-- from the first person on the org, and no row is written here.
-- =========================================================================

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
  values ('agency', ag_id, 'created', btrim(p_name), who, me);
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
  me uuid := auth.uid(); who text; pid uuid; br_id uuid; v_admin boolean := public.is_admin(); v_email text := btrim(coalesce(p_contact_email,''));
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if btrim(coalesce(p_name,'')) = '' then raise exception 'Branch name is required' using errcode = '22023'; end if;
  select partner_id into pid from public.agencies where id = p_agency_id;
  if pid is null then raise exception 'Agency not found.' using errcode = '22023'; end if;
  if not coalesce((v_admin or (public.app_role() = 'management' and pid = public.app_partner()
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
  values (btrim(p_name), p_agency_id, pid, nullif(btrim(coalesce(p_area,'')),''), 'confirmed', me) returning id into br_id;
  insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
  values ('branch', br_id, 'created', btrim(p_name), who, me);
  if v_email <> '' then
    insert into public.agent_contacts(branch_id, partner_id, name, email, phone, is_primary, created_by)
    values (br_id, pid, btrim(coalesce(p_contact_name,'')), v_email, nullif(btrim(p_contact_phone),''), true, me);
  end if;
  return br_id;
end $function$;

CREATE OR REPLACE FUNCTION public.create_referral_target(p_agency text, p_branch text, p_agency_email text DEFAULT NULL::text, p_agency_contact_name text DEFAULT NULL::text, p_agency_phone text DEFAULT NULL::text, p_branch_email text DEFAULT NULL::text, p_branch_contact_name text DEFAULT NULL::text, p_branch_phone text DEFAULT NULL::text, p_partner_slug text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  pid uuid; me uuid := auth.uid(); who text;
  ag_id uuid; br_id uuid; ag_new boolean := false; br_new boolean := false;
  v_admin boolean := public.is_admin();
  v_state text;
  v_slug text := nullif(btrim(coalesce(p_partner_slug,'')), '');
  v_slug_id uuid;
  v_branch text := coalesce(nullif(btrim(coalesce(p_branch,'')), ''), 'Head office');
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if btrim(coalesce(p_agency,'')) = '' then raise exception 'Agency is required' using errcode = '22023'; end if;
  who := coalesce((select full_name from public.users where id = me), 'a referrer');
  pid := public.app_partner();
  if pid is not null then
    v_state := 'pending_review';
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
  else
    if not coalesce(v_admin, false) then raise exception 'Not permitted.' using errcode = '42501'; end if;
    v_state := 'confirmed';
    if v_slug is not null then select id into v_slug_id from public.partners where slug = v_slug; end if;
    select a.id, a.partner_id into ag_id, pid
      from public.agencies a
      where lower(a.name) = lower(btrim(p_agency)) and (v_slug_id is null or a.partner_id = v_slug_id)
      order by (a.review_state = 'confirmed') desc, a.created_at asc limit 1;
    if ag_id is null then
      if v_slug is null then raise exception 'Select a specific partner before creating a new agency on the fly.' using errcode = '22023'; end if;
      if v_slug_id is null then raise exception 'Unknown partner.' using errcode = '22023'; end if;
      pid := v_slug_id;
    end if;
  end if;
  if ag_id is null then
    -- THE GUARD, on the path the referral form submits through. v_admin, not
    -- is_admin() inline, because this function already asked and the answer is
    -- the same one the admin arm above was decided on.
    if coalesce(not v_admin and public.is_our_estate_partner(pid), true) then
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
    if btrim(p_agency_email) !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
      raise exception 'Enter a valid agency contact email.' using errcode = '22023';
    end if;
    insert into public.agencies(name, partner_id, review_state, created_by)
    values (btrim(p_agency), pid, v_state, me) returning id into ag_id;
    ag_new := true;
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('agency', ag_id, 'created', btrim(p_agency), who, me);
  end if;
  select id into br_id from public.branches where agency_id = ag_id and lower(name) = lower(v_branch) limit 1;
  if br_id is null then
    -- THE SECOND GUARD. Reached when the agency is one of ours and the office is
    -- not, which is the likelier of the two in practice: a real agency, a
    -- mistyped or genuinely new office.
    if coalesce(not v_admin and public.is_our_estate_partner(pid), true) then
      raise exception 'A new office is set up by opndoor, not on a referral. Choose one of your own offices.'
        using errcode = '42501';
    end if;
/* NOTHING IS REQUIRED OF THE OFFICE. Matt's correction of 2026-10-02
       makes a branch email an OVERRIDE of the agency's, and an override is
       optional by definition. */
    insert into public.branches(name, agency_id, partner_id, review_state, created_by)
    values (v_branch, ag_id, pid, v_state, me) returning id into br_id;
    br_new := true;
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('branch', br_id, 'created', v_branch, who, me);
  end if;
  if ag_new and coalesce(btrim(p_agency_email),'') <> '' then
    insert into public.agent_contacts(agency_id, partner_id, name, email, phone, is_primary, created_by)
    values (ag_id, pid, btrim(coalesce(p_agency_contact_name,'')), btrim(p_agency_email), nullif(btrim(p_agency_phone),''), true, me);
  end if;
  if br_new and coalesce(btrim(p_branch_email),'') <> '' then
    insert into public.agent_contacts(branch_id, partner_id, name, email, phone, is_primary, created_by)
    values (br_id, pid, btrim(coalesce(p_branch_contact_name,'')), btrim(p_branch_email), nullif(btrim(p_branch_phone),''), true, me);
  end if;
  return br_id;
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
    values ('agency', ag_id, 'created', btrim(p_agency), who, me);
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
    values ('branch', br_id, 'created', btrim(p_branch), who, me);
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

-- ---------------------------------------------------------------------------
-- THE ONBOARDING CALL. It defaults to `opndoor-agents`, so in practice it
-- creates on our own estate and the email is optional there; the test is
-- written on the ESTATE because the slug is a parameter.
-- ---------------------------------------------------------------------------
create or replace function public.admin_create_agency_and_branch(
  p_agency_name text,
  p_branch_name text default null,
  p_branch_area text default null,
  p_partner_rate numeric default null,
  p_agent_rate numeric default null,
  p_partner_slug text default 'opndoor-agents',
  p_group_id uuid default null,
  p_agency_email text default null,
  p_agency_contact_name text default null,
  p_agency_phone text default null
)
returns table(agency_id uuid, branch_id uuid)
language plpgsql security definer set search_path to ''
as $function$
declare v_partner uuid; v_agency uuid; v_branch uuid; v_me uuid := auth.uid();
        v_email text := btrim(coalesce(p_agency_email, ''));
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  if coalesce(btrim(p_agency_name), '') = '' then raise exception 'An agency name is required.' using errcode = '22023'; end if;

  if v_email <> '' and v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Enter a valid agency contact email.' using errcode = '22023';
  end if;

  select id into v_partner from public.partners where slug = coalesce(nullif(btrim(p_partner_slug), ''), 'opndoor-agents');
  if v_partner is null then raise exception 'Partner not found.' using errcode = '22023'; end if;

  -- The estate decides, and only after the partner is resolved.
  if v_email = '' and coalesce(public.is_supplier_estate(v_partner), false) then
    raise exception 'An agency email is required for an agency that comes through a supplier. Signed deeds for its branches go there.'
      using errcode = '22023';
  end if;

  if p_group_id is not null and not exists (
    select 1 from public.agency_groups g where g.id = p_group_id and g.partner_id = v_partner
  ) then
    raise exception 'That group is not under this partner.' using errcode = '22023';
  end if;

  insert into public.agencies (partner_id, name, review_state, partner_rate, agent_rate, group_id)
  values (v_partner, btrim(p_agency_name), 'confirmed', p_partner_rate, p_agent_rate, p_group_id)
  returning id into v_agency;

  -- Only when there is one: an empty contact row is a mailbox with no
  -- address in it, and "leave it blank and nothing is missing".
  if v_email <> '' then
    insert into public.agent_contacts (agency_id, partner_id, name, email, phone, is_primary, created_by)
    values (v_agency, v_partner, btrim(coalesce(p_agency_contact_name, '')), v_email,
            nullif(btrim(coalesce(p_agency_phone, '')), ''), true, v_me);
  end if;

  -- Optional: a skeleton agency waits for its manager to add branches.
  if coalesce(btrim(p_branch_name), '') <> '' then
    insert into public.branches (agency_id, partner_id, name, area, review_state)
    values (v_agency, v_partner, btrim(p_branch_name), nullif(btrim(coalesce(p_branch_area, '')), ''), 'confirmed')
    returning id into v_branch;
  end if;

  return query select v_agency, v_branch;
end $function$;

comment on function public.admin_create_agency_and_branch(text, text, text, numeric, numeric, text, uuid, text, text, text) is
  'Admin onboarding: an agent-rail agency, its first office, and its contact where one was given. The agency email is required only in a supplier''s estate (Matt, 2026-10-02); on our own estate a deed goes to the referrer and the ticked people.';

-- ---------------------------------------------------------------------------
-- AND THE DEED REACHES AN OPTIONAL MAILBOX ON OUR OWN ESTATE. Regenerated
-- from its definition in 20261006820000 with a third arm; the two that
-- were there are untouched, comments included.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.deed_delivery_target(p_application uuid)
 RETURNS TABLE(email text, display_name text, source text, verified boolean, auto_send boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with a as (
    select * from public.applications where id = p_application
  ),
  ch as (
    select public.application_channel((select id from a)) as channel
  ),
  -- THE WHOLE LADDER, in rung order. No limit.
  nr as (
    select r.email, r.display_name, r.rung,
           case r.rung when 'referrer' then 1 when 'copy' then 2 else 3 end as pri
      from public.agency_notification_recipients((select id from a)) r
  ),
  d as (
    select * from public.application_delivery_contacts
     where application_id = (select id from a)
  ),
  rc as (
    select * from public.effective_primary_contact_route(
      (select branch_id from a), (select partner_id from a))
  ),
  -- R1. WAS `effective_primary_contact(branch)`, which keys on the branch
  -- ALONE with no partner filter and runs inside this definer function, so it
  -- saw every contact on the branch whatever RLS said. Where one agency is
  -- legitimately shared by two partners, that handed one route's executed deed
  -- to the other route's contact. Pinned to the BRANCH'S OWN partner: still
  -- the branch mailbox this rung was always for, but never another company's.
  c as (
    select * from public.effective_primary_contact_route(
      (select branch_id from a),
      (select b.partner_id from public.branches b where b.id = (select branch_id from a)))
  ),
  -- auto_send is a property of the application, so it is computed once.
  gate as (
    select (select channel from ch) <> 'Agent referral' or exists (select 1 from nr) as auto_send
  )
  -- THE AGENCY RAIL: one row per person on the ladder, FILTERED BY THE
  -- MATRIX. Q-03. The deed to its own recipient is a locked cell -- the
  -- referrer rung on this rail -- so notification_enabled answers true for it
  -- whatever any stored row says, and set_notification_setting refuses to
  -- turn it off. The COPIES are the switchable half: an agency that does not
  -- want its ticked users copied on the executed instrument can say so, and
  -- this is where that takes effect. Applied here rather than in the caller
  -- because deed_delivery_target is the one thing every deed send asks, and a
  -- rule applied in the caller is a rule the other caller forgets.
  select nr.email, nr.display_name, nr.rung,
         true,
         (select auto_send from gate)
    from nr
   where (select channel from ch) = 'Agent referral'
     and public.notification_enabled(
           'agency', null, (select agency_id from a), 'deed_issued',
           case when nr.rung = 'referrer' then 'referrer' else 'ticked_users' end)

  union all

  -- EVERY OTHER RAIL, and the agency rail when the ladder is empty: the single
  -- contact, exactly as before. Direct stops at the tenant's own nominated
  -- contact and never reaches the route or branch mailbox.
  select
    case when (select channel from ch) = 'Direct'
         then (select email from d)
         else coalesce((select email from d), (select email from rc), (select email from c)) end,
    coalesce(
      nullif(btrim(coalesce((select agency_name from d), '')), ''),
      nullif(btrim(coalesce((select first_name from d), '') || ' ' || coalesce((select last_name from d), '')), ''),
      case when (select channel from ch) = 'Direct' then null
           else coalesce((select name from rc), (select name from c)) end
    ),
    case
      when (select application_id from d) is not null then 'delivery_contact'
      when (select channel from ch) = 'Direct' then 'delivery_contact'
      when (select id from rc) is not null then 'route_contact'
      else 'branch_contact'
    end,
    case when (select application_id from d) is not null
         then (select verified_at from d) is not null
         else true end,
    (select auto_send from gate)
  where not ((select channel from ch) = 'Agent referral' and exists (select 1 from nr))

  union all

  /* AND THE AGENCY'S OWN MAILBOX, WHERE SOMEBODY HAS SET ONE, ON OUR OWN
     ESTATE. Matt, 2026-10-02: "Opndoor's own agencies (like Regent): no
     email required. Signed deeds go to whoever sent the referral (plus
     the people already ticked to receive them, as now). The agency or a
     branch can optionally add an email that ALSO receives the deed;
     leave it blank and nothing is missing."

     It did not. The agency rail returned the ladder and stopped, and the
     second arm above only runs when the ladder is EMPTY, so a mailbox
     set on one of our agencies was stored, shown on the Agencies screen,
     and never written to. GR-FROST-OURS on dev is the proof: its branch
     holds mayfair@frost.example and the deed resolved to the referrer
     alone.

     ALSO, NOT INSTEAD, which is the word in the instruction. This arm
     adds to the ladder rather than replacing it, and only where the
     ladder is non-empty -- when it is empty the second arm already
     returns this same contact, and emitting it twice would make
     `deed_delivered_to` read like two recipients where there is one.

     THE SUPPLIER RAIL IS UNTOUCHED. Its channel is not 'Agent referral',
     so this arm returns nothing for it and the second arm above is still
     the whole answer: one address, the branch's own or the agency's by
     inheritance, which is exactly what Matt's supplier half asks for.

     `branch_contact` as the source, which is what the second arm calls
     the same row, so nothing downstream has a new word to learn. */
  select
    coalesce(rc.email, c.email),
    coalesce(rc.name, c.name),
    'branch_contact',
    true,
    (select auto_send from gate)
  from (select 1) one
  left join rc on true
  left join c on true
  where (select channel from ch) = 'Agent referral'
    and exists (select 1 from nr)
    and coalesce(btrim(coalesce(rc.email, c.email)), '') <> ''
    -- Not somebody who is already on the ladder: a Director whose own
    -- address is also the agency mailbox is one recipient, not two.
    and lower(btrim(coalesce(rc.email, c.email))) not in (select lower(btrim(nr.email)) from nr where nr.email is not null)
$function$;

-- ---------------------------------------------------------------------------
-- WHO STILL NEEDS ONE. Matt: "For supplier-estate agencies with no agency
-- email, show a clear warning on the supplier's Agencies tab and list them
-- on Reconciliation so Opndoor can add one."
--
-- THE AGENCY-LEVEL ADDRESS IS THE SUBJECT, not "can a deed reach
-- anybody". Under the corrected rule the agency email is the DEFAULT for
-- every branch, so an agency without one has no default -- and the next
-- office added under it inherits nothing. That is the thing to fix, and
-- it is why Kestrel Lettings appears here although both of its branches
-- hold a mailbox of their own.
--
-- Staff-only, like the rest of the reconciliation queue.
-- ---------------------------------------------------------------------------
create or replace function public.supplier_agencies_without_an_email()
returns table (
  agency_id    uuid,
  agency_name  text,
  partner_id   uuid,
  partner_name text,
  branches     integer,
  branches_covered integer
)
language sql stable security definer set search_path to '' as $$
  select a.id, a.name, p.id, p.name,
         (select count(*)::int from public.branches b
           where b.agency_id = a.id and not b.is_placeholder),
         (select count(*)::int from public.branches b
           where b.agency_id = a.id and not b.is_placeholder
             and exists (select 1 from public.agent_contacts c where c.branch_id = b.id))
  from public.agencies a
  join public.partners p on p.id = a.partner_id
  where not a.is_placeholder
    and public.is_supplier_estate(a.partner_id)
    and not exists (select 1 from public.agent_contacts c where c.agency_id = a.id)
    and public.is_aal2() and public.is_opndoor_staff()
  order by p.name, a.name
$$;

comment on function public.supplier_agencies_without_an_email() is
  'Agencies in a supplier''s estate with no AGENCY-level contact email. The agency email is the default for every branch (Matt, 2026-10-02), so an agency without one has no default and the next office added inherits nothing. Feeds the reconciliation queue.';

revoke all on function public.supplier_agencies_without_an_email() from public, anon;
grant execute on function public.supplier_agencies_without_an_email() to authenticated, service_role;
