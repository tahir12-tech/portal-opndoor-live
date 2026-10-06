-- THE HEALTH SCREEN, AND THE TWENTY SECONDS.
--
-- Walk item 22b found cron_health() taking twenty seconds against an
-- eight-second cut-off and named the cause as an unbounded scheduled-job
-- log. Matt asked for "a cleanup of the scheduled-job log (keep 30 days)
-- and whatever index the Health screen needs", and then for both to ship
-- with the cutover rather than as a separate hotfix.
--
-- Test: supabase/tests/the_health_screen_is_quick.test.sql
--
-- =========================================================================
-- MEASURED FIRST, AND NEITHER OF THOSE TWO THINGS IS THE FIX
-- =========================================================================
--
-- On dev, 58,867 rows in cron.job_run_details over 54 days:
--
--   16 job laterals (the last run per job)              237 ms
--   547 http responses attributed to a job           10,939 ms
--   THE SAME 547, computed a second time             10,863 ms
--   the activity_log and ops_alerts counts                1 ms
--   cron_health() end to end                         46,715 ms
--
-- 1. RETENTION DOES NOT FIX IT. Trimming the log in a rolled-back
--    transaction and re-timing:
--
--      58,868 rows -> 46,715 ms
--      41,107 rows -> 37,130 ms   (30 days, which is what Matt asked for)
--      15,357 rows -> 25,203 ms   (7 days)
--
--    Three times the timeout even at 7 days. The cleanup is still worth
--    having -- 35 MB growing for ever is housekeeping nobody set up -- and
--    it ships in 20261006960000. It is not what fixes the screen, and
--    saying so is the point of these numbers.
--
-- 2. THE INDEX CANNOT BE CREATED. `create index on cron.job_run_details`
--    is refused with "must be owner of table job_run_details": pg_cron's
--    tables belong to supabase_admin and a migration runs as postgres.
--    Measured on dev, not assumed. So "whatever index the Health screen
--    needs" is not something this branch can ship, and Balal cannot run it
--    by hand either.
--
-- =========================================================================
-- WHAT THE FIX ACTUALLY IS
-- =========================================================================
--
-- Two faults, both ours, both fixable without owning anything.
--
-- THE SET WAS COMPUTED TWICE. The `attributed` CTE was written out
-- byte-identically in two statements, once for recent_http and once for
-- http_by_job. Eleven seconds, paid twice, for one answer.
--
-- AND THE LATERAL HAD NO INDEX TO USE, so each of the 547 responses
-- seq-scanned the whole 35 MB table. Adding a time bound to the lateral
-- changes nothing -- 11,163 ms against 11,094 ms, measured -- because
-- without an index the rows are read and then discarded.
--
-- There is exactly one index on that table we may rely on: the primary key
-- on `runid`. It is monotonic, so `runid > max(runid) - 20000` is an index
-- range scan over the most recent ~18 days at dev's ~1,100 runs a day, and
-- the time predicate then makes it exactly right. Lifted into a
-- `materialized` CTE so it is read once rather than once per response.
--
--   11,163 ms -> 208 ms, with the same 547 rows attributed.
--
-- The duplication is left in place and is now cheap: two 208 ms reads
-- rather than one. Restructuring the function's control flow on the day of
-- a cutover buys 200 ms and risks the screen.
--
-- WHY 24 HOURS IS SAFE INSIDE A runid WINDOW. The outer filter is already
-- `r.created > v_since`, and a run can only attribute a response up to five
-- minutes after it starts, so no run older than `v_since - 5 minutes` can
-- ever match one. The runid bound is the cheap way in; the time bound is
-- what makes it correct.
--
-- AND THE PER-JOB LOOKUP IS DELIBERATELY LEFT ALONE. It costs 237 ms and it
-- has to find the last run of a MONTHLY job -- 33,000 runids back at dev's
-- rate, past the window. Bounding that one would report a monthly job as
-- never run for most of the month.

-- =========================================================================
-- AND IT IS BUILT ON THE LATEST DEFINITION. TWICE WRONG BEFORE IT WAS RIGHT.
-- =========================================================================
--
-- Written first from 20261006140000, the migration walk item 22b points at.
-- Wrong: 20261006280000 redefines cron_health() to add `hubspot_disabled`,
-- so replaying the earlier body silently DELETED that key -- the Health
-- page would have started alerting on a HubSpot integration somebody had
-- deliberately turned off. Caught by health_tells_you_what_to_do.test.sql
-- going red on the local clean-apply cluster, which is what that cluster is
-- for.
--
-- Rebuilt from 20261006280000. Also wrong: `npm run drift` then said dev
-- disagreed with 20261006470000, the NULL-guard sweep, which redefines it a
-- third time -- and which grep had missed because it writes CREATE OR
-- REPLACE in capitals. Rebuilt from that.
--
-- THE RULE, twice learned in one migration. A `create or replace` migration
-- must be generated from the LAST definition, not from the one whose
-- comment describes the problem. `grep -il` for the case, and
-- `npm run drift` is the check that actually catches it -- a case-sensitive
-- grep does not.

create or replace function public.cron_health()
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
    'jobs', v_jobs,
    'recent_http', v_recent_http,
    'http_by_job', v_by_job,
    'counts', v_counts
  );
end
$function$;
