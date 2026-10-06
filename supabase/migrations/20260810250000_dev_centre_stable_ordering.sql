-- Order the Dev Centre listings by something that does not move.
--
-- THE BUG. dev_webhook_endpoints ordered by created_at desc alone. Endpoints
-- created in the same second tie, and with a tie Postgres is free to return any
-- order. An UPDATE rewrites the tuple and moves it in the heap, so toggling an
-- endpoint changed the physical scan order and the row jumped past its
-- neighbour. Toggling a switch should change the switch and nothing else.
--
-- Fixed with a deterministic tiebreak on id. created_at plus id is unique, so
-- the order is now total and stable across any number of updates.
--
-- dev_api_keys had a worse version of the same problem: it ordered by
-- "revoked_at nulls first", which is ORDER BY STATE. Revoking a key made it jump
-- to the bottom of the table at the exact moment the user was looking at it, to
-- confirm they had revoked the right one. Now ordered by creation, with the
-- status column carrying the meaning instead of the position.

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
  order by e.created_at desc, e.id desc;
$$;

revoke all on function public.dev_webhook_endpoints(uuid) from public, anon;
grant execute on function public.dev_webhook_endpoints(uuid) to authenticated;

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
  order by k.created_at desc, k.id desc;
$$;

revoke all on function public.dev_api_keys(uuid) from public, anon;
grant execute on function public.dev_api_keys(uuid) to authenticated;
