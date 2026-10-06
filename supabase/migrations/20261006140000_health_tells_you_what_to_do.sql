-- HEALTH IS MACHINERY, AND IT HAS TO SAY WHAT TO DO ABOUT IT.
--
-- Three changes to cron_health(), all of them about a reader who is holding a
-- deployment rather than a book of business.
--
-- 1. RESPONSES ARE ATTRIBUTED TO A JOB.
--
--    net._http_response does not store the request URL. The URL exists only in
--    net.http_request_queue, and pg_net DELETES that row when the response
--    lands, so by the time anything can read the outcome the "which call was
--    this" is already gone. Confirmed on dev: 0 rows queued against 440
--    responses in the same 24 hours.
--
--    Two ways to keep it were considered and rejected for this change:
--
--      A TRIGGER ON net.http_request_queue would capture the URL at insert
--      time and needs no change to any cron. It is also a ONE-WAY DOOR: the
--      table is owned by supabase_admin, and `postgres` can CREATE a trigger
--      on it but CANNOT DROP one ("must be owner of relation"). Tried on dev,
--      and the only way back out was to drop the trigger's own function with
--      CASCADE. Installing something on production that the operator cannot
--      remove, for a reporting convenience, is the wrong trade on any day and
--      a bad one on cutover day.
--
--      A WRAPPER around net.http_post recording (request_id, job) would be
--      exact and fully reversible, but every cron's command has to be
--      rewritten to call it. That is a change to the thing being diagnosed,
--      on the day it matters most.
--
--    So attribution is computed here, from cron.job_run_details, which already
--    records each run's start. A response belongs to the job whose run started
--    most recently before it, within five minutes. That is honest rather than
--    exact: two jobs firing in the same minute are ambiguous, and a response
--    matching no run is returned as unattributed rather than guessed at. The
--    page says which it is. The wrapper remains the upgrade when there is a
--    quiet week to do it in.
--
-- 2. THE BASE URL IS REPORTED, because of the failure it explains.
--
--    Four crons end their command with `where public.ops_functions_base_url()
--    is not null`. With the secret unset the statement matches no rows, the
--    job does nothing, and cron.job_run_details records SUCCEEDED. The page
--    showed a green row for a job that had not run. Returning the setting lets
--    the page say so in the row rather than leaving the operator to infer it.
--
-- 3. NEEDS ATTENTION GOES. It is a human work queue, it now lives on Home, and
--    a machinery page that also carries it invites the operator to think the
--    backlog is their problem. Four counting queries per load go with it.

create or replace function public.cron_health()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_since        timestamptz := now() - interval '24 hours';
  v_jobs         jsonb;
  v_recent_http  jsonb;
  v_by_job       jsonb;
  v_http_alert   boolean;
  v_counts       jsonb;
  v_base_url     text;
begin
  -- Self-gate: MFA first, then admin. Both raise 42501 (insufficient privilege).
  if not public.is_aal2() then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  if not public.is_admin() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  v_base_url := public.ops_functions_base_url();

  -- Cron jobs: schedule + latest run + a best-effort HTTP outcome.
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
        -- DOES THIS JOB DEPEND ON THE BASE URL? Read off the command text
        -- rather than from a list kept here, so a job that gains or loses the
        -- guard is described correctly without this function being edited.
        'needs_base_url', (job.command ilike '%ops_functions_base_url%')
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

  -- EVERY RECENT RESPONSE, ATTRIBUTED. Errors first, because they are what the
  -- page exists for, then newest. 40 rather than 10: grouping by job is only
  -- useful over enough rows to have more than one job in them, and a chatty
  -- job used to fill the whole list on its own.
  with attributed as (
    select
      r.id, r.status_code, r.created, r.content, r.error_msg, r.timed_out,
      (r.status_code is not null and r.status_code between 200 and 299) as ok,
      a.jobname
    from net._http_response r
    left join lateral (
      -- The job whose run started most recently before this response, within
      -- five minutes. Ambiguous when two jobs fire in the same minute, which
      -- is why the page labels an attribution as correlated rather than known.
      select j.jobname
      from cron.job_run_details d
      join cron.job j on j.jobid = d.jobid
      where d.start_time is not null
        and d.start_time <= r.created
        and r.created < d.start_time + interval '5 minutes'
      order by d.start_time desc
      limit 1
    ) a on true
    where r.created > v_since
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', id,
             'status_code', status_code,
             'ok', ok,
             'created', created,
             'content', left(content, 160),
             'error_msg', error_msg,
             'timed_out', timed_out,
             'job', jobname
           ) order by ok asc, created desc
         ), '[]'::jsonb)
  into v_recent_http
  from (select * from attributed order by ok asc, created desc limit 40) t;

  -- BY JOB: the latest response per job, and how that job has been doing over
  -- the window. This is what stops one chatty job drowning the rest.
  with attributed as (
    select
      r.id, r.status_code, r.created, r.content, r.error_msg, r.timed_out,
      (r.status_code is not null and r.status_code between 200 and 299) as ok,
      a.jobname
    from net._http_response r
    left join lateral (
      select j.jobname
      from cron.job_run_details d
      join cron.job j on j.jobid = d.jobid
      where d.start_time is not null
        and d.start_time <= r.created
        and r.created < d.start_time + interval '5 minutes'
      order by d.start_time desc
      limit 1
    ) a on true
    where r.created > v_since
  )
  select coalesce(jsonb_agg(obj order by errors desc, total desc), '[]'::jsonb)
  into v_by_job
  from (
    select
      coalesce(jobname, '(unattributed)') as grp,
      count(*) as total,
      count(*) filter (where not ok) as errors,
      jsonb_build_object(
        'job', jobname,
        'total', count(*),
        'errors', count(*) filter (where not ok),
        -- THE NEWEST ONE, taken as the first of an ordered array. There is no
        -- max() for jsonb, and reaching for one here compiled cleanly and
        -- failed at execution, which is plpgsql's standing trap: a bad
        -- expression is not planned until the function actually runs.
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

  -- NEEDS ATTENTION IS GONE. It was a human work queue on a machinery page;
  -- Home carries it now, which is where a person looking for work goes.
  return jsonb_build_object(
    'generated_at', now(),
    'http_alert', v_http_alert,
    -- The secret four crons are gated on. Null means those jobs report
    -- "succeeded" having made no call at all.
    'functions_base_url', v_base_url,
    'jobs', v_jobs,
    'recent_http', v_recent_http,
    'http_by_job', v_by_job,
    'counts', v_counts
  );
end
$function$;

comment on function public.cron_health() is
  'Operational health for whoever runs the deployment: cron liveness, the real HTTP outcome of each call, responses attributed to a job by run window, and the functions_base_url setting that four crons silently depend on. Admin + AAL2 only. Needs attention moved to Home in 20261006140000.';
