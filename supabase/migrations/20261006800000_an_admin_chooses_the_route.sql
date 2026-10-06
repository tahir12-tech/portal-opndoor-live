-- AN ADMIN CHOOSES THE ROUTE, AND THE SERVER CHECKS THEY MAY.
--
-- Q-06 item H. Matt's words: admin New application asks "Supplier or Agency"
-- FIRST, required, no default; picking a supplier restricts the agency and
-- branch to that supplier's; "the server checks the branch belongs to the
-- chosen supplier and refuses otherwise".
--
-- Today the rail, the route and the fee are all inferred from the branch
-- AFTER the fact. That is right for every other caller and wrong for this
-- one: an agency introduced by a supplier can transact on either route, and
-- which one it is decides the commission. The branch cannot answer it.
--
-- THE SEAM ALREADY EXISTED AND WAS DEAD CODE. resolve_route_partner(branch,
-- explicit) has taken an explicit route since 20260812010000 -- "an explicit
-- route always wins" -- and every caller in the tree passes null. So this
-- adds a parameter and two guards rather than a mechanism.
--
-- THE TWO GUARDS, and neither is optional:
--
--   ADMIN ONLY. A partner user's route is their own partner; stating
--   somebody else's would be acting as them. An opndoor admin acts for no
--   partner, which is exactly why they are the ones with a choice to make.
--
--   THE RELATIONSHIP MUST EXIST. The chosen supplier must be one the branch
--   actually sits under: the branch's own partner, or a supplier with a
--   recorded relationship to its agency. Without it an admin could file
--   Regent's referral under a supplier who has never met them, and the
--   commission would follow the route.
--
-- DEFAULTED, so every existing caller is unchanged: the partner API, the
-- direct rail and an agency's own staff all keep passing nothing and keep
-- resolving the route exactly as they do now.
--
-- Extends the isolation suite:
-- supabase/tests/an_admin_chooses_the_route.test.sql.

CREATE OR REPLACE FUNCTION public.create_referral(p_branch uuid, p_tenant_title text, p_first text, p_last text, p_dob date, p_email text, p_phone text, p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text, p_rent numeric, p_tenancy_start date, p_route uuid DEFAULT NULL)
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

  return a;
end $function$
;

revoke all on function public.create_referral(uuid, text, text, text, date, text, text, text, text, text, text, text, numeric, date, uuid) from public, anon;
grant execute on function public.create_referral(uuid, text, text, text, date, text, text, text, text, text, text, text, numeric, date, uuid) to authenticated, service_role;

comment on function public.create_referral(uuid, text, text, text, date, text, text, text, text, text, text, text, numeric, date, uuid) is
  'Creates one referral. p_route is the ROUTE it came down, and only an '
  'opndoor admin may state one: it must be the branch''s own partner or a '
  'supplier with a recorded relationship to its agency. Everyone else passes '
  'nothing and the route is resolved from the caller, exactly as before.';
