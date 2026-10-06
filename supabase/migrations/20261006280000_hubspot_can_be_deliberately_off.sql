-- HUBSPOT CAN BE DELIBERATELY OFF, AND THAT IS NOT A FAULT.
--
-- hubspot-sync raises `hubspot_sync_error:config` every time it runs without a
-- token. On dev that is by design -- there is no HubSpot to sync to -- and the
-- result is an alert every two minutes for a condition nobody intends to fix.
-- On dev today that is 68 failures in 211 calls over 24 hours.
--
-- An alert that fires for a deliberate state is worse than no alert: it trains
-- whoever reads it to skip that line, and the day the token really does go
-- missing on production the line looks the same as it did yesterday.
--
-- So "off" becomes a thing the environment can SAY, rather than a thing
-- inferred from a missing secret. An ops_secrets row named 'hubspot_disabled'
-- set to 'true' means "there is no HubSpot here": the sync returns without
-- doing anything, raises no incident, and the Health page reports it as
-- disabled rather than broken.
--
-- PRODUCTION IS UNAFFECTED, and that is the point of making it explicit. The
-- row is absent there, so a missing token is still a missing token and still
-- alerts. Nothing is inferred from the project ref, the URL or the hostname,
-- because an environment that can be guessed wrong is one that will be.

create or replace function public.ops_hubspot_disabled()
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select coalesce(
    lower(btrim(coalesce(
      (select secret from public.ops_secrets where name = 'hubspot_disabled'), ''))) in ('true','t','1','yes','on'),
    false)
$function$;

comment on function public.ops_hubspot_disabled() is
  'Is HubSpot deliberately off on this environment? An explicit ops_secrets row, never inferred: on dev it stops a config alert firing every two minutes for a state nobody intends to fix, and on production its absence means a missing token still alerts.';

revoke all on function public.ops_hubspot_disabled() from public;
grant execute on function public.ops_hubspot_disabled() to authenticated, service_role;

-- The Health page reads the whole snapshot from cron_health, so the flag goes
-- there beside the base URL: both are "a setting that decides whether a job
-- does anything", and an operator should not have to know which secret to go
-- and read.
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
  if not public.is_aal2() then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  if not public.is_admin() then
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
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', id, 'status_code', status_code, 'ok', ok, 'created', created,
             'content', left(content, 160), 'error_msg', error_msg,
             'timed_out', timed_out, 'job', jobname
           ) order by ok asc, created desc
         ), '[]'::jsonb)
  into v_recent_http
  from (select * from attributed order by ok asc, created desc limit 40) t;

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
    'jobs', v_jobs,
    'recent_http', v_recent_http,
    'http_by_job', v_by_job,
    'counts', v_counts
  );
end
$function$;
