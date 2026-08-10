-- Dev Centre read model and key/endpoint lifecycle. See PARTNER-API.md.
--
-- WHO REACHES THESE. Every function below gates positively:
--   superadmin              everything, any partner
--   developer               everything, own partner only
--   management              API keys only, and only to revoke
--
-- Management is included deliberately, and it is a departure from "the tab is
-- for developers and opndoor admin". A leaked key has to be killable by whoever
-- notices, and a developer who has left the company cannot revoke their own key.
-- Management therefore gets the keys panel and nothing else. Read the scoping in
-- each function rather than assuming the tab controls it: the tab is not a
-- security boundary and RLS does not apply to definer functions.
--
-- WHAT IS NEVER RETURNED. key_hash and partner_webhook_endpoints.secret do not
-- appear in any function here. A key or a signing secret is shown exactly once,
-- at creation, by the dev-centre Edge Function, and is not recoverable
-- afterwards. A listing that returned either would turn any read-scoped leak
-- into a forgery capability.

-- ---------- who may see what ----------
create or replace function public.dev_centre_partner()
returns uuid language sql stable security definer set search_path to '' as $$
  -- The partner a Dev Centre call is scoped to, or null if the caller has no
  -- business here. superadmin is handled by the callers, which pass a partner
  -- explicitly.
  select case
    when not public.is_aal2() then null
    when public.app_role() in ('developer','management') then public.app_partner()
    else null
  end
$$;

revoke all on function public.dev_centre_partner() from public, anon;
grant execute on function public.dev_centre_partner() to authenticated;

-- ---------- API keys ----------
-- key_hash is deliberately absent from the column list.
create or replace function public.dev_api_keys(p_partner uuid default null)
returns table (
  id uuid, partner_id uuid, name text, key_prefix text, scopes text[],
  created_at timestamptz, expires_at timestamptz, revoked_at timestamptz, last_used_at timestamptz
)
language sql stable security definer set search_path to '' as $$
  select k.id, k.partner_id, k.name, k.key_prefix, k.scopes,
         k.created_at, k.expires_at, k.revoked_at, k.last_used_at
  from public.partner_api_keys k
  where public.is_aal2()
    and (
      (public.is_admin() and (p_partner is null or k.partner_id = p_partner))
      or (public.app_role() in ('developer','management') and k.partner_id = public.app_partner())
    )
  order by k.revoked_at nulls first, k.created_at desc;
$$;

revoke all on function public.dev_api_keys(uuid) from public, anon;
grant execute on function public.dev_api_keys(uuid) to authenticated;

-- Revoking is one-way. There is no un-revoke: a key that has been exposed stays
-- dead, and the answer to revoking one by mistake is to mint another.
create or replace function public.dev_revoke_api_key(p_id uuid)
returns void language plpgsql security definer set search_path to '' as $$
declare v_partner uuid; v_name text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  select partner_id, name into v_partner, v_name from public.partner_api_keys where id = p_id;
  if v_partner is null then raise exception 'Key not found.' using errcode = '22023'; end if;

  if not (public.is_admin()
          or (public.app_role() in ('developer','management') and v_partner = public.app_partner())) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  update public.partner_api_keys set revoked_at = coalesce(revoked_at, now()) where id = p_id;
end $$;

revoke all on function public.dev_revoke_api_key(uuid) from public, anon;
grant execute on function public.dev_revoke_api_key(uuid) to authenticated;

-- ---------- webhook endpoints ----------
-- secret is deliberately absent from the column list.
create or replace function public.dev_webhook_endpoints(p_partner uuid default null)
returns table (
  id uuid, partner_id uuid, url text, events text[], active boolean, description text,
  created_at timestamptz, last_success_at timestamptz, last_failure_at timestamptz,
  consecutive_failures int
)
language sql stable security definer set search_path to '' as $$
  select e.id, e.partner_id, e.url, e.events, e.active, e.description,
         e.created_at, e.last_success_at, e.last_failure_at, e.consecutive_failures
  from public.partner_webhook_endpoints e
  where public.is_aal2()
    and (
      (public.is_admin() and (p_partner is null or e.partner_id = p_partner))
      or (public.app_role() = 'developer' and e.partner_id = public.app_partner())
    )
  order by e.created_at desc;
$$;

revoke all on function public.dev_webhook_endpoints(uuid) from public, anon;
grant execute on function public.dev_webhook_endpoints(uuid) to authenticated;

create or replace function public.dev_update_webhook_endpoint(
  p_id uuid, p_events text[] default null, p_active boolean default null
) returns void language plpgsql security definer set search_path to '' as $$
declare v_partner uuid; e text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  select partner_id into v_partner from public.partner_webhook_endpoints where id = p_id;
  if v_partner is null then raise exception 'Endpoint not found.' using errcode = '22023'; end if;
  if not (public.is_admin() or (public.app_role() = 'developer' and v_partner = public.app_partner())) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- Validate against the same event list the API accepts, so the Dev Centre
  -- cannot subscribe an endpoint to something that will never fire.
  if p_events is not null then
    foreach e in array p_events loop
      if e not in ('application.created','application.paid','application.deed_issued',
                   'application.lapsed','application.withdrawn','application.reinstated') then
        raise exception 'Unknown event type: %', e using errcode = '22023';
      end if;
    end loop;
  end if;

  update public.partner_webhook_endpoints
     set events = coalesce(p_events, events),
         active = coalesce(p_active, active),
         -- Reactivating clears the failure counter, otherwise an endpoint
         -- auto-deactivated at 20 failures deactivates again on the next error.
         consecutive_failures = case when p_active is true then 0 else consecutive_failures end
   where id = p_id;
end $$;

revoke all on function public.dev_update_webhook_endpoint(uuid, text[], boolean) from public, anon;
grant execute on function public.dev_update_webhook_endpoint(uuid, text[], boolean) to authenticated;

-- ---------- delivery history ----------
-- The panel an integrator actually needs when something is not arriving.
-- Deliberately includes the failure detail: attempts, last_status, last_error,
-- next_attempt_at and dead_at are the whole point. The payload is included
-- because the partner sent or will receive it and it contains nothing they do
-- not already have.
create or replace function public.dev_webhook_deliveries(
  p_partner  uuid default null,
  p_endpoint uuid default null,
  p_event    text default null,
  p_limit    int  default 100
)
returns table (
  id uuid, endpoint_id uuid, endpoint_url text, event_id uuid, event_type text,
  guarantee_ref text, attempts int, last_status int, last_error text,
  next_attempt_at timestamptz, delivered_at timestamptz, dead_at timestamptz,
  created_at timestamptz, payload jsonb
)
language sql stable security definer set search_path to '' as $$
  select d.id, d.endpoint_id, e.url, d.event_id, d.event_type,
         d.payload->'application'->>'guarantee_ref',
         d.attempts, d.last_status, d.last_error,
         d.next_attempt_at, d.delivered_at, d.dead_at, d.created_at, d.payload
  from public.partner_webhook_deliveries d
  join public.partner_webhook_endpoints e on e.id = d.endpoint_id
  where public.is_aal2()
    and (
      (public.is_admin() and (p_partner is null or e.partner_id = p_partner))
      or (public.app_role() = 'developer' and e.partner_id = public.app_partner())
    )
    and (p_endpoint is null or d.endpoint_id = p_endpoint)
    and (p_event is null or d.event_type = p_event)
  order by d.created_at desc
  limit least(coalesce(p_limit, 100), 500);
$$;

revoke all on function public.dev_webhook_deliveries(uuid, uuid, text, int) from public, anon;
grant execute on function public.dev_webhook_deliveries(uuid, uuid, text, int) to authenticated;

-- ---------- partners a superadmin can pick between ----------
-- The Dev Centre is per environment and per partner. A developer sees only their
-- own; an opndoor admin needs to choose. Safe columns only: no rates.
create or replace function public.dev_partner_options()
returns table (id uuid, slug text, name text, referencing_mode text)
language sql stable security definer set search_path to '' as $$
  select p.id, p.slug, p.name, p.referencing_mode
  from public.partners p
  where public.is_aal2() and public.is_admin()
  order by p.name;
$$;

revoke all on function public.dev_partner_options() from public, anon;
grant execute on function public.dev_partner_options() to authenticated;
