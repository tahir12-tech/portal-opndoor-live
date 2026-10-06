-- THE LEAD APPLICANT MUST BE TENANT 1, AND WAS NOT.
--
-- is_tenancy_lead elected "the earliest-created" applicant, ordered by
-- created_at then id. Every applicant on a joint tenancy is inserted inside ONE
-- transaction, so created_at is identical for all of them to the microsecond and
-- the tiebreak falls through to a random UUID. The tenancy's lead — the one who
-- carries the deed, the reminders and the expiry — was therefore whichever
-- applicant happened to draw the lowest uuid, and tenancy_tenant_names listed
-- them in that same arbitrary order, so a two-person deed could be headed
-- "Daniel Okafor, Amelia Hartley" when the agent entered Amelia first.
--
-- Nothing about the MONEY was wrong: the fee is apportioned in the order the
-- tenants were submitted, which was always the array order. It is the ORDERING
-- that was never actually recorded, so this records it.
alter table public.applications
  add column if not exists tenancy_position int;

-- The column allow-list convention (20260918090000): authenticated selects the
-- columns it is granted, one at a time, and the rates are deliberately withheld.
-- The position is not commercially sensitive and the screen needs it to list
-- tenants in the order the agent entered them.
grant select (tenancy_position) on public.applications to authenticated;

comment on column public.applications.tenancy_position is
  'This applicant''s place in the tenancy as the agent entered it, 1-based. Tenant 1 leads: they carry the one deed, its reminders and its expiry, and the deed names everybody in this order. Null on a sole application, which is its own lead.';

-- Existing joint tenancies (none on dev at the time of writing) take the order
-- their guarantee references were assigned, which IS insertion order: the
-- sequence advances once per row in the order they were inserted.
with ranked as (
  select id, row_number() over (
           partition by tenancy_id
           order by (regexp_replace(guarantee_ref, '\D', '', 'g'))::bigint, id
         ) as pos
  from public.applications
  where tenancy_id is not null
)
update public.applications a set tenancy_position = r.pos
from ranked r where r.id = a.id and a.tenancy_position is distinct from r.pos;

-- ---------------------------------------------------------------------------
-- The three functions that depended on the accidental ordering.
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
      -- Position first. created_at is kept only as a fallback for any row that
      -- somehow has no position, and it is still tied for every row in a
      -- tenancy, which is exactly the bug this column exists to fix.
      order by a.tenancy_position nulls last, a.created_at, a.id
      limit 1)
  end
$function$;

comment on function public.is_tenancy_lead(uuid) is
  'Is this the one application that carries the tenancy''s deed, reminders and expiry? Tenant 1 as the agent entered them, or trivially true for a tenancy of one.';

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
                            ', ' order by a.tenancy_position nulls last, a.created_at, a.id)
            from public.applications a, t where a.tenancy_id = t.tenancy_id)
  end
$function$;

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
            order by a.tenancy_position nulls last, a.created_at, a.id limit 1)
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
    -- A solo application is a tenancy of one. "a.tenancy_id = null" matches
    -- nothing, so counting the joint way returns 0 rather than null and coalesce
    -- never fires: the solo case has to be named explicitly.
    case when (select tenancy_id from t) is null then 1
         else (select count(*)::int from public.applications a, t
               where a.tenancy_id = t.tenancy_id) end,
    case when (select tenancy_id from t) is null
         then (select case when paid_at is null then 1 else 0 end
               from public.applications where id = p_application)
         else (select count(*)::int from public.applications a, t
               where a.tenancy_id = t.tenancy_id and a.paid_at is null) end
  from lead
$function$;

-- ---------------------------------------------------------------------------
-- And the creation records it.
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
