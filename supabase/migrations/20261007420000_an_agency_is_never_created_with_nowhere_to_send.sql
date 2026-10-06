-- =========================================================================
-- AN AGENCY OR BRANCH IS NEVER CREATED WITH NOWHERE TO SEND A DEED.
--
-- Matt, 2026-10-02: "A contact email is required when any agency or
-- branch is created, in any estate, so one always exists; creating one
-- without it is refused with a clear message."
--
-- WHAT WAS ALREADY TRUE. `admin_add_agency` has required one since
-- 20261006470000. Nothing else did:
--
--   admin_add_branch                took one and allowed it blank
--   admin_create_agency_and_branch  did not take one at all
--   create_referral_target          took one and allowed it blank, on
--                                   both the agency and the office arm
--
-- HOW THE BRANCH HALF IS READ, and this is the one judgement in here. A
-- branch with no contacts of its own uses its AGENCY's: that is what
-- `effectiveContacts` has always done, and what the deed panel prints as
-- "agency default for X". The clause that governs is "so one always
-- exists", and for a branch under an agency that has a contact, one
-- does. So a branch is refused only when its agency has none either --
-- which is exactly the case that leaves a deed with nowhere to go, and
-- which the "No agent contact" warning already shouts about after the
-- fact. Requiring a second address per office would undo the agency
-- default rather than add to it. If Matt wants the stricter reading it
-- is one condition in two functions; it is in docs/QUEUE.md.
--
-- WHAT IS NOT DONE: no backfill, and no table constraint. He asked for
-- the rule at CREATION and for a list of what is already missing one;
-- the list is in QUEUE.md. A constraint on the tables would also mean
-- rewriting 171 fixture inserts across 72 pgTAP files, which buys less
-- than it costs while every creation door is shut.
-- =========================================================================

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
  if v_email = '' and not coalesce((select exists (
       select 1 from public.agent_contacts c where c.agency_id = p_agency_id)), false) then
    raise exception 'A contact email is required. This agency has none for the branch to fall back on, so a deed issued here would have nowhere to go.'
      using errcode = '22023';
  end if;
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
    /* AND IT ARRIVES WITH SOMEWHERE TO SEND A DEED. Matt, 2026-10-02: "A
       contact email is required when any agency or branch is created, in
       any estate." This is the on-the-fly path, where an agency is born
       in the middle of a referral; it took the address when it was given
       one and created a contactless agency when it was not. */
    if coalesce(btrim(p_agency_email),'') = '' then
      raise exception 'A contact email is required for a new agency, so the deed has somewhere to go.'
        using errcode = '22023';
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
    /* A NEW OFFICE UNDER AN AGENCY THAT HAS NO CONTACT. The same rule as
       admin_add_branch: its own address, or the agency's to inherit, and
       an office with neither is the one that leaves a deed with nowhere
       to go. An agency created a moment ago in this same call always has
       one, because of the check above. */
    /* `ag_new` COUNTS AS COVERED. The contacts are written at the END of
       this function, after both rows exist, so an agency created a moment
       ago in this same call has none YET -- and the check above has
       already refused the call unless an agency email was supplied, so it
       is about to. Reading the table here instead would refuse every
       on-the-fly agency's first office, which is every one of them. */
    if coalesce(btrim(p_branch_email),'') = '' and not ag_new
       and not coalesce((select exists (
             select 1 from public.agent_contacts c where c.agency_id = ag_id)), false) then
      raise exception 'A contact email is required for a new office, because this agency has none to fall back on.'
        using errcode = '22023';
    end if;
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

-- ---------------------------------------------------------------------------
-- AND THE EIGHT-PARAMETER OVERLOAD, which no caller can address today and
-- which estate_referral_may_not_invent_an_agency keeps guarded "for the day
-- somebody drops the nine". A rule the spare copy does not carry is a rule
-- that disappears on that day.
-- ---------------------------------------------------------------------------
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
    /* AND IT ARRIVES WITH SOMEWHERE TO SEND A DEED. The same rule as the
       nine-parameter version beside it (Matt, 2026-10-02). This overload
       cannot be addressed today -- eight arguments or fewer match both and
       Postgres refuses the call as "not unique" -- and it is kept guarded
       for the day somebody drops the nine, which is the whole reason it
       still exists. A guard it does not share is a guard that disappears
       on that day. */
    if coalesce(btrim(p_agency_email),'') = '' then
      raise exception 'A contact email is required for a new agency, so the deed has somewhere to go.'
        using errcode = '22023';
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
    /* The agency's contact is written at the end of this function too, so
       an agency supplied with an email in this same call counts as
       covered; see the note in the nine-parameter version. */
    if coalesce(btrim(p_branch_email),'') = ''
       and coalesce(btrim(p_agency_email),'') = ''
       and not coalesce((select exists (
             select 1 from public.agent_contacts c where c.agency_id = ag_id)), false) then
      raise exception 'A contact email is required for a new office, because this agency has none to fall back on.'
        using errcode = '22023';
    end if;
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
-- AND THE ONBOARDING CALL, which took no contact at all. Dropped and
-- recreated rather than replaced, because it gains parameters.
--
-- NAMED LIKE create_referral_target's, deliberately: the two are the two
-- ways an agency is born, and a reader moving between them should not
-- have to learn a second vocabulary for the same three fields.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_create_agency_and_branch(text, text, text, numeric, numeric, text, uuid);

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

  -- The contact, before anything is written, so a refusal leaves nothing behind.
  if v_email = '' then
    raise exception 'A contact email is required, so a deed issued for this agency has somewhere to go.'
      using errcode = '22023';
  end if;
  if v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Enter a valid agency contact email.' using errcode = '22023';
  end if;

  select id into v_partner from public.partners where slug = coalesce(nullif(btrim(p_partner_slug), ''), 'opndoor-agents');
  if v_partner is null then raise exception 'Partner not found.' using errcode = '22023'; end if;

  if p_group_id is not null and not exists (
    select 1 from public.agency_groups g where g.id = p_group_id and g.partner_id = v_partner
  ) then
    raise exception 'That group is not under this partner.' using errcode = '22023';
  end if;

  insert into public.agencies (partner_id, name, review_state, partner_rate, agent_rate, group_id)
  values (v_partner, btrim(p_agency_name), 'confirmed', p_partner_rate, p_agent_rate, p_group_id)
  returning id into v_agency;

  insert into public.agent_contacts (agency_id, partner_id, name, email, phone, is_primary, created_by)
  values (v_agency, v_partner, btrim(coalesce(p_agency_contact_name, '')), v_email,
          nullif(btrim(coalesce(p_agency_phone, '')), ''), true, v_me);

  -- Optional: a skeleton agency waits for its manager to add branches. Its
  -- offices inherit the contact created above, so each one still has
  -- somewhere to send a deed from the moment it exists.
  if coalesce(btrim(p_branch_name), '') <> '' then
    insert into public.branches (agency_id, partner_id, name, area, review_state)
    values (v_agency, v_partner, btrim(p_branch_name), nullif(btrim(coalesce(p_branch_area, '')), ''), 'confirmed')
    returning id into v_branch;
  end if;

  return query select v_agency, v_branch;
end $function$;

revoke all on function public.admin_create_agency_and_branch(text, text, text, numeric, numeric, text, uuid, text, text, text) from public, anon;
grant execute on function public.admin_create_agency_and_branch(text, text, text, numeric, numeric, text, uuid, text, text, text) to authenticated, service_role;

comment on function public.admin_create_agency_and_branch(text, text, text, numeric, numeric, text, uuid, text, text, text) is
  'Admin onboarding: an agent-rail agency, its contact and its first office in one call. The contact email is required (Matt, 2026-10-02); the office inherits it.';
