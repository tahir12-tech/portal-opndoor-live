-- WHAT THE FOURTH REVIEWER FOUND.
--
-- Eleven findings. The two worst are not leaks at all: they are locks of mine
-- that stop real work, and both were invisible to a green suite. A lock that
-- breaks the product is as much a defect as a hole, and it is the kind this
-- process was least good at catching, because every test I had was asking
-- "is this refused?" and none was asking "does this still work?".
--
-- That is why this migration ships beside a functional guard suite: one test
-- per user-facing action a security migration touches, run as the role that
-- SHOULD be allowed, asserting it succeeds.

-- ===========================================================================
-- H1. NO NEW USER COULD BE INVITED (critical in effect, and mine)
-- ===========================================================================
-- 20261006330000 put create_invited_user in the service-role bucket, because
-- the bucket was computed from every `userClient.rpc("...")` in the edge
-- functions AT THAT MOMENT -- and invite-user did not call it yet. I changed
-- invite-user to call it half an hour later and never re-derived the grant.
--
-- So on a clean apply: generateLink succeeds, the RPC raises 42501, the
-- catch deletes the half-made auth account, and the invite fails with a raw
-- permission error. Every management and negotiator invite on every rail.
--
-- It did not show up because dev had the grant: I had re-applied
-- 20261006300000 (which grants it) AFTER 330000 had run. The files and dev
-- disagreed, and every local test was measuring dev. `npm run drift` now
-- refuses that state, and CLAUDE.md forbids the re-apply that caused it.
grant execute on function public.create_invited_user(uuid,text,text,text,uuid,uuid,boolean,text,uuid)
  to authenticated, service_role;

-- ===========================================================================
-- H2. "REMOVE POSITION" COULD NEVER SUCCEED (and also mine)
-- ===========================================================================
-- user_scopes_delete, added in 20261006350000 to make Remove position work at
-- all, calls may_act_on_user -- which 20261006330000 revoked from
-- authenticated. A policy expression IS permission-checked against the
-- querying role, so the DELETE raises "permission denied for function
-- may_act_on_user" for managers AND for admins, rather than refusing or
-- succeeding.
--
-- Reproduced on dev as Regent's Director on their own Negotiator:
--   ERROR 42501: permission denied for function may_act_on_user
--
-- may_act_on_user is a policy predicate now, so it is granted like the other
-- sixteen and joins the allowlist. It answers only about the caller and a
-- target they have already been narrowed to.
grant execute on function public.may_act_on_user(uuid) to authenticated, service_role;

-- assert_may_act_on_user stays service-role-only: it RAISES, so it is only
-- ever called from inside a definer function, never from a policy.

-- ===========================================================================
-- L1. A NEGOTIATOR COULD RE-ROUTE THEIR OWN APPLICATION ONTO A SUPPLIER
-- ===========================================================================
-- The management arm of applications_update pins partner_id = app_partner();
-- the referrer arm does not, and partner_id is in the table UPDATE grant with
-- no column trigger (applications_sync_partner fires on branch_id and
-- agency_id only). Set partner_id to a supplier's uuid and
-- is_our_estate_partner turns false, app_has_scope is true, and the check
-- passes on the caller's own branch.
--
-- The consequences are larger than the read: application_channel flips to
-- 'Partner referral', the deed falls off the people ladder onto the branch
-- mailbox, and enqueue_partner_webhook fans the tenant, property and fee out
-- to that supplier's endpoints. Bounded today only by uuid opacity.
drop policy if exists applications_update on public.applications;
create policy applications_update on public.applications
  for update
  using (
    public.is_admin()
    or (public.app_role() = 'management'
        and partner_id = public.app_partner()
        and public.app_may_reach_application_org(partner_id, agency_id, branch_id))
    or (public.app_role() = 'referrer'
        and referrer_id = auth.uid()
        and status = 'sent'
        and partner_id = public.app_partner()
        and public.app_may_reach_application_org(partner_id, agency_id, branch_id))
  )
  with check (
    public.is_admin()
    or (public.app_role() = 'management'
        and partner_id = public.app_partner()
        and public.app_may_reach_application_org(partner_id, agency_id, branch_id))
    or (public.app_role() = 'referrer'
        and referrer_id = auth.uid()
        and status = 'sent'
        and partner_id = public.app_partner()
        and public.app_may_reach_application_org(partner_id, agency_id, branch_id))
  );

-- ===========================================================================
-- L2. authenticated COULD WRITE THE TWO COLUMNS IT MAY NOT READ
-- ===========================================================================
-- 20260811180000 narrowed SELECT on public.applications to every column but
-- partner_rate and agent_rate, and left the table-level INSERT and UPDATE
-- grants covering all of them. So a manager in scope, or a referrer on their
-- own sent row, could set a commission figure they are forbidden to read.
-- Mitigated in practice (the estate reads the frozen
-- application_commission_lines, and the scalar is a fallback for pre-additive
-- rows), and still the wrong shape.
--
-- Same method as the SELECT: drop the table grant, re-grant per column,
-- generated from information_schema so a new column is not silently dropped
-- from every write path, and assert it.
do $rates$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'applications'
     and column_name not in ('partner_rate', 'agent_rate')
     and is_generated = 'NEVER';
  if cols is null or cols = '' then
    raise exception 'Refusing to proceed: no writable columns found on public.applications.';
  end if;
  execute 'revoke insert, update on public.applications from anon, authenticated';
  execute format('grant insert (%s), update (%s) on public.applications to authenticated', cols, cols);
end $rates$;

do $proof$
begin
  if has_column_privilege('authenticated', 'public.applications', 'agent_rate', 'UPDATE')
     or has_column_privilege('authenticated', 'public.applications', 'partner_rate', 'UPDATE') then
    raise exception 'A commission column on applications is still writable by authenticated.';
  end if;
  if not has_column_privilege('authenticated', 'public.applications', 'status', 'UPDATE') then
    raise exception 'The re-grant is too narrow: status can no longer be updated.';
  end if;
  if not has_column_privilege('authenticated', 'public.applications', 'tenant_email', 'INSERT') then
    raise exception 'The re-grant is too narrow: an application can no longer be created.';
  end if;
end $proof$;

-- ===========================================================================
-- The rest, rewritten from pg_get_functiondef so only the named arm changes
-- ===========================================================================
-- M1. admin_update_user_role: the promotion door was open
CREATE OR REPLACE FUNCTION public.admin_update_user_role(p_user uuid, p_role text)
 RETURNS users
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur public.users; res public.users; who text; me uuid := auth.uid();
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_role not in ('superadmin','management','referrer','developer') then
    raise exception 'Invalid role' using errcode = '22023';
  end if;
  select * into cur from public.users where id = p_user;
  if cur.id is null then raise exception 'User not found' using errcode = '22023'; end if;
  /* NO DEVELOPER ON OUR OWN ESTATE, BY ANY PATH. invite-user has refused to
     CREATE one since the estate arrived, and 20261006270000 refuses the API
     key and the webhook endpoint a developer exists to hold. This function
     could still PROMOTE somebody into the role, which is the same account by
     a different door: invite them as a Negotiator, then change the role. A
     developer is pinned to a partner, and on the house route the partner is
     every agency we carry. */
  if p_role = 'developer' and public.is_our_estate_partner(cur.partner_id) then
    raise exception 'The developer role is for a supplier''s own API integration. There is no API on the agency rail, so there is nobody for it to be.'
      using errcode = '22023';
  end if;
  if not (public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and public.app_may_reach_user(cur.id))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform public.assert_may_act_on_user(p_user);
  -- WAS: `if not public.is_admin() and public.app_has_scope() then`, so an
  -- unpositioned manager SKIPPED this narrowing rather than being refused by
  -- it. The same class as the arms above, wearing a different face.
  if not public.is_admin() then
    if not exists (select 1 from public.user_scopes s
                    where s.user_id = me and s.kind in ('group','agency')) then
      raise exception 'A branch manager cannot change roles.' using errcode = '42501';
    end if;
  end if;
  if cur.role = 'superadmin' and p_role <> 'superadmin' then
    raise exception 'An opndoor admin cannot be reassigned to a partner role.' using errcode = '22023';
  end if;
  if cur.role <> 'superadmin' and p_role not in ('management','referrer','developer') then
    raise exception 'A partner user can only be Management, Referrer or Developer.' using errcode = '22023';
  end if;
  if p_user = me and p_role <> cur.role then
    raise exception 'You cannot change your own role.' using errcode = '42501';
  end if;
  if cur.role = 'superadmin' and p_role <> 'superadmin'
     and (select count(*) from public.users where role = 'superadmin' and status = 'active') <= 1 then
    raise exception 'At least one active opndoor admin must remain.' using errcode = '42501';
  end if;
  if cur.role = p_role then return cur; end if;
  update public.users set role = p_role where id = p_user returning * into res;
  select full_name into who from public.users where id = me;
  insert into public.user_audit(target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'role', cur.role, p_role, coalesce(who, 'opndoor admin'), me);
  return res;
end $function$;

-- M1. dev_live_applications: the partner was the whole boundary
CREATE OR REPLACE FUNCTION public.dev_live_applications(p_partner uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, guarantee_ref text, status text, created_at timestamp with time zone, sent_at timestamp with time zone, paid_at timestamp with time zone, deed_issued_at timestamp with time zone, idempotency_key text, api_key_name text, request_at timestamp with time zone, request_status integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      or (public.app_role() = 'developer' and a.partner_id = public.app_partner()
          /* AND THE AGENCY, REGARDLESS OF THE ROLE BEING UNREACHABLE. On the
             house route `partner_id = app_partner()` is every agency we
             carry, so the predicate that used to be the whole boundary is
             half of it. This answers false for a developer with no position,
             and true on the supplier rail where the partner IS the company. */
          and public.app_may_reach_application_org(a.partner_id, a.agency_id, a.branch_id))
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

-- M1. dev_live_application_counts: the partner was the whole boundary
CREATE OR REPLACE FUNCTION public.dev_live_application_counts(p_partner uuid DEFAULT NULL::uuid)
 RETURNS TABLE(total bigint, from_api bigint, sent bigint, paid bigint, deed bigint, closed bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      or (public.app_role() = 'developer' and a.partner_id = public.app_partner()
          /* AND THE AGENCY, REGARDLESS OF THE ROLE BEING UNREACHABLE. On the
             house route `partner_id = app_partner()` is every agency we
             carry, so the predicate that used to be the whole boundary is
             half of it. This answers false for a developer with no position,
             and true on the supplier rail where the partner IS the company. */
          and public.app_may_reach_application_org(a.partner_id, a.agency_id, a.branch_id))
    );
$function$;

-- M1. dev_sandbox_applications: the partner was the whole boundary
CREATE OR REPLACE FUNCTION public.dev_sandbox_applications(p_partner uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, guarantee_ref text, status text, deed_state text, created_at timestamp with time zone, sent_at timestamp with time zone, paid_at timestamp with time zone, deed_issued_at timestamp with time zone, tenant_first_name text, tenant_last_name text, tenant_email text, prop_addr1 text, prop_postcode text, monthly_rent numeric, tenancy_start date, agency_name text, branch_name text, pandadoc_document_id text, payment_url text, referrer_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      or (public.app_role() = 'developer' and a.partner_id = public.app_partner()
          /* AND THE AGENCY, REGARDLESS OF THE ROLE BEING UNREACHABLE. On the
             house route `partner_id = app_partner()` is every agency we
             carry, so the predicate that used to be the whole boundary is
             half of it. This answers false for a developer with no position,
             and true on the supplier rail where the partner IS the company. */
          and public.app_may_reach_application_org(a.partner_id, a.agency_id, a.branch_id))
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

-- M1. dev_sandbox_counts: the partner was the whole boundary
CREATE OR REPLACE FUNCTION public.dev_sandbox_counts(p_partner uuid DEFAULT NULL::uuid)
 RETURNS TABLE(total bigint, sent bigint, paid bigint, deed bigint, closed bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      or (public.app_role() = 'developer' and a.partner_id = public.app_partner()
          /* AND THE AGENCY, REGARDLESS OF THE ROLE BEING UNREACHABLE. On the
             house route `partner_id = app_partner()` is every agency we
             carry, so the predicate that used to be the whole boundary is
             half of it. This answers false for a developer with no position,
             and true on the supplier rail where the partner IS the company. */
          and public.app_may_reach_application_org(a.partner_id, a.agency_id, a.branch_id))
    );
$function$;

-- M2. fire_renewal_notices emailed a deactivated referrer
CREATE OR REPLACE FUNCTION public.fire_renewal_notices(p_today date)
 RETURNS TABLE(application_id uuid, guarantee_ref text, tenant_name text, property_addr text, end_date date, tenant_email text, contact_name text, contact_email text, referrer_name text, referrer_email text, channel text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  return query
  with due as (
    select a.id
    from public.applications a
    where a.status = 'deed'
      -- ADDED. A sandbox guarantee must never send real email.
      and a.livemode
      and coalesce(a.payment_state, '') <> 'refunded'
      and a.tenancy_start is not null
      and (a.tenancy_start + interval '12 months' - interval '1 day')::date between p_today and (p_today + 30)
      and not exists (select 1 from public.guarantee_renewal_notices g where g.application_id = a.id)
  ),
  ins as (
    insert into public.guarantee_renewal_notices (application_id)
    select id from due
    on conflict (application_id) do nothing
    returning application_id
  )
  select
    a.id,
    a.guarantee_ref,
    btrim(concat_ws(' ', nullif(btrim(coalesce(a.tenant_title, '')), ''), a.tenant_first_name, a.tenant_last_name)),
    btrim(a.prop_addr1 || case when coalesce(a.prop_postcode, '') <> '' then ', ' || a.prop_postcode else '' end),
    (a.tenancy_start + interval '12 months' - interval '1 day')::date,
    a.tenant_email,
    -- THE CONTACT, BY RAIL.
    case public.application_channel(a.id)
      -- Agent referral: nobody here. The caller asks the ladder, because the
      -- answer is a list and it is per-position.
      when 'Agent referral' then null
      -- Direct: the tenant's OWN nominated contact, and if they have none
      -- then nobody. Never the branch the matcher happened to point at.
      when 'Direct' then nullif(btrim(coalesce(d.agency_name, '')), '')
      -- Supplier and provider hand-over: the branch mailbox, as before.
      else epc.name
    end,
    case public.application_channel(a.id)
      when 'Agent referral' then null
      when 'Direct' then d.email
      else coalesce(nullif(btrim(coalesce(a.landlord_email, '')), ''), epc.email)
    end,
    ru.full_name,
    ru.email,
    public.application_channel(a.id)
  from ins
  join public.applications a on a.id = ins.application_id
  left join public.application_delivery_contacts d on d.application_id = a.id
  left join lateral public.effective_primary_contact(a.branch_id) epc on true
  -- ACTIVE ONLY. agency_notification_recipients excludes an inactive referrer
  -- deliberately, so an active one is deduplicated against the ladder while a
  -- DEACTIVATED one was added back beside it: the exact case Rule 1 says
  -- should fall to the ticked users in scope.
  left join public.users ru on ru.id = a.referrer_id and ru.status = 'active';
end $function$;

-- M3. commission_statement_recipients ignored the level
CREATE OR REPLACE FUNCTION public.commission_statement_recipients(p_level text, p_org_id uuid)
 RETURNS TABLE(email text, full_name text, source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with party as (
    select case when p_level = 'group'  then p_org_id end as group_id,
           case when p_level = 'agency' then p_org_id end as agency_id,
           case when p_level = 'branch' then p_org_id end as branch_id
  ),
  -- The party itself plus every party ABOVE it. Upwards only: see the header.
  chain as (
    select coalesce(pa.group_id, ag.group_id, bag.group_id) as group_id,
           coalesce(pa.agency_id, br.agency_id)             as agency_id,
           pa.branch_id                                     as branch_id
    from party pa
    left join public.agencies ag  on ag.id  = pa.agency_id
    left join public.branches br  on br.id  = pa.branch_id
    left join public.agencies bag on bag.id = br.agency_id
  ),
  found as (
    select u.email, u.full_name, 'person'::text as source
    from chain c
    join public.user_scopes s
      on (s.kind = 'group'  and s.group_id  = c.group_id)
      or (s.kind = 'agency' and s.agency_id = c.agency_id)
      or (s.kind = 'branch' and s.branch_id = c.branch_id)
    join public.users u on u.id = s.user_id
    -- AND THEY MUST BE ENTITLED TO SEE COMMISSION. The admin-set tick was the
    -- only test, so a Director demoted to Manager kept receiving a PDF of
    -- every commission line for their party: the one figure withheld from a
    -- Manager on every other surface. The LEVEL is the rule; the tick only
    -- says which of the people at that level want the email.
    -- ACTIVE, not "not deactivated". A pending invite has never signed in, so
    -- the portal link in the statement goes somewhere they cannot open. The run
    -- reports a payee it could not address rather than mailing a dead account.
    where u.receives_commission_statements
      and u.status = 'active'
      and coalesce(btrim(u.email), '') <> ''
    union all
    select f.finance_email, null, 'finance'
    from (
      select ag.finance_email from public.agencies ag, party pa
       where p_level = 'agency' and ag.id = pa.agency_id
      union all
      select gr.finance_email from public.agency_groups gr, party pa
       where p_level = 'group' and gr.id = pa.group_id
    ) f
    where coalesce(btrim(f.finance_email), '') <> ''
  )
  -- One address, once. A finance mailbox that is also somebody's login would
  -- otherwise receive the statement twice, from two different reasons.
  select distinct on (lower(btrim(r.email))) btrim(r.email), r.full_name, r.source
  from found r
  order by lower(btrim(r.email)), r.source desc
$function$;

-- L5. agency_weekly_climber could name somebody who has left
CREATE OR REPLACE FUNCTION public.agency_weekly_climber(p_user uuid, p_curr_start timestamp with time zone, p_curr_end timestamp with time zone, p_prev_start timestamp with time zone, p_prev_end timestamp with time zone)
 RETURNS TABLE(climber_name text, climber_delta integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with mine as (
    -- The agencies this reader covers. Positions only: home_branch_id is not
    -- a boundary anywhere any more (20261006310000).
    select a.id
    from public.agencies a
    where exists (
      select 1 from public.user_scopes s
      where s.user_id = p_user
        and (   (s.kind = 'agency' and s.agency_id = a.id)
             or (s.kind = 'group'  and a.group_id is not null and s.group_id = a.group_id)
             or (s.kind = 'branch' and exists (
                   select 1 from public.branches b
                   where b.id = s.branch_id and b.agency_id = a.id)))
    )
  ),
  curr as (
    select a.referrer_id as rid, u.full_name as nm,
      coalesce(sum(a.monthly_rent) filter (
        where a.paid_at >= p_curr_start and a.paid_at < p_curr_end
          and a.payment_state is distinct from 'refunded'), 0) as fees,
      count(*) filter (
        where a.status not in ('withdrawn','expired')
          and a.sent_at >= p_curr_start and a.sent_at < p_curr_end) as sent
    from public.applications a
    join public.users u on u.id = a.referrer_id
    where a.livemode and a.referrer_id is not null and u.role <> 'superadmin'
      -- Not somebody who has left. Naming them is worse than naming nobody.
      and u.status = 'active'
      and a.agency_id in (select id from mine)
    group by a.referrer_id, u.full_name
  ),
  prev as (
    -- nm is carried only so last week's ranking breaks ties the same way this
    -- week's does. Rank the two differently and a name with no change in fees
    -- appears to have moved.
    select a.referrer_id as rid, u.full_name as nm,
      coalesce(sum(a.monthly_rent) filter (
        where a.paid_at >= p_prev_start and a.paid_at < p_prev_end
          and a.payment_state is distinct from 'refunded'), 0) as fees
    from public.applications a
    join public.users u on u.id = a.referrer_id
    where a.livemode and a.referrer_id is not null and u.role <> 'superadmin'
      -- Not somebody who has left. Naming them is worse than naming nobody.
      and u.status = 'active'
      and a.agency_id in (select id from mine)
    group by a.referrer_id, u.full_name
  ),
  curr_r as (select rid, nm, fees, sent, row_number() over (order by fees desc, nm asc) as rnk from curr),
  prev_r as (select rid, row_number() over (order by fees desc, nm asc) as rnk from prev),
  moved as (
    select c.nm, (p.rnk - c.rnk) as delta
    from curr_r c join prev_r p on p.rid = c.rid
    where (c.fees > 0 or c.sent > 0) and (p.rnk - c.rnk) > 0
  )
  -- One name, the biggest riser, ties broken by name so the answer is stable
  -- week to week rather than depending on the plan.
  select m.nm, m.delta::int from moved m order by m.delta desc, m.nm asc limit 1
$function$;

-- M3. set_agency_level left the commission-statement tick behind
CREATE OR REPLACE FUNCTION public.set_agency_level(p_user uuid, p_level text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cur    public.users;
  v_role text;
  v_sees boolean;
  v_old  text;
  v_actor text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  select * into cur from public.users where id = p_user;
  if cur.id is null then
    raise exception 'No such person.' using errcode = '22023';
  end if;

  -- Containment: within my partner, and within my positions if I have any.
  if not (public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and public.app_may_reach_user(cur.id))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- Seniority, both halves. The first says I may touch this person; the second says
  -- I may hand out this level. Without the second a Manager could promote a
  -- Negotiator, who is below her, to Director, who is above her.
  perform public.assert_may_act_on_user(p_user);
  perform public.assert_may_grant_level(p_level);

  -- The three levels, spelled as the product spells them. Anything else is a
  -- typo and must not be guessed at. (assert_may_grant_level has already refused
  -- anything that is not one of the three; this maps the survivors.)
  if p_level = 'Director' then v_role := 'management'; v_sees := true;
  elsif p_level = 'Manager' then v_role := 'management'; v_sees := false;
  elsif p_level = 'Negotiator' then v_role := 'referrer'; v_sees := false;
  else
    raise exception 'An agency level is Director, Manager or Negotiator.' using errcode = '22023';
  end if;

  v_old := public.agency_level_of(p_user);

  /* DEMOTING CLEARS THE COMMISSION-STATEMENT TICK. receives_commission_statements
     is admin-set and nothing else ever cleared it, so a Director demoted to
     Manager kept receiving a monthly PDF of every commission line for their
     party. commission_statement_recipients now tests the level too, so this is
     the belt to that brace -- and it is the half that makes the row on screen
     honest rather than leaving a tick that no longer does anything. */
  if not v_sees and cur.receives_commission_statements then
    perform set_config('app.setting_commission_tick', 'on', true);
    update public.users set receives_commission_statements = false where id = p_user;
    perform set_config('app.setting_commission_tick', 'off', true);
    insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
    values ('user', p_user, 'commission_statement_tick_cleared',
            'level changed to ' || p_level, coalesce(v_actor, 'a manager'), auth.uid());
  end if;

  -- Opndoor's own staff are not agency people and have no level to set. Guarding
  -- here rather than letting the update through: this function would otherwise be
  -- a way to turn a superadmin into a referrer. agency_level_of returns null for
  -- them and for a developer, which is the same answer for the same reason.
  if v_old is null then
    raise exception 'That person is not agency staff, so they have no agency level.' using errcode = '22023';
  end if;

  if v_old = p_level then return; end if;

  update public.users set role = v_role, sees_commission = v_sees where id = p_user;

  v_actor := coalesce((select full_name from public.users where id = auth.uid()), 'an administrator');
  insert into public.user_audit (target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'agency level changed', v_old, p_level, v_actor, auth.uid());
end $function$;

-- M4. agency_weekly_digest counted direct-rail applications
CREATE OR REPLACE FUNCTION public.agency_weekly_digest(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(agency_id uuid, agency_name text, partner_id uuid, sent integer, sent_paid integer, paid integer, fees numeric, deeds integer, awaiting integer, top_branch text, top_branch_fees numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return query
  with base as (
    select a.agency_id, a.partner_id, a.status, a.sent_at, a.paid_at, a.deed_issued_at,
           a.deed_state, a.monthly_rent, a.fee_amount, b.name as branch_name
    from public.applications a
    left join public.branches b on b.id = a.branch_id
    where a.livemode
      /* AGENCY-RAIL BUSINESS ONLY. A direct application keeps
         partner_id = 'opndoor-direct' but is given an agency_id and a
         branch_id by the automatic matcher, so it is invisible to that agency
         in the portal (applications_select pins the partner) and was counted
         in their weekly digest anyway. A direct tenant is Opndoor's business,
         never the matched agency's. */
      and public.application_channel(a.id) = 'Agent referral'
  ),
  per_agency as (
    select ag.id as aid, ag.name as aname, ag.partner_id as apid,
      count(*) filter (where base.status <> 'withdrawn' and base.sent_at >= p_start and base.sent_at < p_end)::int as v_sent,
      count(*) filter (where base.status <> 'withdrawn' and base.sent_at >= p_start and base.sent_at < p_end and base.paid_at is not null)::int as v_sent_paid,
      count(*) filter (where base.paid_at >= p_start and base.paid_at < p_end)::int as v_paid,
      coalesce(sum(coalesce(base.fee_amount, base.monthly_rent)) filter (where base.paid_at >= p_start and base.paid_at < p_end), 0) as v_fees,
      count(*) filter (where base.deed_issued_at >= p_start and base.deed_issued_at < p_end)::int as v_deeds,
      count(*) filter (where base.deed_state = 'awaiting_tenant')::int as v_awaiting
    from public.agencies ag
    left join base on base.agency_id = ag.id
    where not ag.is_placeholder
    group by ag.id, ag.name, ag.partner_id
  ),
  branch_agg as (
    select base.agency_id as aid, base.branch_name as bname,
      coalesce(sum(coalesce(base.fee_amount, base.monthly_rent)) filter (where base.paid_at >= p_start and base.paid_at < p_end), 0) as bf
    from base
    where base.branch_name is not null
    group by base.agency_id, base.branch_name
  ),
  top_branch as (
    select ba.aid, ba.bname, ba.bf,
      row_number() over (partition by ba.aid order by ba.bf desc, ba.bname asc) as rn
    from branch_agg ba
  )
  select pa.aid, pa.aname, pa.apid, pa.v_sent, pa.v_sent_paid, pa.v_paid, pa.v_fees,
         pa.v_deeds, pa.v_awaiting, tb.bname, tb.bf
  from per_agency pa
  left join top_branch tb on tb.aid = pa.aid and tb.rn = 1;
end $function$;

-- L4. app_may_reach_application_org already closes; nothing to do

