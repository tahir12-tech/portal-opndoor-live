-- The Dev Centre's sandbox panel.
--
-- A developer has NO other way to see a sandbox application. The restrictive
-- policy on applications has no developer arm, deliberately, so PostgREST
-- returns nothing to anybody. That was the right call for the policy: it stays
-- absolute, the portal client needed no changes, and the hydrated dataset never
-- has to be both a sandbox view and a sandbox-free reporting base.
--
-- The cost of that decision is paid here. This function is the one door, and
-- because it is the only door it has to return everything the panel needs in one
-- call rather than letting the client join.
--
-- Column list is explicit and deliberately narrow. `select *` would hand a
-- developer partner_rate and agent_rate, which are the commission figures the
-- whole role model exists to keep away from them.

create or replace function public.dev_sandbox_applications(
  p_partner uuid default null,
  p_search  text default null,
  p_limit   int  default 100
)
returns table (
  id                   uuid,
  guarantee_ref        text,
  status               text,
  deed_state           text,
  created_at           timestamptz,
  sent_at              timestamptz,
  paid_at              timestamptz,
  deed_issued_at       timestamptz,
  tenant_first_name    text,
  tenant_last_name     text,
  tenant_email         text,
  prop_addr1           text,
  prop_postcode        text,
  monthly_rent         numeric,
  tenancy_start        date,
  agency_name          text,
  branch_name          text,
  pandadoc_document_id text,
  payment_url          text,
  referrer_name        text
)
language sql stable security definer set search_path to '' as $function$
  select
    a.id, a.guarantee_ref, a.status, a.deed_state,
    a.created_at, a.sent_at, a.paid_at, a.deed_issued_at,
    a.tenant_first_name, a.tenant_last_name, a.tenant_email,
    a.prop_addr1, a.prop_postcode, a.monthly_rent, a.tenancy_start,
    ag.name, br.name, a.pandadoc_document_id, a.payment_url, a.referrer_name
  from public.applications a
  left join public.agencies ag on ag.id = a.agency_id
  left join public.branches br on br.id = a.branch_id
  where public.is_aal2()
    -- not livemode, not `livemode = false`: same thing today, but this function
    -- must never widen to live rows if the column ever becomes nullable.
    and not a.livemode
    and (
      (public.is_admin() and (p_partner is null or a.partner_id = p_partner))
      or (public.app_role() = 'developer' and a.partner_id = public.app_partner())
    )
    and (
      p_search is null or btrim(p_search) = ''
      or a.guarantee_ref ilike '%' || btrim(p_search) || '%'
      or a.tenant_email  ilike '%' || btrim(p_search) || '%'
      or a.tenant_last_name ilike '%' || btrim(p_search) || '%'
      or a.status = btrim(p_search)
    )
  order by a.created_at desc
  limit least(coalesce(p_limit, 100), 500);
$function$;

revoke all on function public.dev_sandbox_applications(uuid, text, int) from public, anon;
grant execute on function public.dev_sandbox_applications(uuid, text, int) to authenticated;

-- ---------- one sandbox application, for the signing-link action ----------
-- The Edge Function needs the document id and the tenant email to mint a
-- PandaDoc session, and it must not take either from the request body: a
-- developer who could pass an arbitrary document id could mint a signing session
-- for somebody else's deed, including a live one.
--
-- So it passes an application id and gets back the two values, or nothing. The
-- livemode predicate here is what makes "or nothing" true for every live row.
create or replace function public.dev_sandbox_application_document(p_application uuid)
returns table (document_id text, tenant_email text, guarantee_ref text)
language sql stable security definer set search_path to '' as $function$
  select a.pandadoc_document_id, a.tenant_email, a.guarantee_ref
  from public.applications a
  where a.id = p_application
    and not a.livemode
    and public.is_aal2()
    and (
      public.is_admin()
      or (public.app_role() = 'developer' and a.partner_id = public.app_partner())
    );
$function$;

revoke all on function public.dev_sandbox_application_document(uuid) from public, anon;
grant execute on function public.dev_sandbox_application_document(uuid) to authenticated, service_role;

-- ---------- counts for the panel header ----------
create or replace function public.dev_sandbox_counts(p_partner uuid default null)
returns table (total bigint, sent bigint, paid bigint, deed bigint, closed bigint)
language sql stable security definer set search_path to '' as $function$
  select
    count(*),
    count(*) filter (where a.status = 'sent'),
    count(*) filter (where a.status = 'paid'),
    count(*) filter (where a.status = 'deed'),
    count(*) filter (where a.status in ('withdrawn','expired'))
  from public.applications a
  where public.is_aal2()
    and not a.livemode
    and (
      (public.is_admin() and (p_partner is null or a.partner_id = p_partner))
      or (public.app_role() = 'developer' and a.partner_id = public.app_partner())
    );
$function$;

revoke all on function public.dev_sandbox_counts(uuid) from public, anon;
grant execute on function public.dev_sandbox_counts(uuid) to authenticated;

-- ---------- the audit stays clean ----------
-- All three functions above read public.applications and carry an explicit
-- livemode predicate, so livemode_audit() has nothing to say about them. That is
-- the point of the assertion in 20260810280000: adding a Dev Centre feature that
-- reads applications without one would fail the deploy rather than shipping.
do $$
declare v_count int;
begin
  select count(*) into v_count from public.livemode_audit();
  if v_count > 0 then
    raise exception 'livemode_audit is no longer clean: % function(s) read applications with no predicate.', v_count;
  end if;
end $$;
