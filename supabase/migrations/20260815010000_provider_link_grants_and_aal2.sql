-- ===========================================================================
-- Two holes on the rail 4 provider link, both found by review rather than by
-- the review that wrote them.
--
-- ONE. provider_callbacks_due() is security definer, has no role test in its
-- body, and was revoked "from public, anon" only. Supabase's default privileges
-- grant EXECUTE to authenticated as well, and nothing in this repo has ever
-- revoked it, so ANY signed-in principal could call it and receive the callback
-- tuple: table_id, company_id, agency_id, user_id, tenant_id. A tenant holds an
-- authenticated JWT, so that includes tenants.
--
-- Its sibling nineteen lines earlier in the same migration says
-- "from public, anon, authenticated". The asymmetry was a typo with a blast
-- radius, and 20260702135800 already documented exactly this trap: revoking
-- from PUBLIC alone leaves the role grants standing.
--
-- TWO. application_provider_links carried no require_aal2 policy of its own.
-- Every other table in this schema has one. It reached MFA only transitively,
-- because its select policy happens to nest a subquery against applications,
-- which does have one. That is MFA by coincidence: anyone rewriting that using
-- clause into something that does not touch applications drops the second
-- factor from the table without touching anything that looks like auth.
--
-- Neither is latent. The function is callable today.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The grant. Only the cron and the service role have any business here.
-- ---------------------------------------------------------------------------
revoke execute on function public.provider_callbacks_due() from public, anon, authenticated;

comment on function public.provider_callbacks_due() is
  'Rows due a provider callback. SECURITY DEFINER with no role test in the body, so the GRANT is the whole boundary: service_role and the cron only. Never grant this to authenticated.';

-- ---------------------------------------------------------------------------
-- 2. MFA on its own terms, not by inheritance.
-- ---------------------------------------------------------------------------
drop policy if exists require_aal2 on public.application_provider_links;
create policy require_aal2 on public.application_provider_links
  as restrictive for all to authenticated
  using (public.is_aal2()) with check (public.is_aal2());

-- ---------------------------------------------------------------------------
-- Prove both, rather than trusting the DDL above.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('authenticated', 'public.provider_callbacks_due()', 'execute') then
    raise exception 'authenticated can still execute provider_callbacks_due';
  end if;
  if has_function_privilege('anon', 'public.provider_callbacks_due()', 'execute') then
    raise exception 'anon can still execute provider_callbacks_due';
  end if;

  -- service_role must KEEP it, or the callback cron silently stops finding work.
  if not has_function_privilege('service_role', 'public.provider_callbacks_due()', 'execute') then
    raise exception 'service_role lost provider_callbacks_due; the callback cron would find nothing';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'application_provider_links'
       and policyname = 'require_aal2' and permissive = 'RESTRICTIVE'
  ) then
    raise exception 'require_aal2 on application_provider_links is missing or is not restrictive';
  end if;
end $$;
