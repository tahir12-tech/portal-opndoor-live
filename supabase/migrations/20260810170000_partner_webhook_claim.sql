-- Claiming and settling webhook deliveries. See PARTNER-API.md §13.2 and §13.3.
--
-- THE CLAIM IS WHERE THE ANTI-BLOCKING PROPERTY IS ACTUALLY IMPLEMENTED.
-- `for update skip locked` is what lets two dispatcher runs, or two rows in one
-- run, proceed independently: a row already being worked on is stepped over
-- rather than waited for. A plain `for update` would serialise the queue and
-- reintroduce exactly the head-of-line blocking this design exists to avoid.
--
-- A crashed dispatcher leaves rows with claimed_at set and no outcome. Those
-- become claimable again after a grace period rather than being stuck for ever,
-- which is the difference between a transient failure and a permanent one.

create or replace function public.claim_partner_webhook_deliveries(p_limit int default 50)
returns table (
  delivery_id uuid,
  endpoint_id uuid,
  url         text,
  secret      text,
  event_id    uuid,
  event_type  text,
  payload     jsonb,
  attempts    int
)
language plpgsql security definer set search_path to ''
as $function$
begin
  return query
  with due as (
    select d.id
    from public.partner_webhook_deliveries d
    join public.partner_webhook_endpoints e on e.id = d.endpoint_id
    where d.delivered_at is null
      and d.dead_at is null
      and d.next_attempt_at <= now()
      and e.active
      -- Reclaim rows abandoned by a crashed run. Five minutes is comfortably
      -- longer than any single delivery attempt should take.
      and (d.claimed_at is null or d.claimed_at < now() - interval '5 minutes')
    order by d.next_attempt_at
    limit p_limit
    for update of d skip locked
  )
  update public.partner_webhook_deliveries d
     set claimed_at = now()
    from due, public.partner_webhook_endpoints e
   where d.id = due.id and e.id = d.endpoint_id
  returning d.id, e.id, e.url, e.secret, d.event_id, d.event_type, d.payload, d.attempts;
end $function$;

revoke all on function public.claim_partner_webhook_deliveries(int) from public, anon, authenticated;
grant execute on function public.claim_partner_webhook_deliveries(int) to service_role;

-- ---------- settle a delivery ----------
-- Backoff schedule, in minutes: 1, 5, 25, 120, 360, 720, 1440, 1440.
--
-- JITTER IS NOT DECORATION. Without it, a partner outage produces a synchronised
-- retry storm the moment they recover: every delivery queued during the outage
-- comes due at the same instant and arrives together, which is a good way to
-- knock over a service that has just come back. The +/- 20% spread turns that
-- into a ramp.
create or replace function public.settle_partner_webhook_delivery(
  p_delivery uuid,
  p_ok boolean,
  p_status int default null,
  p_error text default null
) returns void
language plpgsql security definer set search_path to ''
as $function$
declare
  v_attempts int;
  v_endpoint uuid;
  v_backoff constant int[] := array[1, 5, 25, 120, 360, 720, 1440, 1440];
  v_delay int;
  v_jitter numeric;
begin
  select attempts + 1, endpoint_id into v_attempts, v_endpoint
  from public.partner_webhook_deliveries where id = p_delivery;
  if v_endpoint is null then return; end if;

  if p_ok then
    update public.partner_webhook_deliveries
       set attempts = v_attempts, delivered_at = now(), claimed_at = null,
           last_status = p_status, last_error = null
     where id = p_delivery;

    update public.partner_webhook_endpoints
       set last_success_at = now(), consecutive_failures = 0
     where id = v_endpoint;
    return;
  end if;

  update public.partner_webhook_endpoints
     set last_failure_at = now(), consecutive_failures = consecutive_failures + 1
   where id = v_endpoint;

  if v_attempts >= array_length(v_backoff, 1) then
    -- Dead lettered, not deleted. A dead row is the only evidence that a partner
    -- silently stopped receiving something, and it can be replayed by hand.
    update public.partner_webhook_deliveries
       set attempts = v_attempts, dead_at = now(), claimed_at = null,
           last_status = p_status, last_error = p_error
     where id = p_delivery;
  else
    v_jitter := 0.8 + (random() * 0.4);           -- +/- 20%
    v_delay  := greatest(1, round(v_backoff[v_attempts] * v_jitter));
    update public.partner_webhook_deliveries
       set attempts = v_attempts,
           next_attempt_at = now() + make_interval(mins => v_delay),
           claimed_at = null,
           last_status = p_status, last_error = p_error
     where id = p_delivery;
  end if;

  -- A partner who decommissions an endpoint without telling anyone should stop
  -- generating load, and somebody should know. Deactivating is reversible.
  update public.partner_webhook_endpoints
     set active = false
   where id = v_endpoint and consecutive_failures >= 20 and active;
end $function$;

revoke all on function public.settle_partner_webhook_delivery(uuid, boolean, int, text) from public, anon, authenticated;
grant execute on function public.settle_partner_webhook_delivery(uuid, boolean, int, text) to service_role;

-- ---------- SCHEDULING IS DELIBERATELY NOT DONE HERE ----------
-- No cron.schedule in this migration, on purpose.
--
-- 20260705153000 schedules hubspot-sync with a hardcoded project URL, which is
-- why applying this repo's migrations to any new project immediately points it
-- at a foreign project every two minutes (DEFECTS.md defect 2). A migration
-- cannot know which project it is being applied to, so any URL it hardcodes is
-- wrong somewhere.
--
-- Schedule the dispatcher as a deployment step instead, substituting the ref of
-- the project you are actually on:
--
--   select cron.schedule('partner-webhooks', '* * * * *', $cmd$
--     select net.http_post(
--       url := 'https://<THIS PROJECT REF>.supabase.co/functions/v1/partner-webhooks',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'x-ops-secret', (select secret from public.ops_secrets where name = 'reminders_cron')),
--       body := '{}'::jsonb);
--   $cmd$);
--
-- Minute granularity puts up to 60 seconds of latency on the first attempt. If
-- that turns out to matter, the enqueue path can additionally poke the
-- dispatcher directly; the queue is the source of truth either way, so the poke
-- is an optimisation and never a requirement.
