-- Outbound webhook registry and per-delivery queue. See PARTNER-API.md §13.
--
-- No outbound webhook infrastructure exists in this codebase. This is all new.
--
-- THE DESIGN CONSTRAINT, STATED AS AN ANTI-GOAL. hubspot-sync is a cursor-driven
-- feed: it reads one watermark, processes in order, advances the cursor only on
-- success, and on the first error does
--
--     break; // stop; cursor holds at last success; the batch retries next run
--     (hubspot-sync/index.ts:354)
--
-- so one permanently failing event blocks every later event, for every partner,
-- for ever, silently. That is the failure mode this schema exists to make
-- impossible.
--
-- Hence ONE ROW PER ENDPOINT PER EVENT, each with its own attempt counter and
-- its own next_attempt_at. Two endpoints subscribed to the same event get two
-- independent rows that succeed or fail independently. A poisoned payload
-- retries and eventually dead-letters on its own row while everything behind it
-- keeps flowing. There is no shared cursor to hold.

-- ---------- endpoint registry ----------
create table if not exists public.partner_webhook_endpoints (
  id          uuid primary key default gen_random_uuid(),
  partner_id  uuid not null references public.partners(id) on delete cascade,

  url         text not null,

  -- PER ENDPOINT, not per partner. Rotating one endpoint's secret must not
  -- disturb another's, and a partner running staging and production should not
  -- share a signing key between them.
  secret      text not null,

  -- Subscribed event types. Empty means all.
  events      text[] not null default '{}',

  active      boolean not null default true,
  description text,

  created_at  timestamptz not null default now(),

  last_success_at      timestamptz,
  last_failure_at      timestamptz,
  consecutive_failures int not null default 0,

  -- https only. An outbound webhook carries tenant PII and a signature; over
  -- plain http both are readable in transit.
  constraint partner_webhook_endpoints_https check (url like 'https://%')
);

create index if not exists partner_webhook_endpoints_partner_idx
  on public.partner_webhook_endpoints (partner_id) where active;

alter table public.partner_webhook_endpoints enable row level security;
revoke all on table public.partner_webhook_endpoints from anon, authenticated;

comment on table public.partner_webhook_endpoints is
  'Where a partner receives events. Multiple endpoints per partner are intentional, so a partner can run staging and production or migrate without a cutover. Service-role only.';
comment on column public.partner_webhook_endpoints.secret is
  'Per-endpoint HMAC signing secret. Never returned after creation.';

-- ---------- per-delivery queue ----------
create table if not exists public.partner_webhook_deliveries (
  id           uuid primary key default gen_random_uuid(),
  endpoint_id  uuid not null references public.partner_webhook_endpoints(id) on delete cascade,

  -- Stable across retries. Partners dedupe on this.
  event_id     uuid not null default gen_random_uuid(),
  event_type   text not null,

  application_id uuid references public.applications(id) on delete set null,

  -- RENDERED AT ENQUEUE AND NEVER RE-RENDERED. A retry three hours later must
  -- deliver what was true when the event happened, not what is true now.
  -- Re-rendering would make retries deliver out-of-order snapshots, so a partner
  -- replaying a backlog would see the present state labelled with a past event.
  payload      jsonb not null,

  attempts        int not null default 0,
  next_attempt_at timestamptz not null default now(),

  last_status  int,
  last_error   text,

  delivered_at timestamptz,
  dead_at      timestamptz,

  -- Set while a dispatcher run holds the row, so a crashed run's rows become
  -- claimable again rather than being stuck.
  claimed_at   timestamptz,

  created_at   timestamptz not null default now()
);

-- The queue index. Partial, so it stays small: settled rows drop out of it
-- rather than accumulating.
create index if not exists partner_webhook_deliveries_due_idx
  on public.partner_webhook_deliveries (next_attempt_at)
  where delivered_at is null and dead_at is null;

create index if not exists partner_webhook_deliveries_endpoint_idx
  on public.partner_webhook_deliveries (endpoint_id, created_at desc);

create index if not exists partner_webhook_deliveries_application_idx
  on public.partner_webhook_deliveries (application_id)
  where application_id is not null;

-- One delivery per endpoint per event. The enqueue path is driven by a trigger,
-- so a status write that somehow fires twice must not produce two deliveries.
create unique index if not exists partner_webhook_deliveries_once_idx
  on public.partner_webhook_deliveries (endpoint_id, application_id, event_type)
  where application_id is not null;

alter table public.partner_webhook_deliveries enable row level security;
revoke all on table public.partner_webhook_deliveries from anon, authenticated;

comment on table public.partner_webhook_deliveries is
  'One row per endpoint per event, each retrying independently. Deliberately not a shared cursor: see the header for the hubspot-sync failure mode this exists to avoid.';
comment on column public.partner_webhook_deliveries.payload is
  'Rendered at enqueue and immutable. A retry delivers what was true when the event happened, not the current state.';
comment on column public.partner_webhook_deliveries.dead_at is
  'Set after the final attempt. Dead rows are retained for inspection and manual replay, never silently dropped.';
