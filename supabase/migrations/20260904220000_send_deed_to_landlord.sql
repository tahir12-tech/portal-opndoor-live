-- Send the executed deed to the LANDLORD (agency staff on their own agent-rail
-- application). "Send deed to agent" makes no sense to the agent, who is the
-- sender; they send to their client, the landlord. Store the landlord's name and
-- email on the application so a resend needs no retyping, and gate the action to
-- the same audience as can_send_deed. Opndoor staff keep the separate
-- send_deed_to_agent path. Additive only: the Rightmove referral path is untouched.

alter table public.applications
  add column if not exists landlord_name text,
  add column if not exists landlord_email text;

create or replace function public.send_deed_to_landlord(p_app uuid, p_name text, p_email text)
returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare a public.applications; r text; owned boolean; nm text; em text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where id = p_app;
  if not found then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := a.referrer_id = auth.uid();
  -- Same audience as send_deed_to_agent: an owning referrer, a manager in scope,
  -- or opndoor admin. The UI shows this button only to agency staff; the rule is
  -- enforced here independently of the UI.
  if not (public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and (not public.app_has_scope() or a.branch_id in (select public.app_scope_branches())))
          or (r = 'referrer' and owned)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if not public.can_send_deed(r, owned) then
    raise exception 'send not permitted for this role' using errcode = '42501';
  end if;
  if a.status <> 'deed' then raise exception 'deed not yet issued' using errcode = '22023'; end if;

  nm := btrim(coalesce(p_name, ''));
  em := btrim(coalesce(p_email, ''));
  if nm = '' then raise exception 'Landlord name is required' using errcode = '22023'; end if;
  if em !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Invalid landlord email' using errcode = '22023';
  end if;

  -- Stored on the application so the send form prefills on a resend.
  update public.applications set landlord_name = nm, landlord_email = em where id = p_app;
  return jsonb_build_object('sent_to', em, 'landlord_name', nm);
end $function$;

revoke all on function public.send_deed_to_landlord(uuid, text, text) from public, anon;
grant execute on function public.send_deed_to_landlord(uuid, text, text) to authenticated;
