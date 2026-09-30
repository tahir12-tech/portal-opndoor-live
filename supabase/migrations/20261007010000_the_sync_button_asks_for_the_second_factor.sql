/* =====================================================================
   trigger_crm_sync HAD NO SECOND FACTOR, ALONE AMONG THE ADMIN GLOBALS.

   Found while mapping the definer-coverage ratchet, not by a reviewer, and
   not part of that task: it turned up because reading the 35 uncovered
   functions one after another makes the odd one out obvious.

   EVERY OTHER OPNDOOR-ADMIN GLOBAL OPENS WITH TWO GUARDS. set_app_setting_num
   is the pattern:

       if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' ...
       if not coalesce(public.is_admin(), false) then raise exception 'not permitted' ...

   trigger_crm_sync opened with the second only. There is no is_aal2
   anywhere in its body.

   WHAT THAT ACTUALLY ALLOWS. The function fires a net.http_post at
   /functions/v1/hubspot-sync carrying the `reminders_cron` ops secret. So
   an admin in a password-only session -- signed in, second factor not yet
   given -- could push every confirmed agency and branch into the live CRM.
   It is not a data read and it leaks nothing to the caller; what it is, is
   an outward-facing write to a third-party system, reachable in the window
   the second factor exists to close.

   THE GUARD GOES FIRST, matching its siblings: a caller who has not
   stepped up learns "MFA required" rather than whether they are an admin.

   Generated from the LAST definition, found case-insensitively -- it is
   the capitalised one at 20261006470000:4085, which a lower-case grep
   misses. That is the mistake this project has made twice before, and the
   rule is in CLAUDE.md because of it.
   ===================================================================== */

CREATE OR REPLACE FUNCTION public.trigger_crm_sync()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_req bigint; v_base text;
begin
  -- The guard every other admin global has had since 20261006600000, and
  -- this one never did. First, so a caller who has not stepped up is told
  -- that and nothing else.
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  if not coalesce(public.is_admin(), false) then
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
end $function$;
