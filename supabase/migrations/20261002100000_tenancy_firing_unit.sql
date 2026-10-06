-- M5, finished. THE TENANCY IS THE FIRING UNIT.
--
-- The money core landed in 20260930100000: one tenancy, N applicants, the fee
-- split to the penny. What still fired per APPLICATION was everything after the
-- money: deed generation, delivery, reminders and expiry. A two-tenant tenancy
-- would have produced two deeds for one guarantee.
--
-- Three things here, and only three:
--   1. APPORTION, extracted, so the form's preview and the referral itself split
--      a fee by exactly the same arithmetic rather than by two implementations
--      that agree until they don't.
--   2. TENANCY_DEED_TARGET, the one question the deed path asks: whose
--      application carries this tenancy's deed, is the tenancy ready for it, and
--      what are all the tenants called.
--   3. THE RENT BASIS an applicant is referenced against: their share, not the
--      whole tenancy's rent.
--
-- SINGLE TENANT IS UNCHANGED THROUGHOUT, and each function says how.

-- ---------------------------------------------------------------------------
-- 1. APPORTIONMENT. One fee, N shares, to the penny.
--
-- The last applicant takes the rounding, so the shares sum to the fee rather
-- than to the fee plus or minus a penny. This was inline in create_joint_referral;
-- it is extracted because the referral FORM has to show the same numbers before
-- anything is written, and a preview computed by different arithmetic is worse
-- than no preview.
-- ---------------------------------------------------------------------------
create or replace function public.apportion(p_total numeric, p_shares numeric[])
returns numeric[]
language plpgsql immutable set search_path to ''
as $function$
declare v_n int; v_i int; v_out numeric[] := '{}'; v_running numeric := 0; v_each numeric;
begin
  v_n := coalesce(array_length(p_shares, 1), 0);
  if v_n = 0 then return v_out; end if;
  for v_i in 1 .. v_n loop
    if v_i = v_n then
      v_each := round(p_total - v_running, 2);
    else
      v_each := round(p_total * coalesce(p_shares[v_i], 0) / 100.0, 2);
      v_running := v_running + v_each;
    end if;
    v_out := v_out || v_each;
  end loop;
  return v_out;
end $function$;

comment on function public.apportion(numeric, numeric[]) is
  'Split an amount across percentage shares to the penny, the last share taking the rounding so the parts sum to exactly the whole. The one implementation: create_joint_referral charges by it and the referral form previews by it.';

revoke all on function public.apportion(numeric, numeric[]) from public, anon;
grant execute on function public.apportion(numeric, numeric[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. THE FIRING UNIT. One question, asked once, by the deed path.
-- ---------------------------------------------------------------------------
create or replace function public.tenancy_deed_target(p_application uuid)
returns table (lead_id uuid, ready boolean, tenant_names text, tenant_count int, unpaid_count int)
language sql stable security definer set search_path to ''
as $function$
  with t as (select tenancy_id from public.applications where id = p_application),
  lead as (
    select case
      when (select tenancy_id from t) is null then p_application
      else (select a.id from public.applications a
            where a.tenancy_id = (select tenancy_id from t)
            order by a.created_at, a.id limit 1)
    end as id
  )
  select
    lead.id,
    -- A SOLO application's payment gate belongs to the caller and is unchanged:
    -- stripe-webhook already only reaches generateDeed on the paid transition,
    -- and the manual retry paths deliberately do not re-check. Only a JOINT
    -- tenancy adds a gate, because only a joint tenancy can be half paid.
    (select tenancy_id from t) is null or public.tenancy_fully_paid(lead.id),
    public.tenancy_tenant_names(lead.id),
    coalesce((select count(*)::int from public.applications a, t
              where a.tenancy_id = t.tenancy_id), 1),
    coalesce((select count(*)::int from public.applications a, t
              where a.tenancy_id = t.tenancy_id and a.paid_at is null), 0)
  from lead
$function$;

comment on function public.tenancy_deed_target(uuid) is
  'Everything the deed path needs to treat a tenancy as one unit: which application carries the deed (the earliest applicant, or the application itself when it stands alone), whether every applicant has paid, what all the tenants are called for the one document that names them, and how many are still outstanding. A solo application answers lead = itself, ready = true, so nothing about the single-tenant path changes.';

revoke all on function public.tenancy_deed_target(uuid) from public, anon;
grant execute on function public.tenancy_deed_target(uuid) to authenticated, service_role;

-- EXPIRY REMINDERS fire once per tenancy. Only the lead carries the deed, so
-- only the lead is ever in status 'deed' and this filter is belt and braces --
-- but it is the explicit statement of the rule, and it is what a test can assert.
create or replace function public.fire_expiry_reminders(p_today date)
  returns table (
    application_id uuid, guarantee_ref text, days int, expiry_date date,
    agency text, branch text, referrer_id uuid, referrer_email text,
    referrer_name text, partner_id text, prop text
  )
  language plpgsql security definer set search_path to ''
as $function$
declare r record; k text; d int;
begin
  for r in
    select a.id, a.guarantee_ref, a.expiry_date, a.referrer_id, a.partner_id,
           a.prop_addr1, a.prop_postcode,
           ag.name as agency_name, br.name as branch_name,
           u.email as ref_email, u.full_name as ref_name
    from public.applications a
    left join public.agencies ag on ag.id = a.agency_id
    left join public.branches br on br.id = a.branch_id
    left join public.users u on u.id = a.referrer_id
    where a.livemode
      and a.status = 'deed'
      and coalesce(a.payment_state, '') <> 'refunded'
      and a.expiry_date is not null
      and a.expiry_date >= p_today
      and a.expiry_date <= p_today + 30
      -- ONE REMINDER PER TENANCY. The guarantee is the tenancy's, not each
      -- applicant's, so a joint tenancy must not nudge the agent twice.
      and public.is_tenancy_lead(a.id)
  loop
    d := r.expiry_date - p_today;
    k := case when d <= 6 then 'd' || d when d <= 7 then '7' when d <= 14 then '14' else '30' end;
    insert into public.expiry_reminders (application_id, threshold, days_at_send)
      values (r.id, k, d) on conflict do nothing;
    if not found then continue; end if; -- already sent this threshold: skip
    update public.applications
      set expiry_reminders_sent = expiry_reminders_sent + 1, last_expiry_reminder_at = now()
      where id = r.id;
    insert into public.activity_log (application_id, kind, message, actor, visibility)
      values (r.id, 'expiry_reminder',
        'Expiry reminder: guarantee expires ' ||
          (case when d = 0 then 'today' when d = 1 then 'tomorrow' else 'in ' || d || ' days' end) ||
          ' (' || to_char(r.expiry_date, 'DD/MM/YYYY') || ').',
        'System', 'business');
    application_id := r.id; guarantee_ref := r.guarantee_ref; days := d; expiry_date := r.expiry_date;
    agency := r.agency_name; branch := r.branch_name; referrer_id := r.referrer_id;
    referrer_email := r.ref_email; referrer_name := r.ref_name; partner_id := r.partner_id;
    prop := nullif(trim(both ', ' from concat_ws(', ', r.prop_addr1, r.prop_postcode)), '');
    return next;
  end loop;
end $function$;

-- ---------------------------------------------------------------------------
-- 3. THE RENT BASIS an applicant is assessed and referenced against.
--
-- assess_eligibility has always taken a share and always preferred it (rule 1).
-- Its callers passed null, so every applicant on a joint tenancy was tested
-- against the WHOLE rent and the group capacity test was the only place shares
-- were honoured. One applicant on a £3,000 flat at a 50% share was being asked
-- to earn £54,000 rather than £27,000.
--
-- SINGLE TENANT IS BYTE-IDENTICAL: share_amount is the whole rent on a solo
-- referral, and coalesce covers the historic rows where it was never written.
-- ---------------------------------------------------------------------------
create or replace function public.application_rent_basis(p_application uuid)
returns numeric
language sql stable security definer set search_path to ''
as $function$
  select coalesce(a.share_amount, a.monthly_rent)
  from public.applications a where a.id = p_application
$function$;

comment on function public.application_rent_basis(uuid) is
  'The rent figure an applicant is assessed and referenced against: their own share of the tenancy, falling back to the whole rent when no share was ever recorded. One definition, so the prequalification, the portal and the outbound referencing submission cannot disagree about what this person was judged on.';

revoke all on function public.application_rent_basis(uuid) from public, anon;
grant execute on function public.application_rent_basis(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. THE FEE PREVIEW the referral form shows before anything is written.
--
-- By NAME, because that is what the form holds: the agent and branch pickers
-- deal in names and an agency may not exist yet. An unresolvable branch is not
-- an error, it is a brand-new agency, and a brand-new agency is on standard
-- terms -- which is exactly what a null branch resolves to.
-- ---------------------------------------------------------------------------
create or replace function public.referral_fee_preview(
  p_agency text, p_branch text, p_partner_slug text,
  p_rent numeric, p_shares numeric[]
)
returns table (
  fee_amount numeric, fee_basis_weeks numeric, is_standard boolean,
  agreement_id uuid, tenant_count int, shares numeric[]
)
language plpgsql stable security definer set search_path to ''
as $function$
declare v_branch uuid; v_route uuid; v_partner uuid; v_n int; f record;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  v_n := greatest(coalesce(array_length(p_shares, 1), 1), 1);

  if p_partner_slug is not null and btrim(p_partner_slug) <> '' then
    select id into v_partner from public.partners where slug = p_partner_slug;
  end if;

  select b.id into v_branch
  from public.branches b join public.agencies a on a.id = b.agency_id
  where b.name = p_branch and a.name = p_agency
    and (v_partner is null or b.partner_id = v_partner)
  limit 1;

  -- Only branches the caller can already see. The preview adds no reach: an
  -- agent cannot price another agency's deal by typing its name.
  if v_branch is not null and not (
       public.is_admin()
       or exists (select 1 from public.branches b2 where b2.id = v_branch
                   and (public.app_reachable_agency(b2.agency_id)
                        or (public.app_has_scope() and b2.id in (select public.app_scope_branches()))
                        or b2.id = (select u.home_branch_id from public.users u where u.id = auth.uid()))))
  then
    v_branch := null;
  end if;

  v_route := case when v_branch is null then v_partner
                  else public.resolve_route_partner(v_branch, null) end;

  select f2.fee_amount, f2.fee_basis_weeks, f2.agreement_id
    into f
  from public.resolve_fee(v_branch, v_route, p_rent, v_n) f2;

  fee_amount := coalesce(f.fee_amount, p_rent);
  fee_basis_weeks := coalesce(f.fee_basis_weeks, 4.35);
  agreement_id := f.agreement_id;
  is_standard := coalesce((select pa.is_standard from public.pricing_agreements pa where pa.id = f.agreement_id), true);
  tenant_count := v_n;
  shares := public.apportion(fee_amount, coalesce(p_shares, array[100]::numeric[]));
  return next;
end $function$;

comment on function public.referral_fee_preview(text, text, text, numeric, numeric[]) is
  'What this referral will cost, resolved from the agreement at the entered tenant count, and what each tenant''s share of it will be -- both computed by exactly the functions that will charge it. Resolves the branch by name because that is what the form holds, and falls back to standard terms for an agency that does not exist yet.';

revoke all on function public.referral_fee_preview(text, text, text, numeric, numeric[]) from public, anon;
grant execute on function public.referral_fee_preview(text, text, text, numeric, numeric[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. create_joint_referral: the middle name, and the extracted apportionment.
--    Same signature, so nothing that calls it changes.
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

  for t in select * from jsonb_array_elements(p_tenants) loop
    v_i := v_i + 1;
    v_share_pct := (t->>'share_percent')::numeric;
    v_share_rent := round(p_rent * v_share_pct / 100.0, 2);

    perform public.assert_referral_valid(
      p_branch, t->>'title', t->>'first', t->>'last', (t->>'dob')::date, t->>'email', t->>'phone',
      p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

    insert into public.applications(
      guarantee_ref, fee_amount, fee_basis_weeks, pricing_agreement_id,
      tenancy_id, share_percent, share_amount,
      branch_id, agency_id, partner_id, referrer_id, referrer_name,
      tenant_title, tenant_first_name, tenant_middle_name, tenant_last_name,
      tenant_dob, tenant_email, tenant_phone,
      prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
      monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode, referencing_mode
    ) values (
      'GR-' || nextval('public.guarantee_ref_seq')::text,
      v_fees[v_i], v_basis, v_agreement,
      v_tenancy, v_share_pct, v_share_rent,
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
      case when v_mode = 'opndoor_referenced'
           then public.commission_total(p_branch, v_route, v_n) else
           (select r.agent_rate from public.resolve_rates(p_branch, v_route) r) end,
      true, v_mode
    ) returning * into v_app;

    if v_mode = 'opndoor_referenced' then
      insert into public.application_commission_lines (application_id, level, org_id, org_name, rate, basis_amount)
      select v_app.id, s.level, s.org_id, s.org_name, s.rate, v_fees[v_i]
      from public.commission_split(p_branch, v_route, v_n) s;
    end if;

    return next v_app;
  end loop;
end $function$;

revoke all on function public.create_joint_referral(uuid, jsonb, text, text, text, text, text, numeric, date) from public, anon;
grant execute on function public.create_joint_referral(uuid, jsonb, text, text, text, text, text, numeric, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. ONE AUTOMATIC GENERATION PER TENANCY, even when the last two payments land
--    together.
--
-- The solo path is protected by the prior 'payment_received' marker: a second
-- Stripe event for the SAME application generates nothing. A joint tenancy has
-- no such marker, because the two events are for two DIFFERENT applications and
-- both legitimately see "everybody has paid". Whoever inserts this row first
-- generates; the other stands down.
--
-- Only the automatic post-payment path claims. A human pressing Resend or
-- Regenerate is a deliberate, single action and is not gated by this.
-- ---------------------------------------------------------------------------
create table if not exists public.tenancy_deed_claims (
  lead_application_id uuid primary key references public.applications(id) on delete cascade,
  claimed_at timestamptz not null default now()
);
alter table public.tenancy_deed_claims enable row level security;
revoke all on public.tenancy_deed_claims from anon, authenticated;

comment on table public.tenancy_deed_claims is
  'One row per tenancy whose deed the automatic post-payment path has taken responsibility for. Exists so two applicants paying at the same instant cannot both generate a deed for the one guarantee. Deleted again if generation fails, so the next event retries.';

create or replace function public.claim_tenancy_deed(p_application uuid)
returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare v_lead uuid; v_doc text; v_state text;
begin
  select t.lead_id into v_lead from public.tenancy_deed_target(p_application) t;
  if v_lead is null then return false; end if;

  select pandadoc_document_id, deed_state into v_doc, v_state
    from public.applications where id = v_lead;
  -- Already has a deed, or already failed into a state a human must clear.
  if v_doc is not null or v_state is not null then return false; end if;

  insert into public.tenancy_deed_claims (lead_application_id) values (v_lead)
  on conflict (lead_application_id) do nothing;
  return found;
end $function$;

create or replace function public.release_tenancy_deed_claim(p_application uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare v_lead uuid;
begin
  select t.lead_id into v_lead from public.tenancy_deed_target(p_application) t;
  delete from public.tenancy_deed_claims where lead_application_id = v_lead;
end $function$;

revoke all on function public.claim_tenancy_deed(uuid) from public, anon, authenticated;
revoke all on function public.release_tenancy_deed_claim(uuid) from public, anon, authenticated;
grant execute on function public.claim_tenancy_deed(uuid) to service_role;
grant execute on function public.release_tenancy_deed_claim(uuid) to service_role;
