-- SAY THE GRANTS OUT LOUD, BECAUSE THE DEFAULT DOES NOT.
--
-- 20261006330000 ends with ALTER DEFAULT PRIVILEGES FOR ROLE postgres, meant
-- to stop the next function being born callable by anon and authenticated.
-- It does not work on this project, and "it does not work" is not a guess:
--
--   create function public.zzz_probe() returns int language sql as 'select 1';
--   -> proacl  =X/postgres postgres=X/postgres service_role=X/postgres
--   -> has_function_privilege('anon',        ...) = true
--   -> has_function_privilege('authenticated',...) = true
--
-- The leading `=X` is PUBLIC. pg_default_acl shows the postgres row exactly as
-- intended (postgres=X, service_role=X, no PUBLIC), and a new function gets
-- PUBLIC anyway. There is a second default-ACL row for supabase_admin which
-- does grant anon and authenticated, schema public is owned by
-- pg_database_owner, and postgres is not a member of supabase_admin, so that
-- row cannot be altered from a migration. The GRANT half of my ALTER took
-- effect (service_role is there); the REVOKE half did not.
--
-- SO THE DEFAULT IS NOT THE GUARD. Two things are: an explicit revoke on
-- every function that should be closed, and the pgTAP check over pg_proc that
-- fails the build if anything is open. This migration is the first, and it is
-- also the correction that brings dev back in line with the files.
--
-- BALAL, THIS MATTERS ON PRODUCTION. Two functions below are granted to
-- `authenticated` EXPLICITLY for the first time here. Until now they were
-- callable only because of a Supabase platform default, not because any
-- migration said so. If production's default ACL differs at all, is_aal2()
-- would not be callable and EVERY restrictive require_aal2 policy would fail
-- closed: nobody could read anything. Saying it in a migration removes that
-- dependency.

-- ===========================================================================
-- 1. THE TWO THAT MUST BE CALLABLE, SAID IN A MIGRATION
-- ===========================================================================
-- is_aal2() is called by the restrictive require_aal2 policy on sixteen
-- tables. An RLS policy expression IS permission-checked against the querying
-- role (measured on dev in 20261006330000), so if authenticated cannot
-- execute it, every one of those tables answers "permission denied for
-- function is_aal2" rather than filtering. No migration granted it.
grant execute on function public.is_aal2() to authenticated, service_role;

-- guarantee_expiry(date) is the expression behind applications.expiry_date, a
-- GENERATED column. An insert through PostgREST is made by authenticated, so
-- the generated expression is evaluated in that context.
grant execute on function public.guarantee_expiry(date) to authenticated, service_role;

-- ===========================================================================
-- 2. THE TEN THAT SHOULD BE CLOSED, AND ARE OPEN ON DEV
-- ===========================================================================
-- Found by diffing the migration files against dev's catalogue
-- (scripts/schema-drift.mjs). Every one is open on dev and closed by the
-- files, so this closes dev and is a no-op on a clean apply.
--
-- Eight are TRIGGER functions. A trigger fires as the table owner and never
-- checks EXECUTE against the caller, so a grant buys nothing and an open one
-- lets anybody run a guard out of context with whatever NEW they care to
-- construct. Two of those eight, applications_referrer_guard and
-- users_identity_guard, are mine: written after 20261006330000 with no
-- revoke, on the assumption the default would close them.
revoke all on function public.applications_referrer_guard() from public, anon, authenticated;
revoke all on function public.users_identity_guard() from public, anon, authenticated;
revoke all on function public.sync_application_partner() from public, anon, authenticated;
revoke all on function public.sync_branch_partner() from public, anon, authenticated;
revoke all on function public.contacts_maintain_primary() from public, anon, authenticated;
revoke all on function public.contacts_promote_on_delete() from public, anon, authenticated;

-- And four helpers reached only from inside SECURITY DEFINER functions, which
-- run as their owner and so need no grant of their own. Checked first: none
-- appears in a policy, a column default, a check constraint or a view.
revoke all on function public.effective_contacts(uuid) from public, anon, authenticated;
revoke all on function public.effective_primary_contact(uuid) from public, anon, authenticated;
revoke all on function public.can_send_deed(text, boolean) from public, anon, authenticated;
revoke all on function public.can_amend_tenancy_start(text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.effective_contacts(uuid) to service_role;
grant execute on function public.effective_primary_contact(uuid) to service_role;
grant execute on function public.can_send_deed(text, boolean) to service_role;
grant execute on function public.can_amend_tenancy_start(text, text, boolean, text) to service_role;

-- ===========================================================================
-- 3. PROVE IT HERE, not only in a test that might not run
-- ===========================================================================
do $proof$
declare open_to_anon text;
begin
  if not has_function_privilege('authenticated', 'public.is_aal2()', 'execute') then
    raise exception 'is_aal2 is not callable by authenticated: every AAL2 policy would fail closed.';
  end if;
  select string_agg(p.proname, ', ' order by p.proname) into open_to_anon
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('applications_referrer_guard','users_identity_guard','sync_application_partner',
                       'sync_branch_partner','contacts_maintain_primary','contacts_promote_on_delete',
                       'effective_contacts','effective_primary_contact','can_send_deed','can_amend_tenancy_start')
     and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'));
  if open_to_anon is not null then
    raise exception 'Still callable by anon or authenticated after the revoke: %', open_to_anon;
  end if;
end $proof$;
