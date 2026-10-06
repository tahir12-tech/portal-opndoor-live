-- ONE ALERT PER FAILURE, NOT ONE PER RUN.
--
-- Matt, 2026-10-03: "the alert fires once per failing record, not every run"
-- and "The same failure should alert once, then not again until it changes or
-- recovers."
--
-- WHAT HAPPENED ON DEV, measured before anything was built: 47 alerts of type
-- `hubspot_sync_error:config`, all carrying the same sentence, one an hour
-- from 28 Sep 11:24 to 30 Sep 09:00. Not a failing record -- dev has never had
-- a HubSpot token, so nothing has ever synced -- but the same fault in its
-- configuration form: `report_ops_incident` deduped on
-- (type, application, hour_bucket), which stops a two-minute cron sending
-- thirty an hour and does nothing about the same sentence arriving hourly for
-- two days.
--
-- THE LATCH IS ON THE FAILURE. These assertions are the three cases in Matt's
-- sentence -- once, changed, recovered -- plus the daily floor, which is the
-- one judgement that is mine and not his and is asserted so it is visible.
--
-- ASSERTED ON THE LATCH, NOT ON `ops_alerts`, and the first draft of this file
-- got that wrong and said so: `ops_alerts_dedupe` is unique on
-- (type, key, hour_bucket), so the log keeps ONE row an hour however many
-- times we speak, and counting rows measured the log rather than the
-- decision. The latch is what gates the email, which is the thing a person
-- reads. `last_at` moves only when we speak, so it is the observable.

begin;
select plan(8);

-- A type of our own, so this file cannot disturb or be disturbed by the real
-- alerts on dev.
delete from public.ops_alert_state where alert_type = 'zzz_test_alert';
delete from public.ops_alerts where alert_type = 'zzz_test_alert';

-- ===========================================================================
-- 1. THE FIRST ONE IS RAISED
-- ===========================================================================
select public.report_ops_incident('zzz_test_alert', 'The widget is unreachable.');

select is(
  (select count(*)::int from public.ops_alerts where alert_type = 'zzz_test_alert'),
  1, 'the first report of a failure is raised');

select is(
  (select detail from public.ops_alert_state where alert_type = 'zzz_test_alert'),
  'The widget is unreachable.', 'and the failure is latched, with what it said');

-- ===========================================================================
-- 2. THE SAME FAILURE AGAIN IS SILENT
--
-- This is the 47. Called twice more with the same sentence; nothing new.
-- ===========================================================================
/* SPOKEN-AT, captured before the repeats. If the repeats say nothing it does
   not move; if any of them speaks, it does. */
create temp table zzz_spoke as
  select last_at from public.ops_alert_state where alert_type = 'zzz_test_alert';

select public.report_ops_incident('zzz_test_alert', 'The widget is unreachable.');
select public.report_ops_incident('zzz_test_alert', 'The widget is unreachable.');

select is(
  (select s.last_at from public.ops_alert_state s where s.alert_type = 'zzz_test_alert'),
  (select z.last_at from zzz_spoke z),
  'the same failure reported again says nothing: once, not every run');

-- ===========================================================================
-- 3. A CHANGED FAILURE SPEAKS
-- ===========================================================================
select public.report_ops_incident('zzz_test_alert', 'The widget returned 500.');

select isnt(
  (select s.last_at from public.ops_alert_state s where s.alert_type = 'zzz_test_alert'),
  (select z.last_at from zzz_spoke z),
  'a DIFFERENT failure on the same type is raised, because it changed');

select is(
  (select detail from public.ops_alert_state where alert_type = 'zzz_test_alert'),
  'The widget returned 500.', 'and the latch now holds the new one');

-- ===========================================================================
-- 4. RECOVERY RE-ARMS IT
-- ===========================================================================
select public.clear_ops_incident('zzz_test_alert');

select is(
  (select count(*)::int from public.ops_alert_state where alert_type = 'zzz_test_alert'),
  0, 'clearing it on success removes the latch');

select public.report_ops_incident('zzz_test_alert', 'The widget returned 500.');

select ok(
  (select count(*)::int from public.ops_alert_state where alert_type = 'zzz_test_alert') = 1,
  'so the same failure after a recovery is latched again, not swallowed');

-- ===========================================================================
-- 5. AND THE DAILY FLOOR, which is the judgement that is not in Matt's
--    sentence: a failure nobody clears would otherwise be announced once and
--    never again, so a fault present for a week would be as quiet on day
--    seven as a fixed one.
-- ===========================================================================
update public.ops_alert_state
   set last_at = now() - interval '25 hours'
 where alert_type = 'zzz_test_alert';

select public.report_ops_incident('zzz_test_alert', 'The widget returned 500.');

select ok(
  (select s.last_at from public.ops_alert_state s where s.alert_type = 'zzz_test_alert')
    > now() - interval '1 minute',
  'an unchanged failure still reminds once a day, rather than going silent for ever');

select * from finish();
rollback;
