-- =========================================================================
-- THREE COLUMNS WENT ON THE TABLE WITHOUT A GRANT.
--
-- 20261007320000 added `deed_delivered_at`, `deed_delivered_to` and
-- `deed_resent_at` to public.applications and did not grant them. The
-- grant on that table is a DENYLIST -- 20260811180000 took partner_rate
-- and agent_rate off it and re-granted every other column by name -- so a
-- new column is NOT selectable by `authenticated` until a migration says
-- so. That fails closed on purpose, and this is the step that was missed.
--
-- WHAT IT HAS NOT BROKEN, AND WHY IT STILL MATTERS. Nothing on screen is
-- wrong today: hydrate.ts names its columns, and the delivery stamps are
-- read through `my_application_delivery`, a definer function that is not
-- bound by a column grant. The damage is the next `select *` against
-- applications by a signed-in role, which does not come back short -- it
-- comes back "permission denied for table applications", with the whole
-- screen blank. That is exactly how eight lifecycle columns took the
-- staff dashboard down once before, which is why
-- supabase/tests/applications_column_grants.test.sql exists.
--
-- IT WAS THE TEST THAT FOUND IT, running the full pgTAP suite against dev
-- rather than only the files the night's work touched.
--
-- NOT THE TWO COMMISSION COLUMNS. partner_rate and agent_rate stay off
-- the grant and are read through application_commission_rates().
-- =========================================================================

grant select (deed_delivered_at, deed_delivered_to, deed_resent_at)
  on public.applications to authenticated;

-- Assert the invariant the test asserts, here, so a clean filename-order
-- apply fails at the migration rather than later in the suite.
do $$
declare v_gap text;
begin
  select string_agg(column_name::text, ', ' order by ordinal_position) into v_gap
  from information_schema.columns
  where table_schema = 'public'
    and table_name   = 'applications'
    and column_name not in ('partner_rate', 'agent_rate')
    and not has_column_privilege('authenticated', 'public.applications', column_name, 'SELECT');

  if v_gap is not null then
    raise exception 'applications columns are not selectable by authenticated: %', v_gap;
  end if;
end $$;
