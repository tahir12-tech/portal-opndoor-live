-- Re-grant the applications columns that lost their authenticated SELECT.
--
-- ===========================================================================
-- THE REGRESSION
-- ===========================================================================
-- 20260811180000_revoke_commission_columns.sql took partner_rate and agent_rate
-- off the table grant by dropping the table-level SELECT and re-granting every
-- OTHER column per name (a denylist). It fails closed: a column added afterwards
-- is NOT granted to authenticated until a migration grants it, and it documented
-- the rule in its own header --
--
--   Any migration adding a client-visible column to this table must end with:
--     grant select (new_column) on public.applications to authenticated;
--
-- Eight lifecycle columns added since then never did:
--   current_step, decided_at, decided_by_kind, decline_reason,
--   provider_verdict, provider_verdict_at, landlord_name, landlord_email
-- so every staff SELECT that names one -- which the dashboard's does -- failed
-- with "permission denied for table applications", and NO staff role (superadmin
-- included) could load the dashboard. partner_rate and agent_rate stay withheld:
-- they are read only through application_commission_rates() and must not come
-- back onto the table grant.
--
-- ===========================================================================
-- THE FIX
-- ===========================================================================
-- Re-assert the SAME denylist grant, generated from the catalogue: SELECT on
-- every column of public.applications EXCEPT partner_rate and agent_rate. This
-- grants the eight missing columns, is idempotent for the ones already granted,
-- and self-heals any other column that slipped through the rule. It does not
-- revoke the table grant first (authenticated holds per-column grants here, not a
-- table grant), so it is purely additive.
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

  execute format('grant select (%s) on public.applications to authenticated', cols);
end $$;

-- Prove it, the same question PostgREST asks: the commission boundary still
-- holds, and every column that broke the dashboard is now selectable. This block
-- also serves as the invariant a future missing grant will trip, if this file is
-- ever re-run against a schema that regressed again.
do $$
declare c text; missing text := '';
begin
  if has_column_privilege('authenticated', 'public.applications', 'partner_rate', 'SELECT')
     or has_column_privilege('authenticated', 'public.applications', 'agent_rate', 'SELECT') then
    raise exception 'partner_rate or agent_rate must stay off the authenticated grant.';
  end if;
  foreach c in array array[
    'current_step', 'decided_at', 'decided_by_kind', 'decline_reason',
    'provider_verdict', 'provider_verdict_at', 'landlord_name', 'landlord_email'
  ] loop
    if not has_column_privilege('authenticated', 'public.applications', c, 'SELECT') then
      missing := missing || c || ', ';
    end if;
  end loop;
  if missing <> '' then
    raise exception 'Still not selectable by authenticated: %', left(missing, length(missing) - 2);
  end if;
end $$;
