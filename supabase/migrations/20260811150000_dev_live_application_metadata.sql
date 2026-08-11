-- A developer's view of LIVE applications: metadata only.
--
-- THE PROBLEM. A developer can see sandbox applications and nothing else, so
-- they cannot answer the first question anyone asks after go-live: did my POST
-- actually produce an application, and what happened to it? Without that, a live
-- integration is verified by asking somebody in another team to look.
--
-- WHY NOT AN RLS ARM. The obvious fix is a `developer` arm on applications_select.
-- It is the wrong shape: RLS grants access to ROWS, not columns, so it hands over
-- the whole record. That is the tenant's name, date of birth, email, phone and
-- home address; the monthly rent; and partner_rate and agent_rate, which are the
-- commission terms the entire role model exists to keep away from a partner's
-- own staff. A developer needs none of it to verify an integration.
--
-- So this is a projection on a WRITTEN-DOWN ALLOWLIST instead, and the allowlist
-- is the point of the function. Adding a column here is a deliberate act with a
-- reviewer; widening an RLS policy is one word.
--
-- ---------------------------------------------------------------------------
-- WHAT IS RETURNED, AND WHY EACH ONE IS SAFE
-- ---------------------------------------------------------------------------
--   guarantee_ref     the partner's own handle. They sent the request that made it
--   status            the partner vocabulary, via partner_status()
--   created_at        when we accepted it
--   sent_at, paid_at, deed_issued_at
--                     the three lifecycle timestamps. These are "what happened to
--                     it", which is the question being answered. They are events,
--                     not attributes of a person
--   idempotency_key   the developer's OWN string, echoed back
--   api_key_name      which of their keys did it
--   request_at, request_status
--                     when we answered and with what
--
-- WHAT IS DELIBERATELY ABSENT. Every tenant field, every property field,
-- monthly_rent, partner_rate, agent_rate, referrer identity, payment_url and the
-- payment token. If a developer needs one of these to debug, that is a
-- conversation, not a column: the answer is usually that Logs already shows them
-- the redacted body they sent.

create or replace function public.dev_live_applications(
  p_partner uuid default null,
  p_search  text default null,
  p_limit   int  default 100
)
returns table (
  id                 uuid,
  guarantee_ref      text,
  status             text,
  created_at         timestamptz,
  sent_at            timestamptz,
  paid_at            timestamptz,
  deed_issued_at     timestamptz,
  idempotency_key    text,
  api_key_name       text,
  request_at         timestamptz,
  request_status     int
)
language sql stable security definer set search_path to '' as $function$
  select
    a.id,
    a.guarantee_ref,
    -- The partner vocabulary, not the stored value. A developer reading this
    -- beside their webhook payloads must see the same words in both.
    public.partner_status(a.status),
    a.created_at, a.sent_at, a.paid_at, a.deed_issued_at,
    r.idempotency_key,
    k.name,
    r.created_at,
    r.status_code
  from public.applications a
  -- The linking row. LEFT, because an application created in the portal has no
  -- API request behind it, and hiding those would tell a developer their key
  -- created every application their partner has.
  left join public.partner_api_requests r on r.application_id = a.id
  left join public.partner_api_keys k on k.id = r.api_key_id
  where public.is_aal2()
    -- LIVE only. The sandbox list is a separate function with a separate panel,
    -- deliberately: merging them would mean one table where the most important
    -- column is a badge people stop reading.
    and a.livemode
    and (
      (public.is_admin() and (p_partner is null or a.partner_id = p_partner))
      or (public.app_role() = 'developer' and a.partner_id = public.app_partner())
    )
    and (
      p_search is null or btrim(p_search) = ''
      or a.guarantee_ref ilike '%' || btrim(p_search) || '%'
      or r.idempotency_key ilike '%' || btrim(p_search) || '%'
      or public.partner_status(a.status) = btrim(p_search)
    )
  order by a.created_at desc, a.id desc
  limit least(coalesce(p_limit, 100), 500);
$function$;

revoke all on function public.dev_live_applications(uuid, text, int) from public, anon;
grant execute on function public.dev_live_applications(uuid, text, int) to authenticated;

create or replace function public.dev_live_application_counts(p_partner uuid default null)
returns table (total bigint, from_api bigint, sent bigint, paid bigint, deed bigint, closed bigint)
language sql stable security definer set search_path to '' as $function$
  select
    count(*),
    -- How many came through the API at all. A developer whose integration is
    -- live and whose from_api count is zero has their answer immediately.
    count(*) filter (where exists (
      select 1 from public.partner_api_requests r where r.application_id = a.id)),
    count(*) filter (where a.status = 'sent'),
    count(*) filter (where a.status = 'paid'),
    count(*) filter (where a.status = 'deed'),
    count(*) filter (where a.status in ('withdrawn','expired'))
  from public.applications a
  where public.is_aal2()
    and a.livemode
    and (
      (public.is_admin() and (p_partner is null or a.partner_id = p_partner))
      or (public.app_role() = 'developer' and a.partner_id = public.app_partner())
    );
$function$;

revoke all on function public.dev_live_application_counts(uuid) from public, anon;
grant execute on function public.dev_live_application_counts(uuid) to authenticated;

-- Both read public.applications and both carry an explicit livemode predicate,
-- so the audit stays clean. Asserted rather than assumed.
do $$
declare v int;
begin
  select count(*) into v from public.livemode_audit();
  if v > 0 then
    raise exception 'livemode_audit is not clean: % function(s) read applications with no predicate.', v;
  end if;
end $$;
