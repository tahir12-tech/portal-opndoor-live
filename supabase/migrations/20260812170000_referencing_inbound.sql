-- ===========================================================================
-- Rail 4: the referencing provider hands us a tenant who needs a guarantor.
--
-- THE CONTRACT, from the integration documents
--   inbound   POST <our base>/GuarantorApi/save_guarantor_user_data
--             Authorization: Basic base64(agency_secret_token)
--             overall_status "Pass with guarantor", plus tenant, property,
--             landlord, the reference reports as base64, and table_id
--   outbound  POST <their base>/CRMApi/update_gurantor_required_user_detail
--             Authorization: Basic base64(EMAIL:PASSWORD:TOKEN)
--             TableID, CompanyID, AgencyID, UserID, TenantID,
--             PolicyDocument, PolicyDocument_Base64, PaymentStatus
--   (the outbound path really is spelled "gurantor". Not a typo to fix here.)
--
-- ---------------------------------------------------------------------------
-- THE NAMED SEAM: IS agency_secret_token PER AGENCY OR GLOBAL?
-- ---------------------------------------------------------------------------
-- Unanswered, and it decides whether this receiver is multi-tenant. Rather than
-- guess, the token table is built so BOTH answers work without a schema change:
--
--   per agency   one row per provider agency, each with its own token and its
--                own agency_number. The inbound resolves the agency FROM the
--                token, which is the strong form: a leaked token compromises
--                one agency.
--   global       one row with agency_number NULL. The token authenticates the
--                provider as a whole and the agency comes from the payload,
--                which is weaker, because the payload is then trusted for
--                something the token should have established.
--
-- The receiver already implements both: it resolves the agency from the token
-- when the token is scoped, and falls back to the payload when it is not, and
-- it RECORDS which happened on every event. So the seam closes by inserting
-- rows, not by writing code. Until it is answered, seed one global token and
-- read `agency_from_token` on the events to see what is actually happening.
--
-- Tokens are stored HASHED, like partner API keys. A token table readable in
-- the clear is a table of credentials for somebody else's system.
-- ===========================================================================

create table if not exists public.referencing_inbound_tokens (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  token_hash  text not null unique,
  token_prefix text,

  -- NULL means this token authenticates the provider globally and the agency
  -- must come from the payload. Non-null means the token IS the agency, which
  -- is the form to prefer if the provider supports it.
  agency_number text,

  -- Where an application arriving on this token is attributed. Defaults to the
  -- house referencing route.
  partner_id  uuid references public.partners(id) on delete restrict,

  livemode    boolean not null default true,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz
);

alter table public.referencing_inbound_tokens enable row level security;
-- No policies: service_role only. These are another system's credentials.

comment on table public.referencing_inbound_tokens is
  'Shared secrets the referencing provider presents on the inbound hand-over, stored hashed. agency_number NULL means the token is global and the agency comes from the payload; non-null means the token identifies the agency, which is the stronger form. Both are supported so the open question closes by inserting rows rather than by changing code.';

-- ---------------------------------------------------------------------------
-- The replay ledger.
--
-- The inbound carries no event id, so table_id is the idempotency key: it is
-- the provider's own handle for the letting record and is what we must quote
-- back. A repeat for the same table_id is a retry, not a second tenant.
--
-- Same shape as stripe_events: record first, act second, so a redelivery that
-- arrives while the first is still running is refused rather than duplicated.
-- ---------------------------------------------------------------------------
create table if not exists public.referencing_inbound_events (
  table_id       bigint primary key,
  token_id       uuid references public.referencing_inbound_tokens(id) on delete set null,

  -- Which way the agency was established. The evidence that closes the seam.
  agency_from_token boolean not null default false,

  tenant_reference_number text,
  overall_status text,

  application_id uuid references public.applications(id) on delete set null,
  status_code    int,
  error          text,

  -- Exactly as received, for audit and dispute. NEVER exposed on any
  -- partner-facing surface: PARTNER-API section 15.3 is the rule and this is
  -- the table it describes.
  raw_payload    jsonb not null,

  received_at    timestamptz not null default now(),
  completed_at   timestamptz
);

alter table public.referencing_inbound_events enable row level security;
-- No policies: service_role only. raw_payload holds the provider's vocabulary.

comment on table public.referencing_inbound_events is
  'One row per inbound hand-over, keyed on the provider''s table_id, which is both the idempotency key and the handle we must quote back on the callback. raw_payload is stored for audit and is never exposed on a partner-facing surface (PARTNER-API 15.3).';

-- ---------------------------------------------------------------------------
-- What we must remember in order to call back.
--
-- A separate table rather than five columns on applications: the referral path
-- would carry five permanently-null columns, each needing its own grant, to
-- describe a relationship it does not have.
-- ---------------------------------------------------------------------------
create table if not exists public.application_provider_links (
  application_id uuid primary key references public.applications(id) on delete cascade,
  table_id   bigint not null,
  company_id text,
  agency_id  text,
  user_id    text,
  tenant_id  text,
  agency_number text,
  tenant_reference_number text,

  -- The callback's own state. Set when we have told them the policy exists.
  notified_at timestamptz,
  notify_error text,
  notify_attempts int not null default 0,

  created_at timestamptz not null default now(),
  unique (table_id)
);

alter table public.application_provider_links enable row level security;
drop policy if exists provider_links_select on public.application_provider_links;
create policy provider_links_select on public.application_provider_links
  for select to authenticated
  using (exists (select 1 from public.applications a where a.id = application_id));

comment on table public.application_provider_links is
  'The provider identifiers an inbound application must quote back when its policy document exists: TableID, CompanyID, AgencyID, UserID, TenantID. Separate from applications because the referral path has no such relationship and would carry five null columns to say so.';

-- ---------------------------------------------------------------------------
-- Creating the application for an inbound hand-over.
--
-- Starts at 'sent', NOT at a new state. It arrives already referenced, which is
-- the same shape as the API rail: awaiting the guarantee fee with a link out.
-- Starting at 'sent' inherits the payment link, the chasers, the 15-day lapse
-- and deed generation with nothing new written. See 20260812050000.
-- ---------------------------------------------------------------------------
create or replace function public.create_referencing_inbound_application(
  p_table_id bigint,
  p_partner uuid,
  p_title text, p_first text, p_last text, p_dob date, p_email text, p_phone text,
  p_addr1 text, p_city text, p_postcode text,
  p_rent numeric, p_tenancy_start date,
  p_company text, p_agency text, p_user text, p_tenant text,
  p_agency_number text, p_tenant_ref text
) returns public.applications
language plpgsql security definer set search_path to ''
as $function$
declare v_branch uuid; v_agency uuid; a public.applications; v_existing uuid;
begin
  -- Idempotent at the business level as well as the ledger level: a retry that
  -- got past the ledger must not create a second application.
  select application_id into v_existing
  from public.application_provider_links where table_id = p_table_id;
  if v_existing is not null then
    select * into a from public.applications where id = v_existing;
    return a;
  end if;

  select b.id, b.agency_id into v_branch, v_agency
  from public.branches b
  join public.agencies ag on ag.id = b.agency_id
  where ag.partner_id = p_partner and b.name = 'Unattached'
  limit 1;
  if v_branch is null then
    raise exception 'The referencing route has no house branch' using errcode = '22023';
  end if;

  insert into public.applications (
    guarantee_ref, branch_id, agency_id, partner_id, referrer_id, referrer_name,
    tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
    prop_addr1, prop_city, prop_postcode,
    monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode,
    referencing_mode, applicant_id
  ) values (
    'GR-' || nextval('public.guarantee_ref_seq')::text, v_branch, v_agency, p_partner,
    -- No referrer: nobody here referred them. Legal since 20260812090000, and
    -- applications_referrer_required is satisfied by the applicant account the
    -- caller attaches immediately after this.
    null, 'Referencing hand-over',
    p_title, btrim(p_first), btrim(p_last), p_dob, btrim(p_email), btrim(p_phone),
    btrim(p_addr1), btrim(p_city), upper(btrim(p_postcode)),
    p_rent, p_tenancy_start, 'sent', now(), 0, 0, true,
    'pre_referenced_open',
    -- Attached by the caller once the applicant account exists. Null here would
    -- violate applications_referrer_required, so the caller passes it.
    null
  ) returning * into a;

  insert into public.application_provider_links
    (application_id, table_id, company_id, agency_id, user_id, tenant_id, agency_number, tenant_reference_number)
  values (a.id, p_table_id, p_company, p_agency, p_user, p_tenant, p_agency_number, p_tenant_ref);

  return a;
end $function$;

revoke all on function public.create_referencing_inbound_application(bigint, uuid, text, text, text, date, text, text, text, text, text, numeric, date, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_referencing_inbound_application(bigint, uuid, text, text, text, date, text, text, text, text, text, numeric, date, text, text, text, text, text, text) to service_role;

-- Which applications are waiting to be told about. Drives the callback.
create or replace function public.provider_callbacks_due()
returns table (application_id uuid, table_id bigint, company_id text, agency_id text,
               user_id text, tenant_id text, guarantee_ref text, payment_status text)
language sql stable security definer set search_path to '' as $$
  select l.application_id, l.table_id, l.company_id, l.agency_id, l.user_id, l.tenant_id,
         a.guarantee_ref,
         case when a.payment_state = 'paid' then 'Paid' else 'Pending' end
  from public.application_provider_links l
  join public.applications a on a.id = l.application_id
  where l.notified_at is null
    and a.deed_state = 'executed'          -- the policy document exists
    and a.livemode
  order by l.created_at asc
$$;

revoke all on function public.provider_callbacks_due() from public, anon;
grant execute on function public.provider_callbacks_due() to service_role;

comment on function public.provider_callbacks_due() is
  'Inbound applications whose deed is executed and whose provider has not been told. The callback carries the policy document and the payment status; until it lands, their letting record still shows a guarantor required.';
