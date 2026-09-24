-- create_referral prices from the AGREEMENT and resolves the route AGENCY-FIRST.
--
-- M3: the mode an application is snapshotted with is now the agency's own if it
-- has one, else the route partner's. Everything downstream keeps reading
-- applications.referencing_mode, so only this one line had to learn about the
-- override. Inert until an agency sets one.
--
-- It also snapshots the SPLIT, the FEE and the AGREEMENT that priced it.
--
-- M1: the fee stops being implicit. It is written at creation like the rate is,
-- and for now it is exactly monthly_rent on a 4.35-week (one month) basis, so
-- nothing prices differently. When agreements vary the basis this is the single
-- line that changes.
--
-- On the agent rail a referral can now pay several payees, so the frozen record
-- has to name them. The scalar applications.agent_rate is KEPT and written as the
-- TOTAL of the lines, so every existing consumer (League, Dashboard, exports,
-- settlement) keeps reading a correct total while the new lines carry who is paid.
-- Historic rows are not touched and have no lines; a reader with no lines falls
-- back to the scalar, which is exactly what it always meant for them.
--
-- SUPPLIER RAIL BYTE-IDENTICAL: resolve_rates still answers, no lines are written,
-- partner_rate and agent_rate are snapshotted exactly as before.
create or replace function public.create_referral(p_branch uuid, p_tenant_title text, p_first text, p_last text, p_dob date, p_email text, p_phone text, p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text, p_rent numeric, p_tenancy_start date)
 returns applications
 language plpgsql security definer set search_path to ''
as $function$
declare ag uuid; pid uuid; prate numeric; arate numeric; a public.applications;
        v_mode text; v_portal_ok boolean; v_route uuid; v_agreement uuid;
        v_fee numeric; v_basis numeric;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  perform public.assert_referral_valid(
    p_branch, p_tenant_title, p_first, p_last, p_dob, p_email, p_phone,
    p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

  select b.agency_id, b.partner_id into ag, pid from public.branches b where b.id = p_branch;
  if ag is null then raise exception 'Selected branch not found' using errcode = '22023'; end if;

  if not (public.is_admin()
          or (public.app_role() in ('management','referrer') and pid = public.app_partner())) then
    raise exception 'not permitted for this partner' using errcode = '42501';
  end if;

  v_route := public.resolve_route_partner(p_branch, null);

  select p.portal_referrals_enabled into v_portal_ok
  from public.partners p
  where p.id = v_route;
  if not found then raise exception 'Route partner not found' using errcode = '22023'; end if;

  -- THE ROUTE. The agency's own mode if it has said, else the route partner's.
  v_mode := public.resolve_referencing_mode(p_branch, v_route);

  -- Position ladder, AGENT RAIL ONLY (20260923150000, unchanged).
  if not public.is_admin() and v_mode = 'opndoor_referenced' then
    if not (case
              when public.app_has_scope()
                then p_branch in (select public.app_scope_branches())
              else p_branch = (select u.home_branch_id from public.users u where u.id = auth.uid())
            end) then
      raise exception 'You can only refer against a branch within your own scope.' using errcode = '42501';
    end if;
  end if;

  -- THE PRICE. M4: the agreement now decides. Standard terms are one month's rent
  -- exactly; a negotiated basis is weeks of rent (monthly_rent * 12 / 52 * weeks).
  -- Resolved once here, at the moment the agent sends, and frozen below.
  select f.fee_amount, f.fee_basis_weeks, f.agreement_id
    into v_fee, v_basis, v_agreement
  from public.resolve_fee(p_branch, v_route, p_rent, 1) f;

  -- COMMISSION. The agent rail is an additive split and the scalar is its total;
  -- every other rail resolves exactly as before.
  select r.partner_rate, r.agent_rate into prate, arate
  from public.resolve_rates(p_branch, v_route) r;
  if v_mode = 'opndoor_referenced' then
    arate := public.commission_total(p_branch, v_route, 1);
  end if;

  if not coalesce(v_portal_ok, true) then
    raise exception 'This partner does not create referrals in the portal.' using errcode = '42501';
  end if;

  insert into public.applications(
    guarantee_ref, fee_amount, fee_basis_weeks, pricing_agreement_id,
    branch_id, agency_id, partner_id, referrer_id, referrer_name,
    tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
    prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
    monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode,
    referencing_mode
  ) values (
    'GR-' || nextval('public.guarantee_ref_seq')::text,
    -- THE FEE, as the agreement priced it. Frozen: re-negotiating never re-prices
    -- what was already sold.
    v_fee, v_basis, v_agreement,
    p_branch, ag, v_route, auth.uid(),
    (select full_name from public.users where id = auth.uid()),
    p_tenant_title, btrim(p_first), btrim(p_last), p_dob, btrim(p_email), btrim(p_phone),
    btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')), ''), btrim(p_city),
    nullif(btrim(coalesce(p_county,'')), ''), upper(btrim(p_postcode)),
    p_rent, p_tenancy_start, 'sent', now(), prate, arate, true,
    v_mode
  ) returning * into a;

  -- Freeze the payees alongside the total. Agent rail only.
  if v_mode = 'opndoor_referenced' then
    insert into public.application_commission_lines (application_id, level, org_id, org_name, rate)
    select a.id, s.level, s.org_id, s.org_name, s.rate
    from public.commission_split(p_branch, v_route, 1) s;
  end if;

  return a;
end $function$;

comment on function public.create_referral(uuid, text, text, text, date, text, text, text, text, text, text, text, numeric, date) is
  'Portal create path. Freezes the FEE (fee_amount / fee_basis_weeks) as well as the commission. States the route explicitly and freezes the commission at creation. Agent rail: the additive split is snapshotted into application_commission_lines (one row per payee) and applications.agent_rate carries their TOTAL. Supplier rails: resolve_rates as before, no lines. Position ladder enforced on the agent rail.';
