-- Idempotency ledger for the partner API. See PARTNER-API.md section 11.
--
-- WHY THIS IS THE HIGHEST-VALUE SAFEGUARD IN THE API. Nothing prevents a
-- duplicate application today. public.applications has no unique constraint
-- beyond guarantee_ref, and the only guard on the portal create path is a
-- client-side advisory duplicate scan the user can override. A repeated submit
-- creates a second application, a second Stripe Checkout Session and a second
-- payment email to the tenant.
--
-- For a form driven by a human that is an occasional annoyance. For an API it is
-- the normal case: retries after a timeout are expected behaviour for any
-- competent client, and without this a network blip bills a tenant twice.
--
-- Follows the house ledger pattern (stripe_events, pandadoc_events,
-- hubspot_sync_events): record before the work, key on something the caller
-- controls, make a replay cheap.
--
-- ALSO CARRIES PROVENANCE. Which partner and which key created an application is
-- recorded HERE and deliberately not on public.applications. An API-created
-- application must be indistinguishable from a manually entered one in the
-- portal, so nothing downstream can branch on how it arrived. The link is
-- application_id, followed from this side only.

create table if not exists public.partner_api_requests (
  id              uuid primary key default gen_random_uuid(),
  partner_id      uuid not null references public.partners(id) on delete cascade,
  api_key_id      uuid references public.partner_api_keys(id) on delete set null,

  idempotency_key text not null,
  endpoint        text not null,

  -- Hash of the canonicalised request body. Distinguishes a genuine retry from
  -- the same key being reused for a different application, which is the case
  -- that would otherwise silently return the wrong application's details.
  request_hash    text not null,

  -- Null while in flight. Set once the work completes, success or failure.
  status_code     int,
  response_body   jsonb,

  application_id  uuid references public.applications(id) on delete set null,

  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

-- The idempotency contract. Scoped per partner so two partners cannot collide,
-- and per endpoint so the same key on a different endpoint is a different
-- request.
create unique index if not exists partner_api_requests_idem_idx
  on public.partner_api_requests (partner_id, endpoint, idempotency_key);

create index if not exists partner_api_requests_partner_idx
  on public.partner_api_requests (partner_id, created_at desc);

create index if not exists partner_api_requests_application_idx
  on public.partner_api_requests (application_id)
  where application_id is not null;

alter table public.partner_api_requests enable row level security;
revoke all on table public.partner_api_requests from anon, authenticated;

comment on table public.partner_api_requests is
  'Idempotency ledger and provenance record for the partner API. Service-role only. Provenance lives here rather than on applications so an API-created application stays indistinguishable from a manually entered one.';
comment on column public.partner_api_requests.request_hash is
  'Hash of the canonicalised body. A repeat with the same hash replays the stored response; a repeat with a different hash is a 409 rather than a silent wrong answer.';
comment on column public.partner_api_requests.response_body is
  'RETENTION: holds full response bodies including tenant PII, and grows by one row per request. Needs a retention policy before this sees real volume. Recorded as an open question in PARTNER-API.md.';
