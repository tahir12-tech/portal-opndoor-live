/* =====================================================================
   "WHEN WE LAST SPOKE" IS A WALL-CLOCK FACT.

   `last_at` was set from `now()`, which is the TRANSACTION's start time
   and does not advance within one. Two alerts raised in the same
   transaction therefore both claim the same instant, and the pgTAP file
   could not tell "it spoke again" from "it stayed silent" at all -- it
   failed on exactly that assertion, which is how this was found.

   `clock_timestamp()` is the right function for the question. The daily
   floor beside it still compares against `now()`, which is correct: the
   floor asks "has a day passed since we last spoke", and a sub-second
   difference between the two clocks cannot matter to a 24-hour window.

   Nothing else changes.
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
          last_at = case when v_say then clock_timestamp() else public.ops_alert_state.last_at end;

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
