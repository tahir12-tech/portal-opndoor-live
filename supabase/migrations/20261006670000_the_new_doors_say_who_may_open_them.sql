-- THE NEW DOORS SAY WHO MAY OPEN THEM.
--
-- Q-04 added functions and did not close them, and two of the five checks
-- said so on the next run:
--
--   the_rest_of_round_fives_lows.test.sql  "no function in public is
--     executable by PUBLIC" -- ops_notification_types kept the default
--     PUBLIC EXECUTE that Postgres grants every new function and that
--     ALTER DEFAULT PRIVILEGES does not remove on this project.
--
--   definer_grants.test.sql  every SECURITY DEFINER function the browser may
--     call has to be on the allowlist, and the two Q-04 ones were not.
--
-- This is the rule from the standing instruction working as intended: the
-- definition of secure is the test suite, and the suite caught a gap in the
-- same session that opened it.

revoke all on function public.ops_notification_types() from public, anon;
grant execute on function public.ops_notification_types() to authenticated, service_role;
