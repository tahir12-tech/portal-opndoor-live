-- Read model for GET /applications and GET /applications/{id}.
-- See PARTNER-API.md sections 5 and 10.
--
-- DEFAULT DENY, ENFORCED IN SQL. Every column is named. There is no select * and
-- no row passthrough, so a column added to applications later cannot reach a
-- partner by accident. This is the same posture as partner_webhook_payload, and
-- for the same reason: the field list is the security boundary, so it should be
-- somewhere a reviewer can read it in one place rather than spread across a
-- serializer.
--
-- DELIBERATELY EXCLUDED, each for a reason:
--   partner_rate, agent_rate        commission terms. NOTE these are snapshotted
--                                   onto applications, so excluding the partners
--                                   table is not enough on its own
--   paid_amount, refunded_amount    money movement is not the partner's business
--   stripe_*, pandadoc_*            allow direct correlation with our accounts
--   executed_pdf_path               a storage object key
--   payment_state, deed_state       internal state machines. status is the
--                                   contract; these change shape as the product does
--   withdrawn_by, withdrawn_note,
--   withdrawn_reason, expired_at    internal closure detail, and see DEFECTS.md 10:
--                                   these survive reinstatement and would mislead
--   partner_id, referrer_id         internal identifiers and cross-tenant handles
--   referrer_name                   the partner sent an email, not a name; the
--                                   name is ours to manage and may be a placeholder

-- ---------- the partner-facing status vocabulary ----------
-- The stored values are internal. Two of them read badly outside:
--
--   'deed'    describes a column, not an outcome
--   'expired' collides with the OTHER expiry in this system. status='expired'
--             means an unpaid application lapsed after 14 days; expiry_date is
--             the guarantee expiring 12 months after tenancy start. Those are
--             months apart and mean opposite things commercially.
--
-- The webhook events already use application.lapsed and application.deed_issued.
-- This makes the REST surface agree with them, so a partner does not have to
-- learn that "lapsed" in an event is "expired" in a payload.
create or replace function public.partner_status(p_status text)
returns text language sql immutable as $function$
  select case p_status
    when 'deed'    then 'deed_issued'
    when 'expired' then 'lapsed'
    else p_status
  end
$function$;

comment on function public.partner_status(text) is
  'Maps an internal application status to the partner-facing vocabulary. Keeps the REST surface consistent with the webhook event names, which already say lapsed and deed_issued.';

grant execute on function public.partner_status(text) to service_role;

-- ---------- the read model ----------
-- One function serves both endpoints. p_id null lists; p_id set fetches one.
-- Having a single field list serve both is the point: two functions would drift,
-- and the one that drifted would be the one nobody looked at.
create or replace function public.partner_api_applications(
  p_partner uuid,
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
    and (p_id is null or a.id = p_id)
    and (p_status is null or a.status = p_status)
    -- Keyset pagination on (created_at, id). Stable under insert, unlike offset,
    -- which would silently skip rows as new applications arrive during a walk.
    and (p_cursor_created_at is null
         or (a.created_at, a.id) < (p_cursor_created_at, p_cursor_id))
  order by a.created_at desc, a.id desc
  limit least(coalesce(p_limit, 50), 100);
$function$;

comment on function public.partner_api_applications(uuid, uuid, text, int, timestamptz, uuid) is
  'Partner-safe application read model, serving both the list and single-fetch endpoints. Every column named explicitly: commission rates including the snapshots on applications, money amounts, Stripe and PandaDoc identifiers, storage paths and internal state are all excluded by construction. p_partner comes from the verified API key and is never optional.';

revoke all on function public.partner_api_applications(uuid, uuid, text, int, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.partner_api_applications(uuid, uuid, text, int, timestamptz, uuid) to service_role;

-- ---------- make the webhook payload agree ----------
-- Stage D emitted the raw stored status, so a payload said status "expired"
-- while its own event was named application.lapsed. Same value, two vocabularies,
-- in the same delivery. Corrected here rather than left for a partner to
-- discover.
create or replace function public.partner_webhook_payload(p_application uuid, p_event text)
returns jsonb
language sql security definer set search_path to '' stable
as $function$
  select jsonb_build_object(
    'event_type', p_event,
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
