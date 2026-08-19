-- ===========================================================================
-- A supplier-neutral name for the on-demand sync.
--
-- THE DEFECT. The built artefact is checked against a banned list, and the rule
-- is that a partner never learns which CRM or mail provider we use. The UI
-- button already said "Sync CRM" and every comment is stripped by the minifier,
-- but the RPC NAME is a string literal in the bundle:
--
--   sb().rpc('trigger_hubspot_sync')
--
-- so grepping dist/ for the banned list found it. A name is a leak like any
-- other string.
--
-- ADDITIVE. trigger_hubspot_sync() is untouched and keeps its grants, because
-- the cron and anything else that already calls it must keep working. This adds
-- a second entry point with the same body, and the client moves to it.
--
-- The Rightmove referral path does not call either function. This touches no
-- table, no policy and no status.
-- ===========================================================================

create or replace function public.trigger_crm_sync()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_req bigint; v_base text;
begin
  if not public.is_admin() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  v_base := public.ops_functions_base_url();
  if v_base is null then
    -- Raise rather than return quietly: a person is watching this button, and
    -- telling them nothing happened beats a green tick over a call never made.
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

revoke execute on function public.trigger_crm_sync() from public, anon;
grant  execute on function public.trigger_crm_sync() to authenticated;

comment on function public.trigger_crm_sync() is
  'On-demand CRM sync for the admin Sync button. Admin only. Named without the supplier because the function name reaches the browser bundle.';

-- Prove the old entry point survived, so the cron cannot have been broken by
-- this.
do $$
begin
  if to_regprocedure('public.trigger_hubspot_sync()') is null then
    raise exception 'the original trigger was dropped; this migration is meant to be additive';
  end if;
end $$;
