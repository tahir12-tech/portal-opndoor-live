-- Redacted request and response bodies on the observability log.
--
-- Without them the Logs tab can say a request failed but not why, and the first
-- support question is always "what did I actually send". With raw bodies, a
-- table that everyone with Dev Centre access can read accumulates every tenant's
-- name, date of birth, email, phone and home address, for ever.
--
-- REDACTED ON WRITE, NEVER ON READ. The redaction happens in the Edge Function
-- before the insert (_shared/redact.ts), so the unredacted value never lands in
-- the table at all. Redacting in the read path would leave the real values in
-- Postgres, in the WAL, in every backup and in any future query that forgets to
-- go through the view. "It is masked in the UI" is not the same claim as "we do
-- not hold it", and only the second one is worth making.
--
-- NOT ON partner_api_requests. That is the idempotency ledger, and it already
-- stores full response bodies for replay, which is unavoidable because a replay
-- must return byte-identical content. Its rows are read by the API itself rather
-- than by people. Keeping the human-readable log separate is what lets this one
-- hold only redacted content.

alter table public.partner_api_request_log
  add column if not exists request_body  jsonb,
  add column if not exists response_body jsonb;

comment on column public.partner_api_request_log.request_body is
  'Redacted at write time by _shared/redact.ts. Field names are preserved, values are masked unless allowlisted. Never contains tenant identity, contact details, addresses or token material.';
comment on column public.partner_api_request_log.response_body is
  'Redacted at write time, same rules as request_body.';

-- The writer gains two arguments. Dropped and recreated rather than replaced:
-- adding parameters with defaults would leave the old 7-argument signature
-- callable, and an un-updated caller would resolve to it and silently log
-- nothing, which looks identical to a request that was never made.
drop function if exists public.log_partner_api_request(uuid, uuid, text, text, int, text, int);

create function public.log_partner_api_request(
  p_partner uuid, p_api_key uuid, p_method text, p_path text,
  p_status int, p_error_code text, p_duration_ms int,
  p_request_body jsonb, p_response_body jsonb
) returns void
language plpgsql security definer set search_path to '' as $$
begin
  insert into public.partner_api_request_log
    (partner_id, api_key_id, method, path, status_code, error_code, duration_ms,
     request_body, response_body)
  values (p_partner, p_api_key, p_method, p_path, p_status, p_error_code, p_duration_ms,
          p_request_body, p_response_body);
exception when others then
  null;  -- an observability write must never fail the request it observes
end $$;

revoke all on function public.log_partner_api_request(uuid, uuid, text, text, int, text, int, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.log_partner_api_request(uuid, uuid, text, text, int, text, int, jsonb, jsonb)
  to service_role;

-- The reader returns them too. Same drop-and-recreate reasoning: the return type
-- changes, and create or replace refuses that (42P13).
drop function if exists public.dev_api_logs(uuid, text, int, int);

create function public.dev_api_logs(
  p_partner uuid default null,
  p_search  text default null,
  p_days    int  default 7,
  p_limit   int  default 200
)
returns table (
  id uuid, method text, path text, status_code int, error_code text,
  duration_ms int, created_at timestamptz, key_name text,
  request_body jsonb, response_body jsonb
)
language sql stable security definer set search_path to '' as $$
  select l.id, l.method, l.path, l.status_code, l.error_code,
         l.duration_ms, l.created_at, k.name, l.request_body, l.response_body
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
      -- Searching the bodies is deliberately allowed: they are already redacted,
      -- so the only thing findable in them is the field-name structure, which is
      -- exactly what somebody debugging "did my tenancy block arrive" wants.
      or l.request_body::text ilike '%' || btrim(p_search) || '%'
    )
  order by l.created_at desc
  limit least(coalesce(p_limit, 200), 1000);
$$;

revoke all on function public.dev_api_logs(uuid, text, int, int) from public, anon;
grant execute on function public.dev_api_logs(uuid, text, int, int) to authenticated;
