-- A FROZEN LINE NAMES ITS SOURCE, AND ITS BASIS.
--
-- 20261004130000 taught the commission RULE to say where a rate came from, so
-- the agency page could stop calling Regent's negotiated 20% "Opndoor standard".
-- That fixed the live preview. It did not fix reporting, because reporting does
-- not read the rule — it reads the SNAPSHOT, and the snapshot froze four columns
-- out of the five the rule now produces. "Commission earned, labelled by source"
-- had nowhere to read the source from.
--
-- Deriving it at read time was the tempting shortcut and is wrong. Two of the
-- three sources ('rate', and 'agreement' at a level) are facts about live org
-- state: an agency that had an explicit rate in March and an agreement in April
-- would have its March statement silently relabelled the day the agreement was
-- signed. The table's own comment is the rule — "frozen like the scalar rate,
-- never recomputed, so history cannot move" — and a source that moves is not
-- frozen. So it is stored, at creation, alongside the rate it describes.
--
-- Two corrections ride along, because they are the same insert:
--
--   * create_referral never wrote basis_amount. create_joint_referral did. A
--     single-tenant line therefore had a rate and no statement of what the rate
--     was a share OF, and the commission statement (which must foot to
--     settlement) had to reach back to the application for it on some rows and
--     not others.
--   * Both wrote the insert out longhand. There are now two of them and they had
--     already drifted by one column, so the insert becomes ONE function that
--     both call. Freezing happens in one place or it diverges again.
--
-- HISTORIC ROWS KEEP A NULL SOURCE, and are not backfilled. We do not know what
-- the source was; a guess stamped onto a settled statement is worse than an
-- honest blank, and the client renders the blank as no label rather than as
-- "standard".

alter table public.application_commission_lines
  add column if not exists source text;

do $$ begin
  alter table public.application_commission_lines
    add constraint acl_source_chk
    check (source is null or source in ('standard','agreement','rate'));
exception when duplicate_object then null; end $$;

comment on column public.application_commission_lines.source is
  'Where this line''s rate came from, frozen at creation: standard (the partner''s rate, nobody having negotiated), agreement (a negotiated pricing agreement at that level) or rate (an explicit rate set on that party). Null on rows created before this was recorded — unknown, never guessed.';

comment on table public.application_commission_lines is
  'The commission split snapshotted onto an application at creation: one row per payee, each naming its rate, the amount that rate is a share of, and where the rate came from. Frozen like the scalar rate - never recomputed, so history cannot move.';

-- ---------------------------------------------------------------------------
-- THE ONE PLACE A SPLIT IS FROZEN. Both create paths call this and neither
-- writes the insert itself, so the two cannot drift apart a second time.
-- ---------------------------------------------------------------------------
create or replace function public.freeze_commission_lines(
  p_application uuid, p_branch uuid, p_route_partner uuid,
  p_tenant_count int, p_basis numeric
)
returns void
language sql security definer set search_path to ''
as $function$
  insert into public.application_commission_lines
    (application_id, level, org_id, org_name, rate, basis_amount, source)
  select p_application, s.level, s.org_id, s.org_name, s.rate, p_basis, s.source
  from public.commission_split(p_branch, p_route_partner, p_tenant_count) s
$function$;

comment on function public.freeze_commission_lines(uuid, uuid, uuid, int, numeric) is
  'Snapshot the additive split onto an application: one row per payee, with the basis the rate applies to and the slot the rate came out of. Called by create_referral and create_joint_referral; the only writer of application_commission_lines.';

revoke all on function public.freeze_commission_lines(uuid, uuid, uuid, int, numeric) from public, anon;
grant execute on function public.freeze_commission_lines(uuid, uuid, uuid, int, numeric) to service_role;

-- ---------------------------------------------------------------------------
-- The two create paths, unchanged but for the last statement before the return.
-- ---------------------------------------------------------------------------
create or replace function public.create_referral(
  p_branch uuid, p_tenant_title text, p_first text, p_last text, p_dob date,
  p_email text, p_phone text, p_addr1 text, p_addr2 text, p_city text,
  p_county text, p_postcode text, p_rent numeric, p_tenancy_start date
)
returns public.applications
language plpgsql security definer set search_path to ''
as $function$
declare
  a public.applications; ag uuid; pid uuid; v_route uuid; v_mode text;
  v_portal_ok boolean; prate numeric; arate numeric;
  v_fee numeric; v_basis numeric; v_agreement uuid; v_estate boolean;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  perform public.assert_referral_valid(
    p_branch, p_tenant_title, p_first, p_last, p_dob, p_email, p_phone,
    p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

  select b.agency_id, b.partner_id into ag, pid from public.branches b where b.id = p_branch;
  if ag is null then raise exception 'Selected branch not found' using errcode = '22023'; end if;

  if not (public.is_admin()
          or (public.app_role() in ('management','referrer') and pid = public.app_partner())) then
    raise exception 'not permitted for this partner' using errcode = '42501';
  end if;

  v_route := public.resolve_route_partner(p_branch, null);
  select p.portal_referrals_enabled into v_portal_ok from public.partners p where p.id = v_route;
  if not found then raise exception 'Route partner not found' using errcode = '22023'; end if;

  -- WHO CHECKS THE TENANT. The agency's own mode if it has said, else the route
  -- partner's. This is the journey, and it is what gets frozen onto the row.
  v_mode := public.resolve_referencing_mode(p_branch, v_route);
  -- WHAT KIND OF RELATIONSHIP. Never overridden by the answer above.
  v_estate := public.is_agent_estate(p_branch, v_route);

  -- Position ladder: a property of the ESTATE. An agency's staff refer against
  -- their own branches whether or not Opndoor checks their tenants.
  if not public.is_admin() and v_estate then
    if not (case
              when public.app_has_scope()
                then p_branch in (select public.app_scope_branches())
              else p_branch = (select u.home_branch_id from public.users u where u.id = auth.uid())
            end) then
      raise exception 'You can only refer against a branch within your own scope.' using errcode = '42501';
    end if;
  end if;

  -- THE PRICE. Rail-agnostic already: the agreement decides, standard terms are
  -- one month's rent exactly, a negotiated basis is weeks of rent.
  select f.fee_amount, f.fee_basis_weeks, f.agreement_id
    into v_fee, v_basis, v_agreement
  from public.resolve_fee(p_branch, v_route, p_rent, 1) f;

  -- COMMISSION: the ESTATE's additive split, or the flat snapshotted rates.
  select r.partner_rate, r.agent_rate into prate, arate
  from public.resolve_rates(p_branch, v_route) r;
  if v_estate then
    arate := public.commission_total(p_branch, v_route, 1);
  end if;

  if not coalesce(v_portal_ok, true) then
    raise exception 'This partner does not create referrals in the portal.' using errcode = '42501';
  end if;

  insert into public.applications(
    guarantee_ref, fee_amount, fee_basis_weeks, pricing_agreement_id,
    branch_id, agency_id, partner_id, referrer_id, referrer_name,
    tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
    prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
    monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode,
    referencing_mode
  ) values (
    'GR-' || nextval('public.guarantee_ref_seq')::text,
    v_fee, v_basis, v_agreement,
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
end $function$;

comment on function public.create_referral(uuid, text, text, text, date, text, text, text, text, text, text, text, numeric, date) is
  'Portal create path. Freezes the fee and the commission at creation. Two independent questions: the ESTATE (is_agent_estate) decides the position ladder and whether commission is the additive split; the JOURNEY (resolve_referencing_mode) is frozen onto referencing_mode and decides whether the tenant is invited to an eligibility form or sent straight to payment. An agency that references its own tenants is still our agency.';

revoke all on function public.create_referral(uuid, text, text, text, date, text, text, text, text, text, text, text, numeric, date) from public, anon;
grant execute on function public.create_referral(uuid, text, text, text, date, text, text, text, text, text, text, text, numeric, date) to authenticated;

create or replace function public.create_joint_referral(
  p_branch uuid, p_tenants jsonb,
  p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text,
  p_rent numeric, p_tenancy_start date
)
returns setof public.applications
language plpgsql security definer set search_path to ''
as $function$
declare
  ag uuid; pid uuid; v_route uuid; v_mode text; v_portal_ok boolean; v_estate boolean;
  v_n int; v_pct numeric; v_fee numeric; v_basis numeric; v_agreement uuid;
  v_tenancy uuid; t jsonb; v_share_pct numeric; v_share_rent numeric;
  v_pcts numeric[]; v_fees numeric[]; v_emails text[]; v_i int := 0;
  v_app public.applications;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  v_n := jsonb_array_length(p_tenants);
  if v_n is null or v_n < 2 then
    raise exception 'A joint tenancy needs at least two tenants.' using errcode = '22023';
  end if;

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
  v_estate := public.is_agent_estate(p_branch, v_route);

  -- THE ESTATE, not the journey. A supplier hands us finished referrals one
  -- tenant at a time and has no org tree to split commission across; one of our
  -- agencies has both, whoever referenced the tenants.
  if not v_estate then
    raise exception 'A joint tenancy needs an agency of ours to sit under, and this referral comes from a partner who sends them one tenant at a time. Refer each tenant separately.'
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
      v_tenancy, v_i, v_share_pct, v_share_rent,
      p_branch, ag, v_route, auth.uid(),
      (select full_name from public.users where id = auth.uid()),
      t->>'title', btrim(t->>'first'), nullif(btrim(coalesce(t->>'middle','')),''), btrim(t->>'last'),
      (t->>'dob')::date, btrim(t->>'email'), btrim(t->>'phone'),
      btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')),''), btrim(p_city),
      nullif(btrim(coalesce(p_county,'')),''), upper(btrim(p_postcode)),
      p_rent, p_tenancy_start, 'sent', now(),
      (select r.partner_rate from public.resolve_rates(p_branch, v_route) r),
      public.commission_total(p_branch, v_route, v_n),
      -- The JOURNEY, per tenant. Regent's applicants are pre-referenced, so each
      -- one goes straight to their own payment link for their own share.
      true, v_mode
    ) returning * into v_app;

    -- The basis is this applicant's SHARE of the tenancy fee, not the whole
    -- fee: their commission line is a share of what they themselves paid, and
    -- the lines across the tenancy foot to the tenancy's commission.
    perform public.freeze_commission_lines(v_app.id, p_branch, v_route, v_n, v_fees[v_i]);

    return next v_app;
  end loop;
end $function$;

comment on function public.create_joint_referral(uuid, jsonb, text, text, text, text, text, numeric, date) is
  'One tenancy, N applicants, atomically, for an agency of OUR estate — whoever referenced the tenants. The fee is resolved once at the tenant count and split by share to the penny (the last applicant takes the rounding). Each applicant''s journey follows resolve_referencing_mode: pre-referenced tenants go straight to their own payment link for their own share.';

revoke all on function public.create_joint_referral(uuid, jsonb, text, text, text, text, text, numeric, date) from public, anon;
grant execute on function public.create_joint_referral(uuid, jsonb, text, text, text, text, text, numeric, date) to authenticated;
