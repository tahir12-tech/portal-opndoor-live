-- livemode, part two: the definer functions, which is where it actually matters.
--
-- The restrictive policy in 20260810260000 does nothing for any of these. They
-- are SECURITY DEFINER and no table sets FORCE ROW LEVEL SECURITY, so they run
-- with policies switched off. Whatever they return, a caller sees.
--
-- This file closes them in two different ways, because reads and writes need
-- different mechanisms.
--
-- WRITES are closed with ONE trigger rather than twelve rewrites. There are a
-- dozen definer functions that act on a single application by id or token
-- (mark_withdrawn, set_application_status, set_deed_state, apply_stripe_payment,
-- amend_tenancy_start and so on). Editing each to add a guard means twelve
-- chances to get it wrong now and a thirteenth function later that nobody
-- remembers to guard. One BEFORE trigger on the table catches all of them and
-- catches the ones not yet written.
--
-- READS have no equivalent, so each reporting function is patched individually.
-- Every body below is reproduced exactly as it stands today with a single
-- predicate spliced in, and nothing else changed. That is deliberate and it is
-- why this file is long: replacing a body from memory rather than from source is
-- how a subtle behaviour change gets shipped inside a security fix.

-- ===========================================================================
-- WRITES: one guard for every definer function that acts on one row
-- ===========================================================================
--
-- A definer function runs as its owner, but the SESSION still carries the
-- caller's JWT, which is exactly how these functions already gate themselves
-- with is_admin() and app_role(). So the trigger can tell the two kinds of
-- caller apart:
--
--   portal user      JWT present, app_role() returns their role   -> blocked
--   service_role     no user JWT, app_role() returns null         -> allowed
--
-- Machine callers must be allowed through: the Stripe sandbox webhook calling
-- apply_stripe_payment on a sandbox application IS the rehearsal. A portal user
-- reaching a sandbox row never is.
--
-- Note this closes a hole the restrictive policy leaves open even for live rows'
-- sake: applications_update is ANDed with the policy for direct PostgREST
-- writes, but a definer function bypasses it entirely, so before this trigger a
-- management user could reach a sandbox application through any of those twelve
-- functions.
create or replace function public.applications_sandbox_write_guard()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_role text; v_livemode boolean; v_row public.applications;
begin
  -- NEW is unassigned on DELETE and OLD is unassigned on INSERT, and touching an
  -- unassigned record in plpgsql raises rather than returning null. So branch on
  -- TG_OP instead of coalescing across the two.
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;
  v_livemode := v_row.livemode;

  -- Live rows: nothing to say.
  if v_livemode is not false then
    return v_row;
  end if;

  v_role := public.app_role();

  -- No portal identity on the session: a cron job, an Edge Function using the
  -- service key, or the partner API. These are the sandbox rehearsal paths and
  -- must work.
  if v_role is null then
    return v_row;
  end if;

  -- A developer may act on sandbox through the Dev Centre.
  if v_role = 'developer' then
    return v_row;
  end if;

  raise exception 'This is a sandbox application and cannot be modified from the portal.'
    using errcode = '42501';
end $$;

drop trigger if exists applications_sandbox_write_guard on public.applications;
create trigger applications_sandbox_write_guard
  before insert or update or delete on public.applications
  for each row execute function public.applications_sandbox_write_guard();

-- ===========================================================================
-- READS: one predicate per reporting function
-- ===========================================================================

-- ---------- reconciliation_queue: the bordereau's front door ----------
-- Sandbox org creation is kept, because a partner rehearsing Rightmove's two
-- payload shapes needs to exercise create-by-name. That means sandbox agencies
-- and branches exist in pending_review, and without this they would queue up in
-- front of a human alongside real ones.
create or replace function public.reconciliation_queue()
returns table (
  entity_id uuid, entity_type text, name text, parent text,
  created_by_name text, created_at timestamptz, referral_count bigint,
  match_name text, match_exact boolean, folded_head_office boolean
)
language sql security definer set search_path to '' stable
as $function$
  with pend as (
    select a.id, 'agency'::text as etype, a.name, null::text as parent, a.created_by, a.created_at, a.partner_id
    from public.agencies a where a.review_state = 'pending_review' and a.livemode
    union all
    select b.id, 'branch'::text as etype, b.name, pa.name as parent, b.created_by, b.created_at, b.partner_id
    from public.branches b join public.agencies pa on pa.id = b.agency_id
    where b.review_state = 'pending_review' and b.livemode
      -- fold the auto head-office branch of a still-pending agency into its card
      and not (pa.review_state = 'pending_review' and lower(b.name) = lower(pa.name || ', Head office'))
  )
  select
    p.id, p.etype, p.name, p.parent,
    coalesce(u.full_name, 'A referrer') as created_by_name,
    p.created_at,
    (select count(*) from public.applications ap
       where ap.livemode
         and ((p.etype = 'agency' and ap.agency_id = p.id) or (p.etype = 'branch' and ap.branch_id = p.id))) as referral_count,
    m.name as match_name,
    coalesce(m.exact, false) as match_exact,
    (p.etype = 'agency' and exists (
       select 1 from public.branches b
       where b.agency_id = p.id and b.review_state = 'pending_review' and b.livemode
         and lower(b.name) = lower(p.name || ', Head office'))) as folded_head_office
  from pend p
  left join public.users u on u.id = p.created_by
  left join lateral (
    select c.name, (lower(c.name) = lower(p.name)) as exact
    from (
      select a.name from public.agencies a where p.etype = 'agency' and a.review_state = 'confirmed' and a.partner_id = p.partner_id and a.livemode
      union all
      select b.name from public.branches b where p.etype = 'branch' and b.review_state = 'confirmed' and b.partner_id = p.partner_id and b.livemode
    ) c
    where lower(c.name) = lower(p.name)
       or lower(c.name) like '%' || lower(p.name) || '%'
       or lower(p.name) like '%' || lower(c.name) || '%'
    order by (lower(c.name) = lower(p.name)) desc
    limit 1
  ) m on true
  where public.is_aal2() and public.is_admin()
  order by p.created_at desc;
$function$;

-- ---------- referrer_league ----------
-- Five separate reads of applications, all of which feed a fees figure. A
-- sandbox rehearsal that POSTs fifty applications would put a referrer top of
-- their own league. Body otherwise byte-identical to 20260810210000, including
-- the developer allowlist added there.
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

-- ---------- partner_weekly_digest: goes in an email to the partner ----------
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
           a.deed_state, a.monthly_rent, b.name as branch_name
    from public.applications a
    left join public.branches b on b.id = a.branch_id
    where a.livemode
  ),
  per_partner as (
    select p.id as pid, p.name as pname,
      count(*) filter (where base.status <> 'withdrawn' and base.sent_at >= p_start and base.sent_at < p_end)::int as v_sent,
      count(*) filter (where base.status <> 'withdrawn' and base.sent_at >= p_start and base.sent_at < p_end and base.paid_at is not null)::int as v_sent_paid,
      count(*) filter (where base.paid_at >= p_start and base.paid_at < p_end)::int as v_paid,
      coalesce(sum(base.monthly_rent) filter (where base.paid_at >= p_start and base.paid_at < p_end), 0) as v_fees,
      count(*) filter (where base.deed_issued_at >= p_start and base.deed_issued_at < p_end)::int as v_deeds,
      count(*) filter (where base.deed_state = 'awaiting_tenant')::int as v_awaiting
    from public.partners p
    left join base on base.partner_id = p.id
    group by p.id, p.name
  ),
  branch_agg as (
    select base.partner_id as pid, base.branch_name as bname,
      coalesce(sum(base.monthly_rent) filter (where base.paid_at >= p_start and base.paid_at < p_end), 0) as bf
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

-- ---------- partner_weekly_climbers: names a person in that email ----------
create or replace function public.partner_weekly_climbers(
  p_curr_start timestamptz, p_curr_end timestamptz, p_prev_start timestamptz, p_prev_end timestamptz
) returns table(partner_id uuid, climber_name text, climber_delta int)
language plpgsql security definer set search_path to '' as $function$
begin
  return query
  with curr as (
    select a.partner_id as pid, a.referrer_id as rid, u.full_name as nm,
      coalesce(sum(a.monthly_rent) filter (where a.paid_at >= p_curr_start and a.paid_at < p_curr_end and a.payment_state is distinct from 'refunded'), 0) as fees,
      count(*) filter (where a.status not in ('withdrawn','expired') and a.sent_at >= p_curr_start and a.sent_at < p_curr_end) as sent
    from public.applications a join public.users u on u.id = a.referrer_id
    where a.livemode and a.referrer_id is not null and u.role <> 'superadmin'
    group by a.partner_id, a.referrer_id, u.full_name
  ),
  prev as (
    select a.partner_id as pid, a.referrer_id as rid, u.full_name as nm,
      coalesce(sum(a.monthly_rent) filter (where a.paid_at >= p_prev_start and a.paid_at < p_prev_end and a.payment_state is distinct from 'refunded'), 0) as fees
    from public.applications a join public.users u on u.id = a.referrer_id
    where a.livemode and a.referrer_id is not null and u.role <> 'superadmin'
    group by a.partner_id, a.referrer_id, u.full_name
  ),
  curr_r as (select pid, rid, nm, fees, sent, row_number() over (partition by pid order by fees desc, nm asc) as rnk from curr),
  prev_r as (select pid, rid, row_number() over (partition by pid order by fees desc, nm asc) as rnk from prev),
  moved as (
    select c.pid, c.nm, (p.rnk - c.rnk) as delta
    from curr_r c join prev_r p on p.pid = c.pid and p.rid = c.rid
    where (c.fees > 0 or c.sent > 0) and (p.rnk - c.rnk) > 0
  ),
  top as (select pid, nm, delta, row_number() over (partition by pid order by delta desc, nm asc) as rn from moved)
  select pid, nm, delta::int from top where rn = 1;
end $function$;

-- ---------- hubspot_pending_events: the CRM boundary ----------
-- The whole row goes out as to_jsonb(a.*), so a sandbox tenant would arrive in
-- HubSpot as a real contact and a real deal. This is the single most expensive
-- leak to undo by hand, and it is one line to prevent.
create or replace function public.hubspot_pending_events(
  p_last_at timestamptz, p_last_id uuid, p_kinds text[], p_limit int
) returns table(event_id uuid, kind text, at timestamptz, application_id uuid, app jsonb)
language sql security definer set search_path = '' as $$
  select al.id, al.kind, al.at, al.application_id, to_jsonb(a.*)
  from public.activity_log al
  join public.applications a on a.id = al.application_id
  where a.livemode
    and al.kind = any(p_kinds)
    and (al.at, al.id) > (p_last_at, coalesce(p_last_id, '00000000-0000-0000-0000-000000000000'::uuid))
  order by al.at asc, al.id asc
  limit p_limit
$$;

-- ---------- fire_expiry_reminders: sends real email to a real referrer ----------
-- No sandbox row may reach Resend. The cut is here rather than in the Edge
-- Function because a row this returns has ALREADY had its reminder recorded and
-- its counter incremented, so filtering downstream would silently consume the
-- threshold and mean the live reminder never fires if the row were ever
-- mistaken for live.
create or replace function public.fire_expiry_reminders(p_today date)
  returns table (
    application_id uuid, guarantee_ref text, days int, expiry_date date,
    agency text, branch text, referrer_id uuid, referrer_email text,
    referrer_name text, partner_id text, prop text
  )
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare r record; k text; d int;
begin
  for r in
    select a.id, a.guarantee_ref, a.expiry_date, a.referrer_id, a.partner_id,
           a.prop_addr1, a.prop_postcode,
           ag.name as agency_name, br.name as branch_name,
           u.email as ref_email, u.full_name as ref_name
    from public.applications a
    left join public.agencies ag on ag.id = a.agency_id
    left join public.branches br on br.id = a.branch_id
    left join public.users u on u.id = a.referrer_id
    where a.livemode
      and a.status = 'deed'
      and coalesce(a.payment_state, '') <> 'refunded'
      and a.expiry_date is not null
      and a.expiry_date >= p_today
      and a.expiry_date <= p_today + 30
  loop
    d := r.expiry_date - p_today;
    k := case when d <= 6 then 'd' || d when d <= 7 then '7' when d <= 14 then '14' else '30' end;
    insert into public.expiry_reminders (application_id, threshold, days_at_send)
      values (r.id, k, d) on conflict do nothing;
    if not found then continue; end if; -- already sent this threshold: skip
    update public.applications
      set expiry_reminders_sent = expiry_reminders_sent + 1, last_expiry_reminder_at = now()
      where id = r.id;
    insert into public.activity_log (application_id, kind, message, actor, visibility)
      values (r.id, 'expiry_reminder',
        'Expiry reminder: guarantee expires ' ||
          (case when d = 0 then 'today' when d = 1 then 'tomorrow' else 'in ' || d || ' days' end) ||
          ' (' || to_char(r.expiry_date, 'DD/MM/YYYY') || ').',
        'System', 'business');
    application_id := r.id; guarantee_ref := r.guarantee_ref; days := d; expiry_date := r.expiry_date;
    agency := r.agency_name; branch := r.branch_name; referrer_id := r.referrer_id;
    referrer_email := r.ref_email; referrer_name := r.ref_name; partner_id := r.partner_id;
    prop := nullif(trim(both ', ' from concat_ws(', ', r.prop_addr1, r.prop_postcode)), '');
    return next;
  end loop;
end $function$;

-- ---------- fire_payment_reminders: sends real email to a real tenant ----------
-- Same reasoning as above, and worse: this one emails the tenant whose address
-- the developer typed into a test payload.
create or replace function public.fire_payment_reminders(p_today date)
  returns table (
    application_id uuid, guarantee_ref text, days int,
    tenant_title text, tenant_last_name text, tenant_email text,
    prop_addr1 text, prop_postcode text, monthly_rent numeric, payment_url text,
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
           a.monthly_rent, a.payment_url, a.partner_id,
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
    prop_addr1 := r.prop_addr1; prop_postcode := r.prop_postcode; monthly_rent := r.monthly_rent; payment_url := r.payment_url;
    agency := r.agency_name; branch := r.branch_name; referrer_email := r.ref_email; partner_id := r.partner_id;
    return next;
  end loop;
end $function$;

-- ---------- count_pending_tenancy_corrections: a badge in the portal ----------
create or replace function public.count_pending_tenancy_corrections()
returns integer
language sql security definer set search_path to ''
as $function$
  select count(*)::int
  from public.tenancy_correction_tokens t
  join public.applications a on a.id = t.application_id
  where a.livemode
    and t.submitted_at is not null and t.resolved_at is null
    and public.is_aal2()
    and (public.is_admin() or (public.app_role() = 'management' and a.partner_id = public.app_partner()));
$function$;

-- ---------- cron_health: the operational backlog counts ----------
-- Only needs_attention reads applications. A rehearsal that leaves ten sandbox
-- applications sitting in 'sent' would show as ten stuck live ones, which is the
-- kind of false alarm that teaches people to ignore the real one. Body otherwise
-- unchanged.
create or replace function public.cron_health()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_since        timestamptz := now() - interval '24 hours';
  v_jobs         jsonb;
  v_recent_http  jsonb;
  v_http_alert   boolean;
  v_counts       jsonb;
  v_needs        jsonb;
begin
  -- Self-gate: MFA first, then admin. Both raise 42501 (insufficient privilege).
  if not public.is_aal2() then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  if not public.is_admin() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- Cron jobs: schedule + latest run + a best-effort HTTP outcome.
  -- net._http_response does NOT store the request URL, so per-job correlation
  -- is done by time (the nearest response created within 5 minutes of the run
  -- start). It is best-effort and can be ambiguous when two jobs fire in the
  -- same minute; recent_http (below) is the authoritative HTTP signal.
  select coalesce(jsonb_agg(obj order by jobname), '[]'::jsonb)
  into v_jobs
  from (
    select
      job.jobname as jobname,
      jsonb_build_object(
        'jobname', job.jobname,
        'schedule', job.schedule,
        'active', job.active,
        'last_status', lr.status,
        'last_return_message', lr.return_message,
        'last_run', lr.start_time,
        'last_end', lr.end_time,
        'http_status_code', hr.status_code,
        'http_created', hr.created,
        'http_ok', case when hr.status_code is null then null
                        else hr.status_code between 200 and 299 end
      ) as obj
    from cron.job job
    left join lateral (
      select d.status, d.return_message, d.start_time, d.end_time
      from cron.job_run_details d
      where d.jobid = job.jobid
      order by d.start_time desc nulls last
      limit 1
    ) lr on true
    left join lateral (
      select r.status_code, r.created
      from net._http_response r
      where lr.start_time is not null
        and r.created >= lr.start_time
        and r.created <  lr.start_time + interval '5 minutes'
      order by r.created asc
      limit 1
    ) hr on true
  ) s;

  -- The authoritative HTTP surface: the most recent responses, with status,
  -- a 2xx flag and a content snippet so a silent 401 is impossible to miss.
  select coalesce(jsonb_agg(obj order by created desc), '[]'::jsonb)
  into v_recent_http
  from (
    select
      r.created as created,
      jsonb_build_object(
        'id', r.id,
        'status_code', r.status_code,
        'ok', case when r.status_code is null then false
                   else r.status_code between 200 and 299 end,
        'created', r.created,
        'content', left(r.content, 160),
        'error_msg', r.error_msg,
        'timed_out', r.timed_out
      ) as obj
    from net._http_response r
    order by r.created desc
    limit 10
  ) s;

  -- Top-level flag: is the single most recent HTTP response a non-2xx?
  select (r.status_code is null or r.status_code not between 200 and 299)
  into v_http_alert
  from net._http_response r
  order by r.created desc
  limit 1;
  v_http_alert := coalesce(v_http_alert, false);

  -- 24h failure/volume counts, from the signals the system already records.
  select jsonb_build_object(
    'window_hours', 24,
    'email_sends', (
      select count(*) from public.activity_log
      where at > v_since and kind in (
        'payment_email_sent','payment_email_resent','payment_reminder',
        'payment_reminder_email_sent','expiry_reminder_email_sent',
        'refund_email_sent','payment_receipt_sent','tenant_deed_email_sent')),
    'email_failures', (
      select count(*) from public.activity_log
      where at > v_since and kind in (
        'payment_email_failed','payment_reminder_email_failed',
        'expiry_reminder_email_failed','refund_email_failed',
        'payment_receipt_failed','tenant_deed_email_failed')),
    'webhook_failures', (
      select count(*) from public.ops_alerts
      where created_at > v_since and alert_type like 'webhook_error%'),
    'deed_failures', (
      select count(*) from public.activity_log
      where at > v_since and kind in ('deed_error','deed_delivery_failed')),
    'anomalies', (
      select count(*) from public.activity_log
      where at > v_since and kind in ('payment_anomaly','refund_anomaly')),
    'http_errors', (
      select count(*) from net._http_response
      where created > v_since
        and (status_code is null or status_code not between 200 and 299))
  ) into v_counts;

  -- Operational backlog that a human needs to clear.
  select jsonb_build_object(
    'stuck_sent', (
      select count(*) from public.applications where livemode and status = 'sent'),
    'awaiting_signature', (
      select count(*) from public.applications where livemode and deed_state = 'awaiting_tenant'),
    'pending_reconciliation', (
      (select count(*) from public.agencies where livemode and review_state = 'pending_review')
      + (select count(*) from public.branches where livemode and review_state = 'pending_review')),
    'pending_tenancy_corrections', (
      select count(*) from public.tenancy_correction_tokens
      where submitted_at is not null and resolved_at is null)
  ) into v_needs;

  return jsonb_build_object(
    'generated_at', now(),
    'http_alert', v_http_alert,
    'jobs', v_jobs,
    'recent_http', v_recent_http,
    'counts', v_counts,
    'needs_attention', v_needs
  );
end
$function$;

-- ===========================================================================
-- The exemptions, each with the reason it is safe
-- ===========================================================================
-- Read these as claims to be challenged, not as paperwork. If any one of them is
-- wrong, that function is a leak.
insert into public.livemode_audit_exemptions (function_name, reason) values
  ('add_application_note',
   'Writes one note against one application id. Portal sessions cannot reach a sandbox application at all: applications_sandbox_write_guard blocks the parent row, and application_notes inherits visibility through its subquery against applications, which the restrictive policy covers.'),

  ('amend_tenancy_start',
   'Acts on one application by id. Covered by applications_sandbox_write_guard. Machine callers must reach sandbox rows, because amending a tenancy start is part of what a partner rehearses.'),

  ('mark_withdrawn',
   'Acts on one application by guarantee_ref. Covered by applications_sandbox_write_guard.'),

  ('set_application_status',
   'Acts on one application by id. Covered by applications_sandbox_write_guard.'),

  ('set_deed_state',
   'service_role only, called from the PandaDoc webhook. MUST see sandbox rows: the PandaDoc sandbox key produces real watermarked documents whose callbacks drive this, and that is the rehearsal.'),

  ('apply_stripe_payment',
   'service_role only, called from the Stripe webhook. MUST see sandbox rows: a sandbox key charging a test card and landing here is the whole point of sandbox.'),

  ('apply_stripe_refund',
   'service_role only, Stripe webhook. MUST see sandbox rows, same reason as apply_stripe_payment.'),

  ('apply_deed_executed',
   'service_role only, PandaDoc webhook. MUST see sandbox rows.'),

  ('decline_application_by_token',
   'service_role only, reached by a tokenised link with no session. The token is unguessable and scoped to one application. MUST work for sandbox so a developer can rehearse the decline path.'),

  ('mint_payment_page_token',
   'service_role only. MUST work for sandbox: the tokenised payment link is the thing a partner integration hands to a tenant, so it has to be rehearsable.'),

  ('expire_stale_applications',
   'service_role only, cron. Deliberately DOES expire sandbox rows, so a developer can rehearse the expiry path and its webhook. It sends no email itself; the reminder functions that do are filtered above.'),

  ('send_deed_to_agent',
   'Sends a real email to a real agent contact, so it must never run for sandbox. Not exempt because it is safe: exempt because the block is enforced by applications_sandbox_write_guard on its status write plus can_send_deed, which excludes the developer role. REVIEW THIS ONE FIRST if the email boundary ever moves.')
on conflict (function_name) do update set reason = excluded.reason;

-- Deliberately NOT exempted, and still failing the audit after this migration:
--
--   create_referral            the portal create path. Its duplicate check reads
--                              applications without a livemode predicate, so a
--                              sandbox row could suppress a real referral. Fixed
--                              in the create-path commit, alongside
--                              create_referral_api, because the two share
--                              referral_field_errors and must move together.
--   create_referral_api        gets a mandatory p_livemode argument.
--   partner_api_applications   must filter to the calling key's livemode.
--   enqueue_partner_webhook    must match endpoint livemode to row livemode.
--   partner_webhook_payload    must carry livemode in the payload.
--   applications_emit_partner_webhook
--                              the trigger that calls the two above.
--
-- Until those land, public.livemode_audit() returns six rows and that is the
-- expected state. The hard assertion that turns a non-empty audit into a failed
-- deploy is added in that same commit, when zero is actually achievable. Adding
-- it now would mean shipping a check that fails on purpose, which is how a team
-- learns to skip it.
