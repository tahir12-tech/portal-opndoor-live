-- ONE GATE, NOT ONE AND A HALF.
--
-- 20261006230000 put a reach test on tenancy_tenant_names by narrowing the CTE
-- that finds the tenancy:
--
--   with t as (select tenancy_id from public.applications
--               where id = p_application
--                 and (auth.uid() is null or public.app_may_reach_application(...)))
--
-- and that is only half the function. The CASE below it reads
--
--   when (select tenancy_id from t) is null
--     then (select ... from public.applications where id = p_application)
--
-- so a caller who may NOT reach the application empties `t`, the CASE sees a
-- null tenancy_id, takes the SOLO branch, and that branch queries applications
-- again with no gate at all. The fix returned the tenant's name to exactly the
-- caller it was meant to refuse.
--
-- Caught by re-running the probe that found the original leak rather than by
-- reading the patch, which is the argument for measuring after a fix and not
-- only before one.
--
-- The gate is now on the function, once, ahead of both branches.

create or replace function public.tenancy_tenant_names(p_application uuid)
returns text
language sql stable security definer set search_path to ''
as $function$
  /* SERVICE ROLE PASSES THROUGH. The deed generation path calls this with no
     JWT at all, so the test is on there BEING a caller: a signed-in user must
     reach the application, and the cron and webhook paths are unaffected. */
  with allowed as (
    select a.id, a.tenancy_id, a.tenant_first_name, a.tenant_last_name
      from public.applications a
     where a.id = p_application
       and (auth.uid() is null or public.app_may_reach_application(p_application))
  )
  select case
    when not exists (select 1 from allowed) then null
    when (select tenancy_id from allowed) is null
      then (select btrim(coalesce(tenant_first_name,'') || ' ' || coalesce(tenant_last_name,''))
              from allowed)
    else (select string_agg(btrim(coalesce(a.tenant_first_name,'') || ' ' || coalesce(a.tenant_last_name,'')),
                            ', ' order by a.tenancy_position nulls last, a.created_at, a.id)
            from public.applications a
           where a.tenancy_id = (select tenancy_id from allowed))
  end
$function$;

comment on function public.tenancy_tenant_names(uuid) is
  'Every tenant on this application''s tenancy, or the single tenant''s name. Gated once, ahead of both branches: the first version of the gate narrowed only the tenancy lookup, and the solo branch then read the row again unguarded.';
