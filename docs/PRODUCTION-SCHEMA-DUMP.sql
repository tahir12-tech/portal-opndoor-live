-- ===========================================================================
-- READ ONLY. Dumps production's ACTUAL shape for the tables an urgent bundle
-- would touch. Names, types, ACLs and policy text. No application row is read
-- and nothing is written.
--
-- WHY THIS EXISTS. Production has been changed by hand since 5 July: a region
-- move and cron corrections at least. The migration ledger says what was
-- APPLIED, not what the database now IS, and those have already diverged once
-- in this exercise. A bundle checked against what migrations imply is a bundle
-- checked against a story.
--
-- This is the same move that caught the 28-of-58 column mistake: ask the target
-- database what it has, rather than assuming it matches anything.
--
-- Paste whole. Four result sets. Send back all four.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. COLUMNS, and whether `authenticated` can read each one.
--
-- The column count per table is the number the generated grant list in
-- 02-revoke-columns.sql will produce. If partners or applications has a column
-- here that dev does not, the bundle still handles it, because it generates
-- from THIS catalogue. What matters is spotting a column that exists here and
-- nowhere in the tree, which would mean a hand change.
-- ---------------------------------------------------------------------------
select '1. COLUMNS' as part,
       c.table_name,
       c.ordinal_position,
       c.column_name,
       c.data_type,
       c.is_nullable,
       coalesce(c.column_default, '-')                                          as col_default,
       has_column_privilege('authenticated', 'public.' || c.table_name, c.column_name, 'select') as authenticated_can_read
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.table_name in (
     'partners', 'applications', 'agencies', 'branches', 'agent_contacts',
     'users', 'activity_log', 'application_notes', 'stripe_events',
     'partner_audit', 'app_settings', 'org_audit'
   )
 order by c.table_name, c.ordinal_position;

-- ---------------------------------------------------------------------------
-- 2. RLS: is it on, and every policy expression as the catalogue stores it.
--
-- Stored, not written. tenancies_select read as correct in the migration and
-- was stored as something that denied everyone, so the source text is not
-- evidence.
-- ---------------------------------------------------------------------------
select '2. RLS' as part,
       t.relname                                       as table_name,
       t.relrowsecurity                                as rls_enabled,
       t.relforcerowsecurity                           as rls_forced,
       coalesce(p.policyname, '(NO POLICIES)')         as policyname,
       coalesce(p.permissive, '-')                     as permissive,
       coalesce(p.cmd, '-')                            as cmd,
       coalesce(p.roles::text, '-')                    as roles,
       coalesce(p.qual, '-')                           as using_expr,
       coalesce(p.with_check, '-')                     as with_check_expr
  from pg_class t
  join pg_namespace n on n.oid = t.relnamespace and n.nspname = 'public'
  left join pg_policies p on p.schemaname = 'public' and p.tablename = t.relname
 where t.relkind = 'r'
 order by t.relname, policyname;

-- ---------------------------------------------------------------------------
-- 3. FUNCTIONS: name, mode, and who can execute.
--
-- An empty ACL means DEFAULT privileges, and on Supabase that GRANTS execute to
-- authenticated. Read the boolean, not the ACL text.
-- ---------------------------------------------------------------------------
select '3. FUNCTIONS' as part,
       p.proname                                                          as name,
       case when p.prosecdef then 'definer' else 'invoker' end            as mode,
       pg_get_function_identity_arguments(p.oid)                          as args,
       has_function_privilege('authenticated', p.oid, 'execute')          as authenticated_can,
       has_function_privilege('anon', p.oid, 'execute')                   as anon_can,
       coalesce(array_to_string(p.proacl, '  '), '(default)')             as acl,
       -- A definer function with no gate in its body is the shape that has
       -- already produced two defects here.
       (p.prosecdef and p.prosrc !~ 'is_admin|is_aal2|app_role|app_partner') as definer_without_gate
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
 where p.prorettype <> 'trigger'::regtype
 order by p.proname;

-- ---------------------------------------------------------------------------
-- 4. CONTEXT: extensions, cron jobs by name, and the search_path posture.
--
-- Balal corrected cron by hand, so the job list will not match anything in the
-- tree. Names and schedules only, no payloads: a cron command can carry a
-- secret and this must not return one.
-- ---------------------------------------------------------------------------
select '4. CONTEXT' as part, 'extension' as kind, extname as name,
       extversion as detail
  from pg_extension
union all
select '4. CONTEXT', 'cron job', jobname,
       schedule || '  active=' || active::text
  from cron.job
union all
select '4. CONTEXT', 'definer functions with a mutable search_path',
       count(*)::text, '-'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
 where p.prosecdef
   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
                    where cfg like 'search_path=%')
union all
select '4. CONTEXT', 'tables with RLS disabled', count(*)::text, '-'
  from pg_class t
  join pg_namespace n on n.oid = t.relnamespace and n.nspname = 'public'
 where t.relkind = 'r' and not t.relrowsecurity
order by 2, 3;
