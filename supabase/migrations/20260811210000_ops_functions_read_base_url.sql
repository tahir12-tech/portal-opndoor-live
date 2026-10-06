-- Defect 2: the functions base URL stops being a literal.
--
-- Three functions and one cron job hardcoded
-- https://pwftaqtrrqtilxlvwxjd.supabase.co, which is neither production nor the
-- dev project but a third project in the same organisation. The cron one is a
-- top-level statement, so applying that migration to any fresh project schedules
-- it to post to a foreign project every two minutes.
--
-- The consequences worth restating, because they are why this is worth a
-- migration rather than a note: ops alerts may be going somewhere nobody reads,
-- and the side-effect blocks are wrapped in `exception when others then null`,
-- so a cross-project call that fails does so with no log line and no signal.
-- Alerting that silently does not work is worse than no alerting, because
-- somebody is relying on it.
--
-- NOT AN EDIT TO THE APPLIED MIGRATIONS. Those have run; changing them would put
-- the source and the applied state out of step, which is worse than the defect.
-- This replaces the three functions and reschedules the job, so the FINAL state
-- is correct and the history is intact.
--
-- ---------------------------------------------------------------------------
-- WHERE THE URL COMES FROM NOW
-- ---------------------------------------------------------------------------
-- ops_secrets already exists, is service-role only, and is already the place
-- out-of-band configuration lives. A second config table would be a second thing
-- to seed and a second thing to forget.
--
-- The resolver FAILS CLOSED. If no row is present it returns null and every
-- caller skips the HTTP call rather than falling back to a guess. A missing
-- alert is recoverable; an alert posted to a project that is not ours is the
-- defect we are fixing.
--
-- current_setting('app.settings.supabase_url') was considered and rejected: it
-- is not reliably populated on Supabase, so it would have moved the failure from
-- a wrong URL to an absent one without making it visible.

insert into public.ops_secrets (name, secret)
values ('functions_base_url', '')
on conflict (name) do nothing;

comment on table public.ops_secrets is
  'Out-of-band configuration and secrets, service-role only. Includes functions_base_url, which the ops alerting and HubSpot trigger read instead of hardcoding a project URL. Seed it per environment: https://<ref>.supabase.co with no trailing slash.';

/**
 * The base URL for this project's Edge Functions, or null when unset.
 *
 * Null is a valid answer and every caller treats it as "do not call out".
 */
create or replace function public.ops_functions_base_url()
returns text
language sql stable security definer set search_path to '' as $$
  select nullif(btrim(coalesce((select secret from public.ops_secrets where name = 'functions_base_url'), '')), '');
$$;

revoke all on function public.ops_functions_base_url() from public, anon, authenticated;

-- ---------- alert_ops_on_failure ----------
create or replace function public.alert_ops_on_failure()
returns trigger language plpgsql security definer set search_path to '' as $function$
declare v_secret text; v_rows int; v_base text;
begin
  if new.kind not in (
    'deed_error','deed_delivery_failed','deed_reminder_failed','deed_undelivered',
    'expiry_reminder_email_failed','payment_reminder_email_failed',
    'payment_email_failed','refund_email_failed','refund_anomaly','payment_anomaly',
    -- Added with defect 9: a deed void that failed during a refund leaves a
    -- signable document, and previously said nothing at all.
    'deed_void_failed'
  ) then
    return new;
  end if;
  begin
    insert into public.ops_alerts (alert_type, application_id, hour_bucket, detail)
    values (new.kind, new.application_id, date_trunc('hour', now()), left(new.message, 500))
    on conflict do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then return new; end if; -- already alerted for this type+app this hour

    -- The ops_alerts row above is written whether or not the call goes out, so
    -- the record survives even on a project with no base URL configured. That is
    -- deliberate: the row is the durable evidence and the HTTP post is the
    -- notification.
    v_base := public.ops_functions_base_url();
    if v_base is null then return new; end if;

    select secret into v_secret from public.ops_secrets where name = 'reminders_cron';
    perform net.http_post(
      url := v_base || '/functions/v1/ops-alert',
      headers := jsonb_build_object('Content-Type','application/json','x-ops-secret', coalesce(v_secret,'')),
      body := jsonb_build_object('alert_type', new.kind, 'application_id', new.application_id, 'message', new.message)
    );
  exception when others then
    null; -- best effort: a failed alert must never break the logged operation
  end;
  return new;
end $function$;

-- ---------- report_ops_incident ----------
create or replace function public.report_ops_incident(p_type text, p_detail text)
returns void language plpgsql security definer set search_path to '' as $function$
declare v_secret text; v_rows int; v_base text;
begin
  begin
    insert into public.ops_alerts (alert_type, application_id, hour_bucket, detail)
    values (p_type, null, date_trunc('hour', now()), left(coalesce(p_detail,''), 500))
    on conflict do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then return; end if;

    v_base := public.ops_functions_base_url();
    if v_base is null then return; end if;

    select secret into v_secret from public.ops_secrets where name = 'reminders_cron';
    perform net.http_post(
      url := v_base || '/functions/v1/ops-alert',
      headers := jsonb_build_object('Content-Type','application/json','x-ops-secret', coalesce(v_secret,'')),
      body := jsonb_build_object('alert_type', p_type, 'application_id', null, 'message', coalesce(p_detail,''))
    );
  exception when others then
    null; -- best effort: never propagate an alerting failure to the caller
  end;
end $function$;

-- ---------- trigger_hubspot_sync ----------
-- This one RAISES on a missing base URL rather than returning silently. It is
-- the admin "Sync HubSpot" button: a person is watching, and telling them
-- nothing happened is better than a green tick over a call that was never made.
create or replace function public.trigger_hubspot_sync()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_req bigint; v_base text;
begin
  if not public.is_admin() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  v_base := public.ops_functions_base_url();
  if v_base is null then
    raise exception 'The functions base URL is not configured. Seed ops_secrets.functions_base_url with https://<project-ref>.supabase.co before using this.'
      using errcode = '22023';
  end if;

  select net.http_post(
    url := v_base || '/functions/v1/hubspot-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ops-secret', (select secret from public.ops_secrets where name = 'reminders_cron')),
    body := jsonb_build_object('limit', 200)
  ) into v_req;
  return jsonb_build_object('ok', true, 'request_id', v_req);
end $$;

-- ---------- the cron job ----------
-- Unscheduled and rescheduled to read the base URL at RUN time rather than
-- baking it in at schedule time, which is what made the original a problem: the
-- command text is stored, so a literal there survives every later correction to
-- the functions.
do $$
begin
  perform cron.unschedule('hubspot-sync');
exception when others then
  null;  -- not scheduled on this project, which is the normal case for a new one
end $$;

select cron.schedule(
  'hubspot-sync',
  '*/2 * * * *',
  $cron$
  select net.http_post(
    url := public.ops_functions_base_url() || '/functions/v1/hubspot-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ops-secret', coalesce((select secret from public.ops_secrets where name = 'reminders_cron'), '')),
    body := jsonb_build_object('limit', 200)
  ) where public.ops_functions_base_url() is not null;
  $cron$
);

-- A project that has not seeded functions_base_url now runs a job that does
-- nothing, rather than one that posts to somebody else's project.
