-- NOT BINDS TIGHTER THAN AND, WHICH I KNEW.
--
-- 20261006470000 wrapped the operand of each guard:
--
--   if not X then            ->   if not coalesce(X, false) then
--
-- which is right when X is one term, and wrong when it is not. `not` binds
-- tighter than `and`, so in
--
--   if not public.is_admin() and not (public.app_role() = 'management' and ...)
--
-- the operand of `not` is `public.is_admin()` ALONE, and the condition is
-- `(not A) and (not B)`. Taking everything up to `then` as the operand and
-- wrapping it produced `not (A and not B)`, which is a different expression.
--
-- This is the second time this session that a mechanical edit has moved what
-- `not` applies to; 20261006440000 was the first. The un-wrap proof did not
-- catch it, and the reason is worth writing down: that proof shows the edit is
-- REVERSIBLE -- delete the inserted text and the original returns byte for
-- byte -- which says nothing about whether it is SEMANTICS-PRESERVING. A
-- reversible edit can still re-associate the operators around it. The only
-- edit that cannot is one that wraps a WHOLE expression, and that is the form
-- used here:
--
--   if <cond> then           ->   if coalesce(<cond>, true) then
--
-- The entire condition goes inside the parentheses, `not` keeps the operand it
-- already had, and NULL still becomes a refusal because for a raising guard
-- "I do not know" must mean raise. This form is correct for every shape, and
-- it is what the CI check now requires wherever a condition is compound.
--
-- Six guards in four functions. All six were left OVER-strict by 470000, never
-- under: wherever the original raised, the mangled version also raised. So dev
-- refused legitimate work -- agent_rail_funnel and create_referral_target both
-- stopped answering at all -- and opened nothing. The two pgTAP suites that
-- cover them failed on the next run, which is the whole reason
-- the_work_still_works.test.sql exists.

-- agent_rail_funnel(text)
CREATE OR REPLACE FUNCTION public.agent_rail_funnel(p_slug text DEFAULT NULL::text)
 RETURNS TABLE(invited integer, registered integer, details integer, fee integer, documents integer, submitted integer, approved integer, declined integer, guarantee integer, deed integer, stuck_invited integer, stuck_fee integer, stuck_referencing integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pid uuid;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_slug is not null then
    if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
    select id into pid from public.partners where slug = p_slug;
  else
    pid := public.app_partner();
  end if;
  if pid is null then return; end if;
  if coalesce(not public.is_admin() and not (public.app_role() = 'management' and pid = public.app_partner()), true) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return query
  with base as (
    select
      a.status,
      a.branch_id,
      (a.applicant_id is not null) as is_registered,
      (coalesce(btrim(a.prop_addr1),'') <> '' and coalesce(a.monthly_rent,0) > 0 and a.tenancy_start is not null) as prop_done,
      exists (select 1 from public.application_profiles pr where pr.application_id = a.id and pr.nationality is not null) as about_done,
      exists (select 1 from public.application_eligibility_payments ep where ep.application_id = a.id and ep.paid_at is not null) as fee_done,
      exists (select 1 from public.application_documents d where d.application_id = a.id and d.kind = 'id_document') as id_done,
      (exists (select 1 from public.application_documents d where d.application_id = a.id and d.kind = 'bank_connection')
        or (select count(*) from public.application_documents d where d.application_id = a.id and d.kind = 'bank_statement') >= 3) as fin_done,
      (select max(ti.created_at) from public.tenant_invites ti where ti.application_id = a.id) as invited_at,
      (select pr.completed_at from public.application_profiles pr where pr.application_id = a.id) as submitted_at
    from public.applications a
    where a.livemode and a.partner_id = pid
      and a.referencing_mode = 'opndoor_referenced'
      and (public.is_admin()
           or (public.app_role() = 'management'
               and public.app_may_reach_branch(a.branch_id)))
  )
  select
    count(*)::int,
    count(*) filter (where is_registered)::int,
    count(*) filter (where is_registered and prop_done and about_done)::int,
    count(*) filter (where fee_done)::int,
    count(*) filter (where id_done and fin_done)::int,
    count(*) filter (where status in ('referencing','sent','paid','deed','declined'))::int,
    count(*) filter (where status in ('sent','paid','deed'))::int,
    count(*) filter (where status = 'declined')::int,
    count(*) filter (where status in ('paid','deed'))::int,
    count(*) filter (where status = 'deed')::int,
    count(*) filter (where status = 'draft' and not is_registered and invited_at < now() - interval '7 days')::int,
    count(*) filter (where status = 'draft' and is_registered and not fee_done and invited_at < now() - interval '7 days')::int,
    count(*) filter (where status = 'referencing' and submitted_at < now() - interval '7 days')::int
  from base;
end $function$;

-- create_referral(uuid,text,text,text,date,text,text,text,text,text,text,text,numeric,date)
CREATE OR REPLACE FUNCTION public.create_referral(p_branch uuid, p_tenant_title text, p_first text, p_last text, p_dob date, p_email text, p_phone text, p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text, p_rent numeric, p_tenancy_start date)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.applications; ag uuid; pid uuid; v_route uuid; v_mode text;
  v_portal_ok boolean; prate numeric; arate numeric;
  v_fee numeric; v_basis numeric; v_basis_unit text; v_agreement uuid; v_estate boolean;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  perform public.assert_referral_valid(
    p_branch, p_tenant_title, p_first, p_last, p_dob, p_email, p_phone,
    p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

  select b.agency_id, b.partner_id into ag, pid from public.branches b where b.id = p_branch;
  if ag is null then raise exception 'Selected branch not found' using errcode = '22023'; end if;

  if not coalesce((public.is_admin()
          or (public.app_role() in ('management','referrer') and pid = public.app_partner())), false) then
    raise exception 'not permitted for this partner' using errcode = '42501';
  end if;

  v_route := public.resolve_route_partner(p_branch, null);
  select p.portal_referrals_enabled into v_portal_ok from public.partners p where p.id = v_route;
  if not coalesce(found, false) then raise exception 'Route partner not found' using errcode = '22023'; end if;

  -- WHO CHECKS THE TENANT. The agency's own mode if it has said, else the route
  -- partner's. This is the journey, and it is what gets frozen onto the row.
  v_mode := public.resolve_referencing_mode(p_branch, v_route);
  -- WHAT KIND OF RELATIONSHIP. Never overridden by the answer above.
  v_estate := public.is_agent_estate(p_branch, v_route);

  -- Position ladder: a property of the ESTATE. An agency's staff refer against
  -- their own branches whether or not Opndoor checks their tenants.
  if coalesce(not public.is_admin() and v_estate, true) then
    if not coalesce((case
              when public.app_has_scope()
                then p_branch in (select public.app_scope_branches())
              else public.app_may_reach_branch(p_branch) end), false) then
      raise exception 'You can only refer against a branch within your own scope.' using errcode = '42501';
    end if;
  end if;

  -- THE PRICE. Rail-agnostic already: the agreement decides, standard terms are
  -- one month's rent exactly, a negotiated basis is weeks of rent.
  -- THE UNIT COMES OUT WITH THE QUANTITY. A basis of 1 recorded without it is
  -- one WEEK of rent, which is a quarter of what a one-month agreement charges.
  select f.fee_amount, f.fee_basis_weeks, f.fee_basis_unit, f.agreement_id
    into v_fee, v_basis, v_basis_unit, v_agreement
  from public.resolve_fee(p_branch, v_route, p_rent, 1) f;

  -- COMMISSION: the ESTATE's additive split, or the flat snapshotted rates.
  select r.partner_rate, r.agent_rate into prate, arate
  from public.resolve_rates(p_branch, v_route) r;
  if v_estate then
    arate := public.commission_total(p_branch, v_route, 1);
  end if;

  if not coalesce(coalesce(v_portal_ok, true), false) then
    raise exception 'This partner does not create referrals in the portal.' using errcode = '42501';
  end if;

  insert into public.applications(
    guarantee_ref, fee_amount, fee_basis_weeks, fee_basis_unit, pricing_agreement_id,
    branch_id, agency_id, partner_id, referrer_id, referrer_name,
    tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
    prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
    monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode,
    referencing_mode
  ) values (
    'GR-' || nextval('public.guarantee_ref_seq')::text,
    v_fee, v_basis, coalesce(v_basis_unit, 'weeks'), v_agreement,
    p_branch, ag, v_route, auth.uid(),
    (select full_name from public.users where id = auth.uid()),
    p_tenant_title, btrim(p_first), btrim(p_last), p_dob, btrim(p_email), btrim(p_phone),
    btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')), ''), btrim(p_city),
    nullif(btrim(coalesce(p_county,'')), ''), upper(btrim(p_postcode)),
    p_rent, p_tenancy_start, 'sent', now(), prate, arate, true,
    -- THE JOURNEY, frozen. create-referral forks on this: pre_referenced goes
    -- straight to a Stripe session, opndoor_referenced sends an invite.
    v_mode
  ) returning * into a;

  -- The basis is this applicant's own fee. For a tenancy of one that is the
  -- whole fee; create_joint_referral passes each applicant's share instead.
  if v_estate then
    perform public.freeze_commission_lines(a.id, p_branch, v_route, 1, v_fee);
  end if;

  return a;
end $function$;

-- create_referral_target(text,text,text,text,text,text,text,text)
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

-- create_referral_target(text,text,text,text,text,text,text,text,text)
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

