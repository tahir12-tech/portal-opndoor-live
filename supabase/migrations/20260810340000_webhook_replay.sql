-- Replaying a webhook delivery.
--
-- A partner fixes their endpoint and needs the events they missed. Everything
-- required already exists: the queue, the dispatcher, the rendered payload and
-- the retry schedule. Replay is therefore not a new delivery mechanism, it is
-- putting a settled row back on the queue.
--
-- THE HISTORY IS APPENDED TO, NOT OVERWRITTEN. The naive version sets attempts
-- to zero and clears dead_at, which loses the record of what happened the first
-- time. That record is the reason anyone is replaying: "it 500ed eight times
-- with this body" is the evidence, and a replay that erases it means the second
-- failure looks like the first one and nobody can tell whether the fix worked.
--
-- So the pre-replay state is pushed onto prior_attempts before the reset. The
-- row keeps one live set of attempt columns, which is what the dispatcher reads,
-- plus a growing list of what previous rounds looked like.
--
-- WHY NOT INSERT A NEW ROW instead. partner_webhook_deliveries_once_idx enforces
-- one delivery per endpoint per event, deliberately, so a status write that
-- fires twice cannot produce two deliveries. A replay row would violate it, and
-- relaxing that index to allow replays would also allow the duplicates it exists
-- to prevent. Keeping one row per event is also what the partner sees: they
-- dedupe on event_id, and a replay is the same event arriving again, which is
-- exactly what their idempotent handler is built for.

alter table public.partner_webhook_deliveries
  add column if not exists prior_attempts jsonb   not null default '[]'::jsonb,
  add column if not exists replay_count   int     not null default 0,
  add column if not exists last_replay_at timestamptz,
  add column if not exists last_replay_by uuid references public.users(id) on delete set null;

comment on column public.partner_webhook_deliveries.prior_attempts is
  'Append-only record of what the attempt columns held before each replay. The live columns are the current round; this is every round before it.';

/**
 * Requeue one delivery.
 *
 * Deliberately narrow about what it will touch. A delivered row is refused
 * rather than resent: a partner whose handler is idempotent would cope, but
 * resending a success is not a fix for anything and the button that does it will
 * eventually be pressed on the wrong row.
 */
create or replace function public.dev_replay_webhook_delivery(p_delivery uuid)
returns table (id uuid, replay_count int, queued_at timestamptz)
language plpgsql security definer set search_path to '' as $$
declare d record; v_partner uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  select dd.*, e.partner_id into d
  from public.partner_webhook_deliveries dd
  join public.partner_webhook_endpoints e on e.id = dd.endpoint_id
  where dd.id = p_delivery;

  if not found then raise exception 'Delivery not found.' using errcode = '22023'; end if;

  -- Scope, in the same shape as every other Dev Centre RPC.
  if not (
    public.is_admin()
    or (public.app_role() = 'developer' and d.partner_id = public.app_partner())
  ) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if d.delivered_at is not null then
    raise exception 'This delivery already succeeded, so there is nothing to replay.' using errcode = '22023';
  end if;

  update public.partner_webhook_deliveries set
    -- Push the round that just ended onto the history BEFORE clearing it.
    prior_attempts = prior_attempts || jsonb_build_object(
      'attempts',    attempts,
      'last_status', last_status,
      'last_error',  left(coalesce(last_error, ''), 400),
      'dead_at',     dead_at,
      'ended_at',    now()
    ),
    replay_count   = replay_count + 1,
    last_replay_at = now(),
    last_replay_by = auth.uid(),

    -- Back on the queue. next_attempt_at is now() rather than a backoff: a human
    -- has just said the endpoint is fixed, so waiting is the wrong default.
    attempts        = 0,
    next_attempt_at = now(),
    dead_at         = null,
    claimed_at      = null,
    last_status     = null,
    last_error      = null
  where id = p_delivery;

  return query select p_delivery, (select dd.replay_count from public.partner_webhook_deliveries dd where dd.id = p_delivery), now();
end $$;

revoke all on function public.dev_replay_webhook_delivery(uuid) from public, anon;
grant execute on function public.dev_replay_webhook_delivery(uuid) to authenticated;

-- The deliveries listing has to return the replay columns or the UI cannot show
-- that a row has been replayed, which is the difference between "it failed" and
-- "it failed again after you fixed it".
drop function if exists public.dev_webhook_deliveries(uuid, uuid, text, int);

create function public.dev_webhook_deliveries(
  p_partner uuid default null,
  p_endpoint uuid default null,
  p_event text default null,
  p_limit int default 100
)
returns table (
  id uuid, endpoint_id uuid, url text, event_id uuid, event_type text,
  application_id uuid, attempts int, last_status int, last_error text,
  delivered_at timestamptz, dead_at timestamptz, next_attempt_at timestamptz,
  created_at timestamptz, payload jsonb,
  replay_count int, last_replay_at timestamptz, prior_attempts jsonb
)
language sql stable security definer set search_path to '' as $$
  select d.id, d.endpoint_id, e.url, d.event_id, d.event_type,
         d.application_id, d.attempts, d.last_status, d.last_error,
         d.delivered_at, d.dead_at, d.next_attempt_at, d.created_at, d.payload,
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
  order by d.created_at desc, d.id desc
  limit least(coalesce(p_limit, 100), 500);
$$;

revoke all on function public.dev_webhook_deliveries(uuid, uuid, text, int) from public, anon;
grant execute on function public.dev_webhook_deliveries(uuid, uuid, text, int) to authenticated;

-- ---------- the endpoint secret, for sending a test event ----------
-- The Dev Centre already has dev_reveal_webhook_secret for showing it to a
-- developer. This is a separate, service-role-only accessor so the test-event
-- action can SIGN with the secret without the secret travelling to the browser
-- on a path whose purpose is not revealing it.
create or replace function public.dev_endpoint_for_test(p_endpoint uuid, p_actor uuid)
returns table (url text, secret text, livemode boolean, events text[])
language sql stable security definer set search_path to '' as $$
  select e.url, e.secret, e.livemode, e.events
  from public.partner_webhook_endpoints e
  join public.users u on u.id = p_actor
  where e.id = p_endpoint
    and (
      u.role = 'superadmin'
      or (u.role = 'developer' and e.partner_id = u.partner_id)
    );
$$;

revoke all on function public.dev_endpoint_for_test(uuid, uuid) from public, anon, authenticated;
grant execute on function public.dev_endpoint_for_test(uuid, uuid) to service_role;
