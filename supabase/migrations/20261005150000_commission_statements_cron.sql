-- MONTHLY COMMISSION STATEMENTS, SCHEDULED.
--
-- TWO JOBS FOR ONE SEND, which is the house pattern and worth restating because
-- it looks like a mistake. pg_cron runs in UTC and London is not: a job at
-- '0 8 * * *' fires at 09:00 London through the summer. So it is scheduled at
-- both 07:00 and 08:00 UTC, one of which is always 08:00 London, and the
-- function itself refuses to do anything at any other London hour. The off-hour
-- run reaches the function, reads the clock and returns "skipped".
--
-- RUNNING TWICE IS SAFE ANYWAY. The function records what it has posted and a
-- second call in the same month posts nothing, so a retry, a manual invocation
-- and the paired off-hour run are all no-ops rather than duplicate statements.
-- That matters more here than for a reminder: a second copy of a financial
-- statement is not noise, it is a discrepancy somebody has to reconcile.
--
-- DAILY, NOT MONTHLY. The schedule is every morning and the FUNCTION decides
-- whether today is the send day, because the send day is not a fixed date: it
-- is the 1st, or the next day that is not a UK bank holiday. Encoding that in a
-- cron expression is not possible, and encoding "the 1st" alone would silently
-- skip the month whenever the 1st is a bank holiday. The cheap daily wake-up
-- that almost always returns "not the send day" is the honest implementation.
--
-- THE URL IS READ AT RUN TIME, not baked in at schedule time. cron.job stores
-- the command text, so a literal URL survives every later correction; see
-- 20260811210000, which had to unschedule and reschedule a job for exactly that.

do $$
begin
  perform cron.unschedule('commission-statements-0700');
exception when others then null;
end $$;
do $$
begin
  perform cron.unschedule('commission-statements-0800');
exception when others then null;
end $$;

select cron.schedule(
  'commission-statements-0700',
  '0 7 * * *',
  $cron$
  select net.http_post(
    url := public.ops_functions_base_url() || '/functions/v1/commission-statements',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminders-secret', coalesce((select secret from public.ops_secrets where name = 'reminders_cron'), '')),
    body := '{}'::jsonb
  ) where public.ops_functions_base_url() is not null;
  $cron$
);

select cron.schedule(
  'commission-statements-0800',
  '0 8 * * *',
  $cron$
  select net.http_post(
    url := public.ops_functions_base_url() || '/functions/v1/commission-statements',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminders-secret', coalesce((select secret from public.ops_secrets where name = 'reminders_cron'), '')),
    body := '{}'::jsonb
  ) where public.ops_functions_base_url() is not null;
  $cron$
);

-- A project that has not seeded functions_base_url runs a job that does
-- nothing, rather than one that posts to somebody else's project.
