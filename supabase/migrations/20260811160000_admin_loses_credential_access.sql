-- opndoor admin loses the credential panels.
--
-- An opndoor admin runs the platform and needs to diagnose it: monitoring, logs,
-- delivery history. They do not need, and should not have, the partner's
-- credentials. A key inventory is a target, and "who could have seen this key"
-- is a question that should have a one-name answer.
--
-- So admin keeps observability and loses:
--   the API key panel entirely, no list, no prefixes, no inventory
--   the webhook endpoint panel entirely
--   signing secrets, under any circumstances
--
-- Revoke stays, as break-glass, and is dealt with at the bottom.
--
-- ENFORCED HERE, NOT IN THE UI. The screen hides the panels, but hiding is a
-- suggestion: these are PostgREST RPCs, callable with fetch from any signed-in
-- browser. The `is_admin()` arm comes OUT of each function rather than the
-- component being hidden, so the SQL is the rule and the UI is the courtesy.
--
-- WHY MANAGEMENT KEEPS THE KEY LIST. It was granted so a leaked key can be
-- killed by whoever notices rather than waiting for a developer who may have
-- left. That reasoning is unchanged and is inside the partner, not across
-- partners: management sees only their own partner's keys, which they are
-- commercially responsible for. An opndoor admin sees every partner's.

-- ---------- keys: admin arm removed ----------
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
    -- No is_admin() arm. An opndoor admin gets zero rows, including with an
    -- explicit p_partner: the argument is not consulted for them at all.
    and public.app_role() in ('developer','management')
    and k.partner_id = public.app_partner()
  order by k.created_at desc, k.id desc;
$$;

revoke all on function public.dev_api_keys(uuid) from public, anon;
grant execute on function public.dev_api_keys(uuid) to authenticated;

-- ---------- endpoints: admin arm removed ----------
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
    and public.app_role() = 'developer'
    and e.partner_id = public.app_partner()
  order by e.created_at desc, e.id desc;
$$;

revoke all on function public.dev_webhook_endpoints(uuid) from public, anon;
grant execute on function public.dev_webhook_endpoints(uuid) to authenticated;

-- ---------- the signing secret: developer only, always ----------
-- This one already refused everyone but admin and developer. Admin comes off it.
-- A signing secret is the one credential that cannot be rotated without the
-- partner redeploying, so there is no operational reason for us to hold it.
create or replace function public.dev_webhook_endpoint_secret(p_id uuid)
returns text
language plpgsql stable security definer set search_path to '' as $$
declare v_partner uuid; v_secret text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  select e.partner_id, e.secret into v_partner, v_secret
  from public.partner_webhook_endpoints e where e.id = p_id;
  if v_partner is null then raise exception 'Endpoint not found.' using errcode = '22023'; end if;

  -- Deliberately no admin branch. An opndoor admin asking for this is either
  -- helping a partner debug, in which case the partner should read it out, or
  -- doing something that needs a conversation first.
  if not (public.app_role() = 'developer' and v_partner = public.app_partner()) then
    raise exception 'Signing secrets are only visible to that partner''s own developers.'
      using errcode = '42501';
  end if;

  return v_secret;
end $$;

revoke all on function public.dev_webhook_endpoint_secret(uuid) from public, anon;
grant execute on function public.dev_webhook_endpoint_secret(uuid) to authenticated;

-- ---------- endpoint writes: developer only ----------
create or replace function public.dev_update_webhook_endpoint(
  p_id uuid, p_events text[] default null, p_active boolean default null
) returns void
language plpgsql security definer set search_path to '' as $$
declare v_partner uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select e.partner_id into v_partner from public.partner_webhook_endpoints e where e.id = p_id;
  if v_partner is null then raise exception 'Endpoint not found.' using errcode = '22023'; end if;
  if not (public.app_role() = 'developer' and v_partner = public.app_partner()) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  update public.partner_webhook_endpoints
     set events = coalesce(p_events, events),
         active = coalesce(p_active, active)
   where id = p_id;
end $$;

revoke all on function public.dev_update_webhook_endpoint(uuid, text[], boolean) from public, anon;
grant execute on function public.dev_update_webhook_endpoint(uuid, text[], boolean) to authenticated;

create or replace function public.dev_delete_webhook_endpoint(p_id uuid)
returns void
language plpgsql security definer set search_path to '' as $$
declare v_partner uuid; v_deliveries bigint;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select e.partner_id into v_partner from public.partner_webhook_endpoints e where e.id = p_id;
  if v_partner is null then raise exception 'Endpoint not found.' using errcode = '22023'; end if;
  if not (public.app_role() = 'developer' and v_partner = public.app_partner()) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  select count(*) into v_deliveries
  from public.partner_webhook_deliveries d where d.endpoint_id = p_id;
  if v_deliveries > 0 then
    raise exception 'This endpoint has delivery history, so it cannot be deleted. Disable it instead.'
      using errcode = '22023';
  end if;

  delete from public.partner_webhook_endpoints where id = p_id;
end $$;

revoke all on function public.dev_delete_webhook_endpoint(uuid) from public, anon;
grant execute on function public.dev_delete_webhook_endpoint(uuid) to authenticated;

-- Key deletion: developer and management only, same reasoning as the list.
create or replace function public.dev_delete_api_key(p_id uuid)
returns void
language plpgsql security definer set search_path to '' as $$
declare v_partner uuid; v_used timestamptz; v_requests bigint;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select k.partner_id, k.last_used_at into v_partner, v_used
  from public.partner_api_keys k where k.id = p_id;
  if v_partner is null then raise exception 'Key not found.' using errcode = '22023'; end if;

  if not (public.app_role() in ('developer','management') and v_partner = public.app_partner()) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  select count(*) into v_requests from public.partner_api_request_log l where l.api_key_id = p_id;
  if v_used is not null or v_requests > 0 then
    raise exception 'This key has been used, so it cannot be deleted. Revoke it instead.'
      using errcode = '22023';
  end if;

  delete from public.partner_api_keys where id = p_id;
end $$;

revoke all on function public.dev_delete_api_key(uuid) from public, anon;
grant execute on function public.dev_delete_api_key(uuid) to authenticated;

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
    and public.app_role() in ('developer','management')
    and k.partner_id = public.app_partner()
  group by k.id, k.last_used_at;
$function$;

revoke all on function public.dev_api_key_deletable(uuid) from public, anon;
grant execute on function public.dev_api_key_deletable(uuid) to authenticated;
