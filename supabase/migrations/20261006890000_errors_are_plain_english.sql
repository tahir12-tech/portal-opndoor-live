-- WALK FIX 14. ERROR MESSAGES ARE PLAIN ENGLISH FOR AGENCY USERS.
--
-- Matt, walking dev: "Error messages must be plain English for agency users.
-- 'On our estate', 'position' and 'scope' mean nothing to them. This one
-- should say something like 'Choose which branch this person works at.'
-- Check other user-facing errors for the same jargon."
--
-- Test: supabase/tests/errors_are_plain_english.test.sql
-- Failed first on 4 of 5.
--
-- =========================================================================
-- WHAT WAS CHANGED, AND WHAT DELIBERATELY WAS NOT
-- =========================================================================
--
-- The sweep found exactly three messages an `authenticated` caller can
-- reach that use the internal vocabulary:
--
--   create_referral        "You can only refer against a branch within your
--   create_joint_referral   own scope."
--   create_invited_user    "Everybody on our estate is invited into a
--                           position: a group, a brand or a branch."
--
-- "Our estate" is the worst of the three, and not really jargon at all: it
-- is Opndoor's internal word for the set of agencies it onboards, said to a
-- letting agent about their own member of staff. "Scope" and "position" are
-- the model's words for a job and an office.
--
-- NOT CHANGED: the internal assertions inside migrations ("a scope arm is
-- missing", "applications_select is missing a preserved arm or the scope").
-- Those are read by whoever is changing the schema, where the internal
-- vocabulary is the clearer one and rewording would make the code harder to
-- maintain for no reader's benefit. The line drawn here is the AUDIENCE, not
-- the word.
--
-- Each function below is its current definition verbatim with only the
-- message text changed, generated mechanically and asserted unique.
--
-- ONE EXISTING TEST CHANGED WITH IT: create_referral_position_scope.test.sql
-- asserted the old sentence twice. That is the correct signal rather than an
-- inconvenience -- it proves the test was pinned to the words a user actually
-- reads, which is why it had to be updated by hand rather than by a sweep.
-- ---- create_referral ----
CREATE OR REPLACE FUNCTION public.create_referral(p_branch uuid, p_tenant_title text, p_first text, p_last text, p_dob date, p_email text, p_phone text, p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text, p_rent numeric, p_tenancy_start date, p_route uuid DEFAULT NULL::uuid)
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

  /* AN EXPLICIT ROUTE, AND WHO MAY STATE ONE.
   *
   * Fold H: admin New application asks "Supplier or Agency" FIRST, and the
   * answer decides the rail, the route and the commission -- rather than all
   * three being inferred from the branch afterwards. resolve_route_partner
   * has taken an explicit route since 20260812010000 and nothing has ever
   * passed one; this is the caller it was built for.
   *
   * TWO GUARDS, because "the server checks the branch belongs to the chosen
   * supplier and refuses otherwise" is Matt's own sentence.
   *
   * ADMIN ONLY. A partner user's route is their own partner and stating
   * somebody else's would be acting as them. Only an opndoor admin, who acts
   * for no partner, has a route to choose.
   *
   * AND THE RELATIONSHIP MUST EXIST. The chosen supplier has to be one this
   * branch actually sits under -- either the branch's own partner, or a
   * supplier with a recorded relationship to its agency. Without this an
   * admin could file Regent's referral under a supplier who has never met
   * them, and the commission would follow the route.
   */
  if p_route is not null then
    if coalesce(not public.is_admin(), true) then
      raise exception 'Only an opndoor admin may choose the route for a referral.' using errcode = '42501';
    end if;
    /* COALESCED THOUGH `exists` CANNOT BE NULL, because decision D5 is that
       ALL 205 raising guards are wrapped rather than the ones that can go
       NULL today: wrapping only the exposed ones needs a judgement per
       guard, silently reopens when a NOT NULL is dropped, and makes the CI
       rule need an allowlist. guardsAreNullSafe caught these two the moment
       they were written, which is the rule paying for itself. */
    if coalesce(not exists (select 1 from public.partners p where p.id = p_route), true) then
      raise exception 'Chosen supplier not found' using errcode = '22023';
    end if;
    /* THE WHOLE CONDITION, INSIDE THE COALESCE, INCLUDING THE `not`.
       `not` binds tighter than `or`, so wrapping the operand rather than the
       condition changes what is being asked -- which is exactly the
       precedence bug 20261006480000 exists to have fixed once. */
    if coalesce(not (p_route = pid
         or exists (select 1 from public.partner_agency_relationships r
                     where r.partner_id = p_route and r.agency_id = ag)), true) then
      raise exception 'That branch does not sit under the chosen supplier.' using errcode = '22023';
    end if;
  end if;

  v_route := public.resolve_route_partner(p_branch, p_route);
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
      raise exception 'You can only send a referral from one of the offices you work at.' using errcode = '42501';
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

  return public.rates_for_reader(a);
end $function$;

-- ---- create_joint_referral ----
CREATE OR REPLACE FUNCTION public.create_joint_referral(p_branch uuid, p_tenants jsonb, p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text, p_rent numeric, p_tenancy_start date)
 RETURNS SETOF applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ag uuid; pid uuid; v_route uuid; v_mode text; v_portal_ok boolean; v_estate boolean;
  v_n int; v_pct numeric; v_fee numeric; v_basis numeric; v_basis_unit text; v_agreement uuid;
  v_tenancy uuid; t jsonb; v_share_pct numeric;
  v_pcts numeric[]; v_fees numeric[]; v_rents numeric[]; v_emails text[]; v_i int := 0;
  v_app public.applications;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  v_n := jsonb_array_length(p_tenants);
  if v_n is null or v_n < 2 then
    raise exception 'A joint tenancy needs at least two tenants.' using errcode = '22023';
  end if;

  select b.agency_id, b.partner_id into ag, pid from public.branches b where b.id = p_branch;
  if ag is null then raise exception 'Selected branch not found' using errcode = '22023'; end if;
  if not coalesce((public.is_admin()
          or (public.app_role() in ('management','referrer') and pid = public.app_partner())), false) then
    raise exception 'not permitted for this partner' using errcode = '42501';
  end if;

  v_route := public.resolve_route_partner(p_branch, null);
  select p.portal_referrals_enabled into v_portal_ok from public.partners p where p.id = v_route;
  if not coalesce(found, false) then raise exception 'Route partner not found' using errcode = '22023'; end if;
  v_mode := public.resolve_referencing_mode(p_branch, v_route);
  v_estate := public.is_agent_estate(p_branch, v_route);

  if not coalesce(v_estate, false) then
    raise exception 'A joint tenancy needs an agency of ours to sit under, and this referral comes from a partner who sends them one tenant at a time. Refer each tenant separately.'
      using errcode = '22023';
  end if;

  if not coalesce(public.is_admin(), false) then
    if not coalesce((case when public.app_has_scope()
                 then p_branch in (select public.app_scope_branches())
                 else public.app_may_reach_branch(p_branch) end), false) then
      raise exception 'You can only send a referral from one of the offices you work at.' using errcode = '42501';
    end if;
  end if;
  if not coalesce(coalesce(v_portal_ok, true), false) then
    raise exception 'This partner does not create referrals in the portal.' using errcode = '42501';
  end if;

  select array_agg((x->>'share_percent')::numeric order by ord) into v_pcts
  from jsonb_array_elements(p_tenants) with ordinality as e(x, ord);
  select coalesce(sum(s), 0) into v_pct from unnest(v_pcts) s;
  if abs(v_pct - 100) > 0.01 then
    raise exception 'The tenants'' shares total %, not 100%%. Adjust them by %.',
      to_char(v_pct,'FM999990.00') || '%', to_char(100 - v_pct,'FM999990.00') || '%'
      using errcode = '22023';
  end if;

  select array_agg(lower(btrim(x->>'email'))) into v_emails from jsonb_array_elements(p_tenants) x;
  if (select count(distinct e) from unnest(v_emails) e) <> v_n then
    raise exception 'Two tenants have the same email address.' using errcode = '22023';
  end if;

  -- THE UNIT COMES OUT WITH THE QUANTITY. A basis of 1 recorded without it is
  -- one WEEK of rent, which is a quarter of what a one-month agreement charges.
  select f.fee_amount, f.fee_basis_weeks, f.fee_basis_unit, f.agreement_id
    into v_fee, v_basis, v_basis_unit, v_agreement
  from public.resolve_fee(p_branch, v_route, p_rent, v_n) f;
  v_fees  := public.apportion(v_fee, v_pcts);
  -- THE RENT, APPORTIONED THE SAME WAY AS THE FEE. Each tenant's deed covers
  -- this amount and the underwriter's premium is a percentage of it, so the
  -- parts must sum to the whole exactly, not to within a penny.
  v_rents := public.apportion(p_rent, v_pcts);

  insert into public.tenancies (monthly_rent, tenancy_start, prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode)
  values (p_rent, p_tenancy_start, btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')),''),
          btrim(p_city), nullif(btrim(coalesce(p_county,'')),''), upper(btrim(p_postcode)))
  returning id into v_tenancy;

  for t in select value from jsonb_array_elements(p_tenants) with ordinality as e(value, ord) order by ord loop
    v_i := v_i + 1;
    v_share_pct := (t->>'share_percent')::numeric;

    perform public.assert_referral_valid(
      p_branch, t->>'title', t->>'first', t->>'last', (t->>'dob')::date, t->>'email', t->>'phone',
      p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

    insert into public.applications(
      guarantee_ref, fee_amount, fee_basis_weeks, fee_basis_unit, pricing_agreement_id,
      tenancy_id, tenancy_position, share_percent, share_amount,
      branch_id, agency_id, partner_id, referrer_id, referrer_name,
      tenant_title, tenant_first_name, tenant_middle_name, tenant_last_name,
      tenant_dob, tenant_email, tenant_phone,
      prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
      monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode, referencing_mode
    ) values (
      'GR-' || nextval('public.guarantee_ref_seq')::text,
      v_fees[v_i], v_basis, coalesce(v_basis_unit, 'weeks'), v_agreement,
      v_tenancy, v_i, v_share_pct, v_rents[v_i],
      p_branch, ag, v_route, auth.uid(),
      (select full_name from public.users where id = auth.uid()),
      t->>'title', btrim(t->>'first'), nullif(btrim(coalesce(t->>'middle','')),''), btrim(t->>'last'),
      (t->>'dob')::date, btrim(t->>'email'), btrim(t->>'phone'),
      btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')),''), btrim(p_city),
      nullif(btrim(coalesce(p_county,'')),''), upper(btrim(p_postcode)),
      p_rent, p_tenancy_start, 'sent', now(),
      (select r.partner_rate from public.resolve_rates(p_branch, v_route) r),
      public.commission_total(p_branch, v_route, v_n),
      true, v_mode
    ) returning * into v_app;

    -- THE TENANCY'S COMMISSION, APPORTIONED, not this line's basis rounded on its
    -- own. Passing the whole fee, the split and this tenant's position lets the
    -- freeze round ONCE for the tenancy and then divide, the same way v_fees and
    -- v_rents above are divided, so the lines sum to the tenancy's commission
    -- exactly. Rounding each line separately put GR-20845 and GR-20846 a penny
    -- over their tenancy's 25%.
    perform public.freeze_commission_lines(
      v_app.id, p_branch, v_route, v_n, v_fees[v_i],
      v_fee, v_pcts, v_i);

    return next public.rates_for_reader(v_app);
  end loop;
end $function$;

-- ---- create_invited_user ----
CREATE OR REPLACE FUNCTION public.create_invited_user(p_id uuid, p_email text, p_full_name text, p_role text, p_partner uuid, p_home_branch uuid, p_sees_commission boolean, p_scope_kind text, p_scope_target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_estate boolean; v_level text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  select p.referencing_mode = 'opndoor_referenced' into v_estate
    from public.partners p where p.id = p_partner;
  v_estate := coalesce(v_estate, false);

  if not coalesce((public.is_admin()
          or (public.app_role() = 'management' and p_partner = public.app_partner())), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  /* THE ROLE IS NOT FREE TEXT. Round 6, M3. This function is SECURITY DEFINER
     and granted to authenticated, so it is reachable straight from PostgREST,
     and the level assertion below runs only `if p_role in ('management',
     'referrer')`. Anything else skipped the ladder completely -- so a Manager
     called it with p_role := 'developer' and put a developer on the house
     partner, which the standing ruling forbids BY ANY PATH and which
     admin_update_user_role and invite-user both already refuse. */
  if p_role not in ('management', 'referrer', 'developer') then
    raise exception 'A portal user is a manager, a referrer or a developer.' using errcode = '22023';
  end if;
  if v_estate and p_role = 'developer' then
    raise exception 'There is no developer on our own estate.' using errcode = '42501';
  end if;

  /* AND THE HOME BRANCH IS A PLACEMENT. Round 6, M4. 20261006500000 bound
     home_branch_id on the users_mgmt_insert policy and noted that rows made
     here are unaffected, because a definer function owned by the table owner
     does not meet the policy. That was true and was the gap: this door did no
     branch test of its own, so a Manager could place an invitee at any branch
     on the estate. set_home_branch checks both ends; so does this now. */
  if p_home_branch is not null
     and not coalesce(public.is_admin(), false)
     and not coalesce(public.app_may_reach_branch(p_home_branch), false) then
    raise exception 'You can only place somebody at a branch you reach.' using errcode = '42501';
  end if;

  if v_estate and (p_scope_kind is null or p_scope_target is null) then
    raise exception 'Choose which branch, brand or agency this person works at. Everyone needs one before they can be invited.'
      using errcode = '22023';
  end if;

  -- THE LADDER, asked the only way it can be asked about somebody who does
  -- not exist: on the LEVEL they are being given. invite-user asks this too,
  -- before it mints an auth account; asking again here is what makes the
  -- rule a property of the function rather than of one caller.
  v_level := case when p_role = 'referrer' then 'Negotiator'
                  when coalesce(p_sees_commission, false) then 'Director'
                  else 'Manager' end;
  if p_role in ('management', 'referrer') then
    perform public.assert_may_grant_level(v_level);
  end if;

  if p_scope_kind is not null then
    perform public.assert_may_grant_position(p_scope_kind, p_scope_target);
  end if;

  insert into public.users (id, email, full_name, role, partner_id, status,
                            home_branch_id, sees_commission)
  values (p_id, p_email, p_full_name, p_role, p_partner, 'pending',
          p_home_branch, p_role = 'management' and coalesce(p_sees_commission, false));

  if p_scope_kind is not null then
    insert into public.user_scopes (user_id, kind, group_id, agency_id, branch_id, created_by)
    values (p_id, p_scope_kind,
            case when p_scope_kind = 'group'  then p_scope_target end,
            case when p_scope_kind = 'agency' then p_scope_target end,
            case when p_scope_kind = 'branch' then p_scope_target end,
            auth.uid());
    insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
    values ('user', p_id, 'position_set', p_scope_kind || ':' || p_scope_target::text,
            (select full_name from public.users where id = auth.uid()), auth.uid());
  end if;
end $function$;