-- Surface livemode on the two Dev Centre listings.
--
-- A developer holding two keys and two endpoints has no way to tell which is
-- which without this. The key prefix does say (opnd_live_ vs opnd_test_) but the
-- endpoint gives no clue at all, and reading the mode off a prefix is the habit
-- this codebase is deliberately moving away from: partnerAuth reads the column
-- and treats the prefix as an index, so the UI should show the same fact the
-- server acts on rather than a parallel one that could disagree.
--
-- Adding an OUT column means the return type changes, and PostgreSQL refuses
-- that on `create or replace` (42P13). Both are therefore dropped first. This
-- bit the reconciliation_queue change earlier in this work, which is why it is
-- called out here rather than discovered again.

drop function if exists public.dev_api_keys(uuid);

create function public.dev_api_keys(p_partner uuid default null)
returns table (
  id uuid, partner_id uuid, name text, key_prefix text, scopes text[],
  created_at timestamptz, expires_at timestamptz, revoked_at timestamptz, last_used_at timestamptz,
  livemode boolean
)
language sql stable security definer set search_path to '' as $$
  select k.id, k.partner_id, k.name, k.key_prefix, k.scopes,
         k.created_at, k.expires_at, k.revoked_at, k.last_used_at, k.livemode
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
  consecutive_failures int, livemode boolean
)
language sql stable security definer set search_path to '' as $$
  select e.id, e.partner_id, e.url, e.events, e.active, e.description,
         e.created_at, e.last_success_at, e.last_failure_at, e.consecutive_failures, e.livemode
  from public.partner_webhook_endpoints e
  where public.is_aal2()
    and (
      (public.is_admin() and (p_partner is null or e.partner_id = p_partner))
      or (public.app_role() = 'developer' and e.partner_id = public.app_partner())
    )
  -- Ordering stays created_at then id, never by active or by livemode. Sorting
  -- by a value the row can toggle makes the table jump under the cursor as soon
  -- as somebody uses it.
  order by e.created_at desc, e.id desc;
$$;

revoke all on function public.dev_webhook_endpoints(uuid) from public, anon;
grant execute on function public.dev_webhook_endpoints(uuid) to authenticated;
