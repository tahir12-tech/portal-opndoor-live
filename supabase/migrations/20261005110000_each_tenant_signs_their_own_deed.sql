-- EACH TENANT SIGNS THEIR OWN DEED. This supersedes the firing-unit ruling of
-- 20261002100000, and is close to a revert of it.
--
-- That migration made the TENANCY the unit for everything after the money: one
-- deed, carried by the lead, naming everyone. It was a coherent reading and it
-- produced two things nobody wanted. A joint tenant who had paid their share sat
-- at "Paid" for ever with no deed of their own and nothing to sign, and the
-- guarantee they were told they had was a document in somebody else's name.
--
-- THE RULING NOW:
--
--   * Each tenant gets their own deed, generated as soon as THAT tenant has
--     paid. Not once the tenancy is fully paid: a tenant who has paid has bought
--     something and should receive it, and waiting on a co-tenant is a delay
--     they cannot act on.
--   * Each deed covers that tenant's OWN SHARE of the rent (share_amount), and
--     names all the tenants and the tenancy, so the document says what it is
--     part of.
--   * The guarantee reference stays per deed, exactly as today. The earlier
--     draft of this ruling had one reference per tenancy with a counterpart
--     suffix; guarantee_ref is `text unique not null` and is the lookup key of
--     six edge functions, the payment-page token, the /applications/:ref route
--     and the storage path, so that would have been a change to referencing
--     itself. Each application already mints its own inside create_joint_referral's
--     loop. Nothing here touches it.
--   * Expiry and renewal are per deed. The is_tenancy_lead filter that kept
--     expiry reminders to one per tenancy comes out: each tenant holds a
--     guarantee and each is told when theirs is ending.
--
-- SINGLE TENANT IS BYTE-IDENTICAL, and that is asserted, not asserted-about. A
-- tenancy of one has no tenancy_id, so every "co-tenant" answer below is null
-- and every gate reduces to the solo gate it already was.

-- ---------------------------------------------------------------------------
-- 1. THE SHARE OF RENT MUST SUM TO THE RENT.
--
-- The FEE is split with apportion(), so the shares sum to the fee to the penny
-- and the last tenant takes the rounding. share_amount — the share of RENT —
-- was not: create_joint_referral rounds each tenant independently. At £1,750
-- three ways the shares sum to £1,750.01; at £2,995 across six, two pence over.
--
-- That was invisible while the bordereau billed ONE premium on the whole rent.
-- Under this ruling the premium is 13.5% of one month of each tenant's share, so
-- the drift goes to the underwriter and the assertion "the tenancy's premiums
-- sum to 13.5% of one month's full rent" would fail on exactly the tenancies
-- that do not divide evenly. Same arithmetic as the fee, same function.
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
  ag uuid; pid uuid; v_route uuid; v_mode text; v_portal_ok boolean; v_estate boolean;
  v_n int; v_pct numeric; v_fee numeric; v_basis numeric; v_agreement uuid;
  v_tenancy uuid; t jsonb; v_share_pct numeric;
  v_pcts numeric[]; v_fees numeric[]; v_rents numeric[]; v_emails text[]; v_i int := 0;
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
      v_tenancy, v_i, v_share_pct, v_rents[v_i],
      p_branch, ag, v_route, auth.uid(),
      (select full_name from public.users where id = auth.uid()),
      t->>'title', btrim(t->>'first'), nullif(btrim(coalesce(t->>'middle','')),''), btrim(t->>'last'),
      (t->>'dob')::date, btrim(t->>'email'), btrim(t->>'phone'),
      btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')),''), btrim(p_city),
      nullif(btrim(coalesce(p_county,'')),''), upper(btrim(p_postcode)),
      p_rent, p_tenancy_start, 'sent', now(),
      (select r.partner_rate from public.resolve_rates(p_branch, v_route) r),
      public.commission_total(p_branch, v_route, v_n),
      true, v_mode
    ) returning * into v_app;

    perform public.freeze_commission_lines(v_app.id, p_branch, v_route, v_n, v_fees[v_i]);

    return next v_app;
  end loop;
end $function$;

comment on function public.create_joint_referral(uuid, jsonb, text, text, text, text, text, numeric, date) is
  'One tenancy, N applicants, atomically, for an agency of OUR estate. BOTH the fee and the rent are apportioned to the penny by public.apportion, the last applicant taking the rounding, so the fees sum to the tenancy fee and the share_amounts sum to the rent exactly. Each applicant''s journey follows resolve_referencing_mode; each gets their own deed once they have paid.';

revoke all on function public.create_joint_referral(uuid, jsonb, text, text, text, text, text, numeric, date) from public, anon;
grant execute on function public.create_joint_referral(uuid, jsonb, text, text, text, text, text, numeric, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. THE DEED TARGET IS THE APPLICATION AGAIN.
--
-- tenancy_deed_target answered for the tenancy: which row leads, and is the
-- WHOLE tenancy paid. Both questions go. What survives, and is new, is the
-- context each tenant's own document needs: who else is on the tenancy, and
-- what this tenant's share is.
--
-- Dropped and recreated rather than replaced: Postgres will not widen a
-- function's OUT columns in place, and the two callers (claim_tenancy_deed and
-- release_tenancy_deed_claim) are rewritten below in the same migration.
-- ---------------------------------------------------------------------------
drop function if exists public.claim_tenancy_deed(uuid);
drop function if exists public.release_tenancy_deed_claim(uuid);
drop function if exists public.tenancy_deed_target(uuid);

create or replace function public.deed_target(p_application uuid)
returns table (
  application_id uuid,
  ready boolean,
  tenant_names text,
  co_tenant_names text,
  tenant_count int,
  unpaid_count int,
  share_amount numeric,
  share_percent numeric,
  tenancy_id uuid
)
language sql stable security definer set search_path to ''
as $function$
  with me as (select * from public.applications where id = p_application)
  select
    m.id,
    -- THIS TENANT'S OWN GATE. A tenant who has paid gets their deed; a tenant
    -- who has not, does not; and nobody waits on anybody else. For a tenancy of
    -- one this is exactly the gate it always was.
    m.paid_at is not null,
    -- ALL the names, for the document to say whose tenancy it is. Null on a
    -- tenancy of one, which is what keeps a single-tenant deed byte-identical:
    -- createAndSend falls back to the applicant's own name, as before.
    case when m.tenancy_id is null then null else public.tenancy_tenant_names(m.id) end,
    -- The OTHERS, for the co-tenant merge field. Null when there are none.
    case when m.tenancy_id is null then null else (
      select nullif(string_agg(
               btrim(o.tenant_first_name || ' ' || o.tenant_last_name),
               ', ' order by o.tenancy_position nulls last, o.created_at), '')
        from public.applications o
       where o.tenancy_id = m.tenancy_id and o.id <> m.id) end,
    -- A tenancy of one IS a tenancy of one. `a.tenancy_id = null` matches no
    -- row and returns 0, not null, so coalesce never fires: the solo case has to
    -- be named. The old function had the same coalesce and the same hole.
    case when m.tenancy_id is null then 1
         else (select count(*)::int from public.applications a
                where a.tenancy_id = m.tenancy_id) end,
    case when m.tenancy_id is null then (case when m.paid_at is null then 1 else 0 end)
         else (select count(*)::int from public.applications a
                where a.tenancy_id = m.tenancy_id and a.paid_at is null) end,
    -- What this deed covers. A tenancy of one covers the whole rent, which is
    -- what share_amount is null for and monthly_rent answers.
    coalesce(m.share_amount, m.monthly_rent),
    coalesce(m.share_percent, 100),
    m.tenancy_id
  from me m
$function$;

comment on function public.deed_target(uuid) is
  'Everything one tenant''s deed needs: whether THEY have paid, what their share of the rent is, and who else is on the tenancy. Replaces tenancy_deed_target, which answered for the tenancy as a whole and made every joint tenant wait on the slowest. A tenancy of one answers co_tenant_names null and share = the whole rent, so its document is unchanged.';

revoke all on function public.deed_target(uuid) from public, anon;
grant execute on function public.deed_target(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. THE RACE GUARD IS PER DEED.
--
-- Two webhooks for the same tenancy could both see "ready" and both generate.
-- That was a real race when the tenancy had one deed and the last payment
-- released it. Now each tenant's deed is released by their OWN payment, so the
-- race is the ordinary one: two deliveries of the same tenant's event. The
-- claim table is unchanged and still gives exactly that guard, keyed on the
-- application rather than on its tenancy's lead.
-- ---------------------------------------------------------------------------
create or replace function public.claim_tenancy_deed(p_application uuid)
returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare v_doc text; v_state text;
begin
  select pandadoc_document_id, deed_state into v_doc, v_state
    from public.applications where id = p_application;
  if not found then return false; end if;
  -- Already has a deed, or already failed into a state a human must clear.
  if v_doc is not null or v_state is not null then return false; end if;

  insert into public.tenancy_deed_claims (lead_application_id) values (p_application)
  on conflict (lead_application_id) do nothing;
  return found;
end $function$;

comment on function public.claim_tenancy_deed(uuid) is
  'Claim the right to generate THIS application''s deed, once. The column is still called lead_application_id for the table''s history; under the per-tenant ruling every applicant is its own lead and the claim is one per deed.';

create or replace function public.release_tenancy_deed_claim(p_application uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
begin
  delete from public.tenancy_deed_claims where lead_application_id = p_application;
end $function$;

revoke all on function public.claim_tenancy_deed(uuid) from public, anon, authenticated;
revoke all on function public.release_tenancy_deed_claim(uuid) from public, anon, authenticated;
grant execute on function public.claim_tenancy_deed(uuid) to service_role;
grant execute on function public.release_tenancy_deed_claim(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. EXPIRY IS PER DEED.
--
-- fire_expiry_reminders filtered to the tenancy lead, and its own comment called
-- that "belt and braces" because only the lead could reach status 'deed'
-- anyway. Both halves of that are now false: every tenant reaches 'deed', and
-- every tenant holds a guarantee that ends. One reminder each.
-- ---------------------------------------------------------------------------
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
      -- ONE REMINDER PER DEED. No tenancy filter: each tenant holds their own
      -- guarantee over their own share, and each is told when it ends.
    order by a.expiry_date, a.guarantee_ref
  loop
    d := r.expiry_date - p_today;
    k := case when d <= 7 then '7' when d <= 14 then '14' else '30' end;
    if exists (select 1 from public.expiry_reminders x
                where x.application_id = r.id and x.bucket = k) then
      continue;
    end if;
    insert into public.expiry_reminders (application_id, bucket) values (r.id, k)
    on conflict do nothing;
    if not found then continue; end if;
    application_id := r.id; guarantee_ref := r.guarantee_ref; days := d;
    expiry_date := r.expiry_date; agency := r.agency_name; branch := r.branch_name;
    referrer_id := r.referrer_id; referrer_email := r.ref_email; referrer_name := r.ref_name;
    partner_id := r.partner_id::text;
    prop := coalesce(r.prop_addr1, '') || case when r.prop_postcode is null then '' else ', ' || r.prop_postcode end;
    return next;
  end loop;
end $function$;

comment on function public.fire_expiry_reminders(date) is
  'Guarantees ending within 30 days, one reminder per DEED per bucket. Each tenant of a joint tenancy holds their own guarantee over their own share and is reminded about it; the tenancy-lead filter that made this one-per-tenancy came out with the per-tenant deed ruling.';
