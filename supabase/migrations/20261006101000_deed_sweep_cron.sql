-- THE DEED SWEEP, SCHEDULED.
--
-- HOURLY, AND NOT A 07:00/08:00 PAIR. The pair exists for jobs that must land at
-- 08:00 Europe/London, where pg_cron runs in UTC and one of the two is always the
-- right hour. This has no London hour to hit: it is a safety net, and the only
-- thing that matters is how long a paid tenant can sit without a deed before
-- somebody notices. Hourly makes that at most an hour. So there is one job, and
-- deed-sweep has no London-hour self-gate for the same reason.
--
-- RUNNING TWICE IS SAFE, which is what makes hourly acceptable. Every candidate
-- goes through claim_tenancy_deed, and generateDeed holds a lease for its own
-- duration (20261005280000), so a second run that overlaps the first claims
-- nothing and generates nothing. A run with nothing to do is one RPC and no
-- PandaDoc calls at all.
--
-- THE GENERATION WINDOW IS THE FUNCTION'S, NOT THE SCHEDULE'S. The job passes no
-- arguments; deeds_awaiting_generation defaults to 30 minutes, so an application
-- that paid four minutes ago is not swept out from under the stripe-webhook call
-- that is probably still running for it.
--
-- THE URL IS READ AT RUN TIME, not baked in at schedule time, because cron.job
-- stores the command text and a literal URL would survive every later correction.
-- See 20260811210000, which had to unschedule and reschedule a job for exactly
-- that. A project that has not seeded functions_base_url runs a job that does
-- nothing rather than one that posts to somebody else's project.

do $$
begin
  perform cron.unschedule('deed-sweep-hourly');
exception when others then null;
end $$;

select cron.schedule(
  'deed-sweep-hourly',
  '20 * * * *',
  $cron$
  select net.http_post(
    url := public.ops_functions_base_url() || '/functions/v1/deed-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminders-secret', coalesce((select secret from public.ops_secrets where name = 'reminders_cron'), '')),
    body := '{}'::jsonb
  ) where public.ops_functions_base_url() is not null;
  $cron$
);

-- Twenty past, so it does not start in the same minute as the hourly and daily
-- jobs already on the clock (rate-limit-cleanup at :07, everything else on the
-- hour). Nothing breaks if they collide; they simply queue behind each other and
-- the run times become harder to read in cron.job_run_details.
