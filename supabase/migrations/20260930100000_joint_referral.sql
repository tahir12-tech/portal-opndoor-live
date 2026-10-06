-- M5. JOINT TENANCIES, WIRED.
--
-- The tenancies schema has existed and been dormant since 20260812190000: one
-- tenancy, one guarantee, one deed, applicants as one application row each,
-- shares summing to 100% under a deferred constraint trigger. This connects it.
--
-- THE MONEY SHAPE, which is the part that can go silently wrong:
--   * The FEE is resolved once for the tenancy, from the agreement and the tenant
--     COUNT (Regent's: 2 tenants = 5 weeks at 25%).
--   * Each applicant's application carries THEIR SHARE of that fee in fee_amount,
--     so their own Stripe session charges their own share and the shares sum to
--     exactly one fee.
--   * Commission lines carry basis_amount, the fee share they were computed
--     against. Settlement multiplies per application row, so with each row
--     holding a share the sum is exactly one tenancy's commission — the
--     double-count hazard closed at the source rather than in every consumer.
--   * monthly_rent on each application stays the WHOLE tenancy rent, because that
--     is what the guarantee covers and what the bordereau premium is 13.5% of.
--     share_amount carries the applicant's slice for the eligibility test.
--
-- SINGLE TENANT IS UNCHANGED. create_referral is untouched; a tenancy of one has
-- no tenancy row, share 100% implied, and the same fee it has always had.

-- The base each commission line was computed against.
alter table public.application_commission_lines
  add column if not exists basis_amount numeric(10,2);
comment on column public.application_commission_lines.basis_amount is
  'The fee amount this line''s rate was applied to. On a joint tenancy it is the applicant''s share of the tenancy fee, which is what makes per-row settlement sum to one tenancy''s commission.';

-- Backfill: every existing line was computed against the whole fee.
update public.application_commission_lines l
   set basis_amount = a.fee_amount
  from public.applications a
 where a.id = l.application_id and l.basis_amount is null;

-- ---------------------------------------------------------------------------
-- THE FIRING UNIT. Deed generation, delivery, reminders and expiry are per
-- application and would fire N times for one tenancy. Rather than teach each of
-- them about tenancies, ONE application per tenancy is elected to carry them:
-- the earliest-created, which is Tenant 1 and is stable for the life of the
-- tenancy. A tenancy of one elects itself, so nothing about the single-tenant
-- path changes.
-- ---------------------------------------------------------------------------
create or replace function public.is_tenancy_lead(p_application uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select case
    when (select tenancy_id from public.applications where id = p_application) is null then true
    else p_application = (
      select a.id from public.applications a
      where a.tenancy_id = (select tenancy_id from public.applications where id = p_application)
      order by a.created_at, a.id
      limit 1)
  end
$function$;

comment on function public.is_tenancy_lead(uuid) is
  'Is this the one application that carries the tenancy''s deed, reminders and expiry? The earliest-created applicant, or trivially true for a tenancy of one. The election is stable and needs no new column.';

revoke all on function public.is_tenancy_lead(uuid) from public, anon;
grant execute on function public.is_tenancy_lead(uuid) to authenticated, service_role;

-- Has every applicant paid their share? The deed waits for the whole tenancy.
create or replace function public.tenancy_fully_paid(p_application uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  with t as (select tenancy_id from public.applications where id = p_application)
  select case
    when (select tenancy_id from t) is null
      then (select paid_at is not null from public.applications where id = p_application)
    else not exists (
      select 1 from public.applications a, t
      where a.tenancy_id = t.tenancy_id and a.paid_at is null)
  end
$function$;

revoke all on function public.tenancy_fully_paid(uuid) from public, anon;
grant execute on function public.tenancy_fully_paid(uuid) to authenticated, service_role;

-- Every tenant's name, for the one deed that names them all.
create or replace function public.tenancy_tenant_names(p_application uuid)
returns text
language sql stable security definer set search_path to ''
as $function$
  with t as (select tenancy_id from public.applications where id = p_application)
  select case
    when (select tenancy_id from t) is null
      then (select btrim(coalesce(tenant_first_name,'') || ' ' || coalesce(tenant_last_name,''))
              from public.applications where id = p_application)
    else (select string_agg(btrim(coalesce(a.tenant_first_name,'') || ' ' || coalesce(a.tenant_last_name,'')),
                            ', ' order by a.created_at, a.id)
            from public.applications a, t where a.tenancy_id = t.tenancy_id)
  end
$function$;

revoke all on function public.tenancy_tenant_names(uuid) from public, anon;
grant execute on function public.tenancy_tenant_names(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- CREATE A JOINT REFERRAL. One tenancy, N applicants, atomically.
--
-- p_tenants is an array of objects: title, first, last, dob, email, phone,
-- share_percent. Shares must sum to 100 (the deferred trigger enforces it at
-- commit; this checks early so the error names the gap).
-- ---------------------------------------------------------------------------
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
  v_tenancy uuid; t jsonb; v_share_pct numeric; v_share_fee numeric; v_share_rent numeric;
  v_app public.applications; v_running numeric := 0; v_i int := 0; v_emails text[];
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

  if not public.is_admin() and v_mode = 'opndoor_referenced' then
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
  select coalesce(sum((x->>'share_percent')::numeric), 0) into v_pct
  from jsonb_array_elements(p_tenants) x;
  if abs(v_pct - 100) > 0.01 then
    raise exception 'The tenants'' shares total %%%, not 100%%. Adjust them by %%%.',
      to_char(v_pct,'FM999990.00'), to_char(100 - v_pct,'FM999990.00') using errcode = '22023';
  end if;

  -- No applicant twice.
  select array_agg(lower(btrim(x->>'email'))) into v_emails from jsonb_array_elements(p_tenants) x;
  if (select count(distinct e) from unnest(v_emails) e) <> v_n then
    raise exception 'Two tenants have the same email address.' using errcode = '22023';
  end if;

  -- THE PRICE, resolved once for the whole tenancy at this tenant count.
  select f.fee_amount, f.fee_basis_weeks, f.agreement_id
    into v_fee, v_basis, v_agreement
  from public.resolve_fee(p_branch, v_route, p_rent, v_n) f;

  insert into public.tenancies (monthly_rent, tenancy_start, prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode)
  values (p_rent, p_tenancy_start, btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')),''),
          btrim(p_city), nullif(btrim(coalesce(p_county,'')),''), upper(btrim(p_postcode)))
  returning id into v_tenancy;

  for t in select * from jsonb_array_elements(p_tenants) loop
    v_i := v_i + 1;
    v_share_pct := (t->>'share_percent')::numeric;

    -- Penny-exact apportionment: the last applicant takes the rounding, so the
    -- shares add up to the fee rather than to the fee plus or minus a penny.
    if v_i = v_n then
      v_share_fee := round(v_fee - v_running, 2);
    else
      v_share_fee := round(v_fee * v_share_pct / 100.0, 2);
      v_running := v_running + v_share_fee;
    end if;
    v_share_rent := round(p_rent * v_share_pct / 100.0, 2);

    perform public.assert_referral_valid(
      p_branch, t->>'title', t->>'first', t->>'last', (t->>'dob')::date, t->>'email', t->>'phone',
      p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

    insert into public.applications(
      guarantee_ref, fee_amount, fee_basis_weeks, pricing_agreement_id,
      tenancy_id, share_percent, share_amount,
      branch_id, agency_id, partner_id, referrer_id, referrer_name,
      tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
      prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
      monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode, referencing_mode
    ) values (
      'GR-' || nextval('public.guarantee_ref_seq')::text,
      v_share_fee, v_basis, v_agreement,
      v_tenancy, v_share_pct, v_share_rent,
      p_branch, ag, v_route, auth.uid(),
      (select full_name from public.users where id = auth.uid()),
      t->>'title', btrim(t->>'first'), btrim(t->>'last'), (t->>'dob')::date,
      btrim(t->>'email'), btrim(t->>'phone'),
      btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')),''), btrim(p_city),
      nullif(btrim(coalesce(p_county,'')),''), upper(btrim(p_postcode)),
      -- The WHOLE rent: the guarantee covers the tenancy, and the bordereau
      -- premium is 13.5% of one month's rent for it.
      p_rent, p_tenancy_start, 'sent', now(),
      (select r.partner_rate from public.resolve_rates(p_branch, v_route) r),
      case when v_mode = 'opndoor_referenced'
           then public.commission_total(p_branch, v_route, v_n) else
           (select r.agent_rate from public.resolve_rates(p_branch, v_route) r) end,
      true, v_mode
    ) returning * into v_app;

    if v_mode = 'opndoor_referenced' then
      insert into public.application_commission_lines (application_id, level, org_id, org_name, rate, basis_amount)
      select v_app.id, s.level, s.org_id, s.org_name, s.rate, v_share_fee
      from public.commission_split(p_branch, v_route, v_n) s;
    end if;

    return next v_app;
  end loop;
end $function$;

comment on function public.create_joint_referral(uuid, jsonb, text, text, text, text, text, numeric, date) is
  'One tenancy, N applicants, atomically. The fee is resolved once at the tenant count and split by share to the penny (the last applicant takes the rounding), so each tenant pays their own share through their own journey and the shares sum to exactly one fee. Commission lines carry the share they were computed against, which is what stops per-row settlement double-counting a joint tenancy.';

revoke all on function public.create_joint_referral(uuid, jsonb, text, text, text, text, text, numeric, date) from public, anon;
grant execute on function public.create_joint_referral(uuid, jsonb, text, text, text, text, text, numeric, date) to authenticated;
