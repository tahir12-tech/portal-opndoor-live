-- R7. THE PARTNER API PRICES A REFERRAL EXACTLY AS THE PORTAL DOES.
--
-- Matt, 2026-09-29, verbatim: "the partner API must work out the fee and
-- commission exactly as the portal does when the tenant pays, which is every
-- route today. Where a supplier is set so that someone other than the tenant
-- pays, the API refuses the application with a clear message until Matt
-- decides how that payment works; do not build that payment path."
--
-- WHAT WAS WRONG. `create_referral_api` read `partner_rate` and `agent_rate`
-- straight off the partner row, and set no fee at all: `fee_amount`,
-- `fee_basis_weeks`, `fee_basis_unit` and `pricing_agreement_id` were left
-- null. So an API referral ignored every pricing agreement, every negotiated
-- band and the agency's own rate, and carried no record of what it charged
-- or why. Measured earlier against NM-C 7 and recorded at `1eb6fa0`.
--
-- Test: supabase/tests/the_api_prices_like_the_portal.test.sql
-- Failed first on 7 of 9.
--
-- =========================================================================
-- "EXACTLY AS THE PORTAL DOES" IS TAKEN LITERALLY
-- =========================================================================
--
-- The pricing block below is `create_referral`'s, calling the same four
-- resolvers in the same order: resolve_referencing_mode, is_agent_estate,
-- resolve_fee, resolve_rates -- then commission_total and
-- freeze_commission_lines on the estate. It is not a second implementation
-- that agrees today.
--
-- Assertion 4 of the test is what holds that: it runs both paths over one
-- branch and asserts every figure equal. A future change to the portal's
-- pricing that misses the API now breaks a test rather than an invoice.
--
-- =========================================================================
-- THE REFUSAL, AND WHY IT IS SHAPED THIS WAY
-- =========================================================================
--
-- There is no setting today that says somebody other than the tenant pays.
-- That is Matt's own "which is every route today", and NM-A -- which would
-- add one -- is parked. So nothing can be keyed off a payer column, because
-- there is not one, and inventing one would be building the very thing the
-- instruction says not to build.
--
-- Instead the guard is a FAIL-CLOSED ALLOWLIST over the one column that does
-- describe the payment journey, `referencing_mode`. All three known modes
-- end with the tenant paying: the pre-referenced two send the tenant a Stripe
-- link, and opndoor_referenced sends the tenant an invite and then a link.
-- Anything outside that set is refused with Matt's message.
--
-- The value of writing it now, before the setting exists, is that the day
-- somebody adds a fourth mode -- or a payer switch that widens this column --
-- the API stops rather than silently creating referrals nobody has agreed how
-- to collect on. It builds no payment path and decides nothing.

-- -------------------------------------------------------------------------
-- THE GUARD. Its own function so the API and any future caller share one
-- answer, and so the message is written once.
-- -------------------------------------------------------------------------
create or replace function public.assert_tenant_pays(p_mode text)
returns void
language plpgsql immutable
set search_path to ''
as $function$
begin
  -- Fail closed: NULL is not a known arrangement either.
  if coalesce(p_mode, '') not in ('pre_referenced_open', 'pre_referenced_screened', 'opndoor_referenced') then
    raise exception 'This supplier is set so that someone other than the tenant pays the fee. Opndoor has not yet agreed how that payment is collected, so this referral cannot be accepted through the API yet.'
      using errcode = '42501';
  end if;
end $function$;

comment on function public.assert_tenant_pays(text) is
  'Refuses a referral whose payment arrangement is not one Opndoor has agreed how to collect. Today all three referencing modes end with the TENANT paying, so this passes everything; it exists so that the day a fourth arrangement appears, the partner API stops instead of silently accepting referrals nobody has agreed how to bill. See NM-A.';

revoke all on function public.assert_tenant_pays(text) from public, anon;
grant execute on function public.assert_tenant_pays(text) to authenticated, service_role;

-- -------------------------------------------------------------------------
-- THE API. Identity, branch and cross-partner guards unchanged; the pricing
-- block is now the portal's.
-- -------------------------------------------------------------------------
create or replace function public.create_referral_api(
  p_partner uuid, p_livemode boolean, p_referrer uuid, p_branch uuid,
  p_tenant_title text, p_first text, p_last text, p_dob date, p_email text, p_phone text,
  p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text,
  p_rent numeric, p_tenancy_start date)
returns applications
language plpgsql security definer set search_path to ''
as $function$
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
  if v_estate then
    perform public.freeze_commission_lines(a.id, p_branch, p_partner, 1, v_fee);
  end if;

  return a;
end $function$;

comment on function public.create_referral_api(uuid, boolean, uuid, uuid, text, text, text, date, text, text, text, text, text, text, text, numeric, date) is
  'Creates a referral from the partner API, pricing it through the SAME resolvers as the portal (resolve_referencing_mode, is_agent_estate, resolve_fee, resolve_rates, commission_total, freeze_commission_lines) so the two cannot drift apart. Refuses any payment arrangement other than the tenant paying -- see assert_tenant_pays and NM-A.';
