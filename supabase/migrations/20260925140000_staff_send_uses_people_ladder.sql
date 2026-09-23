-- The staff send must be able to send what the automatic send held back.
--
-- 20260924110000 stopped an agent-rail deed auto-sending when no ACTIVE person
-- could receive it, parking it as needs-attention for a staff send. But the staff
-- send resolved its recipient from effective_primary_contact alone -- the
-- agent_contacts mailbox chain -- and an agent-rail agency onboarded through the
-- Add agency flow has no mailbox at all. So the held deed could not be sent by the
-- button that exists to send it: the operator had to know to type an address into
-- "send to another address", and otherwise got a second delivery failure.
--
-- send_deed_to_agent now resolves the same way delivery does: on the agent rail
-- the org's ACTIVE people first (deed_people_target: nominated recipient, else the
-- branch/agency/group manager), then the mailbox chain as a fallback. An explicit
-- p_recipient_email still wins over both, unchanged.
--
-- SUPPLIER RAIL BYTE-IDENTICAL: the people lateral only joins for
-- opndoor_referenced, so a supplier application resolves exactly as before.
-- Every permission check below is unchanged from 20260904160000.
create or replace function public.send_deed_to_agent(p_app uuid, p_recipient_email text default null, p_save_contact boolean default false)
 returns jsonb
 language plpgsql security definer set search_path to ''
as $function$
declare a public.applications; r text; owned boolean; eff public.agent_contacts; recipient text;
        v_mode text; v_pe_email text; v_pe_name text;
        v_resolved_email text; v_resolved_name text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where id = p_app;
  if not found then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := a.referrer_id = auth.uid();
  if not (public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and (not public.app_has_scope() or a.branch_id in (select public.app_scope_branches())))
          or (r = 'referrer'   and owned)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if not public.can_send_deed(r, owned) then
    raise exception 'send not permitted for this role' using errcode = '42501';
  end if;
  if a.status <> 'deed' then raise exception 'deed not yet issued'; end if;
  if r = 'referrer' and (p_recipient_email is not null or p_save_contact) then
    raise exception 'referrers may only send to the resolved contact and cannot save contacts' using errcode = '42501';
  end if;
  if p_recipient_email is not null and p_recipient_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Invalid recipient email' using errcode = '22023';
  end if;

  select p.referencing_mode into v_mode from public.partners p where p.id = a.partner_id;

  -- The mailbox chain, exactly as before.
  select * into eff from public.effective_primary_contact(a.branch_id);

  -- The people ladder, agent rail only.
  if v_mode = 'opndoor_referenced' then
    select t.email, t.display_name into v_pe_email, v_pe_name
    from public.deed_people_target(a.branch_id) t;
  end if;

  v_resolved_email := coalesce(v_pe_email, eff.email);
  v_resolved_name  := coalesce(v_pe_name,  eff.name);
  recipient := coalesce(p_recipient_email, v_resolved_email);

  return jsonb_build_object('sent_to', recipient, 'resolved_contact', v_resolved_email, 'resolved_name', v_resolved_name);
end $function$;

comment on function public.send_deed_to_agent(uuid, text, boolean) is
  'Staff/agent resend of an issued deed. Resolves the recipient the same way delivery does: on the agent rail the org''s ACTIVE people first (deed_people_target), then the agent_contacts chain; supplier rails use the chain alone, byte-identical to before. An explicit recipient email always wins.';
