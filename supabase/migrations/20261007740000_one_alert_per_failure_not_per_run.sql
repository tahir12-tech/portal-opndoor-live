/* =====================================================================
   ONE ALERT PER FAILURE, NOT ONE PER RUN.

   Matt, 2026-10-03: "the alert fires once per failing record, not every
   run" and, the message before, "The same failure should alert once,
   then not again until it changes or recovers."

   WHAT ACTUALLY HAPPENED ON DEV, measured before building anything:
   47 alerts of type `hubspot_sync_error:config`, all carrying the same
   sentence -- "no HubSpot access token ... Nothing is syncing." -- one
   an hour from 28 Sep 11:24 to 30 Sep 09:00. Not a failing record: dev
   has never had a HubSpot token, so nothing has ever synced. The record
   Matt asked me to find does not exist, and the per-record retry he
   described cannot be exercised here at all. The CADENCE, though, is
   exactly the fault he named, in its configuration form.

   WHY IT WAS HOURLY. `report_ops_incident` dedupes on
   `(alert_type, coalesce(application_id, zero), hour_bucket)`, so a
   condition that never changes produces one alert an hour for ever. The
   hour bucket was the right idea applied at the wrong grain: it stops a
   two-minute cron sending thirty, and does nothing about the same
   sentence arriving every hour for two days.

   SO THE LATCH IS ON THE FAILURE ITSELF, and the rule is Matt's three
   words: once, then again when it CHANGES or RECOVERS.

     changes    the detail differs, so it is a different failure and
                worth saying
     recovers   `clear_ops_incident` is called, which a caller does on
                success

   AND A DAILY FLOOR, which is not in his sentence and is the one
   judgement here. A failure that nobody clears would otherwise be
   announced once and never again, so a fault present for a week would
   be as quiet on day seven as a fixed one. Twenty-four hours is a
   reminder rather than a stream: 47 alerts become 2.

   NOTHING ELSE CHANGES. `ops_alerts` still records every alert raised,
   so the history Matt reads is intact; this only decides whether a new
   one is raised.
   ===================================================================== */

create table if not exists public.ops_alert_state (
  alert_type text not null,
  /* The application the alert is about, or the zero uuid for one that is
     about the system rather than a row -- the same key `ops_alerts_dedupe`
     already coalesces to, so the two agree about what "the same alert"
     means. */
  alert_key uuid not null,
  detail text,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (alert_type, alert_key)
);

comment on table public.ops_alert_state is
  'One row per distinct ops failure currently being reported, so the same failure alerts once rather than once per run. Cleared by clear_ops_incident when a caller recovers. Not a log: ops_alerts is the log.';

alter table public.ops_alert_state enable row level security;
/* NO POLICY. RLS on with none denies every browser role, which is right:
   this is alerting bookkeeping and no screen reads it. */

/* =====================================================================
   THE RECOVERY DOOR, so "until it changes or recovers" has a second half.
   ===================================================================== */
create or replace function public.clear_ops_incident(p_type text, p_application_id uuid default null)
returns void language sql security definer set search_path = '' as $$
  delete from public.ops_alert_state
   where alert_type = p_type
     and alert_key = coalesce(p_application_id, '00000000-0000-0000-0000-000000000000'::uuid)
$$;

comment on function public.clear_ops_incident(text, uuid) is
  'Mark an ops failure recovered, so the next occurrence alerts again. Called by a job on success. Silent when there was nothing to clear, because a job that succeeds twice running must not have to know whether it failed before.';

revoke all on function public.clear_ops_incident(text, uuid) from public, anon, authenticated;
grant execute on function public.clear_ops_incident(text, uuid) to service_role;

/* =====================================================================
   AND THE RAISE ASKS THE LATCH FIRST.

   The body below is 20261006xxxxx's, with the latch in front of the
   existing insert and nothing else touched: the `on conflict do nothing`
   hour bucket stays, because it is still the right guard against a
   two-minute cron reporting the same thing within one hour, and the
   best-effort exception handler stays because an alerting failure must
   never reach the caller.
   ===================================================================== */
create or replace function public.report_ops_incident(
  p_type text, p_detail text, p_application_id uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_secret text; v_rows int; v_base text;
        v_key uuid; v_prev text; v_last timestamptz; v_say boolean;
begin
  begin
    v_key := coalesce(p_application_id, '00000000-0000-0000-0000-000000000000'::uuid);

    /* IS THIS WORTH SAYING AGAIN? New, changed, or quiet for a day. */
    select s.detail, s.last_at into v_prev, v_last
      from public.ops_alert_state s
     where s.alert_type = p_type and s.alert_key = v_key;

    v_say := not found
             or v_prev is distinct from left(coalesce(p_detail,''), 500)
             or v_last < now() - interval '24 hours';

    insert into public.ops_alert_state (alert_type, alert_key, detail)
    values (p_type, v_key, left(coalesce(p_detail,''), 500))
    on conflict (alert_type, alert_key) do update
      set detail = excluded.detail,
          /* `last_at` moves only when we SPEAK. Touching it on every run
             would push the daily floor forward for ever and the reminder
             would never arrive. */
          last_at = case when v_say then now() else public.ops_alert_state.last_at end;

    if not v_say then return; end if;

    insert into public.ops_alerts (alert_type, application_id, hour_bucket, detail)
    values (p_type, p_application_id, date_trunc('hour', now()), left(coalesce(p_detail,''), 500))
    on conflict do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then return; end if;

    v_base := public.ops_functions_base_url();
    if v_base is null then return; end if;

    select secret into v_secret from public.ops_secrets where name = 'reminders_cron';
    perform net.http_post(
      url := v_base || '/functions/v1/ops-alert',
      headers := jsonb_build_object('Content-Type','application/json','x-ops-secret', coalesce(v_secret,'')),
      body := jsonb_build_object('alert_type', p_type, 'application_id', p_application_id, 'message', coalesce(p_detail,''))
    );
  exception when others then
    null; -- best effort: never propagate an alerting failure to the caller
  end;
end $$;
