-- ===========================================================================
-- STEP 3 of 3. THIS IS THE ONE THAT BREAKS AN OLD CLIENT.
--
-- DO NOT RUN until the build containing the hydrate.ts change is live and a
-- management user has signed in against it. The deployed client names
-- partner_rate in the select it runs at SIGN IN, and PostgREST refuses the
-- whole statement when one column is denied, so management sign-in fails.
--
-- Rollback, if sign-in breaks:
--   grant select (partner_rate, agent_rate) on public.partners to authenticated;
--   grant select (partner_rate, agent_rate) on public.applications to authenticated;
--
-- WHY THE COLUMN LIST IS GENERATED AND NOT WRITTEN OUT.
--
-- A column-level REVOKE cannot subtract from a table-level GRANT, so the table
-- grant has to go and every other column must be granted back by name. The
-- first draft of this file listed them by hand. It listed 28 of the 58 columns
-- that actually exist, which would have silently removed deed state, payment
-- state, refunds, withdrawals, expiry and the Stripe ids from the portal on
-- production. It was written directly underneath a comment warning about this
-- exact failure.
--
-- Worse, a list copied from dev would be wrong here in the other direction:
-- production is behind the tree, so it does not have applicant_id, share_amount,
-- tenancy_id or tenant_middle_name, and granting a column that does not exist
-- raises. So the list is built from the TARGET database's own catalogue, at run
-- time, excluding exactly two columns. It cannot be short and it cannot name
-- something absent.
--
-- THE TRAP THAT REMAINS. Once the table grant is gone, every future column on
-- either table needs its own grant or it is invisible to the portal. Re-run
-- this file after adding one, or add the grant in the migration that adds the
-- column.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Manual gate. Postgres cannot see whether the client was deployed, so this is
-- deliberate: delete this block once step 2 is verified live, then re-run.
-- ---------------------------------------------------------------------------
do $$
begin
  raise exception
    'STOP. Confirm the hydrate.ts build is live on production and a management user has signed in against it, then delete this guard block and re-run.';
end $$;

do $$
declare
  v_cols text;
  v_tbl  text;
begin
  foreach v_tbl in array array['partners', 'applications'] loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
      into v_cols
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = v_tbl
       and column_name not in ('partner_rate', 'agent_rate');

    if v_cols is null then
      raise exception 'no columns found for public.%; is the table there?', v_tbl;
    end if;

    execute format('revoke select on public.%I from authenticated', v_tbl);
    execute format('grant select (%s) on public.%I to authenticated', v_cols, v_tbl);

    raise notice 'public.%: granted % columns, withheld partner_rate and agent_rate',
      v_tbl, (select count(*) from information_schema.columns
               where table_schema='public' and table_name=v_tbl
                 and column_name not in ('partner_rate','agent_rate'));
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Prove it, both directions, including that nothing else was lost.
-- ---------------------------------------------------------------------------
do $$
declare v_missing text;
begin
  if has_column_privilege('authenticated', 'public.partners', 'partner_rate', 'select')
     or has_column_privilege('authenticated', 'public.partners', 'agent_rate', 'select') then
    raise exception 'partners rate columns are still readable';
  end if;
  if has_column_privilege('authenticated', 'public.applications', 'partner_rate', 'select')
     or has_column_privilege('authenticated', 'public.applications', 'agent_rate', 'select') then
    raise exception 'applications rate columns are still readable';
  end if;

  -- EVERY other column must have survived. This is the assertion the
  -- hand-written list would have failed.
  select string_agg(t.table_name || '.' || c.column_name, ', ')
    into v_missing
    from (values ('partners'), ('applications')) as t(table_name)
    join information_schema.columns c
      on c.table_schema = 'public' and c.table_name = t.table_name
   where c.column_name not in ('partner_rate', 'agent_rate')
     and not has_column_privilege('authenticated', 'public.' || t.table_name, c.column_name, 'select');

  if v_missing is not null then
    raise exception 'these columns lost their grant and the portal needs them: %', v_missing;
  end if;

  if not has_column_privilege('service_role', 'public.applications', 'partner_rate', 'select') then
    raise exception 'service_role lost applications.partner_rate; rate snapshotting would fail';
  end if;
end $$;
