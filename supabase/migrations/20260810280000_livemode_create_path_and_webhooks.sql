-- livemode, part three: the chain from the API key to the row it creates.
--
-- The rule this file exists to enforce is that livemode NEVER comes from a
-- request payload. It comes from the API key, and nowhere else. A partner cannot
-- opt into sandbox by sending a flag, and cannot escape it either. The only
-- thing that changes when they go live is which key they send.
--
-- ---------------------------------------------------------------------------
-- WHY p_livemode HAS NO DEFAULT, AND WHY THE OLD SIGNATURE IS DROPPED
-- ---------------------------------------------------------------------------
-- Giving it `default true` would look harmless and be the worst outcome
-- available. Postgres would keep the old 16-argument function alongside the new
-- 17-argument one, and any caller still passing 16 arguments would resolve to
-- the OLD function, which knows nothing about livemode and inserts a live row.
-- A sandbox key would then silently mint live applications: real commission,
-- real bordereau, real partner email, and a test tenant in HubSpot.
--
-- A mandatory argument plus an explicit DROP of the old signature turns that
-- entire failure mode into a hard error at deploy time. If anything still calls
-- the old shape, it breaks loudly instead of billing someone.

-- ---------- the portal create path ----------
-- No behaviour change. create_referral only ever makes live rows, and the column
-- default already guaranteed that. Setting it explicitly says so at the site
-- rather than relying on a default a future ALTER could change, and it is what
-- makes this function honest to livemode_audit() rather than exempt from it.
create or replace function public.create_referral(p_branch uuid, p_tenant_title text, p_first text, p_last text, p_dob date, p_email text, p_phone text, p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text, p_rent numeric, p_tenancy_start date)
 returns applications
 language plpgsql security definer set search_path to ''
as $function$
declare ag uuid; pid uuid; prate numeric; arate numeric; a public.applications;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  perform public.assert_referral_valid(
    p_branch, p_tenant_title, p_first, p_last, p_dob, p_email, p_phone,
    p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

  select b.agency_id, b.partner_id, p.partner_rate, p.agent_rate
    into ag, pid, prate, arate
  from public.branches b
  join public.partners p on p.id = b.partner_id
  where b.id = p_branch;
  if ag is null then raise exception 'Selected branch not found' using errcode = '22023'; end if;
  if not (public.is_admin()
          or (public.app_role() in ('management','referrer') and pid = public.app_partner())) then
    raise exception 'not permitted for this partner' using errcode = '42501';
  end if;

  insert into public.applications(
    guarantee_ref, branch_id, agency_id, partner_id, referrer_id, referrer_name,
    tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
    prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
    monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode
  ) values (
    'GR-' || nextval('public.guarantee_ref_seq')::text, p_branch, ag, pid, auth.uid(),
    (select full_name from public.users where id = auth.uid()),
    p_tenant_title, btrim(p_first), btrim(p_last), p_dob, btrim(p_email), btrim(p_phone),
    btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')), ''), btrim(p_city),
    nullif(btrim(coalesce(p_county,'')), ''), upper(btrim(p_postcode)),
    p_rent, p_tenancy_start, 'sent', now(), prate, arate, true
  ) returning * into a;
  return a;
end $function$;

-- ---------- the API create path ----------
drop function if exists public.create_referral_api(
  uuid, uuid, uuid, text, text, text, date, text, text,
  text, text, text, text, text, numeric, date);

create function public.create_referral_api(
  p_partner uuid,
  -- Second, immediately beside the partner, because the two together are the
  -- identity of the caller. A mandatory argument must also precede the defaulted
  -- ones, and it is the argument most likely to be read by a human scanning a
  -- call site.
  p_livemode boolean,
  p_referrer uuid,
  p_branch uuid,
  p_tenant_title text, p_first text, p_last text, p_dob date, p_email text, p_phone text,
  p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text,
  p_rent numeric, p_tenancy_start date
) returns public.applications
language plpgsql security definer set search_path to ''
as $function$
declare ag uuid; pid uuid; prate numeric; arate numeric; a public.applications; rname text;
        v_branch_live boolean; v_ref text;
begin
  if p_partner is null then raise exception 'Partner is required.' using errcode = '22023'; end if;
  if p_referrer is null then raise exception 'Referrer is required.' using errcode = '22023'; end if;
  -- Null would fall through every `if not p_livemode` test below and produce a
  -- live row. Reject it rather than coalescing to a guess.
  if p_livemode is null then raise exception 'livemode is required.' using errcode = '22023'; end if;

  -- Same rules as the portal, from the same function.
  perform public.assert_referral_valid(
    p_branch, p_tenant_title, p_first, p_last, p_dob, p_email, p_phone,
    p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

  select b.agency_id, b.partner_id, p.partner_rate, p.agent_rate, b.livemode
    into ag, pid, prate, arate, v_branch_live
  from public.branches b
  join public.partners p on p.id = b.partner_id
  where b.id = p_branch;

  if ag is null then raise exception 'Selected branch not found' using errcode = '22023'; end if;

  -- The cross-partner guard. Deliberately the same message whether the branch
  -- belongs to another partner or does not exist, so the API cannot be used to
  -- probe for the existence of another partner's orgs.
  if pid <> p_partner then
    raise exception 'Selected branch not found' using errcode = '22023';
  end if;

  -- The cross-MODE guard, and it reuses that same message for the same reason.
  -- A sandbox key must not be able to attach a rehearsal to a real branch, and a
  -- live key must not attach real money to a branch that only exists for
  -- testing. Without this, a developer who guesses or is given a live branch id
  -- puts a sandbox row on a real agency's record.
  if v_branch_live is distinct from p_livemode then
    raise exception 'Selected branch not found' using errcode = '22023';
  end if;

  -- The referrer must belong to this partner too. Without this, a partner could
  -- attribute an application to another partner's user.
  select u.full_name into rname
  from public.users u
  where u.id = p_referrer and u.partner_id = p_partner;

  if not found then
    raise exception 'Referrer not found for this partner.' using errcode = '22023';
  end if;

  -- Separate sequences, and a prefix nobody can mistake. A sandbox GR-20604 next
  -- to a real GR-20603 in a support conversation is an incident waiting to
  -- happen; GR-TEST-4 is not. It also keeps the live sequence free of gaps
  -- proportional to rehearsal volume.
  v_ref := case when p_livemode
                then 'GR-'      || nextval('public.guarantee_ref_seq')::text
                else 'GR-TEST-' || nextval('public.guarantee_ref_sandbox_seq')::text
           end;

  insert into public.applications(
    guarantee_ref, branch_id, agency_id, partner_id, referrer_id, referrer_name,
    tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
    prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
    monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode
  ) values (
    v_ref, p_branch, ag, p_partner, p_referrer,
    rname,
    p_tenant_title, btrim(p_first), btrim(p_last), p_dob, btrim(p_email), btrim(p_phone),
    btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')), ''), btrim(p_city),
    nullif(btrim(coalesce(p_county,'')), ''), upper(btrim(p_postcode)),
    p_rent, p_tenancy_start, 'sent', now(), prate, arate, p_livemode
  ) returning * into a;

  return a;
end $function$;

revoke all on function public.create_referral_api(
  uuid, boolean, uuid, uuid, text, text, text, date, text, text,
  text, text, text, text, text, numeric, date) from public, anon, authenticated;
grant execute on function public.create_referral_api(
  uuid, boolean, uuid, uuid, text, text, text, date, text, text,
  text, text, text, text, text, numeric, date) to service_role;

-- ---------- the API read path ----------
-- Same treatment and the same reasoning: mandatory argument, old signature
-- dropped. A defaulted p_livemode here would mean a sandbox key silently reading
-- the partner's real applications, which is a data breach rather than a bug.
drop function if exists public.partner_api_applications(
  uuid, uuid, text, int, timestamptz, uuid);

create function public.partner_api_applications(
  p_partner uuid,
  p_livemode boolean,
  p_id uuid default null,
  p_status text default null,
  p_limit int default 50,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns table (
  id             uuid,
  guarantee_ref  text,
  status         text,
  created_at     timestamptz,
  sent_at        timestamptz,
  paid_at        timestamptz,
  deed_issued_at timestamptz,
  expiry_date    date,
  tenant_title   text,
  tenant_first   text,
  tenant_last    text,
  tenant_dob     date,
  tenant_email   text,
  tenant_phone   text,
  addr1          text,
  addr2          text,
  city           text,
  county         text,
  postcode       text,
  monthly_rent   numeric,
  tenancy_start  date,
  agency_id      uuid,
  agency_name    text,
  branch_id      uuid,
  branch_name    text,
  payment_token  uuid
)
language sql security definer set search_path to '' stable
as $function$
  select
    a.id,
    a.guarantee_ref,
    public.partner_status(a.status),
    a.created_at, a.sent_at, a.paid_at, a.deed_issued_at, a.expiry_date,
    a.tenant_title, a.tenant_first_name, a.tenant_last_name, a.tenant_dob,
    a.tenant_email, a.tenant_phone,
    a.prop_addr1, a.prop_addr2, a.prop_city, a.prop_county, a.prop_postcode,
    a.monthly_rent, a.tenancy_start,
    a.agency_id, ag.name, a.branch_id, br.name,
    -- The payment token is returned ONLY while the application is still payable,
    -- matching payment-page's own definition of payable (index.ts:82). Once paid,
    -- withdrawn or issued there is nothing to pay and the link is noise.
    case when a.status in ('sent','expired') and coalesce(a.payment_state,'') <> 'refunded'
         then t.token else null end
  from public.applications a
  join public.agencies ag on ag.id = a.agency_id
  join public.branches br on br.id = a.branch_id
  left join public.payment_page_tokens t on t.application_id = a.id
  where a.partner_id = p_partner                       -- the scoping filter, never optional
    and a.livemode = p_livemode                        -- and neither is this one
    and (p_id is null or a.id = p_id)
    and (p_status is null or a.status = p_status)
    -- Keyset pagination on (created_at, id). Stable under insert, unlike offset,
    -- which would silently skip rows as new applications arrive during a walk.
    and (p_cursor_created_at is null
         or (a.created_at, a.id) < (p_cursor_created_at, p_cursor_id))
  order by a.created_at desc, a.id desc
  limit least(coalesce(p_limit, 50), 100);
$function$;

revoke all on function public.partner_api_applications(
  uuid, boolean, uuid, text, int, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.partner_api_applications(
  uuid, boolean, uuid, text, int, timestamptz, uuid) to service_role;

-- ---------- the webhook chain ----------
-- A sandbox event must reach only endpoints registered in sandbox, and a live
-- event only live endpoints. Matching rather than filtering: `e.livemode =
-- a.livemode` is one predicate that gets both directions right, where two
-- separate `if sandbox then` branches would eventually get one of them wrong.
create or replace function public.enqueue_partner_webhook(p_application uuid, p_event text)
returns integer
language plpgsql security definer set search_path to ''
as $function$
declare v_partner uuid; v_livemode boolean; v_payload jsonb; n int := 0;
begin
  select partner_id, livemode into v_partner, v_livemode
  from public.applications where id = p_application;
  if v_partner is null then return 0; end if;

  -- Render once, store per endpoint. Rendering here rather than at delivery is
  -- what makes a retry deliver the past, not the present.
  v_payload := public.partner_webhook_payload(p_application, p_event);
  if v_payload is null then return 0; end if;

  insert into public.partner_webhook_deliveries (endpoint_id, event_type, application_id, payload)
  select e.id, p_event, p_application, v_payload
  from public.partner_webhook_endpoints e
  where e.partner_id = v_partner
    and e.livemode = v_livemode
    and e.active
    and (cardinality(e.events) = 0 or p_event = any(e.events))
  on conflict do nothing;   -- the once-per-endpoint-per-event index

  get diagnostics n = row_count;
  return n;
end $function$;

-- livemode is in the payload for the same reason Stripe puts it there: a partner
-- whose sandbox and live handlers share code needs one field to branch on, and
-- an event that arrives at the wrong endpoint should be detectable by the
-- receiver rather than only by us.
create or replace function public.partner_webhook_payload(p_application uuid, p_event text)
returns jsonb
language sql security definer set search_path to '' stable
as $function$
  select jsonb_build_object(
    'event_type', p_event,
    'livemode',   a.livemode,
    'application', jsonb_build_object(
      'id',             a.id,
      'guarantee_ref',  a.guarantee_ref,
      'status',         public.partner_status(a.status),
      'created_at',     a.created_at,
      'sent_at',        a.sent_at,
      'paid_at',        a.paid_at,
      'deed_issued_at', a.deed_issued_at,
      'expiry_date',    a.expiry_date,
      'tenant', jsonb_build_object(
        'title',         a.tenant_title,
        'first_name',    a.tenant_first_name,
        'last_name',     a.tenant_last_name,
        'date_of_birth', a.tenant_dob,
        'email',         a.tenant_email,
        'phone',         a.tenant_phone
      ),
      'property', jsonb_build_object(
        'address_line_1', a.prop_addr1,
        'address_line_2', a.prop_addr2,
        'city',           a.prop_city,
        'county',         a.prop_county,
        'postcode',       a.prop_postcode
      ),
      'tenancy', jsonb_build_object(
        'monthly_rent', a.monthly_rent,
        'start_date',   a.tenancy_start
      ),
      'org', jsonb_build_object(
        'agency_id',   a.agency_id,
        'agency_name', ag.name,
        'branch_id',   a.branch_id,
        'branch_name', br.name
      )
    )
  )
  from public.applications a
  join public.agencies ag on ag.id = a.agency_id
  join public.branches br on br.id = a.branch_id
  where a.id = p_application;
$function$;

-- The last exemption, and the weakest-looking one, so it says why plainly.
insert into public.livemode_audit_exemptions (function_name, reason) values
  ('applications_emit_partner_webhook',
   'A trigger that decides an event name and delegates to enqueue_partner_webhook, which carries the predicate. It reads only new.status and new.id, never a list of applications, and it must fire for sandbox rows because rehearsing webhook delivery is the main thing sandbox is for. Adding a livemode reference here purely to satisfy the audit would be worse than the exemption: it would be a line of code with no purpose that a later reader has to work out.')
on conflict (function_name) do update set reason = excluded.reason;

-- ===========================================================================
-- THE ASSERTION
-- ===========================================================================
-- Zero is now achievable, so from here a non-empty audit fails the deploy.
--
-- This runs at migration time, which catches the state of the database today. It
-- does not, and cannot, catch a function somebody adds next month: that is what
-- the companion test in src/data/livemode.test.ts is for, which reads the
-- migration files themselves and runs in CI with no database. The two together
-- cover both directions. Neither alone does.
--
-- If this raises, do not add an exemption to make it stop. Read the function and
-- work out whether it can return a sandbox row to somebody who should not see
-- one. An exemption is a claim that it cannot, and the reason column is where you
-- write the argument.
do $$
declare v_rows text; v_count int;
begin
  select count(*), string_agg(format('  - %s (%s)', function_name, why), e'\n' order by function_name)
    into v_count, v_rows
  from public.livemode_audit();

  if v_count > 0 then
    raise exception e'\n\n%  SECURITY DEFINER function(s) read public.applications with no livemode predicate:\n\n%\n\nEach of these bypasses row level security completely and can return a sandbox\napplication to a caller who must never see one. Add the predicate, or add a row\nto public.livemode_audit_exemptions saying why it is safe.\n',
      v_count, v_rows;
  end if;

  raise notice 'livemode_audit: clean.';
end $$;
