/* =====================================================================
   A CHANGE IS ONLY A CHANGE IF SOMETHING CHANGED.

   Matt, 2026-10-01: "Supplier Recent changes: show every change in plain
   English ... Only record a change when a value actually changed. Same
   for agencies and anywhere else changes are listed."

   The wording is the client's half and is in src/data/changeSentence.ts.
   This is the other half, and it is the one wording cannot fix: a trail
   that records something nobody did is wrong however nicely it is
   phrased.

   =====================================================================
   WHAT WAS ACTUALLY WRONG, measured on dev
   =====================================================================

   `partner_audit` holds a row reading:

     live_from   2026-08  ->  2026-08

   Every other field in this function is compared with `is distinct
   from` and is correct. `live_from` is too -- but it compares DATES,
   and the screen edits a MONTH: the client sends `${since}-01`, so
   saving a supplier whose stored date is the 20th moves the column from
   2026-08-20 to 2026-08-01 and records a change between two values that
   print identically.

   kestrel-lettings has that row. Every other partner on dev still holds
   a non-first day -- harbour-lets the 20th, opndoor-agents the 17th,
   opndoor-direct and referencing-partner the 18th -- so the next save of
   any of them writes another one.

   NOT NORMALISED ON THE WAY IN, deliberately. Rewriting every live_from
   to the first of its month would fix the symptom and lose a real date
   somebody may have meant. The question this trail answers is "what did
   a person change", and a person changing nothing is the case to fix.

   Tests: supabase/tests/a_change_is_only_a_change.test.sql
   ===================================================================== */

-- Regenerated from 20261006470000 by script, with one substitution asserted
-- to match exactly once.

CREATE OR REPLACE FUNCTION public.update_partner_settings(p_slug text, p_name text, p_status text, p_live_from date, p_partner_rate numeric, p_agent_rate numeric, p_referencing_mode text, p_portal_referrals boolean, p_api_access boolean)
 RETURNS partners
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur public.partners; res public.partners; who text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;

  select * into cur from public.partners where slug = p_slug;
  if cur.id is null then raise exception 'Partner not found' using errcode = '22023'; end if;

  if btrim(coalesce(p_name,'')) = '' then raise exception 'Partner name is required' using errcode = '22023'; end if;
  if p_partner_rate is null or p_partner_rate < 0 or p_partner_rate > 1 then raise exception 'Partner commission must be between 0 and 100%%' using errcode = '22023'; end if;
  if p_agent_rate is null or p_agent_rate < 0 or p_agent_rate > 1 then raise exception 'Agent commission must be between 0 and 100%%' using errcode = '22023'; end if;
  if coalesce(p_status,'') not in ('active','onboarding','paused') then raise exception 'Invalid status' using errcode = '22023'; end if;
  if coalesce(p_referencing_mode,'') not in ('pre_referenced_open','pre_referenced_screened','opndoor_referenced') then
    raise exception 'Invalid referencing mode' using errcode = '22023';
  end if;

  who := coalesce((select full_name from public.users where id = auth.uid()), 'opndoor admin');

  -- One audit row per changed field (old -> new). Rates recorded to ONE DECIMAL
  -- (never rounded to whole %) so 9.5% can never be mistaken for 10%.
  if cur.partner_rate is distinct from p_partner_rate then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'partner_rate', to_char(cur.partner_rate*100, 'FM990.0') || '%', to_char(p_partner_rate*100, 'FM990.0') || '%', who);
  end if;
  if cur.agent_rate is distinct from p_agent_rate then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'agent_rate', to_char(cur.agent_rate*100, 'FM990.0') || '%', to_char(p_agent_rate*100, 'FM990.0') || '%', who);
  end if;
  if cur.status is distinct from p_status then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'status', cur.status, p_status, who);
  end if;
  /* COMPARED AT THE PRECISION IT IS EDITED AT, which is the whole of
     "only record a change when a value actually changed".

     `live_from` is a DATE and the screen edits it as a MONTH: the client
     sends `${since}-01`, so saving a supplier whose stored date is the
     20th of the month wrote a row reading "2026-08 -> 2026-08". Found on
     dev, where kestrel-lettings has exactly that row and every other
     supplier still holds a non-first day, so the next save of any of them
     would write another.

     The row was not wrong about the column; it was wrong about the
     question, which is what a person changed. Comparing the months makes
     the record agree with the sentence it prints. */
  if date_trunc('month', cur.live_from) is distinct from date_trunc('month', p_live_from) then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'live_from', coalesce(to_char(cur.live_from,'YYYY-MM'),'—'), coalesce(to_char(p_live_from,'YYYY-MM'),'—'), who);
  end if;
  if cur.name is distinct from p_name then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'name', cur.name, p_name, who);
  end if;

  -- The three new ones. referencing_mode is recorded with its raw value rather
  -- than a friendly label: this trail is read when somebody asks what changed
  -- and when, and a label that gets reworded later makes old rows unreadable.
  if cur.referencing_mode is distinct from p_referencing_mode then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'referencing_mode', cur.referencing_mode, p_referencing_mode, who);
  end if;
  if cur.portal_referrals_enabled is distinct from p_portal_referrals then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'portal_referrals_enabled',
            case when cur.portal_referrals_enabled then 'on' else 'off' end,
            case when p_portal_referrals then 'on' else 'off' end, who);
  end if;
  if cur.api_access_enabled is distinct from p_api_access then
    -- Worth its own note in the trail: turning this off stops EXISTING keys
    -- working, not just new ones, so this row explains an outage somebody will
    -- be investigating later.
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'api_access_enabled',
            case when cur.api_access_enabled then 'on' else 'off' end,
            case when p_api_access then 'on (existing keys work again)' else 'off (all existing keys stop working)' end,
            who);
  end if;

  update public.partners
    set name = p_name, status = p_status, live_from = p_live_from,
        partner_rate = p_partner_rate, agent_rate = p_agent_rate,
        referencing_mode = p_referencing_mode,
        portal_referrals_enabled = p_portal_referrals,
        api_access_enabled = p_api_access
    where id = cur.id
    returning * into res;

  return res;
end $function$;
