/* =====================================================================
   `command` IS NOT IN SCOPE IN THE RESPONSE AGGREGATE.

   20261007780000 added `makes_call` in two places. The first is the JOBS
   list, which selects from `cron.job` and is the one the page reads. The
   second was the `http_by_job` aggregate, which groups RESPONSES and has
   no `command` column -- so `cron_health()` raised

     ERROR: 42703: column "command" does not exist

   on every call, which its own pgTAP file caught:
   health_tells_you_what_to_do errored outright.

   THE SECOND ONE IS SIMPLY REMOVED, not fixed. `http_by_job` counts
   responses per job; a job that makes no call has no responses to count
   and never appears in it. The fact belongs on the job, where the first
   insertion put it and where `jobAdvice` reads it.

   A NEW MIGRATION rather than an edit, as always -- and this one matters
   more than most, because the broken version is applied to dev and
   Health is erroring until this lands.
   ===================================================================== */

CREATE OR REPLACE FUNCTION public.cron_health()
 RETURNS jsonb
language plpgsql security definer set search_path = '' as $$
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
end $$;
