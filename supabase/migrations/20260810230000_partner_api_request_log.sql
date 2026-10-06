-- A real request log for the partner API, and the Dev Centre monitoring queries.
--
-- WHY A NEW TABLE RATHER THAN partner_api_requests. That table is the
-- IDEMPOTENCY LEDGER, not a log. It records one row per idempotency key, only
-- for POST /applications, with a NOT NULL idempotency_key and a unique index on
-- (partner_id, endpoint, idempotency_key). Reads carry no idempotency key and
-- must not collide, so they cannot go in it. Every GET is therefore invisible
-- there, and monitoring built on it would tell a developer they made three
-- requests when they made thirty. Worse than no monitoring, because it looks
-- authoritative.
--
-- The two tables answer different questions and are deliberately separate:
--   partner_api_requests      did this exact request already happen
--   partner_api_request_log   what has been happening
--
-- It also records what the ledger cannot: method and path separately, the
-- duration, and the error code, which are the three things an integrator
-- actually filters on.
--
-- NO REQUEST OR RESPONSE BODIES. The ledger already stores response bodies for
-- replay and carries tenant PII with it. This is an observability table, queried
-- far more often and by more people, so it holds only metadata. A log that
-- accumulates PII becomes a liability rather than a tool.

create table if not exists public.partner_api_request_log (
  id            uuid primary key default gen_random_uuid(),
  partner_id    uuid references public.partners(id) on delete cascade,
  api_key_id    uuid references public.partner_api_keys(id) on delete set null,

  method        text not null,
  path          text not null,
  status_code   int  not null,
  -- The machine-readable error code from the response envelope, so the error
  -- distribution chart groups by cause rather than by status alone.
  error_code    text,
  duration_ms   int,

  -- Null when the request never authenticated, which is exactly the case worth
  -- being able to count.
  created_at    timestamptz not null default now()
);

-- The monitoring queries are all "this partner, this window", so lead with both.
create index if not exists partner_api_request_log_partner_time_idx
  on public.partner_api_request_log (partner_id, created_at desc);

-- Supports the error distribution chart without scanning the successes.
create index if not exists partner_api_request_log_errors_idx
  on public.partner_api_request_log (partner_id, created_at desc)
  where status_code >= 400;

alter table public.partner_api_request_log enable row level security;
revoke all on table public.partner_api_request_log from anon, authenticated;

comment on table public.partner_api_request_log is
  'Observability log for the partner API: one row per request, metadata only. Distinct from partner_api_requests, which is the idempotency ledger and only covers POST /applications. No bodies are stored here, deliberately.';

-- ---------- monitoring: the counters ----------
create or replace function public.dev_api_stats(p_partner uuid default null, p_days int default 7)
returns table (
  total_requests   bigint,
  failed_requests  bigint,
  success_requests bigint,
  distinct_paths   bigint,
  avg_duration_ms  numeric
)
language sql stable security definer set search_path to '' as $$
  select
    count(*),
    count(*) filter (where l.status_code >= 400),
    count(*) filter (where l.status_code < 400),
    count(distinct l.path),
    round(avg(l.duration_ms)::numeric, 0)
  from public.partner_api_request_log l
  where public.is_aal2()
    and l.created_at >= now() - make_interval(days => greatest(coalesce(p_days, 7), 1))
    and (
      (public.is_admin() and (p_partner is null or l.partner_id = p_partner))
      or (public.app_role() = 'developer' and l.partner_id = public.app_partner())
    );
$$;

revoke all on function public.dev_api_stats(uuid, int) from public, anon;
grant execute on function public.dev_api_stats(uuid, int) to authenticated;

-- ---------- monitoring: requests over time, split success and failed ----------
create or replace function public.dev_api_timeseries(p_partner uuid default null, p_days int default 7)
returns table (bucket date, succeeded bigint, failed bigint)
language sql stable security definer set search_path to '' as $$
  -- generate_series so empty days appear as zero rather than being missing,
  -- which would make a gap in traffic look like a gap in the chart's x axis.
  select d::date,
         coalesce(count(l.id) filter (where l.status_code < 400), 0),
         coalesce(count(l.id) filter (where l.status_code >= 400), 0)
  from generate_series(
         (now() - make_interval(days => greatest(coalesce(p_days, 7), 1)))::date,
         now()::date, interval '1 day') d
  left join public.partner_api_request_log l
    on l.created_at::date = d::date
   and (
     (public.is_admin() and (p_partner is null or l.partner_id = p_partner))
     or (public.app_role() = 'developer' and l.partner_id = public.app_partner())
   )
  where public.is_aal2()
  group by d
  order by d;
$$;

revoke all on function public.dev_api_timeseries(uuid, int) from public, anon;
grant execute on function public.dev_api_timeseries(uuid, int) to authenticated;

-- ---------- monitoring: error distribution by method ----------
create or replace function public.dev_api_errors_by_method(p_partner uuid default null, p_days int default 7)
returns table (method text, error_code text, errors bigint)
language sql stable security definer set search_path to '' as $$
  select l.method, coalesce(l.error_code, 'unknown'), count(*)
  from public.partner_api_request_log l
  where public.is_aal2()
    and l.status_code >= 400
    and l.created_at >= now() - make_interval(days => greatest(coalesce(p_days, 7), 1))
    and (
      (public.is_admin() and (p_partner is null or l.partner_id = p_partner))
      or (public.app_role() = 'developer' and l.partner_id = public.app_partner())
    )
  group by l.method, coalesce(l.error_code, 'unknown')
  order by count(*) desc;
$$;

revoke all on function public.dev_api_errors_by_method(uuid, int) from public, anon;
grant execute on function public.dev_api_errors_by_method(uuid, int) to authenticated;

-- ---------- monitoring: webhook health ----------
-- Delivery time is measured from enqueue to delivery, so it includes the wait
-- for the dispatcher as well as the partner's own response. That is the number
-- an integrator cares about: how long after the event did it actually arrive.
create or replace function public.dev_webhook_stats(p_partner uuid default null, p_days int default 7)
returns table (
  sent bigint, delivered bigint, failed bigint, dead bigint,
  min_ms numeric, avg_ms numeric, max_ms numeric
)
language sql stable security definer set search_path to '' as $$
  select
    count(*),
    count(*) filter (where d.delivered_at is not null),
    count(*) filter (where d.delivered_at is null and d.dead_at is null and d.attempts > 0),
    count(*) filter (where d.dead_at is not null),
    round(min(extract(epoch from (d.delivered_at - d.created_at)) * 1000)::numeric, 0),
    round(avg(extract(epoch from (d.delivered_at - d.created_at)) * 1000)::numeric, 0),
    round(max(extract(epoch from (d.delivered_at - d.created_at)) * 1000)::numeric, 0)
  from public.partner_webhook_deliveries d
  join public.partner_webhook_endpoints e on e.id = d.endpoint_id
  where public.is_aal2()
    and d.created_at >= now() - make_interval(days => greatest(coalesce(p_days, 7), 1))
    and (
      (public.is_admin() and (p_partner is null or e.partner_id = p_partner))
      or (public.app_role() = 'developer' and e.partner_id = public.app_partner())
    );
$$;

revoke all on function public.dev_webhook_stats(uuid, int) from public, anon;
grant execute on function public.dev_webhook_stats(uuid, int) to authenticated;

-- ---------- logs: the filterable request table ----------
create or replace function public.dev_api_logs(
  p_partner uuid default null,
  p_search  text default null,
  p_days    int  default 7,
  p_limit   int  default 200
)
returns table (
  id uuid, method text, path text, status_code int, error_code text,
  duration_ms int, created_at timestamptz, key_name text
)
language sql stable security definer set search_path to '' as $$
  select l.id, l.method, l.path, l.status_code, l.error_code,
         l.duration_ms, l.created_at, k.name
  from public.partner_api_request_log l
  left join public.partner_api_keys k on k.id = l.api_key_id
  where public.is_aal2()
    and l.created_at >= now() - make_interval(days => greatest(coalesce(p_days, 7), 1))
    and (
      (public.is_admin() and (p_partner is null or l.partner_id = p_partner))
      or (public.app_role() = 'developer' and l.partner_id = public.app_partner())
    )
    and (
      p_search is null or btrim(p_search) = ''
      or l.path ilike '%' || btrim(p_search) || '%'
      or l.method ilike '%' || btrim(p_search) || '%'
      or coalesce(l.error_code, '') ilike '%' || btrim(p_search) || '%'
      or l.status_code::text = btrim(p_search)
    )
  order by l.created_at desc
  limit least(coalesce(p_limit, 200), 1000);
$$;

revoke all on function public.dev_api_logs(uuid, text, int, int) from public, anon;
grant execute on function public.dev_api_logs(uuid, text, int, int) to authenticated;

-- ---------- the writer ----------
-- Called by the Edge Function with the service role. Never raises: an
-- observability write must not be able to fail the request it is observing.
create or replace function public.log_partner_api_request(
  p_partner uuid, p_api_key uuid, p_method text, p_path text,
  p_status int, p_error_code text, p_duration_ms int
) returns void
language plpgsql security definer set search_path to '' as $$
begin
  insert into public.partner_api_request_log
    (partner_id, api_key_id, method, path, status_code, error_code, duration_ms)
  values (p_partner, p_api_key, p_method, p_path, p_status, p_error_code, p_duration_ms);
exception when others then
  null;  -- deliberately swallowed: see the header
end $$;

revoke all on function public.log_partner_api_request(uuid, uuid, text, text, int, text, int) from public, anon, authenticated;
grant execute on function public.log_partner_api_request(uuid, uuid, text, text, int, text, int) to service_role;
