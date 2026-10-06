-- ===========================================================================
-- READ ONLY. Returns the list of migration versions production has applied.
-- No schema is read, no application row is read, nothing is written.
--
-- WHY. applications.partner_rate is still selectable by authenticated on
-- production, which means 20260811180000_revoke_commission_columns.sql was
-- never applied there. That is one known gap and nobody knows what else.
-- Guessing from the tree is exactly the inference this whole exercise has
-- learned not to trust, so read the ledger instead.
--
-- Paste whole. Copy the single output value and send it back; it is a comma
-- separated list of version stamps and nothing else.
-- ===========================================================================

select
  count(*)                                              as applied_count,
  min(version)                                          as earliest,
  max(version)                                          as latest,
  string_agg(version, ',' order by version)             as all_versions
from supabase_migrations.schema_migrations;

-- If the query above errors with "schema does not exist", production was not
-- built with the Supabase CLI ledger. In that case run this instead, which
-- infers the same thing from what the objects look like, and say so when you
-- send it back, because it is weaker evidence:
--
--   select 'applications.partner_rate revoked (11 Aug)' as marker,
--          not has_column_privilege('authenticated','public.applications','partner_rate','select') as applied
--   union all
--   select 'partners.refers_own_stock exists (14 Aug)',
--          exists (select 1 from information_schema.columns
--                   where table_schema='public' and table_name='partners'
--                     and column_name='refers_own_stock')
--   union all
--   select 'agency_groups table exists (13 Aug)',
--          to_regclass('public.agency_groups') is not null
--   union all
--   select 'user_scopes table exists (13 Aug)',
--          to_regclass('public.user_scopes') is not null
--   union all
--   select 'applicants table exists (12 Aug)',
--          to_regclass('public.applicants') is not null;
