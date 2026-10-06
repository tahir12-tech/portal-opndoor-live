-- Commission columns come off the table grant.
--
-- ===========================================================================
-- THE HOLE THIS CLOSES, WHICH PREDATES THE DEVELOPER ROLE
-- ===========================================================================
-- `maySeeCommission()` decides whether the client ASKS for partner_rate and
-- agent_rate. It is TypeScript. It narrows the select string in hydrate.ts and
-- nothing else.
--
-- PostgREST does not consult it. Any signed-in user on any role could always
-- request the columns directly:
--
--   GET /rest/v1/applications?select=guarantee_ref,partner_rate,agent_rate
--
-- and RLS would happily return them, because RLS filters ROWS. A referrer got
-- their own applications with the commission terms attached; management got
-- their whole partner's. The screens never showed it, which is why it was never
-- noticed. See DEFECTS.md 19.
--
-- ===========================================================================
-- WHY IT IS DONE THIS WAY
-- ===========================================================================
-- The obvious statement does nothing:
--
--   revoke select (partner_rate, agent_rate) on public.applications from authenticated;
--
-- A column-level REVOKE cannot subtract from a TABLE-level grant. If a role
-- holds SELECT on the table it holds every column, and Postgres accepts that
-- statement without error while changing nothing. The only way is to drop the
-- table grant and re-grant per column.
--
-- The grant is generated from the catalogue rather than typed out, with a
-- DENYLIST rather than an allowlist. That is deliberate: an allowlist of forty
-- column names is mechanical, unreadable, and wrong the moment somebody adds a
-- column. A denylist is two names and says what it means.
--
-- THE COST, AND IT IS REAL: a column added to public.applications after this
-- migration is NOT granted to authenticated and will be invisible to the client
-- until somebody grants it. That fails closed, which is the right direction, but
-- it WILL be confusing the first time. Any migration adding a client-visible
-- column to this table must end with:
--
--   grant select (new_column) on public.applications to authenticated;
--
-- This is noted in HANDOVER.md alongside the open item proposing the cleaner
-- long-term shape, which is to move the snapshot to a sibling table and remove
-- the need for any of this.

do $$
declare c record; cols text := '';
begin
  for c in
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = 'applications'
      and column_name not in ('partner_rate', 'agent_rate')
    order by ordinal_position
  loop
    cols := cols || case when cols = '' then '' else ', ' end || quote_ident(c.column_name);
  end loop;

  if cols = '' then
    raise exception 'Refusing to proceed: no columns found on public.applications.';
  end if;

  -- Table-level first, or the per-column grant below is subsumed by it.
  execute 'revoke select on public.applications from authenticated';
  execute format('grant select (%s) on public.applications to authenticated', cols);

  raise notice 'applications: granted % columns to authenticated, withholding partner_rate and agent_rate.',
    (select count(*) from information_schema.columns
      where table_schema='public' and table_name='applications' and column_name not in ('partner_rate','agent_rate'));
end $$;

-- Prove it, rather than assume it. has_column_privilege is the same question
-- PostgREST will ask.
do $$
begin
  if has_column_privilege('authenticated', 'public.applications', 'partner_rate', 'SELECT')
     or has_column_privilege('authenticated', 'public.applications', 'agent_rate', 'SELECT') then
    raise exception 'partner_rate or agent_rate is still selectable by authenticated.';
  end if;
  if not has_column_privilege('authenticated', 'public.applications', 'guarantee_ref', 'SELECT') then
    raise exception 'guarantee_ref is no longer selectable by authenticated: the grant is too narrow.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The rates, for the roles entitled to them
-- ---------------------------------------------------------------------------
-- Admin and management still need the snapshot: it is what settlement, the
-- bordereau and every commission figure are computed from. They get it here
-- instead of off the row, so the entitlement is a role test in SQL rather than a
-- select string in TypeScript.
--
-- Returns rates ONLY. Joining anything else onto it would recreate the problem
-- one column at a time.
create or replace function public.application_commission_rates(p_partner uuid default null)
returns table (application_id uuid, partner_rate numeric, agent_rate numeric)
language sql stable security definer set search_path to '' as $function$
  select a.id, a.partner_rate, a.agent_rate
  from public.applications a
  where public.is_aal2()
    and a.livemode
    and (
      public.is_admin()
      or (public.app_role() = 'management' and a.partner_id = public.app_partner())
    )
    and (p_partner is null or a.partner_id = p_partner);
$function$;

revoke all on function public.application_commission_rates(uuid) from public, anon;
grant execute on function public.application_commission_rates(uuid) to authenticated;

comment on function public.application_commission_rates(uuid) is
  'The commission snapshot for applications the caller is entitled to. Exists because partner_rate and agent_rate are no longer in the table grant: a referrer or developer asking PostgREST for them directly used to get them.';

do $$
declare v int;
begin
  select count(*) into v from public.livemode_audit();
  if v > 0 then raise exception 'livemode_audit is not clean: % function(s).', v; end if;
end $$;
