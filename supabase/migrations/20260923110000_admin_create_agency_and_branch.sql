-- Admin agency onboarding: create an agency and its first branch in one call,
-- with an optional commission override, and return both ids so the caller can set
-- a rate / send the first invite without a re-hydrate round-trip.
--
-- Agencies are invite-only and created by Opndoor (admin + AAL2). The new agency is
-- an independent, agent-rail org under the opndoor-agents house partner (deeds
-- resolve from its PEOPLE, so no agent_contacts mailbox is required — unlike
-- admin_add_agency, which forces a default contact for the supplier model). No group
-- is created; the agency is independent until it grows. Additive; off the referral path.
create or replace function public.admin_create_agency_and_branch(
  p_agency_name  text,
  p_branch_name  text,
  p_branch_area  text default null,
  p_partner_rate numeric default null,
  p_agent_rate   numeric default null,
  p_partner_slug text default 'opndoor-agents'
)
returns table (agency_id uuid, branch_id uuid)
language plpgsql security definer set search_path to '' as $function$
declare v_partner uuid; v_agency uuid; v_branch uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  if coalesce(btrim(p_agency_name), '') = '' then raise exception 'An agency name is required.' using errcode = '22023'; end if;
  if coalesce(btrim(p_branch_name), '') = '' then raise exception 'A first branch name is required.' using errcode = '22023'; end if;

  select id into v_partner from public.partners where slug = coalesce(nullif(btrim(p_partner_slug), ''), 'opndoor-agents');
  if v_partner is null then raise exception 'Partner not found.' using errcode = '22023'; end if;

  insert into public.agencies (partner_id, name, review_state, partner_rate, agent_rate)
  values (v_partner, btrim(p_agency_name), 'confirmed', p_partner_rate, p_agent_rate)
  returning id into v_agency;

  insert into public.branches (agency_id, partner_id, name, area, review_state)
  values (v_agency, v_partner, btrim(p_branch_name), nullif(btrim(coalesce(p_branch_area, '')), ''), 'confirmed')
  returning id into v_branch;

  return query select v_agency, v_branch;
end $function$;

revoke all on function public.admin_create_agency_and_branch(text, text, text, numeric, numeric, text) from public, anon;
grant execute on function public.admin_create_agency_and_branch(text, text, text, numeric, numeric, text) to authenticated;
