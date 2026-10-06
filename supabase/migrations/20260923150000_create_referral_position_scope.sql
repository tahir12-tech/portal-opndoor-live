-- create_referral: enforce the position ladder in SQL, not just the UI.
--
-- On the AGENT RAIL (route partner referencing_mode = 'opndoor_referenced') a
-- caller may only refer against a branch inside their own position scope:
--   negotiator (no user_scope, has home_branch) -> exactly their home branch
--   branch manager  (branch scope)              -> their branch(es)
--   agency manager  (agency scope)              -> every branch of that agency
--   group director  (group scope)               -> every branch in the group
-- app_scope_branches() already expands the ladder from user_scopes and, by
-- design, EXCLUDES home_branch -- so a position-holder is bounded by their
-- scope and a scope-less negotiator falls to the home-branch clause. This is
-- the org-visibility boundary made into an attribution rule: a hidden button
-- is a suggestion, this is the rule.
--
-- SUPPLIER RAIL and OPNDOOR ADMIN are untouched, byte for byte. The new block
-- is guarded by `not is_admin() and v_mode = 'opndoor_referenced'`, so every
-- pre_referenced_* route and every admin caller skips it entirely and takes the
-- exact path they took before. The rest of the body is unchanged from
-- 20260904250000; only the guarded block after v_mode is resolved is new.
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

  -- Capability and mode follow the ROUTE partner.
  select p.referencing_mode, p.portal_referrals_enabled
    into v_mode, v_portal_ok
  from public.partners p
  where p.id = v_route;
  if not found then raise exception 'Route partner not found' using errcode = '22023'; end if;

  -- Position ladder, AGENT RAIL ONLY. Admins are exempt; supplier routes never
  -- reach this branch. A position-holder is bounded by app_scope_branches()
  -- (group/agency/branch, expanded); a scope-less negotiator is bounded to
  -- their home branch. Anyone on the agent rail with neither is refused.
  if not public.is_admin() and v_mode = 'opndoor_referenced' then
    if not (case
              when public.app_has_scope()
                then p_branch in (select public.app_scope_branches())
              else p_branch = (select u.home_branch_id from public.users u where u.id = auth.uid())
            end) then
      raise exception 'You can only refer against a branch within your own scope.' using errcode = '42501';
    end if;
  end if;

  -- Commission follows the RESOLVED rate: group override, then agency rate, then
  -- the route partner's rate. Snapshotted below and never recomputed.
  select r.partner_rate, r.agent_rate
    into prate, arate
  from public.resolve_rates(p_branch, v_route) r;

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
  'Portal create path. States the route explicitly (resolve_route_partner) and snapshots the resolved commission rate (resolve_rates: group override, then agency, then route partner). The rate is frozen at creation and never recomputed. On the agent rail (opndoor_referenced) the caller may only refer against a branch inside their own position scope (app_scope_branches for a position-holder, home branch for a scope-less negotiator); supplier routes and admins are unaffected.';
