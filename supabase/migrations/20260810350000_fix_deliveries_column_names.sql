-- Restore the column contract on dev_webhook_deliveries.
--
-- 20260810340000 recreated this function to add the replay columns and, in doing
-- so, renamed endpoint_url to url and dropped guarantee_ref. Both are read by
-- the Webhooks history table.
--
-- This is the failure mode worth naming, because nothing would have caught it:
-- PostgREST returns whatever the function declares, supabase-js types it as the
-- caller asserts, and the UI renders undefined as an empty cell. No error, in
-- Postgres or TypeScript or the browser. The table would simply have shown blank
-- URLs and blank references, and it would have looked like missing data rather
-- than a broken contract.
--
-- The lesson generalises past this one function: `drop function` plus `create`
-- is the only way to change a return type, and it is also the only way to
-- silently change a column NAME. A replace would have refused.

drop function if exists public.dev_webhook_deliveries(uuid, uuid, text, int);

create function public.dev_webhook_deliveries(
  p_partner  uuid default null,
  p_endpoint uuid default null,
  p_event    text default null,
  p_limit    int  default 100
)
returns table (
  id uuid, endpoint_id uuid, endpoint_url text, event_id uuid, event_type text,
  guarantee_ref text, attempts int, last_status int, last_error text,
  next_attempt_at timestamptz, delivered_at timestamptz, dead_at timestamptz,
  created_at timestamptz, payload jsonb,
  -- The additions, appended so every pre-existing column keeps its name and
  -- position.
  replay_count int, last_replay_at timestamptz, prior_attempts jsonb
)
language sql stable security definer set search_path to '' as $$
  select d.id, d.endpoint_id, e.url, d.event_id, d.event_type,
         d.payload->'application'->>'guarantee_ref',
         d.attempts, d.last_status, d.last_error,
         d.next_attempt_at, d.delivered_at, d.dead_at, d.created_at, d.payload,
         d.replay_count, d.last_replay_at, d.prior_attempts
  from public.partner_webhook_deliveries d
  join public.partner_webhook_endpoints e on e.id = d.endpoint_id
  where public.is_aal2()
    and (
      (public.is_admin() and (p_partner is null or e.partner_id = p_partner))
      or (public.app_role() = 'developer' and e.partner_id = public.app_partner())
    )
    and (p_endpoint is null or d.endpoint_id = p_endpoint)
    and (p_event is null or d.event_type = p_event)
  -- id as a tiebreak, matching 20260810250000. Two deliveries enqueued by the
  -- same status write share a created_at to the microsecond, and without this
  -- they can swap places between reloads.
  order by d.created_at desc, d.id desc
  limit least(coalesce(p_limit, 100), 500);
$$;

revoke all on function public.dev_webhook_deliveries(uuid, uuid, text, int) from public, anon;
grant execute on function public.dev_webhook_deliveries(uuid, uuid, text, int) to authenticated;
