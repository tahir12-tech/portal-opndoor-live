-- THE HEALTH SCREEN ANSWERS, AND THE JOB LOG IS TRIMMED.
--
-- Walk item 22b, and the two lines of Matt's hotfix list that ship with the
-- cutover: "a cleanup of the scheduled-job log (keep 30 days) and whatever
-- index the Health screen needs".
--
-- ONE OF THOSE TWO TURNED OUT NOT TO EXIST AND THE OTHER NOT TO BE THE
-- CAUSE, which is why this file asserts something different from what the
-- instruction names. Measured on dev before anything was written; the
-- numbers are in 20261006950000's header:
--
--   the index       cannot be created at all. `create index on
--                   cron.job_run_details` is refused, "must be owner of
--                   table job_run_details".
--   the retention   trims 58,868 rows to 41,107 and takes cron_health from
--                   46.7 s to 37.1 s, against an 8 s cut-off. Worth having,
--                   not the fix.
--   the cause       the attributed set was computed TWICE, and each time
--                   seq-scanned a 35 MB table once per http response.
--
-- SO WHAT IS ASSERTED IS THE THING THAT WAS WRONG: the function reads the
-- job log through an index it is allowed to use, gets the same answer, and
-- the trim job exists.
--
-- AND NOT A TIMING. A test that asserts "under N milliseconds" fails on a
-- loaded machine and passes on a fast one, and this suite runs on both. The
-- SHAPE is what is durable: an index scan rather than a sequential one, and
-- one read rather than two.

begin;
select plan(7);

-- ===========================================================================
-- 1-2. THE TRIM JOB EXISTS, AND KEEPS THIRTY DAYS.
-- ===========================================================================
select isnt_empty(
  $$select 1 from cron.job where jobname = 'job-log-trim-nightly'$$,
  'the scheduled-job log has a job that trims it');

select matches(
  (select command from cron.job where jobname = 'job-log-trim-nightly'),
  '30 days',
  'and it keeps thirty days, which is what Matt asked for');

-- ===========================================================================
-- 3. AND IT DELETES FROM THE RIGHT TABLE. A trim job pointed at the wrong
-- table would satisfy both assertions above and trim nothing.
-- ===========================================================================
select matches(
  (select command from cron.job where jobname = 'job-log-trim-nightly'),
  'cron\.job_run_details',
  'from cron.job_run_details, which is the log that grows');

-- ===========================================================================
-- 4-6. THE FUNCTION READS THE LOG THROUGH AN INDEX.
--
-- The plan is the assertion, because the plan is what changed. Without the
-- runid bound this is a Seq Scan on job_run_details once per http response;
-- with it, an Index Scan on the primary key, once.
-- ===========================================================================
select isnt_empty(
  $$select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'cron_health'
       and pg_get_functiondef(p.oid) like '%recent_runs as materialized%'$$,
  'cron_health reads the recent runs once, as a materialized set');

select isnt_empty(
  $$select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'cron_health'
       and pg_get_functiondef(p.oid) like '%runid > (select coalesce(max(runid), 0) - 20000%'$$,
  'and bounds it by the primary key, which is the one index it may rely on');

/* AND THE TIME BOUND IS STILL THERE, because the runid window is the cheap
   way in and the time predicate is what makes the answer right. A runid
   bound on its own would attribute a response to a run from last week. */
select isnt_empty(
  $$select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'cron_health'
       and pg_get_functiondef(p.oid) like '%start_time > v_since - interval ''5 minutes''%'$$,
  'and still bounds it by time, which is what makes the attribution correct');

-- ===========================================================================
-- 7. AND THE PER-JOB LOOKUP IS NOT BOUNDED, deliberately. It has to find the
-- last run of a MONTHLY job, which is 33,000 runids back at dev's rate --
-- past the window. Bounding it would report a monthly job as never run for
-- most of the month, which on a health screen reads as an outage.
-- ===========================================================================
select isnt_empty(
  $$select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'cron_health'
       and pg_get_functiondef(p.oid) like '%where d.jobid = job.jobid%order by d.start_time desc%'$$,
  'while the last-run-per-job lookup still reads all of history, for the monthly jobs');

select * from finish();
rollback;
