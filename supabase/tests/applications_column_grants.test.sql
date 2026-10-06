-- Grant-coverage guard for public.applications. Run by `supabase test db`
-- (pgTAP) against a freshly-migrated database, so it re-checks the invariant
-- after EVERY migration, not once at apply time.
--
-- ===========================================================================
-- WHY THIS EXISTS
-- ===========================================================================
-- 20260811180000_revoke_commission_columns.sql took partner_rate and agent_rate
-- off the applications table grant and re-granted every other column per name (a
-- denylist). That fails closed: a column added later is NOT selectable by
-- `authenticated` until a migration grants it. When eight lifecycle columns
-- (landlord_name/landlord_email among them) skipped that step, hydrate.ts's
-- staff SELECT began failing with "permission denied for table applications" and
-- no staff role could load the dashboard.
--
-- Nothing caught it: the vitest suite runs in mock mode (SUPABASE_ENABLED is
-- forced false when import.meta.env.MODE === 'test', src/lib/supabase.ts), so no
-- test ever issues a real `authenticated` PostgREST query, and there was no
-- DB-level test at all. This is that missing DB-level test.
--
-- It is catalogue-driven (reads information_schema), so a NEW ungranted column
-- trips it automatically -- the failure becomes a red test, not a silent 500 in
-- front of a staff user. The two commission columns are the only intended
-- exclusion; they are read through application_commission_rates(), never off the
-- row. If a genuinely new column should also be withheld, add it to the denylist
-- in BOTH the grant migration and this test, deliberately.

begin;
select plan(2);

-- 1. Every applications column except the commission denylist is SELECT-able by
--    authenticated. string_agg returns NULL when there are no gaps (a pass);
--    when a column is missing its grant, the gap list is the failure diagnostic.
select is(
  (select string_agg(column_name::text, ', ' order by ordinal_position)
     from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'applications'
      and column_name not in ('partner_rate', 'agent_rate')
      and not has_column_privilege('authenticated', 'public.applications', column_name, 'SELECT')),
  null,
  'authenticated can SELECT every applications column except the commission denylist (partner_rate, agent_rate)'
);

-- 2. The commission boundary still holds: those two columns stay off the grant.
select ok(
  not has_column_privilege('authenticated', 'public.applications', 'partner_rate', 'SELECT')
  and not has_column_privilege('authenticated', 'public.applications', 'agent_rate', 'SELECT'),
  'partner_rate and agent_rate remain off the authenticated grant (read only via application_commission_rates)'
);

select * from finish();
rollback;
