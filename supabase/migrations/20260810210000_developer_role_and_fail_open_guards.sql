-- Add the 'developer' role, and close every server-side gate that would
-- otherwise grant it something.
--
-- WHY THE GUARDS ARE IN THE SAME MIGRATION AS THE CONSTRAINT. The instant
-- 'developer' becomes a permitted value, a set of existing checks start admitting
-- it. Widening the constraint in one migration and fixing the gates in another
-- leaves a window in which the role exists and is over-privileged. They ship
-- together or not at all.
--
-- THE STRUCTURAL CAUSE, because it explains every fix below. This schema mixes
-- two idioms:
--
--   positive  app_role() in ('management','referrer')     a new role is excluded
--   negative  role <> 'referrer', else true, or a test    a new role INHERITS
--             on partner membership with no role part      whatever the negation
--                                                          implies
--
-- One constraint makes every partner-membership test fire. users_partner_by_role
-- (core_schema.sql:59-62) requires a non-superadmin to have a partner_id, so a
-- developer always has one. Every check of the shape "x = public.app_partner()"
-- with no role component therefore admits a developer the moment the role is
-- legal. That is the single most important thing to understand here.
--
-- Each fix below converts a negative or partner-only test into a positive
-- allowlist. A positive allowlist excludes the NEXT role added too, which is the
-- point: the next person to add a role should get a wall of deny, not a silent
-- grant.

-- ---------- 1. the role itself ----------
alter table public.users drop constraint if exists users_status_check_role_placeholder;
alter table public.users drop constraint if exists users_role_check;
alter table public.users
  add constraint users_role_check
  check (role in ('superadmin','management','referrer','developer'));

comment on column public.users.role is
  'superadmin (opndoor admin), management, referrer, developer. A developer belongs to a partner like management does, sees the Dev Centre, and must never see commercial data: no commission, no league, no exports, no bordereau.';

-- users_partner_by_role is deliberately NOT changed. It already requires a
-- non-superadmin to have a partner_id, which is exactly right for a developer.

-- ---------- 2. a name for the thing ----------
create or replace function public.is_developer()
returns boolean language sql stable security definer set search_path to '' as $$
  select public.app_role() = 'developer'
$$;

comment on function public.is_developer() is
  'True when the caller is a partner developer. Prefer positive allowlists over calling this: excluding one role by name does not exclude the next role somebody adds.';

revoke all on function public.is_developer() from public, anon;
grant execute on function public.is_developer() to authenticated, service_role;

-- ---------- 3. create_referral: no commercial writes ----------
-- Was: if not (public.is_admin() or pid = public.app_partner())
-- A partner-membership test with no role component, so a developer could create
-- live fee-bearing applications, and the RETURNING row hands back the
-- partner_rate and agent_rate snapshots. Identical to 20260807120000 otherwise.
create or replace function public.create_referral(p_branch uuid, p_tenant_title text, p_first text, p_last text, p_dob date, p_email text, p_phone text, p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text, p_rent numeric, p_tenancy_start date)
 returns applications
 language plpgsql security definer set search_path to ''
as $function$
declare ag uuid; pid uuid; prate numeric; arate numeric; a public.applications;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  perform public.assert_referral_valid(
    p_branch, p_tenant_title, p_first, p_last, p_dob, p_email, p_phone,
    p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

  select b.agency_id, b.partner_id, p.partner_rate, p.agent_rate
    into ag, pid, prate, arate
  from public.branches b
  join public.partners p on p.id = b.partner_id
  where b.id = p_branch;
  if ag is null then raise exception 'Selected branch not found' using errcode = '22023'; end if;
  if not (public.is_admin()
          or (public.app_role() in ('management','referrer') and pid = public.app_partner())) then
    raise exception 'not permitted for this partner' using errcode = '42501';
  end if;

  insert into public.applications(
    guarantee_ref, branch_id, agency_id, partner_id, referrer_id, referrer_name,
    tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
    prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
    monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate
  ) values (
    'GR-' || nextval('public.guarantee_ref_seq')::text, p_branch, ag, pid, auth.uid(),
    (select full_name from public.users where id = auth.uid()),
    p_tenant_title, btrim(p_first), btrim(p_last), p_dob, btrim(p_email), btrim(p_phone),
    btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')), ''), btrim(p_city),
    nullif(btrim(coalesce(p_county,'')), ''), upper(btrim(p_postcode)),
    p_rent, p_tenancy_start, 'sent', now(), prate, arate
  ) returning * into a;
  return a;
end $function$;

-- ---------- 4. referrer_league: the worst of the set ----------
-- Was gated ONLY by is_aal2() and "pid is null", with no role test anywhere in
-- the body, while being security definer and granted to authenticated. A
-- developer always has a partner_id, so both gates passed and the whole league
-- including fees per referrer was one browser call away. Hiding the nav item
-- would have done nothing.
--
-- Only the caller gate is added; the body is otherwise the live definition from
-- 20260705115145.
CREATE OR REPLACE FUNCTION public.referrer_league(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(name text, refs integer, fees numeric, is_self boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pid uuid := public.app_partner(); me uuid := auth.uid(); v_mode text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  -- THE FIX. This function is security definer, granted to authenticated, and its
  -- only other gates are MFA and a non-null partner. A developer always has a
  -- partner_id (users_partner_by_role), so both passed and the whole league
  -- including fees per referrer was one browser call away. Commercial data, so a
  -- positive allowlist. Returning empty rather than raising keeps callers simple.
  if public.app_role() not in ('superadmin','management','referrer') then return; end if;
  if pid is null then return; end if;
  select referrer_leaderboard_mode into v_mode from public.partners where id = pid;
  v_mode := coalesce(v_mode, 'full');

  if v_mode = 'private' then
    return query
    select coalesce(u.full_name, 'You'),
           (select count(*)::int from public.applications a
              where a.partner_id = pid and a.referrer_id = me and a.status not in ('withdrawn','expired') and a.sent_at between p_start and p_end),
           (select coalesce(sum(a.monthly_rent), 0) from public.applications a
              where a.partner_id = pid and a.referrer_id = me and a.paid_at between p_start and p_end and a.payment_state is distinct from 'refunded'),
           true
    from public.users u where u.id = me;
    return;
  end if;

  return query
  with agg as (
    select a.referrer_id as rid,
           count(*) filter (where a.status not in ('withdrawn','expired') and a.sent_at between p_start and p_end) as ct,
           coalesce(sum(a.monthly_rent) filter (where a.paid_at between p_start and p_end and a.payment_state is distinct from 'refunded'), 0) as amt
    from public.applications a
    where a.partner_id = pid and a.referrer_id is not null
    group by a.referrer_id
  ),
  peers as (
    select u.full_name as rname, agg.ct::int as rrefs,
           case when v_mode = 'rankings' then 0::numeric else agg.amt end as rfees,
           agg.amt as ramt, (agg.rid = me) as rself, agg.rid as rrid
    from agg join public.users u on u.id = agg.rid
    where u.role <> 'superadmin' and agg.ct > 0
  ),
  self_row as (
    select coalesce(u.full_name, 'You') as rname,
           (select count(*)::int from public.applications a
              where a.partner_id = pid and a.referrer_id = me and a.status not in ('withdrawn','expired') and a.sent_at between p_start and p_end) as rrefs,
           (select coalesce(sum(a.monthly_rent), 0) from public.applications a
              where a.partner_id = pid and a.referrer_id = me and a.paid_at between p_start and p_end and a.payment_state is distinct from 'refunded') as ramt,
           true as rself, me as rrid
    from public.users u where u.id = me
  )
  select x.rname, x.rrefs, x.rfees, x.rself
  from (
    select p.rname, p.rrefs, p.rfees, p.ramt, p.rself, p.rrid from peers p where p.rrid <> me
    union all
    select s.rname, s.rrefs, case when v_mode = 'rankings' then 0::numeric else s.ramt end as rfees, s.ramt, s.rself, s.rrid from self_row s
  ) x
  order by x.ramt desc, x.rrefs desc, x.rname asc;
end $function$
;


-- ---------- 5. can_amend_tenancy_start: the "else true" ----------
-- Was: else (case when p_role = 'referrer' then p_owned else true end)
-- The else granted every non-referrer role, so a developer could amend a
-- tenancy start date. The executed-deed arm above it was already positive.
create or replace function public.can_amend_tenancy_start(p_role text, p_status text, p_owned boolean, p_deed_state text default null)
returns boolean language sql immutable set search_path to '' as $$
  select case
    when p_status = 'deed' or p_deed_state = 'executed'
      then p_role in ('superadmin', 'management')
    else (case
            when p_role = 'referrer' then p_owned
            else p_role in ('superadmin', 'management')
          end)
  end
$$;

-- can_send_deed is NOT changed: it already reads
--   case when p_role = 'referrer' then p_owned else p_role in ('superadmin','management') end
-- which is positive and excludes a developer correctly.

-- ---------- 6. partners_select: the commission rates ----------
-- Was: is_admin() or id = public.app_partner()
-- public.partners carries partner_rate and agent_rate (core_schema.sql:43-44),
-- so this handed a developer the literal commission figures in one PostgREST
-- call. RLS is row level and cannot filter columns, so the policy has to exclude
-- the role outright.
drop policy if exists partners_select on public.partners;
create policy partners_select on public.partners for select to authenticated
  using (
    public.is_admin()
    or (public.app_role() in ('management','referrer') and id = public.app_partner())
  );

-- A developer still needs to know which partner and which environment they are
-- in, so give them the safe columns through a definer function with an explicit
-- list. Never widen this to select *.
create or replace function public.my_partner_summary()
returns table (id uuid, slug text, name text, status text, referencing_mode text)
language sql stable security definer set search_path to '' as $$
  select p.id, p.slug, p.name, p.status, p.referencing_mode
  from public.partners p
  where p.id = public.app_partner() and public.is_aal2()
$$;

comment on function public.my_partner_summary() is
  'The caller partner, safe columns only. Exists because partners_select excludes developers to keep partner_rate and agent_rate away from them, and RLS cannot filter columns. Never add rate columns here.';

revoke all on function public.my_partner_summary() from public, anon;
grant execute on function public.my_partner_summary() to authenticated;

-- ---------- 7. org tables: read and write ----------
-- All were "is_admin() or partner_id = public.app_partner()" with no role
-- component, so a developer could read the whole org book and, on agencies and
-- branches, insert into it. agent_contacts additionally holds third-party PII.
drop policy if exists agencies_select on public.agencies;
create policy agencies_select on public.agencies for select to authenticated
  using (public.is_admin() or (public.app_role() in ('management','referrer') and partner_id = public.app_partner()));

drop policy if exists agencies_insert on public.agencies;
create policy agencies_insert on public.agencies for insert to authenticated
  with check (public.is_admin() or (public.app_role() in ('management','referrer') and partner_id = public.app_partner()));

drop policy if exists branches_select on public.branches;
create policy branches_select on public.branches for select to authenticated
  using (public.is_admin() or (public.app_role() in ('management','referrer') and partner_id = public.app_partner()));

drop policy if exists branches_insert on public.branches;
create policy branches_insert on public.branches for insert to authenticated
  with check (public.is_admin() or (public.app_role() in ('management','referrer') and partner_id = public.app_partner()));

drop policy if exists contacts_select on public.agent_contacts;
create policy contacts_select on public.agent_contacts for select to authenticated
  using (public.is_admin() or (public.app_role() in ('management','referrer') and partner_id = public.app_partner()));

-- contacts_insert, contacts_update and contacts_delete already test
-- app_role() = 'management' positively and need no change.

-- ---------- 8. create_referral_target: the check in the wrong branch ----------
-- The only permission check sat inside the ELSE branch, which runs when
-- app_partner() is null. On the reachable path, where a partner user has a
-- partner_id, there was no role test at all. Rather than restate the whole
-- function, guard it at the top: the body below it is unchanged behaviour for
-- every role that was already allowed.
create or replace function public.assert_may_create_org_on_the_fly()
returns void language plpgsql stable security definer set search_path to '' as $$
begin
  if public.is_admin() then return; end if;
  if public.app_role() in ('management','referrer') then return; end if;
  raise exception 'not permitted' using errcode = '42501';
end $$;

revoke all on function public.assert_may_create_org_on_the_fly() from public, anon;
grant execute on function public.assert_may_create_org_on_the_fly() to authenticated;

-- ---------- 9. provisioning a developer ----------
-- users_mgmt_insert and users_mgmt_update enumerate assignable roles POSITIVELY,
-- so they fail closed and management currently cannot create a developer at all.
-- Widened deliberately, per the decision that management provisions developers
-- for their own partner behind the same wall as their existing user creation.
drop policy if exists users_mgmt_insert on public.users;
create policy users_mgmt_insert on public.users for insert to authenticated with check (
  public.app_role() = 'management' and partner_id = public.app_partner()
  and role in ('management','referrer','developer')
);

drop policy if exists users_mgmt_update on public.users;
create policy users_mgmt_update on public.users for update to authenticated
  using  (public.app_role() = 'management' and partner_id = public.app_partner() and role in ('management','referrer','developer'))
  with check (public.app_role() = 'management' and partner_id = public.app_partner() and role in ('management','referrer','developer'));

-- users_select is NOT changed. It is positive and excludes a developer, which is
-- correct: a developer has no business reading the partner's staff list.

-- ---------- 10. admin_update_user_role ----------
-- Its role-model wall reads "cur.role <> 'superadmin' and p_role not in
-- ('management','referrer')", which would reject 'developer' as a target role.
-- Only that list changes; every other guard, including the self-edit guard and
-- the last-admin guard, is reproduced exactly.
create or replace function public.admin_update_user_role(p_user uuid, p_role text)
returns public.users
language plpgsql security definer set search_path to ''
as $function$
declare cur public.users; res public.users; who text; me uuid := auth.uid();
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_role not in ('superadmin','management','referrer','developer') then raise exception 'Invalid role' using errcode = '22023'; end if;

  select * into cur from public.users where id = p_user;
  if cur.id is null then raise exception 'User not found' using errcode = '22023'; end if;

  if not (public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin')) then
    raise exception 'not permitted' using errcode = '42501';
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

  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  update public.users set role = p_role where id = p_user returning * into res;

  insert into public.user_audit(target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'role', cur.role, p_role, who, me);
  return res;
end $function$;
