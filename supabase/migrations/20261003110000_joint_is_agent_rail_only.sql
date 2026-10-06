-- A JOINT TENANCY IS AN AGENT-RAIL THING.
--
-- create_joint_referral resolved the referencing mode and then only ever
-- BRANCHED on it, never refused it. So a supplier-rail branch could be given
-- three tenants and would get: one tenancies row, three applications sharing it,
-- the supplier's fee split three ways, and three separate Stripe sessions for
-- thirds of one fee. Coherent, and nothing anybody decided to support.
--
-- The rule is that a pre-referenced referral covers one tenant, so the refusal
-- belongs here rather than only in the form: the form can be wrong about the
-- rail (it resolves the agency by name, and an admin on "all partners" can name
-- one that exists under two), and this function cannot -- it has the branch id
-- and calls resolve_referencing_mode, which is what actually decides the journey.
--
-- The whole function is refused off the agent rail, not merely the N > 1 case.
-- A tenancy of one is still a tenancy row, and a supplier-rail application
-- acquiring one would make it look joint to every surface that groups on
-- tenancy_id. create_referral remains the single-tenant path on every rail and
-- is untouched.
create or replace function public.create_joint_referral(
  p_branch uuid, p_tenants jsonb,
  p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text,
  p_rent numeric, p_tenancy_start date
)
returns setof public.applications
language plpgsql security definer set search_path to ''
as $function$
declare
  ag uuid; pid uuid; v_route uuid; v_mode text; v_portal_ok boolean;
  v_n int; v_pct numeric; v_fee numeric; v_basis numeric; v_agreement uuid;
  v_tenancy uuid; t jsonb; v_share_pct numeric; v_share_rent numeric;
  v_app public.applications; v_i int := 0; v_emails text[];
  v_pcts numeric[]; v_fees numeric[];
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  v_n := jsonb_array_length(p_tenants);
  if v_n is null or v_n < 1 then raise exception 'At least one tenant is required.' using errcode = '22023'; end if;

  select b.agency_id, b.partner_id into ag, pid from public.branches b where b.id = p_branch;
  if ag is null then raise exception 'Selected branch not found' using errcode = '22023'; end if;

  if not (public.is_admin()
          or (public.app_role() in ('management','referrer') and pid = public.app_partner())) then
    raise exception 'not permitted for this partner' using errcode = '42501';
  end if;

  v_route := public.resolve_route_partner(p_branch, null);
  select p.portal_referrals_enabled into v_portal_ok from public.partners p where p.id = v_route;
  if not found then raise exception 'Route partner not found' using errcode = '22023'; end if;
  v_mode := public.resolve_referencing_mode(p_branch, v_route);

  -- THE RAIL. Refused before anything is written, and before the permission
  -- ladder below, so the message is about the rail rather than about scope.
  if v_mode <> 'opndoor_referenced' then
    raise exception 'This agent''s references are already done before the referral reaches us, and a pre-referenced referral covers one tenant. Refer each tenant separately.'
      using errcode = '22023';
  end if;

  if not public.is_admin() then
    if not (case when public.app_has_scope()
                 then p_branch in (select public.app_scope_branches())
                 else p_branch = (select u.home_branch_id from public.users u where u.id = auth.uid())
            end) then
      raise exception 'You can only refer against a branch within your own scope.' using errcode = '42501';
    end if;
  end if;
  if not coalesce(v_portal_ok, true) then
    raise exception 'This partner does not create referrals in the portal.' using errcode = '42501';
  end if;

  -- Shares must describe the whole tenancy, and the error names the gap.
  select array_agg((x->>'share_percent')::numeric order by ord) into v_pcts
  from jsonb_array_elements(p_tenants) with ordinality as e(x, ord);
  select coalesce(sum(s), 0) into v_pct from unnest(v_pcts) s;
  if abs(v_pct - 100) > 0.01 then
    raise exception 'The tenants'' shares total %%%, not 100%%. Adjust them by %%%.',
      to_char(v_pct,'FM999990.00'), to_char(100 - v_pct,'FM999990.00') using errcode = '22023';
  end if;

  -- No applicant twice.
  select array_agg(lower(btrim(x->>'email'))) into v_emails from jsonb_array_elements(p_tenants) x;
  if (select count(distinct e) from unnest(v_emails) e) <> v_n then
    raise exception 'Two tenants have the same email address.' using errcode = '22023';
  end if;

  -- THE PRICE, resolved once for the whole tenancy at this tenant count, then
  -- apportioned by the one apportionment function the form previewed with.
  select f.fee_amount, f.fee_basis_weeks, f.agreement_id
    into v_fee, v_basis, v_agreement
  from public.resolve_fee(p_branch, v_route, p_rent, v_n) f;
  v_fees := public.apportion(v_fee, v_pcts);

  insert into public.tenancies (monthly_rent, tenancy_start, prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode)
  values (p_rent, p_tenancy_start, btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')),''),
          btrim(p_city), nullif(btrim(coalesce(p_county,'')),''), upper(btrim(p_postcode)))
  returning id into v_tenancy;

  for t in select value from jsonb_array_elements(p_tenants) with ordinality as e(value, ord) order by ord loop
    v_i := v_i + 1;
    v_share_pct := (t->>'share_percent')::numeric;
    v_share_rent := round(p_rent * v_share_pct / 100.0, 2);

    perform public.assert_referral_valid(
      p_branch, t->>'title', t->>'first', t->>'last', (t->>'dob')::date, t->>'email', t->>'phone',
      p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

    insert into public.applications(
      guarantee_ref, fee_amount, fee_basis_weeks, pricing_agreement_id,
      tenancy_id, tenancy_position, share_percent, share_amount,
      branch_id, agency_id, partner_id, referrer_id, referrer_name,
      tenant_title, tenant_first_name, tenant_middle_name, tenant_last_name,
      tenant_dob, tenant_email, tenant_phone,
      prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
      monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode, referencing_mode
    ) values (
      'GR-' || nextval('public.guarantee_ref_seq')::text,
      v_fees[v_i], v_basis, v_agreement,
      -- THE ORDER THE AGENT ENTERED THEM. Tenant 1 leads the tenancy; without
      -- this every applicant shares one created_at and the lead is a coin toss.
      v_tenancy, v_i, v_share_pct, v_share_rent,
      p_branch, ag, v_route, auth.uid(),
      (select full_name from public.users where id = auth.uid()),
      t->>'title', btrim(t->>'first'), nullif(btrim(coalesce(t->>'middle','')),''), btrim(t->>'last'),
      (t->>'dob')::date, btrim(t->>'email'), btrim(t->>'phone'),
      btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')),''), btrim(p_city),
      nullif(btrim(coalesce(p_county,'')),''), upper(btrim(p_postcode)),
      -- The WHOLE rent: the guarantee covers the tenancy, and the bordereau
      -- premium is 13.5% of one month's rent for it. share_amount above carries
      -- the applicant's slice, which is what they are referenced against.
      p_rent, p_tenancy_start, 'sent', now(),
      (select r.partner_rate from public.resolve_rates(p_branch, v_route) r),
      -- The rail is opndoor_referenced by the guard above, so the commission is
      -- always the additive split; the old else-arm was unreachable and is gone.
      public.commission_total(p_branch, v_route, v_n),
      true, v_mode
    ) returning * into v_app;

    insert into public.application_commission_lines (application_id, level, org_id, org_name, rate, basis_amount)
    select v_app.id, s.level, s.org_id, s.org_name, s.rate, v_fees[v_i]
    from public.commission_split(p_branch, v_route, v_n) s;

    return next v_app;
  end loop;
end $function$;

comment on function public.create_joint_referral(uuid, jsonb, text, text, text, text, text, numeric, date) is
  'One tenancy, N applicants, atomically, on the AGENT RAIL ONLY. The fee is resolved once at the tenant count and split by share to the penny (the last applicant takes the rounding), so each tenant pays their own share through their own journey and the shares sum to exactly one fee. A pre-referenced origin is refused: its references are done before the referral arrives and it covers one tenant.';

revoke all on function public.create_joint_referral(uuid, jsonb, text, text, text, text, text, numeric, date) from public, anon;
grant execute on function public.create_joint_referral(uuid, jsonb, text, text, text, text, text, numeric, date) to authenticated;

-- ---------------------------------------------------------------------------
-- The same question, answerable by the FORM before it offers the button.
--
-- By name, because that is what the picker holds, and partner-qualified because
-- an admin on "all partners" can name an agency that exists under two. Falls
-- back to the partner's own mode for an agency that does not exist yet, which
-- is what a fly-created one will inherit.
-- ---------------------------------------------------------------------------
create or replace function public.origin_referencing_mode(
  p_agency text, p_branch text, p_partner_slug text
)
returns text
language plpgsql stable security definer set search_path to ''
as $function$
declare v_branch uuid; v_partner uuid; v_route uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  if p_partner_slug is not null and btrim(p_partner_slug) <> '' then
    select id into v_partner from public.partners where slug = p_partner_slug;
  end if;
  -- Only an admin may ask about a partner other than their own.
  if v_partner is not null and not public.is_admin()
     and v_partner is distinct from public.app_partner() then
    return null;
  end if;

  select b.id into v_branch
  from public.branches b join public.agencies a on a.id = b.agency_id
  where b.name = p_branch and a.name = p_agency
    and (v_partner is null or b.partner_id = v_partner)
  limit 1;

  -- Adds no reach: an agent cannot learn another agency's rail by typing its name.
  if v_branch is not null and not (
       public.is_admin()
       or exists (select 1 from public.branches b2 where b2.id = v_branch
                   and (public.app_reachable_agency(b2.agency_id)
                        or (public.app_has_scope() and b2.id in (select public.app_scope_branches()))
                        or b2.id = (select u.home_branch_id from public.users u where u.id = auth.uid()))))
  then
    v_branch := null;
  end if;

  if v_branch is null then
    -- No such branch yet. It will be created under this partner, so the partner's
    -- own mode is the honest answer.
    return (select p.referencing_mode from public.partners p where p.id = v_partner);
  end if;

  v_route := public.resolve_route_partner(v_branch, null);
  return public.resolve_referencing_mode(v_branch, v_route);
end $function$;

comment on function public.origin_referencing_mode(text, text, text) is
  'The rail a referral against this agent and branch would actually run on, resolved by the same functions create_joint_referral uses. The form asks so it can offer multi-tenant only where a joint tenancy is real.';

revoke all on function public.origin_referencing_mode(text, text, text) from public, anon;
grant execute on function public.origin_referencing_mode(text, text, text) to authenticated;
