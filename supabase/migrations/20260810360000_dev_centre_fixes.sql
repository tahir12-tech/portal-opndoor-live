-- Dev Centre fixes: the ambiguous replay, the purge that could not run, and
-- delete alongside revoke.

-- ---------------------------------------------------------------------------
-- 1. "column reference id is ambiguous" on every replay
-- ---------------------------------------------------------------------------
-- `returns table (id uuid, replay_count int, ...)` declares OUT PARAMETERS with
-- those names, and inside a plpgsql body an OUT parameter is a variable in the
-- same namespace as the column names. So in
--
--     update public.partner_webhook_deliveries set
--       replay_count = replay_count + 1
--     where id = p_delivery
--
-- both `id` and `replay_count` refer to two things at once and Postgres refuses.
-- The failure was total: every replay, every row, same error.
--
-- Two changes, and the second is the one that stops it recurring. The OUT
-- parameters are renamed with an out_ prefix so they cannot collide with a
-- column name, and the body qualifies every column with its table alias. Either
-- alone would fix today's bug; both together mean adding a column called
-- `attempts` or `payload` to the OUT list later cannot reintroduce it.
--
-- Note this is the same class of mistake as `#variable_conflict`: it is invisible
-- until the statement runs, and no amount of reading the CREATE FUNCTION tells
-- you, which is why the function is exercised in REGRESSION.md rather than only
-- deployed.
drop function if exists public.dev_replay_webhook_delivery(uuid);

create function public.dev_replay_webhook_delivery(p_delivery uuid)
returns table (out_id uuid, out_replay_count int, out_queued_at timestamptz)
language plpgsql security definer set search_path to '' as $$
declare v_partner uuid; v_delivered timestamptz; v_count int;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  select e.partner_id, d.delivered_at into v_partner, v_delivered
  from public.partner_webhook_deliveries d
  join public.partner_webhook_endpoints e on e.id = d.endpoint_id
  where d.id = p_delivery;

  if v_partner is null then raise exception 'Delivery not found.' using errcode = '22023'; end if;

  if not (
    public.is_admin()
    or (public.app_role() = 'developer' and v_partner = public.app_partner())
  ) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if v_delivered is not null then
    raise exception 'This delivery already succeeded, so there is nothing to replay.' using errcode = '22023';
  end if;

  update public.partner_webhook_deliveries d set
    -- The round that just ended is pushed onto the history BEFORE it is cleared.
    prior_attempts = d.prior_attempts || jsonb_build_object(
      'attempts',    d.attempts,
      'last_status', d.last_status,
      'last_error',  left(coalesce(d.last_error, ''), 400),
      'dead_at',     d.dead_at,
      'ended_at',    now()
    ),
    replay_count   = d.replay_count + 1,
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
  where d.id = p_delivery
  returning d.replay_count into v_count;

  return query select p_delivery, v_count, now();
end $$;

revoke all on function public.dev_replay_webhook_delivery(uuid) from public, anon;
grant execute on function public.dev_replay_webhook_delivery(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Clear sandbox did nothing, for an admin
-- ---------------------------------------------------------------------------
-- applications_sandbox_write_guard blocks any session carrying a portal identity
-- from writing a sandbox row, allowing only a null role (machine callers) and
-- 'developer'. dev_purge_sandbox is SECURITY DEFINER so it bypasses RLS, but a
-- trigger is not RLS: it fires regardless of who owns the function, and the
-- session still carries the caller's JWT. So a SUPERADMIN pressing Clear sandbox
-- hit the raise, every time.
--
-- Widening the trigger to allow superadmin would be the easy fix and the wrong
-- one: it would also let an admin reach a sandbox row through the twelve other
-- definer functions the trigger exists to cover.
--
-- Instead the purge announces itself. set_config with is_local = true scopes the
-- flag to the current transaction, so it cannot leak into another statement or
-- another session, and it is set by the purge function rather than by the caller.
-- A portal user cannot set it: they have no way to call set_config on a
-- connection they do not control, and even if they could, the flag only permits
-- deleting rows that are already `not livemode`.
create or replace function public.applications_sandbox_write_guard()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_role text; v_livemode boolean; v_row public.applications;
begin
  -- NEW is unassigned on DELETE and OLD is unassigned on INSERT, and touching an
  -- unassigned record in plpgsql raises rather than returning null. So branch on
  -- TG_OP instead of coalescing across the two.
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;
  v_livemode := v_row.livemode;

  -- Live rows: nothing to say.
  if v_livemode is not false then
    return v_row;
  end if;

  -- The deliberate purge path, scoped to one transaction. Checked before the
  -- role, because the whole point is that it works for a role that is otherwise
  -- refused.
  if current_setting('app.purging_sandbox', true) = 'on' then
    return v_row;
  end if;

  v_role := public.app_role();

  -- No portal identity on the session: a cron job, an Edge Function using the
  -- service key, or the partner API. These are the sandbox rehearsal paths and
  -- must work.
  if v_role is null then
    return v_row;
  end if;

  -- A developer may act on sandbox through the Dev Centre.
  if v_role = 'developer' then
    return v_row;
  end if;

  raise exception 'This is a sandbox application and cannot be modified from the portal.'
    using errcode = '42501';
end $$;

create or replace function public.dev_purge_sandbox(p_partner uuid default null)
returns table (applications_deleted bigint, agencies_deleted bigint, branches_deleted bigint)
language plpgsql security definer set search_path to '' as $$
declare v_apps bigint; v_ag bigint; v_br bigint; v_partner uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  if public.is_admin() then
    v_partner := p_partner;
  elsif public.app_role() = 'developer' then
    v_partner := public.app_partner();
  else
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- Transaction-local, and set here rather than by any caller.
  perform set_config('app.purging_sandbox', 'on', true);

  -- Cascades take activity_log, notes, payment tokens and webhook deliveries.
  with d as (
    delete from public.applications a
     where not a.livemode and (v_partner is null or a.partner_id = v_partner)
    returning 1)
  select count(*) into v_apps from d;

  with d as (
    delete from public.branches b
     where not b.livemode and (v_partner is null or b.partner_id = v_partner)
    returning 1)
  select count(*) into v_br from d;

  with d as (
    delete from public.agencies g
     where not g.livemode and (v_partner is null or g.partner_id = v_partner)
    returning 1)
  select count(*) into v_ag from d;

  perform set_config('app.purging_sandbox', 'off', true);

  return query select v_apps, v_ag, v_br;
end $$;

revoke all on function public.dev_purge_sandbox(uuid) from public, anon;
grant execute on function public.dev_purge_sandbox(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Delete, alongside revoke
-- ---------------------------------------------------------------------------
-- Revoke and delete are different acts and both should exist. Revoke stops a key
-- working and KEEPS THE ROW, because the audit trail is the point: somebody will
-- ask which key created an application eight months from now. Delete removes the
-- row, and is therefore only honest where there is nothing to lose.
--
-- "Nothing to lose" is decided in SQL, not in the UI, so a hand-crafted call
-- cannot delete a key with history by skipping the button. The UI asks the same
-- question only so it can explain WHY delete is unavailable rather than hiding
-- the option, which would leave somebody hunting for a feature that is there.
--
-- ON KEY ATTRIBUTION, honestly: partner_api_requests has no api_key_id, so an
-- application cannot be traced to the key that created it. Only
-- partner_api_request_log carries api_key_id. So "created no applications" is
-- approximated by "made no requests at all", which is strictly stronger and
-- therefore safe: a key that made no requests certainly created nothing.

/** Whether a key can be deleted, and if not, why not. */
create or replace function public.dev_api_key_deletable(p_id uuid)
returns table (deletable boolean, reason text, request_count bigint)
language sql stable security definer set search_path to '' as $function$
  select
    (k.last_used_at is null and count(l.id) = 0),
    case
      when k.last_used_at is not null or count(l.id) > 0
        then 'This key has been used, so deleting it would remove the record of what it did. Revoke it instead: it stops working immediately and the history is kept.'
      else null
    end,
    count(l.id)
  from public.partner_api_keys k
  left join public.partner_api_request_log l on l.api_key_id = k.id
  where k.id = p_id
    and public.is_aal2()
    and (
      public.is_admin()
      or (public.app_role() in ('developer','management') and k.partner_id = public.app_partner())
    )
  group by k.id, k.last_used_at;
$function$;

revoke all on function public.dev_api_key_deletable(uuid) from public, anon;
grant execute on function public.dev_api_key_deletable(uuid) to authenticated;

create or replace function public.dev_delete_api_key(p_id uuid)
returns void
language plpgsql security definer set search_path to '' as $$
declare v_partner uuid; v_used timestamptz; v_requests bigint;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  select k.partner_id, k.last_used_at into v_partner, v_used
  from public.partner_api_keys k where k.id = p_id;
  if v_partner is null then raise exception 'Key not found.' using errcode = '22023'; end if;

  if not (
    public.is_admin()
    or (public.app_role() in ('developer','management') and v_partner = public.app_partner())
  ) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  select count(*) into v_requests from public.partner_api_request_log l where l.api_key_id = p_id;

  -- Enforced here, not only in the UI.
  if v_used is not null or v_requests > 0 then
    raise exception 'This key has been used, so it cannot be deleted. Revoke it instead.'
      using errcode = '22023';
  end if;

  delete from public.partner_api_keys where id = p_id;
end $$;

revoke all on function public.dev_delete_api_key(uuid) from public, anon;
grant execute on function public.dev_delete_api_key(uuid) to authenticated;

/** Whether an endpoint can be deleted, and if not, why not. */
create or replace function public.dev_endpoint_deletable(p_id uuid)
returns table (deletable boolean, reason text, delivery_count bigint)
language sql stable security definer set search_path to '' as $function$
  select
    count(d.id) = 0,
    case when count(d.id) > 0
      then 'This endpoint has delivery history, so deleting it would remove the record of what was sent and whether it arrived. Disable it instead: it stops receiving events and the history is kept.'
      else null
    end,
    count(d.id)
  from public.partner_webhook_endpoints e
  left join public.partner_webhook_deliveries d on d.endpoint_id = e.id
  where e.id = p_id
    and public.is_aal2()
    and (
      public.is_admin()
      or (public.app_role() = 'developer' and e.partner_id = public.app_partner())
    )
  group by e.id;
$function$;

revoke all on function public.dev_endpoint_deletable(uuid) from public, anon;
grant execute on function public.dev_endpoint_deletable(uuid) to authenticated;

create or replace function public.dev_delete_webhook_endpoint(p_id uuid)
returns void
language plpgsql security definer set search_path to '' as $$
declare v_partner uuid; v_deliveries bigint;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  select e.partner_id into v_partner from public.partner_webhook_endpoints e where e.id = p_id;
  if v_partner is null then raise exception 'Endpoint not found.' using errcode = '22023'; end if;

  if not (
    public.is_admin()
    or (public.app_role() = 'developer' and v_partner = public.app_partner())
  ) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  select count(*) into v_deliveries
  from public.partner_webhook_deliveries d where d.endpoint_id = p_id;

  -- Deliberately not relying on the cascade. partner_webhook_deliveries cascades
  -- on endpoint delete, so without this check removing an endpoint would silently
  -- take its entire delivery history with it.
  if v_deliveries > 0 then
    raise exception 'This endpoint has delivery history, so it cannot be deleted. Disable it instead.'
      using errcode = '22023';
  end if;

  delete from public.partner_webhook_endpoints where id = p_id;
end $$;

revoke all on function public.dev_delete_webhook_endpoint(uuid) from public, anon;
grant execute on function public.dev_delete_webhook_endpoint(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The listings carry the usage counts
-- ---------------------------------------------------------------------------
-- So the UI can decide whether to offer delete without a round trip per row, and
-- can say why it is unavailable.
drop function if exists public.dev_api_keys(uuid);

create function public.dev_api_keys(p_partner uuid default null)
returns table (
  id uuid, partner_id uuid, name text, key_prefix text, scopes text[],
  created_at timestamptz, expires_at timestamptz, revoked_at timestamptz, last_used_at timestamptz,
  livemode boolean, request_count bigint
)
language sql stable security definer set search_path to '' as $$
  select k.id, k.partner_id, k.name, k.key_prefix, k.scopes,
         k.created_at, k.expires_at, k.revoked_at, k.last_used_at, k.livemode,
         (select count(*) from public.partner_api_request_log l where l.api_key_id = k.id)
  from public.partner_api_keys k
  where public.is_aal2()
    and (
      (public.is_admin() and (p_partner is null or k.partner_id = p_partner))
      or (public.app_role() in ('developer','management') and k.partner_id = public.app_partner())
    )
  order by k.created_at desc, k.id desc;
$$;

revoke all on function public.dev_api_keys(uuid) from public, anon;
grant execute on function public.dev_api_keys(uuid) to authenticated;

drop function if exists public.dev_webhook_endpoints(uuid);

create function public.dev_webhook_endpoints(p_partner uuid default null)
returns table (
  id uuid, partner_id uuid, url text, events text[], active boolean, description text,
  created_at timestamptz, last_success_at timestamptz, last_failure_at timestamptz,
  consecutive_failures int, livemode boolean, delivery_count bigint
)
language sql stable security definer set search_path to '' as $$
  select e.id, e.partner_id, e.url, e.events, e.active, e.description,
         e.created_at, e.last_success_at, e.last_failure_at, e.consecutive_failures, e.livemode,
         (select count(*) from public.partner_webhook_deliveries d where d.endpoint_id = e.id)
  from public.partner_webhook_endpoints e
  where public.is_aal2()
    and (
      (public.is_admin() and (p_partner is null or e.partner_id = p_partner))
      or (public.app_role() = 'developer' and e.partner_id = public.app_partner())
    )
  -- Never by active or livemode: sorting by a value the row can toggle makes the
  -- table jump under the cursor the moment somebody uses it.
  order by e.created_at desc, e.id desc;
$$;

revoke all on function public.dev_webhook_endpoints(uuid) from public, anon;
grant execute on function public.dev_webhook_endpoints(uuid) to authenticated;
