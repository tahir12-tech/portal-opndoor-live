/* =====================================================================
   THE LATCH GATES THE ALERT; THE HOUR BUCKET ONLY GATES THE LOG ROW.

   20261007740000 put a per-failure latch in front of
   `report_ops_incident`, and its own pgTAP caught the interaction: a
   CHANGED failure within the same hour was still silent, and so was the
   same failure after a recovery. Both had passed the latch and were then
   stopped by this line:

     get diagnostics v_rows = row_count;
     if v_rows = 0 then return; end if;

   `ops_alerts_dedupe` is unique on (alert_type, key, hour_bucket), so the
   second insert in an hour does nothing and that early return took the
   notification with it. The hour bucket was the whole dedupe before the
   latch existed, and it is the wrong grain for the job it was left
   doing: it cannot tell "the same sentence again" from "a different
   failure, ten minutes later".

   SO THE RETURN GOES, AND THE INDEX STAYS. The index is still correct for
   what it now guards -- one LOG row per type per hour -- and
   `alert_ops_on_failure`, the trigger, still depends on it as its only
   dedupe. Dropping it to suit this function would change that trigger's
   behaviour for no reason.

   WHAT THIS MEANS IN PRACTICE: the log keeps at most one row an hour per
   type, as it always has, and the EMAIL now follows the latch, which is
   what Matt asked for -- "once, then not again until it changes or
   recovers". A changed failure within the hour is a second email against
   one log row, which is the right way round: the email is the thing a
   person reads, and the row is the record that something was reported in
   that hour.
   ===================================================================== */
create or replace function public.report_ops_incident(
  p_type text, p_detail text, p_application_id uuid default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_secret text; v_base text;
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

    /* THE LOG, which keeps one row per type per hour and whose conflict is
       no longer allowed to swallow the notification below. */
    insert into public.ops_alerts (alert_type, application_id, hour_bucket, detail)
    values (p_type, p_application_id, date_trunc('hour', now()), left(coalesce(p_detail,''), 500))
    on conflict do nothing;

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
