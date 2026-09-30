-- THE SCHEDULED-JOB LOG IS TRIMMED TO THIRTY DAYS.
--
-- Matt: "a cleanup of the scheduled-job log (keep 30 days)".
--
-- Test: supabase/tests/the_health_screen_is_quick.test.sql
--
-- WHAT THIS IS AND IS NOT. Every pg_cron run writes a row to
-- cron.job_run_details and nothing has ever deleted one. Dev held 58,867
-- rows over 54 days, 35 MB, growing by roughly 1,100 a day for ever. That
-- is housekeeping nobody set up, and this sets it up.
--
-- IT IS NOT THE FIX FOR THE HEALTH SCREEN, and 20261006950000's header has
-- the numbers: trimming to 30 days took cron_health from 46.7 s to 37.1 s,
-- against an 8 s cut-off, and even 7 days only reached 25.2 s. The screen
-- is fixed by the query, not by the size of the table. Both were asked for
-- and both ship; only one of them was the cause.
--
-- WHY A DELETE AND NOT A DROP OF THE OLD PARTITION. There are no
-- partitions: cron.job_run_details is a plain table. And why a delete is
-- allowed here at all when `create index` on the same table is refused --
-- pg_cron grants delete on it to the database owner and an index needs
-- ownership. Measured on dev; see 20261006950000.
--
-- 03:40 UTC: nothing else runs then, and the work is a single indexed-ish
-- delete over a table this size, which takes well under a second once the
-- first run has caught up. The FIRST run deletes 24 days of backlog in one
-- statement, which is the only slow one it will ever do.

do $$
begin
  perform cron.unschedule('job-log-trim-nightly');
exception when others then null;
end $$;

select cron.schedule(
  'job-log-trim-nightly',
  '40 3 * * *',
  $cron$
  delete from cron.job_run_details
   where start_time < now() - interval '30 days';
  $cron$
);
