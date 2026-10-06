-- THE GATE MUST NOT LOCK OUT THE MACHINE.
--
-- 20261006230000 put a reach test on deed_target, which was right: any manager
-- on the house partner could read another agency's tenant names, share
-- amounts and paid state. It was also a REGRESSION, because deed_target is not
-- only a screen's read. supabase/functions/_shared/pandadoc.ts:604 calls it as
-- service_role at the moment a deed is generated:
--
--   const { data: tgt, error: tgtErr } = await service.rpc("deed_target", ...)
--
-- service_role carries no JWT, so auth.uid() is null, so the new predicate was
-- false, so the CTE was empty and the function returned no row. Generation
-- would have failed for EVERY deed -- loudly, because that call site already
-- refuses to treat an unread result as "solo tenancy, already paid"
-- (deedChainIsNotSilent.test.ts asserts exactly that), but failed all the same.
--
-- Caught by running the deed path with the JWT cleared rather than by reading
-- the patch. The same escape tenancy_tenant_names already carries applies
-- here, and for the same reason: the test is on there BEING a caller.
--
-- Of the thirteen functions 20261006230000 touched, deed_target is the only
-- one an edge function calls (checked across supabase/functions). The other
-- twelve are reached from the client with a JWT, and three of them
-- (application_commission_rates, referrer_league, commission_preview) sit
-- behind is_aal2() as well, which service_role never satisfies anyway.

create or replace function public.deed_target(p_application uuid)
returns table(application_id uuid, ready boolean, tenant_names text, co_tenant_names text, tenant_count integer, unpaid_count integer, share_amount numeric, share_percent numeric, tenancy_id uuid)
language sql stable security definer set search_path to ''
as $function$
  -- WHO A DEED IS FOR. Gated so one agency cannot read another's tenant names
  -- and share amounts, and escaped so the generation path -- which has no JWT
  -- at all -- still resolves.
  with me as (
    select * from public.applications
     where id = p_application
       and (auth.uid() is null or public.app_may_reach_application(p_application))
  )
  select
    m.id,
    -- THIS TENANT'S OWN GATE. A tenant who has paid gets their deed; a tenant
    -- who has not, does not; and nobody waits on anybody else. For a tenancy of
    -- one this is exactly the gate it always was.
    m.paid_at is not null,
    -- ALL the names, for the document to say whose tenancy it is. Null on a
    -- tenancy of one, which is what keeps a single-tenant deed byte-identical:
    -- createAndSend falls back to the applicant's own name, as before.
    case when m.tenancy_id is null then null else public.tenancy_tenant_names(m.id) end,
    -- The OTHERS, for the co-tenant merge field. Null when there are none.
    case when m.tenancy_id is null then null else (
      select nullif(string_agg(
               btrim(o.tenant_first_name || ' ' || o.tenant_last_name),
               ', ' order by o.tenancy_position nulls last, o.created_at), '')
        from public.applications o
       where o.tenancy_id = m.tenancy_id and o.id <> m.id) end,
    -- A tenancy of one IS a tenancy of one. `a.tenancy_id = null` matches no
    -- row and returns 0, not null, so coalesce never fires: the solo case has to
    -- be named. The old function had the same coalesce and the same hole.
    case when m.tenancy_id is null then 1
         else (select count(*)::int from public.applications a
                where a.tenancy_id = m.tenancy_id) end,
    case when m.tenancy_id is null then (case when m.paid_at is null then 1 else 0 end)
         else (select count(*)::int from public.applications a
                where a.tenancy_id = m.tenancy_id and a.paid_at is null) end,
    -- What this deed covers. A tenancy of one covers the whole rent, which is
    -- what share_amount is null for and monthly_rent answers.
    coalesce(m.share_amount, m.monthly_rent),
    coalesce(m.share_percent, 100),
    m.tenancy_id
  from me m
$function$;

comment on function public.deed_target(uuid) is
  'Who a deed is for, and whether this tenant may have one. Reach-gated so one agency cannot read another''s tenant names and share amounts, with the service-role escape the generation path needs: pandadoc.ts calls this with no JWT.';
