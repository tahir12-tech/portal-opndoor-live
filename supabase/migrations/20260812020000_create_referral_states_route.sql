-- ===========================================================================
-- create_referral states the route instead of letting the trigger infer it.
--
-- WHAT CHANGES OBSERVABLY: nothing, today. For management and referrer the
-- permission arm already requires the branch's partner to equal app_partner(),
-- so the route and the branch give the same answer. For an opndoor admin
-- resolve_route_partner falls back to the branch, which is what this function
-- did before. Every row this produces today is byte-identical.
--
-- WHY DO IT THEN: because the route is now a decision, and a decision belongs
-- at the call site where it can be read, not in a trigger that infers it from
-- an unrelated column. When the org tree later becomes reachable across routes,
-- this function is already correct and the trigger does not have to learn
-- anything new.
--
-- COMMISSION FOLLOWS THE ROUTE. The rates are now read from the route partner
-- rather than the branch's partner. Identical today for the reason above, and
-- correct rather than coincidental when they diverge: an agent referring at an
-- agency somebody else introduced is paid at their own partner's rate, not at
-- the rate of whoever introduced the agency.
--
-- WHAT IS DELIBERATELY NOT TOUCHED
--   - The permission arm. It is the org-visibility boundary and widening it is
--     a separate change with a disclosure risk. Unchanged, byte for byte.
--   - create_referral_api. It already passes p_partner explicitly and guards
--     pid <> p_partner, so it is already route-stating. Editing the live
--     Rightmove path to make an identical value arrive by a different route is
--     churn on the one path that must not move.
-- ===========================================================================

create or replace function public.create_referral(p_branch uuid, p_tenant_title text, p_first text, p_last text, p_dob date, p_email text, p_phone text, p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text, p_rent numeric, p_tenancy_start date)
 returns applications
 language plpgsql security definer set search_path to ''
as $function$
declare ag uuid; pid uuid; prate numeric; arate numeric; a public.applications;
        v_mode text; v_portal_ok boolean; v_route uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  perform public.assert_referral_valid(
    p_branch, p_tenant_title, p_first, p_last, p_dob, p_email, p_phone,
    p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

  -- The branch still supplies the agency. That is structural and unchanged.
  select b.agency_id, b.partner_id
    into ag, pid
  from public.branches b
  where b.id = p_branch;
  if ag is null then raise exception 'Selected branch not found' using errcode = '22023'; end if;

  -- UNCHANGED, byte for byte. This is the org-visibility boundary, not the
  -- attribution rule, and it is not what this migration is about.
  if not (public.is_admin()
          or (public.app_role() in ('management','referrer') and pid = public.app_partner())) then
    raise exception 'not permitted for this partner' using errcode = '42501';
  end if;

  -- The route. No explicit argument on the portal path, so this is the
  -- creator's partner, or the branch for an opndoor admin.
  v_route := public.resolve_route_partner(p_branch, null);

  -- Commission, capability and mode all follow the ROUTE partner. Identical to
  -- the branch partner on every path that exists today.
  select p.partner_rate, p.agent_rate, p.referencing_mode, p.portal_referrals_enabled
    into prate, arate, v_mode, v_portal_ok
  from public.partners p
  where p.id = v_route;
  if not found then raise exception 'Route partner not found' using errcode = '22023'; end if;

  -- The capability, enforced here rather than only by hiding the button. A
  -- hidden control is a suggestion; this is the rule. Admins are not exempt:
  -- an opndoor admin creating a referral on behalf of an API-only partner would
  -- produce exactly the row the setting exists to prevent.
  if not coalesce(v_portal_ok, true) then
    raise exception 'This partner does not create referrals in the portal.' using errcode = '42501';
  end if;

  insert into public.applications(
    guarantee_ref, branch_id, agency_id, partner_id, referrer_id, referrer_name,
    tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
    prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
    monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode,
    referencing_mode
  ) values (
    'GR-' || nextval('public.guarantee_ref_seq')::text, p_branch, ag, v_route, auth.uid(),
    (select full_name from public.users where id = auth.uid()),
    p_tenant_title, btrim(p_first), btrim(p_last), p_dob, btrim(p_email), btrim(p_phone),
    btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')), ''), btrim(p_city),
    nullif(btrim(coalesce(p_county,'')), ''), upper(btrim(p_postcode)),
    p_rent, p_tenancy_start, 'sent', now(), prate, arate, true,
    v_mode
  ) returning * into a;
  return a;
end $function$;

comment on function public.create_referral(uuid, text, text, text, date, text, text, text, text, text, text, text, numeric, date) is
  'Portal create path. States the route explicitly (resolve_route_partner) rather than letting the trigger infer it from the branch, and reads commission from the route partner. Behaviour is identical to the pre-20260812020000 version on every path that exists today; see that migration header for why.';
