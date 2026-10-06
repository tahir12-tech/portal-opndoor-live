-- ===========================================================================
-- READ ONLY. Paste whole, run once. Returns names, ACLs and policy text.
-- No application row is read and nothing is written.
--
-- Answers three questions about the production project:
--   1. Do the 17 flagged functions exist there, and can `authenticated`
--      execute them?
--   2. Can `authenticated` select partners.partner_rate and agent_rate?
--   3. Does partners_select admit referrer and developer?
--
-- HOW TO READ THE ACL COLUMN. An empty proacl means DEFAULT privileges, and
-- on Supabase the default GRANTS EXECUTE to authenticated. So "(default:
-- authenticated CAN execute)" is exposure, not silence. The column
-- authenticated_can_execute is the authoritative answer either way.
-- ===========================================================================

with wanted(fn) as (
  values
    ('hubspot_pending_events'),
    ('hubspot_sync_partners'),
    ('hubspot_stale_partners'),
    ('hubspot_mark_cursor'),
    ('hubspot_mark_stuck'),
    ('resolve_rates'),
    ('duplicate_agency_groups'),
    ('deed_delivery_target'),
    ('application_annual_income'),
    ('application_attribution'),
    ('effective_primary_contact_route'),
    ('tenancy_group_prequalification'),
    ('partner_reaches_agency'),
    ('application_channel'),
    ('livemode_audit'),
    ('address_history_months'),
    ('eligibility_fee_paid')
)
select '1. FUNCTIONS'                                          as section,
       w.fn                                                    as item,
       case
         when p.oid is null then 'NOT PRESENT ON THIS PROJECT'
         when p.proacl is null then '(default: authenticated CAN execute)'
         else array_to_string(p.proacl, '  ')
       end                                                     as acl_or_state,
       coalesce(has_function_privilege('authenticated', p.oid, 'execute')::text, '-') as authenticated_can,
       coalesce(case when p.prosecdef then 'definer' else 'invoker' end, '-')         as mode
  from wanted w
  left join pg_proc p
         on p.proname = w.fn
        and p.pronamespace = 'public'::regnamespace

union all
select '2. RATE COLUMNS',
       'partners.' || c.column_name,
       '-',
       has_column_privilege('authenticated', 'public.partners', c.column_name, 'select')::text,
       '-'
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.table_name   = 'partners'
   and c.column_name in ('partner_rate', 'agent_rate')

union all
-- Says so explicitly if the columns are absent, rather than returning nothing.
select '2. RATE COLUMNS', 'partners.partner_rate / agent_rate', '-', 'COLUMNS NOT PRESENT', '-'
 where not exists (
   select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'partners'
      and column_name in ('partner_rate', 'agent_rate'))

union all
select '3. PARTNERS POLICY',
       pol.policyname,
       'roles=' || pol.roles::text || '  cmd=' || pol.cmd
         || '  permissive=' || pol.permissive,
       coalesce(pol.qual, '(no USING)'),
       '-'
  from pg_policies pol
 where pol.schemaname = 'public'
   and pol.tablename  = 'partners'

union all
select '4. CONTEXT', 'table-level select on partners for authenticated', '-',
       has_table_privilege('authenticated', 'public.partners', 'select')::text, '-'

union all
select '4. CONTEXT', 'applications.partner_rate (should be false: revoked 11 Aug)', '-',
       has_column_privilege('authenticated', 'public.applications', 'partner_rate', 'select')::text, '-'

order by 1, 2;
