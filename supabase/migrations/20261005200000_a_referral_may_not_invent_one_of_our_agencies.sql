-- A REFERRAL MAY NOT INVENT ONE OF OUR AGENCIES.
--
-- 20261004160000 ruled that our estate is set up by us, and closed the two
-- direct routes: agencies_insert and branches_insert now refuse any non-admin
-- insert whose partner is the house route. That migration is correct and it did
-- not finish the job.
--
-- create_referral_target is SECURITY DEFINER. It is the resolve-or-create the
-- referral form submits through, and it was made DEFINER on purpose, for a
-- reason that is still good: a referrer has to be able to write the agency
-- default contact, and RLS limits contact writes to admin and management. But
-- DEFINER runs as the owner, and the owner bypasses row level security, so the
-- two policies above are not consulted for the inserts inside this function.
--
-- The effect, proved on dev as a Regent manager before this migration:
--
--   select public.create_referral_target(
--     'Totally Invented Agency', 'Invented Branch', 'x@invented.test');
--
--   agency                   | branch           | review_state   | partner
--   Totally Invented Agency  | Invented Branch  | pending_review | opndoor-agents
--
-- An agency user filing a referral could create an agency and a branch on our
-- house route by typing names into the form. Not a competitor's data read (RLS
-- on select holds: that manager can read exactly one agency, their own) but a
-- write into the estate that decides commission, deed delivery and scope, made
-- by whoever happened to be sending a referral, and landing as pending_review
-- for somebody at Opndoor to puzzle over.
--
-- RESOLVING IS NOT CREATING, and only creating is refused. The form submits an
-- agency and a branch by NAME and needs the branch id back, so the lookup half
-- of this function is the normal path for every referral on our estate and must
-- keep working exactly as it does. What is refused is the fall-through where the
-- name matched nothing and the function would have invented it.
--
-- The client half of the same ruling is in AgentBranchPicker: an agency user is
-- never offered an agency search or a create-on-the-fly option at all, so this
-- error is the backstop rather than the thing the reader meets. It carries a
-- message a person could act on regardless, because a backstop that fires is
-- being read by somebody who did not expect it.
--
-- BOTH OVERLOADS, and finding that out is the reason this migration is longer
-- than it looks. create_referral_target exists twice, at eight parameters and at
-- nine (the ninth is p_partner_slug, for an opndoor admin creating under an
-- explicitly chosen partner). Both are SECURITY DEFINER and both insert. The
-- edge function passes p_partner_slug, so the one the product actually calls is
-- the NINE, and a guard on the eight alone would have read like a fix and
-- changed nothing that matters. Both are patched here.
--
-- Because both carry defaults for everything after the second parameter, a call
-- like create_referral_target('a','b') is ambiguous and Postgres refuses to
-- choose. That is pre-existing and is left alone: dropping either signature is a
-- bigger change than this migration should make on cutover week, and with both
-- guarded the refusal holds whichever one a caller resolves to.
--
-- AN ADMIN IS STILL AN ADMIN. is_admin() is untouched, exactly as in
-- 20261004160000: Opndoor sets up structure, and on the nine-parameter path
-- creating under a named partner IS the admin's job. The guard asks whether the
-- CALLER is an admin, not only which partner the row lands under.

create or replace function public.create_referral_target(
  p_agency text, p_branch text,
  p_agency_email text default null, p_agency_contact_name text default null, p_agency_phone text default null,
  p_branch_email text default null, p_branch_contact_name text default null, p_branch_phone text default null
) returns uuid
language plpgsql security definer set search_path to ''
as $function$
declare pid uuid; me uuid := auth.uid(); who text; ag_id uuid; br_id uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  pid := public.app_partner();
  if pid is null then
    raise exception 'Creating an agency or branch on the fly is only available to partner users; opndoor admins should pick an existing branch.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_agency,'')) = '' or btrim(coalesce(p_branch,'')) = '' then
    raise exception 'Agency and branch are required' using errcode = '22023';
  end if;

  who := coalesce((select full_name from public.users where id = me), 'a referrer');

  select id into ag_id from public.agencies where partner_id = pid and lower(name) = lower(btrim(p_agency)) limit 1;
  if ag_id is null then
    -- THE GUARD. Mirrors agencies_insert, which this function's DEFINER rights
    -- would otherwise walk straight past, including its is_admin() arm.
    if not public.is_admin() and public.is_our_estate_partner(pid) then
      raise exception 'A new agency is set up by opndoor, not on a referral. Choose one of your own agencies.'
        using errcode = '42501';
    end if;
    insert into public.agencies(name, partner_id, review_state, created_by)
    values (btrim(p_agency), pid, 'pending_review', me) returning id into ag_id;
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('agency', ag_id, 'created', btrim(p_agency), who, me);
  end if;

  select id into br_id from public.branches where agency_id = ag_id and lower(name) = lower(btrim(p_branch)) limit 1;
  if br_id is null then
    -- Mirrors branches_insert, for the same reason.
    if not public.is_admin() and public.is_our_estate_partner(pid) then
      raise exception 'A new office is set up by opndoor, not on a referral. Choose one of your own offices.'
        using errcode = '42501';
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

comment on function public.create_referral_target(text,text,text,text,text,text,text,text) is
  'Resolve the referral target by name, creating the agency or branch only where inventing one mid-referral is the product. On the house route it resolves and never creates: our estate is set up by us. SECURITY DEFINER for the contact write, so the estate guard is written out here rather than left to RLS, which DEFINER bypasses.';

revoke execute on function public.create_referral_target(text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.create_referral_target(text,text,text,text,text,text,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- AND THE ONE THE PRODUCT ACTUALLY CALLS.
--
-- Body lifted verbatim from 20260704184047 (#69 root: store the provided contact
-- name rather than defaulting it to the email). The only changes are the two
-- guards, marked. Nothing else is retyped from memory: the admin arm, the slug
-- resolution, the Head office default and the review_state rules are the same
-- statements in the same order.
-- ---------------------------------------------------------------------------
create or replace function public.create_referral_target(
  p_agency text, p_branch text,
  p_agency_email text default null, p_agency_contact_name text default null, p_agency_phone text default null,
  p_branch_email text default null, p_branch_contact_name text default null, p_branch_phone text default null,
  p_partner_slug text default null
) returns uuid
language plpgsql security definer set search_path to ''
as $function$
declare
  pid uuid; me uuid := auth.uid(); who text;
  ag_id uuid; br_id uuid; ag_new boolean := false; br_new boolean := false;
  v_admin boolean := public.is_admin();
  v_state text;
  v_slug text := nullif(btrim(coalesce(p_partner_slug,'')), '');
  v_slug_id uuid;
  v_branch text := coalesce(nullif(btrim(coalesce(p_branch,'')), ''), 'Head office');
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if btrim(coalesce(p_agency,'')) = '' then raise exception 'Agency is required' using errcode = '22023'; end if;
  who := coalesce((select full_name from public.users where id = me), 'a referrer');
  pid := public.app_partner();
  if pid is not null then
    v_state := 'pending_review';
    select id into ag_id from public.agencies where partner_id = pid and lower(name) = lower(btrim(p_agency)) limit 1;
  else
    if not v_admin then raise exception 'Not permitted.' using errcode = '42501'; end if;
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
    if not v_admin and public.is_our_estate_partner(pid) then
      raise exception 'A new agency is set up by opndoor, not on a referral. Choose one of your own agencies.'
        using errcode = '42501';
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
    if not v_admin and public.is_our_estate_partner(pid) then
      raise exception 'A new office is set up by opndoor, not on a referral. Choose one of your own offices.'
        using errcode = '42501';
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

comment on function public.create_referral_target(text,text,text,text,text,text,text,text,text) is
  'The resolve-or-create the referral form submits through. Creates only where inventing an agency mid-referral is the product: a supplier, or an opndoor admin under a named partner. On our own estate it resolves and never creates.';

revoke all on function public.create_referral_target(text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_referral_target(text, text, text, text, text, text, text, text, text) to authenticated;
