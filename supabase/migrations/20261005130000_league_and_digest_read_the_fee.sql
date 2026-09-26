-- THE LEAGUE AND THE DIGEST SAY "FEES" AND SUM THE RENT.
--
-- Three aggregates still add up monthly_rent and label the total as money we
-- collected:
--
--   referrer_league       the "Fees collected" column on the leaderboard, and
--                         the number the whole board is ORDERED by, so a wrong
--                         sum does not just misreport a figure, it puts the
--                         wrong person top.
--   partner_weekly_digest "Fees collected" and "top branch by fees" in the
--                         weekly email, which goes out unread by anyone here.
--   fire_payment_reminders returns monthly_rent to the reminder job, which
--                         prints it under the words "Guarantee fee" in a
--                         chasing email to the tenant.
--
-- That was correct while the fee WAS one month's rent, which is why nobody
-- noticed: the two columns were provably equal on every row (20260928100000
-- backfilled fee_amount to monthly_rent and refused to finish unless they
-- matched exactly). They stopped being equal when negotiated three and five
-- week bases landed, and again when a joint tenancy started charging each
-- tenant a share: fee_amount is what was actually charged, per applicant, and
-- monthly_rent is the rent of the property.
--
-- So an agency on a three week basis has had every fee it collected overstated
-- by about a third on its own leaderboard, and a joint tenancy has had each
-- tenant's share reported as if each had paid a whole month.
--
-- coalesce(a.fee_amount, a.monthly_rent) everywhere, never a bare rent: the
-- fallback is for rows created before the fee was snapshotted, where the two
-- are the same number, so this changes no historic total.
--
-- NOTHING ELSE MOVES. Each function is reproduced from its current definition
-- with only the summed expression changed: the same predicates (livemode,
-- partner scope, the withdrawn/expired and refunded filters, the branch
-- narrowing, the always-present self row), the same ordering, the same grants.
--
-- STILL ON THE RENT, deliberately left for a separate decision:
--   partner_weekly_climbers ranks referrers by summed monthly_rent for the
--   "Climber of the week" line in the same email. It is a ranking of movement,
--   not a printed amount, but it is the same defect and wants the same fix.

-- ---------- referrer_league: the board, and the column it is ordered by ----------
-- Reproduced from 20260904150000_referrer_league_position_scope.sql. Three sums
-- change (the private-mode self total, the peer aggregate, and the self row);
-- everything else is byte-for-byte the behaviour it had.
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
           (select coalesce(sum(coalesce(a.fee_amount, a.monthly_rent)), 0) from public.applications a
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
           coalesce(sum(coalesce(a.fee_amount, a.monthly_rent)) filter (where a.paid_at between p_start and p_end and a.payment_state is distinct from 'refunded'), 0) as amt
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
           (select coalesce(sum(coalesce(a.fee_amount, a.monthly_rent)), 0) from public.applications a
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

-- ---------- partner_weekly_digest: goes in an email to the partner ----------
-- Reproduced from 20260810270000_livemode_definer_predicates.sql. The base CTE
-- now carries fee_amount alongside the rent so both the partner total (v_fees)
-- and the top-branch total (bf) can read the fee; the rent stays in the CTE
-- because it is the fallback for pre-snapshot rows.
create or replace function public.partner_weekly_digest(p_start timestamptz, p_end timestamptz)
returns table(
  partner_id uuid, partner_name text, sent int, sent_paid int, paid int, fees numeric,
  deeds int, awaiting int, top_branch text, top_branch_fees numeric
)
language plpgsql security definer set search_path to '' as $function$
begin
  return query
  with base as (
    select a.partner_id, a.status, a.sent_at, a.paid_at, a.deed_issued_at,
           a.deed_state, a.monthly_rent, a.fee_amount, b.name as branch_name
    from public.applications a
    left join public.branches b on b.id = a.branch_id
    where a.livemode
  ),
  per_partner as (
    select p.id as pid, p.name as pname,
      count(*) filter (where base.status <> 'withdrawn' and base.sent_at >= p_start and base.sent_at < p_end)::int as v_sent,
      count(*) filter (where base.status <> 'withdrawn' and base.sent_at >= p_start and base.sent_at < p_end and base.paid_at is not null)::int as v_sent_paid,
      count(*) filter (where base.paid_at >= p_start and base.paid_at < p_end)::int as v_paid,
      coalesce(sum(coalesce(base.fee_amount, base.monthly_rent)) filter (where base.paid_at >= p_start and base.paid_at < p_end), 0) as v_fees,
      count(*) filter (where base.deed_issued_at >= p_start and base.deed_issued_at < p_end)::int as v_deeds,
      count(*) filter (where base.deed_state = 'awaiting_tenant')::int as v_awaiting
    from public.partners p
    left join base on base.partner_id = p.id
    group by p.id, p.name
  ),
  branch_agg as (
    select base.partner_id as pid, base.branch_name as bname,
      coalesce(sum(coalesce(base.fee_amount, base.monthly_rent)) filter (where base.paid_at >= p_start and base.paid_at < p_end), 0) as bf
    from base
    where base.branch_name is not null
    group by base.partner_id, base.branch_name
  ),
  top_branch as (
    select ba.pid, ba.bname, ba.bf,
      row_number() over (partition by ba.pid order by ba.bf desc, ba.bname asc) as rn
    from branch_agg ba
  )
  select pp.pid, pp.pname, pp.v_sent, pp.v_sent_paid, pp.v_paid, pp.v_fees, pp.v_deeds, pp.v_awaiting,
         tb.bname, tb.bf
  from per_partner pp
  left join top_branch tb on tb.pid = pp.pid and tb.rn = 1;
end $function$;

-- ---------- fire_payment_reminders: the amount in a chasing email ----------
-- Reproduced from 20260810270000_livemode_definer_predicates.sql with one more
-- OUT column, fee_amount, and one more column selected into the loop row. No
-- predicate, threshold, ledger write or activity row changes.
--
-- It is a DROP and recreate rather than a replace because adding an OUT column
-- changes the function's return type, which create or replace refuses. The
-- drop takes the grants with it, so they are restored below exactly as
-- 20260705090637 set them: service_role only, because this function sends real
-- email to a real tenant.
--
-- The fee is returned raw and NOT coalesced here, unlike the two aggregates
-- above: the caller (the payment-reminders edge function) already falls back to
-- the rent, and a reminder that quotes a figure wants the truth about whether a
-- fee was ever snapshotted rather than a substitute made two layers down.
drop function if exists public.fire_payment_reminders(date);

create or replace function public.fire_payment_reminders(p_today date)
  returns table (
    application_id uuid, guarantee_ref text, days int,
    tenant_title text, tenant_last_name text, tenant_email text,
    prop_addr1 text, prop_postcode text, monthly_rent numeric, fee_amount numeric, payment_url text,
    agency text, branch text, referrer_email text, partner_id uuid
  )
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare r record; k text; d int;
begin
  for r in
    select a.id, a.guarantee_ref, (p_today - a.sent_at::date) as age,
           a.tenant_title, a.tenant_last_name, a.tenant_email, a.prop_addr1, a.prop_postcode,
           a.monthly_rent, a.fee_amount, a.payment_url, a.partner_id,
           ag.name as agency_name, br.name as branch_name, u.email as ref_email
    from public.applications a
    left join public.branches br on br.id = a.branch_id
    left join public.agencies ag on ag.id = a.agency_id
    left join public.users u on u.id = a.referrer_id
    where a.livemode
      and a.status = 'sent'
      and coalesce(a.payment_state, '') <> 'refunded'
      and a.payment_url is not null
      and a.sent_at is not null
      and (p_today - a.sent_at::date) >= 2
  loop
    d := r.age;
    -- Only the highest reached threshold fires (so a long-stuck app first seen at
    -- day 21 gets one reminder, not a backlog of all three).
    k := case when d >= 9 then '9' when d >= 5 then '5' else '2' end;
    insert into public.payment_reminders (application_id, threshold, days_at_send)
      values (r.id, k, d) on conflict do nothing;
    if not found then continue; end if; -- already sent this threshold: skip
    insert into public.activity_log (application_id, kind, message, actor, visibility)
      values (r.id, 'payment_reminder',
        'Payment reminder sent to the tenant: guarantor fee still unpaid ' || d || ' days after the application was sent.',
        'System', 'business');
    application_id := r.id; guarantee_ref := r.guarantee_ref; days := d;
    tenant_title := r.tenant_title; tenant_last_name := r.tenant_last_name; tenant_email := r.tenant_email;
    prop_addr1 := r.prop_addr1; prop_postcode := r.prop_postcode; monthly_rent := r.monthly_rent;
    fee_amount := r.fee_amount; payment_url := r.payment_url;
    agency := r.agency_name; branch := r.branch_name; referrer_email := r.ref_email; partner_id := r.partner_id;
    return next;
  end loop;
end $function$;

revoke all on function public.fire_payment_reminders(date) from public, anon, authenticated;
grant execute on function public.fire_payment_reminders(date) to service_role;
