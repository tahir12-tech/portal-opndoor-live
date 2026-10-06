-- AN OPNDOOR MANAGER MAY REFER ON ANYBODY'S BEHALF.
--
-- Matt (bb): "opndoor managers: give them the Suppliers list and each
-- supplier's page read-only (no editing settings, commission, keys or
-- people), and New application on behalf of any supplier or agency, the
-- same form admins use. Still no commission, settlements, bordereau,
-- opndoor team or Health."
--
-- Test: supabase/tests/an_opndoor_manager_may_refer.test.sql
--
-- =========================================================================
-- RECORDED ON 2026-10-04 AND NEVER BUILT, in either half
-- =========================================================================
--
-- The queue entry for (bb) said this in terms: "that server guard has to
-- learn about opndoor_manager, or the form will offer a choice the database
-- refuses." It never did, and neither did the form. Checked before writing
-- anything: `create_referral`'s caller guard is
--
--   is_admin() or (app_role() in ('management','referrer')
--                  and pid = app_partner())
--
-- and an opndoor_manager is neither -- they are not an admin and they have
-- no partner, so the second arm cannot be true for them on any branch.
--
-- =========================================================================
-- FIVE GUARDS, ALL ASKING THE SAME QUESTION
-- =========================================================================
--
-- Every `is_admin()` in these two functions means "is this an opndoor
-- person acting on somebody else's behalf", and the answer for all five is
-- now `is_opndoor_staff()`:
--
--   the caller guard        may they refer for a partner that is not theirs
--   the route guard         may they file it under a chosen route
--   the position ladder     are they exempt from branch scoping
--
-- NONE OF THEM IS ABOUT MONEY OR SETTINGS, which is what keeps this inside
-- what Matt granted. (bb) withholds commission, settlements, the bordereau,
-- the opndoor team page and Health, and none of those is reached from here.
-- `set_agency_rates`, `create_agreement` and the rest keep their own
-- `is_admin()` and are untouched.
--
-- AND THE ROUTE MESSAGE CHANGES WITH THE RULE. "Only an opndoor admin may
-- choose the route" would now be refused by nobody it names.

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

  if not coalesce((public.is_opndoor_staff()
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
    if coalesce(not public.is_opndoor_staff(), true) then
      raise exception 'Only opndoor staff may choose the route for a referral.' using errcode = '42501';
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
  if coalesce(not public.is_opndoor_staff() and v_estate, true) then
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
  /* EVERY REFERRAL FREEZES ITS LINES, WHATEVER THE ROUTE. Matt, 2026-10-04:
     "Every referral freezes its commission lines at creation, whatever the
     route: agency or supplier, portal (single and joint) or API."

     This was `if v_estate then`, so a supplier referral created here stored
     nothing and the supplier's own record of what it owed that agency did
     not exist. freeze_commission_lines already knows the difference: it
     takes the estate's additive split on our own estate and the row's own
     frozen rates on a supplier. */
  perform public.freeze_commission_lines(a.id, p_branch, v_route, 1, v_fee);

  return public.rates_for_reader(a);
end $function$;

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
  prate numeric; arate numeric;
  v_app public.applications;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  v_n := jsonb_array_length(p_tenants);
  if v_n is null or v_n < 2 then
    raise exception 'A joint tenancy needs at least two tenants.' using errcode = '22023';
  end if;

  select b.agency_id, b.partner_id into ag, pid from public.branches b where b.id = p_branch;
  if ag is null then raise exception 'Selected branch not found' using errcode = '22023'; end if;
  if not coalesce((public.is_opndoor_staff()
          or (public.app_role() in ('management','referrer') and pid = public.app_partner())), false) then
    raise exception 'not permitted for this partner' using errcode = '42501';
  end if;

  v_route := public.resolve_route_partner(p_branch, null);
  select p.portal_referrals_enabled into v_portal_ok from public.partners p where p.id = v_route;
  if not coalesce(found, false) then raise exception 'Route partner not found' using errcode = '22023'; end if;
  v_mode := public.resolve_referencing_mode(p_branch, v_route);
  v_estate := public.is_agent_estate(p_branch, v_route);

  /* WALK FIX 26. WHICH RAILS MAY CARRY A JOINT TENANCY.
     WAS: the agent estate alone -- "A joint tenancy needs an agency of ours
     to sit under, and this referral comes from a partner who sends them one
     tenant at a time." That was Q-06 item H's rule, "single tenant (no Add
     another tenant)" on the supplier path. Batch 16 reverses it: "Suppliers
     may refer joint tenancies, the same way agencies can."

     NARROWED RATHER THAN REMOVED. Matt named suppliers. He did not name the
     DIRECT rail, and a joint direct tenancy has no staff referrer to create
     it -- a direct signup is one tenant applying for themselves. Deleting
     the guard outright would have opened all three rails at once, so what
     is refused now is the two house routes that are not the agency one.

     `opndoor-agents` is deliberately NOT is_house_route -- application_channel
     maps that flag to 'Direct' and the agency rail is not direct -- so the
     test is on the slug, the same way channel.ts draws the line.

     NOTHING ELSE IN THIS FUNCTION NEEDED CHANGING, which was measured
     rather than hoped: with the guard lifted on dev, a real Kestrel joint
     referral produced 2 applications on 1 tenancy, fees summing to exactly
     one month of the rent, shares summing to exactly the rent, and the
     supplier's own rates on both rows. resolve_fee already prices per
     TENANCY on that rail (GBP 2,000 for one tenant and for two, measured)
     and apportion already splits to the penny. */
  if coalesce((select p.slug in ('opndoor-direct', 'referencing-partner')
                 from public.partners p where p.id = v_route), false) then
    raise exception 'A direct signup is one tenant''s own application. Refer each tenant separately.'
      using errcode = '22023';
  end if;

  if not coalesce(public.is_opndoor_staff(), false) then
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

  /* COMMISSION: THE ESTATE'S ADDITIVE SPLIT, OR THE FLAT SNAPSHOTTED RATES.
     Matt, 2026-10-04: "apply the same estate check to joint referrals as
     single ones, so Kestrel's agency share on a joint referral follows the
     deal (10%), not the tenant count."

     This is create_referral's block, word for word, and that is the point:
     the joint path had no estate test at all and always took
     commission_total, which is OUR OWN ESTATE's additive split. On a supplier
     that made the agents' share depend on how many tenants the tenancy had
     rather than on the supplier's deal. Measured on Kestrel Central before
     this change: a single referral froze a share of 0.1000 and a two-tenant
     joint froze 0.2000, same supplier, same deal, same branch.

     RESOLVED ONCE, ABOVE THE LOOP, rather than per applicant. Neither rate
     varies by tenant within a tenancy, the tenant count passed is the
     tenancy's, and reading them once makes it impossible for two applicants
     of one tenancy to be frozen at different rates. */
  select r.partner_rate, r.agent_rate into prate, arate
  from public.resolve_rates(p_branch, v_route, v_n) r;
  if v_estate then
    arate := public.commission_total(p_branch, v_route, v_n);
  end if;

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
      prate, arate,
      true, v_mode
    ) returning * into v_app;

    -- THE TENANCY'S COMMISSION, APPORTIONED, not this line's basis rounded on its
    -- own. Passing the whole fee, the split and this tenant's position lets the
    -- freeze round ONCE for the tenancy and then divide, the same way v_fees and
    -- v_rents above are divided, so the lines sum to the tenancy's commission
    -- exactly. Rounding each line separately put GR-20845 and GR-20846 a penny
    -- over their tenancy's 25%.
    /* AND THE FROZEN SPLIT FOLLOWS THE SAME TEST, because it is the same
       question: the lines ARE the additive split, so freezing them off the
       estate would record a split that applications.agent_rate no longer
       agrees with. create_referral and create_referral_api both gate this on
       v_estate and the joint path did not. */
    /* AND THE JOINT PATH TOO. 20261008010000 gated this on v_estate, on
       Matt's instruction to apply the same estate check as the single paths.
       That was right about the RATE and wrong about the LINES, which he has
       now settled: the rate still follows the estate test above, and the
       lines are always written. */
    perform public.freeze_commission_lines(
      v_app.id, p_branch, v_route, v_n, v_fees[v_i],
      v_fee, v_pcts, v_i);

    return next public.rates_for_reader(v_app);
  end loop;
end $function$;
