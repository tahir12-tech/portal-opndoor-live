-- A JOINT REFERRAL TAKES THE SAME ESTATE CHECK AS A SINGLE ONE.
--
-- Matt, 2026-10-04, verbatim: "Yes: apply the same estate check to joint
-- referrals as single ones, so Kestrel's agency share on a joint referral
-- follows the deal (10%), not the tenant count."
--
-- Test: supabase/tests/a_joint_referral_takes_the_same_estate_check.test.sql
--
-- =========================================================================
-- THE VARIABLE WAS ALREADY THERE AND NOTHING READ IT
-- =========================================================================
--
-- create_joint_referral has computed `v_estate := is_agent_estate(...)` since
-- the tenancy work landed and never used it once. Both single paths do the
-- same two things with it:
--
--   select partner_rate, agent_rate from resolve_rates(...)
--   if v_estate then agent_rate := commission_total(...) end if
--   ...
--   if v_estate then freeze_commission_lines(...) end if
--
-- The joint path took `commission_total` unconditionally and froze the lines
-- unconditionally. `commission_total` is OUR OWN ESTATE's additive split, the
-- agency/branch/group slots. On a supplier that is not the arrangement at all:
-- the supplier is paid `partner_rate` and the agents' share comes from the
-- supplier's own agent_share deal, which `resolve_rates` already resolves,
-- including an agency-scope one as the per-agency override (20261007200000).
--
-- SO THE SHARE DEPENDED ON THE TENANT COUNT RATHER THAN ON THE DEAL. Measured
-- on Kestrel Central, one branch, one agency, one GBP 2,000 rent, both rolled
-- back:
--
--   single, 1 tenant    total 0.2500   share 0.1000
--   joint,  2 tenants   total 0.2500   share 0.2000
--
-- Nobody decided that. It is two code paths reading two different
-- arrangements for the same supplier.
--
-- =========================================================================
-- WHAT THIS IS AND IS NOT A FIX FOR
-- =========================================================================
--
-- It is the ROOT of the 0.26-against-0.25 breach reported in the audit: the
-- breach was the estate's split being read on a supplier at a tenant count
-- the estate's bands were written for. With the gate in place Kestrel's joint
-- share is its deal, so the breach cannot arise from a joint referral.
--
-- 20261007990000's guard is NOT redundant and stays: it refuses a per-agency
-- deal that exceeds the supplier's total at save time, which is still
-- reachable on our own estate and through an agency-scope agent_share deal.
--
-- THE AGENCY RAIL IS UNTOUCHED, which is the whole value of using the
-- existing predicate rather than a new one: v_estate is true there, so both
-- arms behave exactly as before. Measured after applying.
--
-- NO BACKFILL, the rule the money model rests on. Dev's existing joint rows
-- keep the rates they were created under. There are no PAID joint supplier
-- referrals on dev, so nothing already invoiced is involved either way.

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
    if v_estate then
      perform public.freeze_commission_lines(
        v_app.id, p_branch, v_route, v_n, v_fees[v_i],
        v_fee, v_pcts, v_i);
    end if;

    return next public.rates_for_reader(v_app);
  end loop;
end $function$


;

comment on function public.create_joint_referral(uuid, jsonb, text, text, text, text, text, numeric, date) is
  'Creates one tenancy and one application per tenant, each priced at its share of the tenancy fee. Rates are frozen once for the tenancy from the real tenant count, and the agents'' share takes the estate''s additive split only on our own estate, exactly as create_referral does: on a supplier it is the supplier''s own deal.';
