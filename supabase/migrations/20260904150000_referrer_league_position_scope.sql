-- Position-scoped referrer leaderboard.
--
-- The board followed only app_partner(), so every level at a partner saw the same
-- whole-partner ranking. It now takes a scope:
--   'company' -> the whole partner (unchanged from before), and
--   'mine'    -> the caller's own branches.
-- A positioned manager (management with a group/agency/branch user_scope) expands
-- via app_scope_branches(); a plain negotiator, who holds no position, falls back
-- to the branches they have themselves referred at.
--
-- ADDITIVE: p_scope defaults to 'company', so the two-argument callers are byte-for
-- -byte unchanged. The fees-visibility mode (full/rankings/private) is orthogonal and
-- untouched: it decides whether money shows, this decides who is in the league.
-- Every other predicate (livemode, status/refund filters, superadmin exclusion, the
-- always-present self row, the order-by) is preserved exactly.

drop function if exists public.referrer_league(timestamptz, timestamptz);

create or replace function public.referrer_league(p_start timestamptz, p_end timestamptz, p_scope text default 'company')
  returns table(name text, refs integer, fees numeric, is_self boolean)
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare pid uuid := public.app_partner(); me uuid := auth.uid(); v_mode text; v_branches uuid[];
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if public.app_role() not in ('superadmin','management','referrer','developer') then return; end if;
  if pid is null then return; end if;
  select referrer_leaderboard_mode into v_mode from public.partners where id = pid;
  v_mode := coalesce(v_mode, 'full');

  -- The caller's own branch set, computed ONLY when narrowing. A positioned user
  -- expands their group/agency/branch scope; a negotiator (no position) uses the
  -- branches they have referred at. Left NULL for the 'company' scope, which the
  -- predicates below read as "no branch filter".
  if p_scope = 'mine' then
    if public.app_has_scope() then
      select array_agg(b) into v_branches from public.app_scope_branches() b;
    else
      select array_agg(distinct a.branch_id) into v_branches
      from public.applications a
      where a.livemode and a.partner_id = pid and a.referrer_id = me;
    end if;
    v_branches := coalesce(v_branches, array[]::uuid[]);
  end if;

  if v_mode = 'private' then
    return query
    select coalesce(u.full_name, 'You'),
           (select count(*)::int from public.applications a
              where a.livemode and a.partner_id = pid and a.referrer_id = me and a.status not in ('withdrawn','expired') and a.sent_at between p_start and p_end
                and (v_branches is null or a.branch_id = any(v_branches))),
           (select coalesce(sum(a.monthly_rent), 0) from public.applications a
              where a.livemode and a.partner_id = pid and a.referrer_id = me and a.paid_at between p_start and p_end and a.payment_state is distinct from 'refunded'
                and (v_branches is null or a.branch_id = any(v_branches))),
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
      and (v_branches is null or a.branch_id = any(v_branches))
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
              where a.livemode and a.partner_id = pid and a.referrer_id = me and a.status not in ('withdrawn','expired') and a.sent_at between p_start and p_end
                and (v_branches is null or a.branch_id = any(v_branches))) as rrefs,
           (select coalesce(sum(a.monthly_rent), 0) from public.applications a
              where a.livemode and a.partner_id = pid and a.referrer_id = me and a.paid_at between p_start and p_end and a.payment_state is distinct from 'refunded'
                and (v_branches is null or a.branch_id = any(v_branches))) as ramt,
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

revoke all on function public.referrer_league(timestamptz, timestamptz, text) from public, anon;
grant execute on function public.referrer_league(timestamptz, timestamptz, text) to authenticated;
