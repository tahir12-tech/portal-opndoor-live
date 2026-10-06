-- EVERY REFERRAL FREEZES ITS COMMISSION LINES, WHATEVER THE ROUTE.
--
-- Matt, 2026-10-04, verbatim: "Every referral freezes its commission lines at
-- creation, whatever the route: agency or supplier, portal (single and joint)
-- or API. Make all three creation paths do it for suppliers, backfill the
-- stored lines for existing supplier referrals on dev (and in the live
-- migration) from their frozen rates".
--
-- Test: supabase/tests/every_referral_freezes_its_lines.test.sql
--
-- =========================================================================
-- HOW THIS SURFACED, WHICH IS WORTH KEEPING
-- =========================================================================
--
-- A pgTAP assertion that had always passed started failing the moment Matt
-- created GR-25831: it was the first supplier referral on dev made through
-- the portal's own path, and all three creation paths gated
-- freeze_commission_lines on `v_estate`, which is false for a supplier. The
-- older supplier rows had their lines because they were seeded, so the
-- invariant looked satisfied while no code satisfied it.
--
-- =========================================================================
-- "FROM THEIR FROZEN RATES", AND WHY THE AGENCY LINE COULD NOT COME FROM
-- commission_split
-- =========================================================================
--
-- freeze_commission_lines' first arm reads commission_split, the estate's
-- additive split. On a supplier that returns the AGENCY-SCOPE COMMISSION
-- DEAL, which is not what the referral was frozen at. Measured on dev:
-- GR-22162's frozen share is 0.1000 and commission_split says 0.1200, from
-- the very agency-scope deal that (o) and (gg) exist to regularise. Writing
-- the split's number would store the figure those screens are being fixed to
-- stop showing.
--
-- THE SHAPE IS NOT INVENTED. GR-FROST-KES, seeded long before any of this,
-- already has exactly the right pair: supplier@0.2500 and agency@0.1000,
-- both of them the application's own frozen rates. This makes every supplier
-- referral look like that row.
--
-- SO: our own estate keeps commission_split, a supplier gets one agency line
-- at `applications.agent_rate` and one supplier line at `partner_rate`, and
-- both arms plus the backfill below read the row rather than recomputing.
--
-- ALL THREE ARMS ARE NOW `on conflict do nothing`. The unique key is
-- (application_id, level), the backfill reuses this function's own shape,
-- and a freeze reached twice must leave the first call's numbers alone
-- rather than fail.

CREATE OR REPLACE FUNCTION public.freeze_commission_lines(p_application uuid, p_branch uuid, p_route_partner uuid, p_tenant_count integer, p_basis numeric, p_tenancy_basis numeric DEFAULT NULL::numeric, p_pcts numeric[] DEFAULT NULL::numeric[], p_position integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with agency_side as (
    insert into public.application_commission_lines
      (application_id, level, org_id, org_name, rate, basis_amount, source, amount)
    select p_application, s.level, s.org_id, s.org_name, s.rate, p_basis, s.source,
           case
             when p_pcts is null or p_position is null or p_tenancy_basis is null
               -- A tenancy of one: its single line IS the tenancy's commission, so
               -- rounding it once here is the same arithmetic apportion would do.
               then round(p_basis * s.rate, 2)
             else
               -- Round the TENANCY's commission once, then divide. The reverse
               -- order is the defect.
               (public.apportion(round(p_tenancy_basis * s.rate, 2), p_pcts))[p_position]
           end
    from public.commission_split(p_branch, p_route_partner, p_tenant_count) s
    /* OUR OWN ESTATE ONLY. commission_split is the estate's ADDITIVE split,
       the agency/branch/group slots, and on a supplier it returns the
       agency-scope commission deal rather than what that referral was frozen
       at. The two disagree on exactly the rows this is being extended to
       cover: Kestrel's frozen share is 0.10 and the split says 0.12. Matt,
       2026-10-04: "backfill the stored lines ... from their frozen rates".
       So a supplier's agency line comes from the row, in the arm below. */
    where public.is_agent_estate(p_branch, p_route_partner)
    on conflict do nothing
    returning 1
  ),
  /* THE SUPPLIER'S AGENCY LINE: what this supplier owes this agency on this
     referral, restating the rate frozen on the row.

     THE SHAPE IS NOT INVENTED. GR-FROST-KES, seeded before any of this, has
     exactly it: supplier@0.2500 and agency@0.1000, both the application's
     own frozen rates. The two referrals created since through the portal had
     one line or none, which is the gap Matt asked to close. */
  supplier_agency_side as (
    insert into public.application_commission_lines
      (application_id, level, org_id, org_name, rate, basis_amount, source, amount)
    select p_application, 'agency', ag.id, ag.name, a.agent_rate, p_basis,
           /* No source, for the reason the supplier line gives: the rate is
              the frozen one and naming a source would be a guess printed on
              a statement. */
           null,
           case
             when p_pcts is null or p_position is null or p_tenancy_basis is null
               then round(p_basis * a.agent_rate, 2)
             else (public.apportion(round(p_tenancy_basis * a.agent_rate, 2), p_pcts))[p_position]
           end
    from public.applications a
    join public.agencies ag on ag.id = a.agency_id
    where a.id = p_application
      and public.is_supplier_estate(a.partner_id)
      and coalesce(a.agent_rate, 0) > 0
    on conflict do nothing
    returning 1
  )
  -- WHAT OPNDOOR OWES THE SUPPLIER, written exactly as the agency side
  -- is: one row, the rate from the application's own snapshot, the
  -- amount rounded once here so every surface reads one number, and no
  -- ON CONFLICT DO NOTHING on all three arms now, where this one used to
  -- have none "because the arm above it has none". The backfill in
  -- 20261008060000 reuses this function's shape and a freeze must be safe to
  -- reach twice: the unique key is (application_id, level), so a second call
  -- should leave the first call's numbers alone rather than fail.
  insert into public.application_commission_lines
    (application_id, level, org_id, org_name, rate, basis_amount, source, amount)
  select p_application, 'supplier', pt.id, pt.name, a.partner_rate, p_basis,
         -- The supplier's rate is resolved by resolve_rates and carries no
         -- source today. Null is "not recorded", which is what the agency
         -- side's historic lines say and is honest; naming one would be a
         -- guess printed on a statement.
         null,
         case
           when p_pcts is null or p_position is null or p_tenancy_basis is null
             then round(p_basis * a.partner_rate, 2)
           else (public.apportion(round(p_tenancy_basis * a.partner_rate, 2), p_pcts))[p_position]
         end
  from public.applications a
  join public.partners pt on pt.id = a.partner_id
  where a.id = p_application
    and public.is_supplier_estate(a.partner_id)
    and coalesce(a.partner_rate, 0) > 0
  on conflict do nothing
$function$


;

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
end $function$


;

CREATE OR REPLACE FUNCTION public.create_referral_api(p_partner uuid, p_livemode boolean, p_referrer uuid, p_branch uuid, p_tenant_title text, p_first text, p_last text, p_dob date, p_email text, p_phone text, p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text, p_rent numeric, p_tenancy_start date)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ag uuid; pid uuid; a public.applications; rname text;
  v_ref text; v_mode text; v_estate boolean;
  v_fee numeric; v_basis numeric; v_basis_unit text; v_agreement uuid;
  prate numeric; arate numeric;
begin
  if p_partner is null then raise exception 'Partner is required.' using errcode = '22023'; end if;
  if p_referrer is null then raise exception 'Referrer is required.' using errcode = '22023'; end if;
  if p_livemode is null then raise exception 'livemode is required.' using errcode = '22023'; end if;

  perform public.assert_referral_valid(
    p_branch, p_tenant_title, p_first, p_last, p_dob, p_email, p_phone,
    p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

  select b.agency_id, b.partner_id into ag, pid
  from public.branches b where b.id = p_branch;

  if ag is null then raise exception 'Selected branch not found' using errcode = '22023'; end if;

  -- The cross-PARTNER guard stays. Deliberately the same message whether the
  -- branch belongs to another partner or does not exist, so the API cannot be
  -- used to probe for the existence of another partner's orgs.
  if pid <> p_partner then
    raise exception 'Selected branch not found' using errcode = '22023';
  end if;

  select u.full_name into rname
  from public.users u
  where u.id = p_referrer and u.partner_id = p_partner;

  if not coalesce(found, false) then
    raise exception 'Referrer not found for this partner.' using errcode = '22023';
  end if;

  -- WHO CHECKS THE TENANT, and therefore how they come to pay. The API's
  -- route is always the branch's own partner: it is the caller, and the guard
  -- above has already proved they match.
  v_mode   := public.resolve_referencing_mode(p_branch, p_partner);
  v_estate := public.is_agent_estate(p_branch, p_partner);

  -- MATT'S REFUSAL. Before anything is written.
  perform public.assert_tenant_pays(v_mode);

  -- THE PRICE. create_referral's block, calling the same resolvers in the
  -- same order, so the two paths cannot drift apart.
  select f.fee_amount, f.fee_basis_weeks, f.fee_basis_unit, f.agreement_id
    into v_fee, v_basis, v_basis_unit, v_agreement
  from public.resolve_fee(p_branch, p_partner, p_rent, 1) f;

  select r.partner_rate, r.agent_rate into prate, arate
  from public.resolve_rates(p_branch, p_partner) r;
  if v_estate then
    arate := public.commission_total(p_branch, p_partner, 1);
  end if;

  v_ref := case when p_livemode
                then 'GR-'      || nextval('public.guarantee_ref_seq')::text
                else 'GR-TEST-' || nextval('public.guarantee_ref_sandbox_seq')::text
           end;

  insert into public.applications(
    guarantee_ref, fee_amount, fee_basis_weeks, fee_basis_unit, pricing_agreement_id,
    branch_id, agency_id, partner_id, referrer_id, referrer_name,
    tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
    prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
    monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode,
    referencing_mode
  ) values (
    v_ref, v_fee, v_basis, coalesce(v_basis_unit, 'weeks'), v_agreement,
    p_branch, ag, p_partner, p_referrer, rname,
    p_tenant_title, btrim(p_first), btrim(p_last), p_dob, btrim(p_email), btrim(p_phone),
    btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')), ''), btrim(p_city),
    nullif(btrim(coalesce(p_county,'')), ''), upper(btrim(p_postcode)),
    p_rent, p_tenancy_start, 'sent', now(), prate, arate, p_livemode,
    v_mode
  ) returning * into a;

  -- The estate's additive split is frozen per applicant, exactly as the
  -- portal does. An API referral is always a tenancy of one today.
  /* EVERY REFERRAL FREEZES ITS LINES, WHATEVER THE ROUTE. Matt, 2026-10-04:
     "Every referral freezes its commission lines at creation, whatever the
     route: agency or supplier, portal (single and joint) or API."

     This was `if v_estate then`, so a supplier referral created here stored
     nothing and the supplier's own record of what it owed that agency did
     not exist. freeze_commission_lines already knows the difference: it
     takes the estate's additive split on our own estate and the row's own
     frozen rates on a supplier. */
  perform public.freeze_commission_lines(a.id, p_branch, p_partner, 1, v_fee);

  return a;
end $function$


;

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
  if not coalesce((public.is_admin()
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
end $function$


;

-- ---------------------------------------------------------------------------
-- THE BACKFILL, on dev and on live.
-- ---------------------------------------------------------------------------
/* FROM THE ROW, NEVER RECOMPUTED, which is Matt's instruction and is also the
   only thing that could be right: these referrals were priced under
   arrangements that may since have changed, and the rates frozen on them are
   the record of what they were priced at.

   IDEMPOTENT AND NON-DESTRUCTIVE. `on conflict do nothing` on both inserts,
   so a line that already exists keeps the number it already has. GR-FROST-KES
   has both of its lines and must come through this untouched.

   SCOPED TO SUPPLIER ESTATES. Our own estate's rows were never missing their
   lines, because the gate this migration removes was true for them. */
insert into public.application_commission_lines
  (application_id, level, org_id, org_name, rate, basis_amount, source, amount)
select a.id, 'supplier', p.id, p.name, a.partner_rate,
       coalesce(a.fee_amount, a.monthly_rent),
       null,
       round(coalesce(a.fee_amount, a.monthly_rent) * a.partner_rate, 2)
from public.applications a
join public.partners p on p.id = a.partner_id
where public.is_supplier_estate(a.partner_id)
  and coalesce(a.partner_rate, 0) > 0
  and coalesce(a.fee_amount, a.monthly_rent, 0) > 0
on conflict do nothing;

insert into public.application_commission_lines
  (application_id, level, org_id, org_name, rate, basis_amount, source, amount)
select a.id, 'agency', ag.id, ag.name, a.agent_rate,
       coalesce(a.fee_amount, a.monthly_rent),
       null,
       round(coalesce(a.fee_amount, a.monthly_rent) * a.agent_rate, 2)
from public.applications a
join public.agencies ag on ag.id = a.agency_id
where public.is_supplier_estate(a.partner_id)
  and coalesce(a.agent_rate, 0) > 0
  and coalesce(a.fee_amount, a.monthly_rent, 0) > 0
on conflict do nothing;

do $$
declare v_missing int;
begin
  select count(*) into v_missing
    from public.applications a
   where public.is_supplier_estate(a.partner_id)
     and coalesce(a.partner_rate, 0) > 0
     and coalesce(a.fee_amount, a.monthly_rent, 0) > 0
     and not exists (select 1 from public.application_commission_lines l
                      where l.application_id = a.id and l.level = 'supplier');
  raise notice 'Supplier referrals still missing a supplier line after the backfill: %', v_missing;
end $$;
