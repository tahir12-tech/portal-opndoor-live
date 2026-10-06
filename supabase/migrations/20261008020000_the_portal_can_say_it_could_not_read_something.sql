-- THE PORTAL CAN SAY IT COULD NOT READ SOMETHING, AND HEALTH SHOWS IT.
--
-- Matt, 2026-10-04, verbatim: "When a statement's reference can't be read,
-- don't label it a draft. Show 'Reference couldn't be loaded. Refresh to try
-- again.' in place of the reference and status, and log it to Health."
--
-- Test: supabase/tests/the_portal_can_report_an_incident.test.sql
--
-- =========================================================================
-- WHY NOT JUST GRANT report_ops_incident TO authenticated
-- =========================================================================
--
-- That function takes a free-text type AND a free-text detail, writes both
-- into ops_alerts, and then SENDS AN OUTBOUND NOTIFICATION through pg_net. It
-- is granted to service_role for that reason: every caller today is an edge
-- function whose inputs we wrote.
--
-- Handing it to the browser would let any signed-in user invent alert types
-- and put arbitrary text into an operational alert that a human reads and
-- that leaves our network. Its hourly dedupe is keyed on (type, detail), so
-- varying the detail is enough to send as many notifications as you like.
--
-- SO THE PORTAL GETS A DOOR, NOT A KEY. This function takes a type from a
-- FIXED LIST and a month it validates as YYYY-MM, and BUILDS THE DETAIL
-- ITSELF. Nothing a caller sends reaches the alert text. The variability is
-- then bounded by the number of months that exist, which is the dedupe
-- behaving as intended rather than a hole in it.
--
-- AND IT NEEDS A SIGNED-IN CALLER. anon has no reason to report an incident
-- and granting it would be an unauthenticated write to an ops surface.

create or replace function public.report_portal_incident(p_type text, p_month text)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare v_detail text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  /* THE ALLOWLIST IS THE WHOLE SECURITY MODEL HERE. A new portal incident
     type is a deliberate addition to this list and a migration, which is the
     point: the set of things the browser may raise is reviewable. */
  if p_type is null or p_type not in ('portal_statement_reference_unreadable') then
    raise exception 'Unknown portal incident type.' using errcode = '22023';
  end if;

  /* VALIDATED, NOT TRUSTED. A month is four digits, a dash and two digits or
     it is not a month, and the detail below is built rather than passed. */
  if p_month is null or p_month !~ '^[0-9]{4}-[0-9]{2}$' then
    raise exception 'A month is YYYY-MM.' using errcode = '22023';
  end if;

  v_detail := 'The portal could not read the statement reference for ' || p_month
    || '. Shown to the reader as unavailable rather than as a draft.';

  perform public.report_ops_incident(p_type, v_detail, null);
end $function$;

revoke all on function public.report_portal_incident(text, text) from public, anon;
grant execute on function public.report_portal_incident(text, text) to authenticated, service_role;

comment on function public.report_portal_incident(text, text) is
  'The browser reporting that it could not read something it needed. The type must be on a fixed allowlist and the alert text is built here, never passed in, so a signed-in caller cannot put their own words into an operational alert or invent a type.';

-- ---------------------------------------------------------------------------
-- AND HEALTH COUNTS THEM, or logging it would be writing to a table nobody
-- reads. `portal_%` rather than the one type, so the next one is counted
-- without this function changing again.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cron_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_since        timestamptz := now() - interval '24 hours';
  v_jobs         jsonb;
  v_recent_http  jsonb;
  v_by_job       jsonb;
  v_http_alert   boolean;
  v_counts       jsonb;
  v_base_url     text;
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  if not coalesce(public.is_admin(), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  v_base_url := public.ops_functions_base_url();

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
                        else hr.status_code between 200 and 299 end,
        'needs_base_url', (job.command ilike '%ops_functions_base_url%'),
        /* DOES THIS JOB CALL ANYTHING AT ALL? Matt, 2026-10-03: "For jobs
           that run purely inside the database and make no call
           (job-log-trim-nightly, and any others), show 'Runs in the
           database; no call expected' instead of the 'no HTTP response
           could be matched' warning."

           READ OFF THE COMMAND, not a list of names. `job-log-trim-nightly`
           and `rate-limit-cleanup` are both a bare DELETE today, and a list
           would be wrong the first time somebody adds a third. */
        'makes_call', (job.command ilike '%net.http_post%'),
        -- A job that is off on purpose reads as off, not as failing.
        'disabled_here', (job.jobname ilike '%hubspot%' and public.ops_hubspot_disabled())
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

  with recent_runs as materialized (
    /* THE RECENT RUNS, READ ONCE, THROUGH THE PRIMARY KEY. See the header
       of this migration for the measurements. `runid` is monotonic and its
       primary key is the only index on this table a migration is allowed to
       rely on, so the window is taken by runid and then made correct by
       time. `materialized` forces it once rather than once per response. */
    select d.jobid, d.start_time, j.jobname
      from cron.job_run_details d
      join cron.job j on j.jobid = d.jobid
     where d.runid > (select coalesce(max(runid), 0) - 20000 from cron.job_run_details)
       and d.start_time is not null
       and d.start_time > v_since - interval '5 minutes'
  ),
  attributed as (
    select
      r.id, r.status_code, r.created, r.content, r.error_msg, r.timed_out,
      (r.status_code is not null and r.status_code between 200 and 299) as ok,
      a.jobname
    from net._http_response r
    left join lateral (
      select rc.jobname
      from recent_runs rc
      where rc.start_time <= r.created
        and r.created < rc.start_time + interval '5 minutes'
      order by rc.start_time desc
      limit 1
    ) a on true
    where r.created > v_since
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', id, 'status_code', status_code, 'ok', ok, 'created', created,
             'content', left(content, 160), 'error_msg', error_msg,
             'timed_out', timed_out, 'job', jobname
           ) order by ok asc, created desc
         ), '[]'::jsonb)
  into v_recent_http
  from (select * from attributed order by ok asc, created desc limit 40) t;

  with recent_runs as materialized (
    /* THE RECENT RUNS, READ ONCE, THROUGH THE PRIMARY KEY. See the header
       of this migration for the measurements. `runid` is monotonic and its
       primary key is the only index on this table a migration is allowed to
       rely on, so the window is taken by runid and then made correct by
       time. `materialized` forces it once rather than once per response. */
    select d.jobid, d.start_time, j.jobname
      from cron.job_run_details d
      join cron.job j on j.jobid = d.jobid
     where d.runid > (select coalesce(max(runid), 0) - 20000 from cron.job_run_details)
       and d.start_time is not null
       and d.start_time > v_since - interval '5 minutes'
  ),
  attributed as (
    select
      r.id, r.status_code, r.created, r.content, r.error_msg, r.timed_out,
      (r.status_code is not null and r.status_code between 200 and 299) as ok,
      a.jobname
    from net._http_response r
    left join lateral (
      select rc.jobname
      from recent_runs rc
      where rc.start_time <= r.created
        and r.created < rc.start_time + interval '5 minutes'
      order by rc.start_time desc
      limit 1
    ) a on true
    where r.created > v_since
  )
  select coalesce(jsonb_agg(obj order by errors desc, total desc), '[]'::jsonb)
  into v_by_job
  from (
    select
      count(*) as total,
      count(*) filter (where not ok) as errors,
      jsonb_build_object(
        'job', jobname,
        'total', count(*),
        'errors', count(*) filter (where not ok),
        'disabled_here', (jobname ilike '%hubspot%' and public.ops_hubspot_disabled()),
        'latest', (array_agg(
          jsonb_build_object(
            'id', id, 'status_code', status_code, 'ok', ok, 'created', created,
            'content', left(content, 160), 'error_msg', error_msg, 'timed_out', timed_out,
            'job', jobname
          ) order by created desc
        ))[1]
      ) as obj
    from attributed
    group by jobname
  ) s;

  select (r.status_code is null or r.status_code not between 200 and 299)
  into v_http_alert
  from net._http_response r
  order by r.created desc
  limit 1;
  v_http_alert := coalesce(v_http_alert, false);

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
    /* RAISED BY THE PORTAL ITSELF, not by a cron. Everything else on this
       card is something the back end noticed; this is the browser telling us
       it could not read something it needed. It belongs here because the
       reader of this page is the person who would otherwise never learn. */
    'portal_errors', (
      select count(*) from public.ops_alerts
      where created_at > v_since and alert_type like 'portal_%'),
    'http_errors', (
      select count(*) from net._http_response
      where created > v_since
        and (status_code is null or status_code not between 200 and 299))
  ) into v_counts;

  return jsonb_build_object(
    'generated_at', now(),
    'http_alert', v_http_alert,
    'functions_base_url', v_base_url,
    'hubspot_disabled', public.ops_hubspot_disabled(),
    /* HOW LONG A RESPONSE SURVIVES, so the page can say why a weekly job
       never has one rather than warning about it every week. `pg_net.ttl`
       is 6 hours on this project; read rather than written down, so the
       sentence cannot go stale if it is changed. */
    'response_ttl', (select setting from pg_settings where name = 'pg_net.ttl'),
    'jobs', v_jobs,
    'recent_http', v_recent_http,
    'http_by_job', v_by_job,
    'counts', v_counts
  );
end $function$


;
