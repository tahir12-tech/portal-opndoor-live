-- The developer role widens: partner staff, scoped to their partner.
--
-- A developer is the partner's own employee, building against the API. They were
-- given the Dev Centre and nothing else, which turned out to be too narrow to do
-- the job: verifying an integration means looking at what it produced, and that
-- means the applications list, the detail, the dashboard and the league.
--
-- Scoped to the PARTNER rather than to themselves, unlike a referrer, because a
-- developer creates nothing and so owns nothing. `referrer_id = auth.uid()` would
-- match no rows for them, for ever.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DELIBERATELY GIVES THEM, WHICH IS MORE THAN THE DEV CENTRE DOES
-- ---------------------------------------------------------------------------
-- Tenant personal data: name, date of birth, email, phone and the property
-- address. Also agent contact details and their colleagues' details, through
-- agencies, branches, agent_contacts and users.
--
-- That is accepted rather than overlooked. A developer is partner staff, a
-- referrer at the same partner already sees agent contacts and colleagues, and
-- the alternative, a metadata projection, was tried for the Dev Centre and does
-- not scale to "the whole applications screen".
--
-- WHAT IT STILL DOES NOT GIVE THEM.
--   Commission: partner_rate and agent_rate came off the table grant entirely in
--     20260811180000, so this is enforced by the GRANT and not by these policies.
--     No arm added here can leak them.
--   Sandbox: applications_live_only is RESTRICTIVE, so it ANDs with the arm
--     below. A developer still sees no sandbox row through PostgREST. The Dev
--     Centre remains the only route, which is what keeps that panel honest.
--   Any write. Every write path already gates on
--     app_role() in ('management','referrer'), so a developer is refused today
--     with nothing added here. Read-only is the whole shape of the role.

-- ---------- applications ----------
drop policy if exists applications_select on public.applications;
create policy applications_select on public.applications for select to authenticated using (
  public.is_admin()
  or (public.app_role() = 'management' and partner_id = public.app_partner())
  or (public.app_role() = 'referrer'   and referrer_id = auth.uid())
  -- Partner-scoped, not self-scoped. See the header.
  or (public.app_role() = 'developer'  and partner_id = public.app_partner())
);

-- activity_log and application_notes need NOTHING: their select policies nest a
-- subquery against public.applications, so they inherit this arm automatically.
-- That is why the subquery form was worth keeping.

-- ---------- the org tree ----------
drop policy if exists agencies_select on public.agencies;
create policy agencies_select on public.agencies for select to authenticated
  using (public.is_admin() or (public.app_role() in ('management','referrer','developer') and partner_id = public.app_partner()));

drop policy if exists branches_select on public.branches;
create policy branches_select on public.branches for select to authenticated
  using (public.is_admin() or (public.app_role() in ('management','referrer','developer') and partner_id = public.app_partner()));

drop policy if exists contacts_select on public.agent_contacts;
create policy contacts_select on public.agent_contacts for select to authenticated
  using (public.is_admin() or (public.app_role() in ('management','referrer','developer') and partner_id = public.app_partner()));

-- ---------- the partner record ----------
-- Needed for the dashboard header and the league, which read the partner's name
-- and its leaderboard mode. The commission columns on partners are handled by
-- the narrowed select in hydrate.ts, which already excludes them for anyone
-- maySeeCommission() refuses.
drop policy if exists partners_select on public.partners;
create policy partners_select on public.partners for select to authenticated
  using (
    public.is_admin()
    or (public.app_role() in ('management','referrer','developer') and id = public.app_partner())
  );

-- ---------- colleagues ----------
-- Without this the applications list shows a referrer column with no names in
-- it, and the league shows rows belonging to nobody.
drop policy if exists users_select on public.users;
create policy users_select on public.users for select to authenticated using (
  public.is_admin()
  or (public.app_role() = 'management' and partner_id = public.app_partner())
  or (public.app_role() = 'developer'  and partner_id = public.app_partner())
  or id = auth.uid()
);

-- ---------- the league ----------
-- referrer_league carries a positive allowlist added when the developer role was
-- introduced, specifically to keep them out. That was right then and is wrong
-- now. Reproduced byte-for-byte from 20260810280000 with 'developer' added to
-- the one list and nothing else changed.
CREATE OR REPLACE FUNCTION public.referrer_league(p_start timestamp with time zone, p_end timestamp with time zone)
 RETURNS TABLE(name text, refs integer, fees numeric, is_self boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pid uuid := public.app_partner(); me uuid := auth.uid(); v_mode text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  -- A positive allowlist, still. 'developer' is added because a developer is
  -- partner staff and the league is partner-scoped performance, not commission:
  -- the fees column is governed by referrer_leaderboard_mode, the same as it is
  -- for a referrer.
  if public.app_role() not in ('superadmin','management','referrer','developer') then return; end if;
  if pid is null then return; end if;
  select referrer_leaderboard_mode into v_mode from public.partners where id = pid;
  v_mode := coalesce(v_mode, 'full');

  if v_mode = 'private' then
    return query
    select coalesce(u.full_name, 'You'),
           (select count(*)::int from public.applications a
              where a.livemode and a.partner_id = pid and a.referrer_id = me and a.status not in ('withdrawn','expired') and a.sent_at between p_start and p_end),
           (select coalesce(sum(a.monthly_rent), 0) from public.applications a
              where a.livemode and a.partner_id = pid and a.referrer_id = me and a.paid_at between p_start and p_end and a.payment_state is distinct from 'refunded'),
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
    where a.livemode and a.partner_id = pid and a.referrer_id is not null
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
              where a.livemode and a.partner_id = pid and a.referrer_id = me and a.status not in ('withdrawn','expired') and a.sent_at between p_start and p_end) as rrefs,
           (select coalesce(sum(a.monthly_rent), 0) from public.applications a
              where a.livemode and a.partner_id = pid and a.referrer_id = me and a.paid_at between p_start and p_end and a.payment_state is distinct from 'refunded') as ramt,
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
end $function$;

-- A developer has no applications of their own, so the self_row above is empty
-- for them and they appear in nobody's league but see their colleagues'. That is
-- correct and worth stating: they are staff, not a competitor.

do $$
declare v int;
begin
  select count(*) into v from public.livemode_audit();
  if v > 0 then raise exception 'livemode_audit is not clean: % function(s).', v; end if;
end $$;
