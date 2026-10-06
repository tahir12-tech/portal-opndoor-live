-- THE SUPPLIER'S OWN TOTAL IS FROZEN AT THE REAL TENANT COUNT.
--
-- Matt, 2026-10-04, verbatim: "freeze the supplier's total commission using
-- the same real tenant count as the agency share".
--
-- Test: supabase/tests/the_total_is_frozen_at_the_real_tenant_count.test.sql
--
-- =========================================================================
-- ONE ARGUMENT, AND IT WAS THE ONLY THING WRONG
-- =========================================================================
--
-- create_joint_referral froze the two rates from two different tenant counts:
--
--   agent_rate    commission_total(p_branch, v_route, v_n)        -- banded on v_n
--   partner_rate  resolve_rates(p_branch, v_route)                -- banded on 1
--
-- resolve_rates has taken a tenant count since 20261007200000 and defaults it
-- to 1, so the second call compiled, ran, and quietly read the wrong band.
--
-- MEASURED ON DEV BEFORE THE FIX, on Kestrel Central with a GBP 2,000 rent,
-- in a transaction that was rolled back:
--
--   tenants   fee        total (partner_rate)   agents' share (agent_rate)
--   1         2,000.00   0.2500                 0.1200
--   2         2,307.69   0.2500                 0.2000
--   3         2,769.23   0.2500                 0.2600   <-- share over total
--
-- The total is flat at 0.2500 not because that is the right band but because
-- it is the ONLY band this call could ever reach.
--
-- =========================================================================
-- WHY THIS WAS NOT A BUG UNTIL 2026-10-06
-- =========================================================================
--
-- While a supplier referral covered one tenant, v_n was 1 on that rail and
-- the default was the right answer. 20261006970000 opened the rail to joint
-- tenancies, which is what made bands 2 and 3 reachable. So this is the
-- commission half of the same change, found by the audit Matt asked for
-- before any of it was altered.
--
-- ON THE AGENCY RAIL IT WAS ALREADY WRONG, and the same line fixes both: a
-- banded partner-scope commission deal on an agency route read band 1 too.
-- Nothing on dev has one, so nothing dev holds is repriced by this.
--
-- NO BACKFILL. Every frozen row keeps the rate it was created under, which is
-- the rule the whole money model rests on; repricing a sent referral would
-- change what an agency has already been told it is owed. The 11 paid Kestrel
-- referrals on dev are all single-tenant, so none of them is even affected.

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
      /* THE REAL TENANT COUNT, which is the whole of this migration. Two
         arguments meant p_tenant_count defaulted to 1, so the supplier's own
         total was frozen from the ONE-TENANT band while the line below it
         banded on v_n. */
      (select r.partner_rate from public.resolve_rates(p_branch, v_route, v_n) r),
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
end $function$


;

comment on function public.create_joint_referral(uuid, jsonb, text, text, text, text, text, numeric, date) is
  'Creates one tenancy and one application per tenant, each priced at its share of the tenancy fee. Both rates are frozen from the REAL tenant count, so a banded deal resolves the same band for the supplier''s total as for the agents'' share.';
