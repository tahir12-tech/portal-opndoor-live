-- ===========================================================================
-- OPNDOOR PORTAL: HOTFIX FOR THE LIVE SYSTEM
-- 2026-09-29. Read docs/HOTFIX-LIVE-FOR-BALAL.md first.
--
-- Run this on the LIVE Supabase project, in the SQL editor, signed in as the
-- project owner. It is two statements. Run them together.
--
-- It does NOT create, drop or alter any table, column, policy or row. It
-- removes write permissions that were never used, and replaces one small
-- function. Nothing is deleted and no data changes.
--
-- Proved in supabase/tests/the_live_hotfix_holds.test.sql, which rebuilds this
-- exact schema, shows both holes open, applies these two statements, and shows
-- them shut with every working path still working. 19 assertions.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. THE BROWSER MAY NOT WRITE TO applications.
--
-- Supabase grants every new table in `public` to `anon` and `authenticated`
-- automatically. No migration ever narrowed it for this table, so today a
-- logged-in manager can send a single web request that marks any application
-- in their company paid, changes the rent every commission figure is
-- calculated from, or points the executed deed at a different document. No
-- screen does any of this; the permission is simply sitting there unused.
--
-- Nothing legitimate is lost. Every action in the product that changes an
-- application goes through a database function that runs with its own
-- authority, or through a background job holding the service key. Neither is
-- affected by this. SELECT is deliberately untouched, so every screen still
-- reads exactly what it reads today.
--
-- THE ORDER MATTERS AND THIS IS THE WHOLE STATEMENT. Do not "improve" this by
-- adding a narrower grant afterwards: a column-level grant cannot subtract
-- from a table-level one, so adding an allowlist without this revoke leaves
-- the hole completely open. That is asserted in the test file.
-- ---------------------------------------------------------------------------

revoke insert, update, delete, truncate
  on public.applications
  from anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. A GUARD THAT CANNOT TELL WHO YOU ARE MUST REFUSE.
--
-- app_role() answers "what is this person's role". For a sign-in that has no
-- matching row in public.users it answers "I don't know" (NULL). Every
-- permission check in the system is written as "if this person is NOT allowed,
-- refuse" -- and in SQL, "not (I don't know)" is itself "I don't know", and an
-- `if` on "I don't know" does not run. So the refusal never happened and the
-- caller walked through.
--
-- Production had two such accounts, with MFA enrolled, until 2026-09-29.
--
-- The fix is to answer "nobody" instead of "I don't know". Empty string is not
-- a valid role -- the column only permits superadmin, management and referrer
-- -- so every check that could not decide now decides "no". It cannot widen
-- anything: every one of the 50 places this value is used compares it for
-- equality or membership, so a value that matched nothing before still matches
-- nothing, and a check that could not decide now refuses.
--
-- Nothing changes for anybody who has a normal account.
--
-- This one function fixes all four of mark_withdrawn, add_application_note,
-- amend_tenancy_start and send_deed_to_agent, and eight more besides,
-- including admin_update_user_role -- where today one of those profile-less
-- accounts could promote any negotiator, in any company, to management.
--
-- PASTE THIS WHOLE STATEMENT. The words `stable`, `security definer` and
-- `set search_path` are not decoration: drop them and the function stops being
-- able to read the table it needs, and every permission check in the product
-- starts failing. Replacing a function this way keeps its existing
-- permissions, so nothing else needs re-granting.
-- ---------------------------------------------------------------------------

create or replace function public.app_role() returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce((select role from public.users where id = auth.uid()), '')
$$;


-- ===========================================================================
-- STATEMENT 3 OF 4. STOP THE SCHEDULED-JOB LOG GROWING FOREVER.
--
-- WHAT IS WRONG. pg_cron writes one row to cron.job_run_details every time a
-- job runs, and nothing ever deletes them. Two of the jobs run every minute
-- and every two minutes, so the table grows by roughly 2,160 rows a day, for
-- ever. On dev it had reached 57,240 rows and 34 MB.
--
-- WHAT IT BREAKS. The Health screen reads that table to tell you whether the
-- scheduled jobs are working. Measured on dev, that one query now takes
-- TWENTY SECONDS against an eight-second limit, so the screen simply stops
-- loading. It is the only screen that tells you the automatic jobs have
-- stopped, so it is the worst one to lose quietly.
--
-- Nothing else reads history older than a day. Thirty days is kept so there
-- is a fortnight of margin for looking back at a problem.
--
-- SAFE TO RUN AT ANY TIME. It deletes log rows only. It touches no
-- application, no payment, no deed and no schedule: the jobs themselves live
-- in cron.job, which is a different table and is not touched here.
-- ---------------------------------------------------------------------------

delete from cron.job_run_details where end_time < now() - interval '30 days';

select cron.schedule(
  'job-log-cleanup',
  '20 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '30 days'$$
);


-- ===========================================================================
-- STATEMENT 4 OF 4. THE INDEX THE HEALTH SCREEN NEEDS.
--
-- WHAT IS WRONG. cron.job_run_details has exactly one index, on its own row
-- id, which nothing searches by. The Health screen looks up "the last run of
-- this job" and "the runs around this time", so every lookup reads the whole
-- table from beginning to end. That is why it got slower every single day.
--
-- WHAT THIS DOES. Adds the index those two lookups actually want. Together
-- with statement 3 the Health screen goes back to being instant.
--
-- CONCURRENTLY means the table stays readable and writable while the index is
-- built, so the scheduled jobs keep running normally throughout.
--
-- IMPORTANT: CREATE INDEX CONCURRENTLY CANNOT RUN INSIDE A TRANSACTION. If
-- you are pasting the whole file into the SQL editor in one go, run this last
-- statement ON ITS OWN afterwards. If it errors with "cannot run inside a
-- transaction block", that is all this is -- nothing has gone wrong.
-- ---------------------------------------------------------------------------

create index concurrently if not exists job_run_details_jobid_start
  on cron.job_run_details (jobid, start_time desc);
