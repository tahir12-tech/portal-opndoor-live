-- R4. THE COMMISSION RATES ARE NOT IN THE REPLY.
--
-- 20260811180000_revoke_commission_columns.sql took SELECT on `partner_rate`
-- and `agent_rate` away from `authenticated`, and
-- `applications_column_grants.test.sql` asserts that revoke still holds. It
-- does. The table is shut.
--
-- Six SECURITY DEFINER functions are declared `returns applications`, and a
-- composite carries every column. A definer function runs as the OWNER, so
-- the column revoke does not apply inside it, and the whole row goes back --
-- rates included. The front door was locked and the reply posts the key
-- through it.
--
-- MEASURED on a clean local apply, as a Negotiator calling create_referral:
--
--     reply partner_rate   0.3000
--     reply agent_rate     0.1000
--
-- Test: supabase/tests/the_rates_are_not_in_the_reply.test.sql
-- Failed first on 3 of 9, with 6 regression guards passing throughout.
--
-- SIX, NOT FOUR. The finding said four. Enumerated against the catalogue --
-- `returns applications` or `setof applications`, SECURITY DEFINER, and
-- executable by `authenticated` -- it is six. The other six functions with
-- that return type are not callable by `authenticated` at all, so they are
-- left alone rather than changed on the strength of their signature.
--
-- =========================================================================
-- THE SHAPE: redact the REPLY, never the RECORD
-- =========================================================================
--
-- The stored rates are what every commission figure is computed from. A fix
-- that blanked the column instead of the reply would silently destroy the
-- money on every referral a negotiator creates, and it would look like it
-- worked. Assertions 8 and 9 of the test exist for exactly that, and they are
-- the reason this is a function applied AT THE RETURN rather than anything
-- touching the row.
--
-- One helper, and six one-line changes. Each function below is its current
-- definition verbatim with a single `return` rewritten, so nothing else about
-- any of them moves.

-- -------------------------------------------------------------------------
-- THE HELPER. Not `security definer`: it must answer for the CALLER, and
-- may_see_commission() reads the caller's own level. A definer helper here
-- would answer for the owner and hand the rates to everybody -- the exact
-- mistake that made the six functions leak in the first place.
-- -------------------------------------------------------------------------
create or replace function public.rates_for_reader(p public.applications)
returns public.applications
language plpgsql stable
set search_path to ''
as $function$
begin
  -- Fail CLOSED: a NULL from may_see_commission() redacts.
  if coalesce(public.may_see_commission(), false) then
    return p;
  end if;
  p.partner_rate := null;
  p.agent_rate   := null;
  return p;
end $function$;

comment on function public.rates_for_reader(public.applications) is
  'Blanks partner_rate and agent_rate from a row being RETURNED to a caller who may not see commission. The stored row is never touched: every commission figure is computed from the stored rates, so redacting the record rather than the reply would destroy the money silently. SECURITY INVOKER on purpose -- it must judge the caller, not the owner.';

revoke all on function public.rates_for_reader(public.applications) from public, anon;
grant execute on function public.rates_for_reader(public.applications) to authenticated, service_role;

-- -------------------------------------------------------------------------
-- THE SIX, each verbatim but for its return.
-- -------------------------------------------------------------------------
-- ---- amend_tenancy_start ----
CREATE OR REPLACE FUNCTION public.amend_tenancy_start(p_app uuid, p_new_start date)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications; r text; owned boolean;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_new_start is null then raise exception 'A new tenancy start date is required' using errcode = '22023'; end if;
  if p_new_start < date '2000-01-01' or p_new_start > (current_date + interval '5 years')::date then
    raise exception 'Tenancy start date is out of range' using errcode = '22023';
  end if;
  select * into a from public.applications where id = p_app;
  if not coalesce(found, false) then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := coalesce(a.referrer_id = auth.uid(), false);
  if not coalesce((public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and public.app_may_reach_branch(a.branch_id))
          or (r = 'referrer'   and owned)), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if not coalesce(public.can_amend_tenancy_start(r, a.status, owned, a.deed_state), false) then
    raise exception 'amend not permitted for this role and status' using errcode = '42501';
  end if;
  -- Date only. expiry_date is generated from tenancy_start; the deed lifecycle is
  -- handled by the amend-tenancy-start Edge Function, not here.
  update public.applications set tenancy_start = p_new_start where id = p_app returning * into a;
  return public.rates_for_reader(a);
end $function$;

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

  return public.rates_for_reader(a);
end $function$;

-- ---- decline_application ----
CREATE OR REPLACE FUNCTION public.decline_application(p_ref text, p_reason text DEFAULT NULL::text)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications; who text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where guarantee_ref = p_ref;
  if not coalesce(found, false) then raise exception 'application not found'; end if;
  if not coalesce(public.is_opndoor_staff(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  if a.status <> 'referencing' then
    raise exception 'Only an application awaiting a decision can be declined.' using errcode = '42501';
  end if;

  update public.applications
    set status = 'declined', decided_at = now(), decided_by_kind = 'staff',
        decline_reason = nullif(btrim(coalesce(p_reason,'')), '')
    where id = a.id returning * into a;

  who := coalesce((select full_name from public.users where id = auth.uid()), 'an administrator');
  insert into public.activity_log(application_id, kind, message, actor, visibility)
  values (a.id, 'application_declined',
    'Application declined by ' || who
      || case when a.decline_reason is not null then ' (' || a.decline_reason || ')' else '' end || '.',
    who, 'business');
  return public.rates_for_reader(a);
end $function$;

-- ---- mark_withdrawn ----
CREATE OR REPLACE FUNCTION public.mark_withdrawn(p_ref text, p_reason text, p_note text)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications; r text; owned boolean; who text; lbl text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where guarantee_ref = p_ref;
  if not coalesce(found, false) then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := coalesce(a.referrer_id = auth.uid(), false);
  if not coalesce((public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and public.app_may_reach_branch(a.branch_id))
          or (r = 'referrer' and owned)), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if a.status <> 'sent' then raise exception 'Only an application at Sent (before payment) can be withdrawn.' using errcode = '42501'; end if;
  if p_reason not in ('another_guarantor','tenancy_fell_through','duplicate','other') then
    raise exception 'Invalid withdrawal reason' using errcode = '22023';
  end if;
  if p_reason = 'other' and coalesce(btrim(p_note), '') = '' then
    raise exception 'A note is required when the reason is Other.' using errcode = '22023';
  end if;
  update public.applications
    set status = 'withdrawn', withdrawn_at = now(), withdrawn_reason = p_reason,
        withdrawn_note = nullif(btrim(coalesce(p_note,'')), ''), withdrawn_by = auth.uid()
    where id = a.id returning * into a;
  who := coalesce((select full_name from public.users where id = auth.uid()), 'a user');
  lbl := case p_reason
           when 'another_guarantor' then 'tenant found another guarantor'
           when 'tenancy_fell_through' then 'tenancy fell through'
           when 'duplicate' then 'duplicate referral'
           else 'other' end;
  insert into public.activity_log(application_id, kind, message, actor, visibility)
  values (a.id, 'withdrawn',
    'Application withdrawn (' || lbl || ')' || case when a.withdrawn_note is not null then ': ' || a.withdrawn_note else '' end || '.',
    who, 'business');
  return public.rates_for_reader(a);
end $function$;

-- ---- set_application_status ----
CREATE OR REPLACE FUNCTION public.set_application_status(p_app uuid, p_status text)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_status not in ('sent','paid','deed') then raise exception 'invalid status'; end if;
  select * into a from public.applications where id = p_app;
  if not coalesce(found, false) then raise exception 'application not found'; end if;
  -- opndoor admin only. Real Stripe/PandaDoc transitions run through service-role RPCs.
  if not coalesce(public.is_opndoor_staff(), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  update public.applications set
    status         = p_status,
    paid_at        = case when p_status in ('paid','deed') then coalesce(paid_at, now())      else paid_at end,
    deed_issued_at = case when p_status = 'deed'           then coalesce(deed_issued_at, now()) else deed_issued_at end,
    issue_date     = case when p_status = 'deed'           then coalesce(issue_date, now()::date) else issue_date end
  where id = p_app returning * into a;
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
      raise exception 'You can only refer against a branch within your own scope.' using errcode = '42501';
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