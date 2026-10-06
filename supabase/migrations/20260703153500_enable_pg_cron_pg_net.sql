-- Enable the two extensions this schema depends on but never enabled.
--
-- No migration in this tree runs `create extension` for anything, so a clean
-- project cannot stand up: the very next migration, 20260703153600, calls
-- cron.schedule() and fails with "schema cron does not exist". The existing
-- projects work only because the extensions were turned on out of band, in the
-- dashboard, which leaves no record in the repo.
--
-- Required by:
--   pg_cron  first used at 20260703153600_rate_limit_cleanup.sql:10 (cron.schedule)
--            also 20260705125214, 20260705153000
--   pg_net   first used at 20260705102238_ops_failure_alerting.sql (net.http_post)
--            also 20260705110300, 20260705125214, 20260705153000
--
-- Nothing else is needed. gen_random_uuid() is built in on PostgreSQL 13+ and
-- this is 17.x, so pgcrypto is not required. The only vault reference in the
-- migrations is a comment, so supabase_vault is not required either.
--
-- VERSION CHOICE. This is dated before its first consumer rather than today,
-- because a migration that enables an extension has to run before the migration
-- that uses it, and a fresh project applies these in version order. The version
-- deliberately matches the equivalent migration in the sibling tree so the two
-- do not diverge on the same slot.
--
-- SAFE ON AN EXISTING PROJECT. Both statements are `if not exists`, so applying
-- this to a project where the extensions were already enabled by hand is a
-- no-op. It records in the repo what was previously only true in the dashboard.

create extension if not exists pg_cron;
create extension if not exists pg_net;
