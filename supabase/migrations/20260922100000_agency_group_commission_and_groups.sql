-- Phase 5 DB: edit the agency/group commission overrides, and make agency groups real.
--
-- resolve_rates() already coalesces group -> agency -> partner, but nothing could
-- WRITE the agency or group tiers, and a "group" was a dead free-text label
-- (agencies.group_name) with no way to create the real agency_groups row that
-- positions and resolve_rates point at. This adds the write path.
--
--  * set_agency_rates / set_group_rates -- commission overrides. SUPERADMIN ONLY:
--    commission is Opndoor's commercial term, not a partner-management setting.
--  * create_agency_group / set_agency_group -- create a real group and attach a
--    brand (agency) to it. Org management (superadmin, or a partner's own
--    management), like admin_add_agency.
--
-- Editing a rate never moves history: create_referral snapshots the resolved rate
-- at creation; resolve_rates is read only for NEW applications. A null rate means
-- "inherit the next tier up".

create or replace function public.set_agency_rates(p_agency uuid, p_partner_rate numeric, p_agent_rate numeric)
returns void language plpgsql security definer set search_path to '' as $function$
declare me uuid := auth.uid(); nm text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  update public.agencies set partner_rate = p_partner_rate, agent_rate = p_agent_rate
    where id = p_agency returning name into nm;
  if nm is null then raise exception 'Agency not found' using errcode = '22023'; end if;
  insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
  values ('agency', p_agency, 'commission_set',
    'partner ' || coalesce(round(p_partner_rate, 4)::text, 'inherit') || ', agent ' || coalesce(round(p_agent_rate, 4)::text, 'inherit'),
    coalesce((select full_name from public.users where id = me), 'an administrator'), me);
end $function$;

create or replace function public.set_group_rates(p_group uuid, p_partner_rate numeric, p_agent_rate numeric)
returns void language plpgsql security definer set search_path to '' as $function$
declare me uuid := auth.uid(); nm text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  update public.agency_groups set partner_rate = p_partner_rate, agent_rate = p_agent_rate
    where id = p_group returning name into nm;
  if nm is null then raise exception 'Group not found' using errcode = '22023'; end if;
  insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
  values ('agency_group', p_group, 'commission_set',
    'partner ' || coalesce(round(p_partner_rate, 4)::text, 'inherit') || ', agent ' || coalesce(round(p_agent_rate, 4)::text, 'inherit'),
    coalesce((select full_name from public.users where id = me), 'an administrator'), me);
end $function$;

create or replace function public.create_agency_group(p_partner_slug text, p_name text)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare me uuid := auth.uid(); pid uuid; gid uuid; nm text := btrim(coalesce(p_name, ''));
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if nm = '' then raise exception 'Group name is required' using errcode = '22023'; end if;
  if public.is_admin() then
    select id into pid from public.partners where slug = p_partner_slug;
    if pid is null then raise exception 'Select a valid partner for this group.' using errcode = '22023'; end if;
  elsif public.app_role() = 'management' then
    pid := public.app_partner();
    if pid is null then raise exception 'Unknown partner.' using errcode = '22023'; end if;
  else
    raise exception 'not permitted' using errcode = '42501';
  end if;
  -- name_key is a generated column; do not write it.
  insert into public.agency_groups(partner_id, name, created_by)
  values (pid, nm, me) returning id into gid;
  insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
  values ('agency_group', gid, 'created', nm, coalesce((select full_name from public.users where id = me), 'an administrator'), me);
  return gid;
exception when unique_violation then
  raise exception 'A group with that name already exists for this partner.' using errcode = '23505';
end $function$;

create or replace function public.set_agency_group(p_agency uuid, p_group uuid)
returns void language plpgsql security definer set search_path to '' as $function$
declare me uuid := auth.uid(); a_pid uuid; g_pid uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select partner_id into a_pid from public.agencies where id = p_agency;
  if a_pid is null then raise exception 'Agency not found' using errcode = '22023'; end if;
  if not (public.is_admin() or (public.app_role() = 'management' and a_pid = public.app_partner())) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_group is not null then
    select partner_id into g_pid from public.agency_groups where id = p_group;
    if g_pid is null then raise exception 'Group not found' using errcode = '22023'; end if;
    if g_pid <> a_pid then raise exception 'The group and the agency are under different partners.' using errcode = '22023'; end if;
  end if;
  update public.agencies set group_id = p_group where id = p_agency;
  insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
  values ('agency', p_agency, 'group_set', coalesce((select name from public.agency_groups where id = p_group), 'detached'),
    coalesce((select full_name from public.users where id = me), 'an administrator'), me);
end $function$;

revoke all on function public.set_agency_rates(uuid, numeric, numeric) from public, anon;
revoke all on function public.set_group_rates(uuid, numeric, numeric) from public, anon;
revoke all on function public.create_agency_group(text, text) from public, anon;
revoke all on function public.set_agency_group(uuid, uuid) from public, anon;
grant execute on function public.set_agency_rates(uuid, numeric, numeric) to authenticated;
grant execute on function public.set_group_rates(uuid, numeric, numeric) to authenticated;
grant execute on function public.create_agency_group(text, text) to authenticated;
grant execute on function public.set_agency_group(uuid, uuid) to authenticated;
