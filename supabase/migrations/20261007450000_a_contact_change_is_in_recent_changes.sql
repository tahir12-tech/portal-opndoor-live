-- =========================================================================
-- ADDING OR CHANGING A CONTACT IS A CHANGE SOMEBODY SHOULD SEE.
--
-- Matt, 2026-10-02, asking for an "Add email" button on the supplier's
-- Agencies tab: "an 'Add email' button that sets the agency's email in
-- place, with a confirmation, recorded in Recent changes. Each branch's
-- email can be added or changed the same way."
--
-- Recent changes reads `org_audit`, and neither `org_add_contact` nor
-- `org_update_contact` wrote to it. So a contact could be added -- which
-- is where a signed deed goes -- and the agency's own history would not
-- mention it.
--
-- WHY IN THE FUNCTIONS AND NOT AT THE CALL SITE. Three screens already
-- add a contact (the Agencies tree's contacts modal, the referral form's
-- fly-creation, and now the supplier's Agencies tab) and a fourth will.
-- A write in one caller is a history with holes in it.
--
-- A CHANGED NAME IS NOT A CHANGED ADDRESS. The update arm records only
-- when the EMAIL moves, because "the deed now goes somewhere else" is
-- the thing this list exists to show, and a row for every typo fixed in
-- a contact's name is the kind of no-op entry Matt asked to have hidden
-- on the Settings tab the same day.
-- =========================================================================

CREATE OR REPLACE FUNCTION public.org_add_contact(p_agency_id uuid, p_branch_id uuid, p_name text, p_role text, p_email text, p_phone text, p_primary boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := auth.uid(); pid uuid; new_id uuid; v_email text := btrim(coalesce(p_email,''));
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if (p_agency_id is null) = (p_branch_id is null) then
    raise exception 'A contact must belong to exactly one agency or branch.' using errcode = '22023';
  end if;
  if v_email = '' then raise exception 'A contact email is required.' using errcode = '22023'; end if;
  if v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Enter a valid contact email.' using errcode = '22023';
  end if;
  if p_agency_id is not null then select partner_id into pid from public.agencies where id = p_agency_id;
  else select partner_id into pid from public.branches where id = p_branch_id; end if;
  if pid is null then raise exception 'Owner not found.' using errcode = '22023'; end if;
  if not coalesce((public.is_admin()
          or (public.app_role() = 'management' and pid = public.app_partner()
              and public.app_may_reach_contact(p_agency_id, p_branch_id, pid))), false) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  insert into public.agent_contacts(agency_id, branch_id, name, email, phone, contact_role, is_primary, created_by)
  values (p_agency_id, p_branch_id, btrim(coalesce(p_name,'')), v_email, nullif(btrim(coalesce(p_phone,'')),''), nullif(btrim(coalesce(p_role,'')),''), coalesce(p_primary,false), me)
  returning id into new_id;

  /* AND IT IS A CHANGE SOMEBODY SHOULD SEE. Matt, 2026-10-02, asking for
     the Add email button on the supplier's Agencies tab: "with a
     confirmation, recorded in Recent changes."

     Recent changes reads `org_audit`, and this function wrote nothing
     to it -- so a contact could be added, the deed's destination could
     move, and the agency's own history would not mention it. The write
     is here rather than at the call site because three screens add a
     contact and a fourth will.

     THE ADDRESS IS IN THE DETAIL, not just the fact of a contact. "A
     contact was added" does not answer the question somebody opens this
     list to ask, which is where the deed is going now. */
  insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
  values (case when p_agency_id is not null then 'agency' else 'branch' end,
          coalesce(p_agency_id, p_branch_id),
          'contact_added', v_email,
          coalesce((select full_name from public.users where id = me), 'an administrator'), me);

  return new_id;
end $function$;

CREATE OR REPLACE FUNCTION public.org_update_contact(p_id uuid, p_name text, p_role text, p_email text, p_phone text, p_primary boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pid uuid; a_id uuid; b_id uuid; v_email text := btrim(coalesce(p_email,'')); has_primary boolean; v_was text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select partner_id, agency_id, branch_id into pid, a_id, b_id from public.agent_contacts where id = p_id;
  if pid is null then raise exception 'Contact not found.' using errcode = '22023'; end if;
  if not coalesce((public.is_admin()
          or (public.app_role() = 'management' and pid = public.app_partner()
              and public.app_may_reach_contact(a_id, b_id, pid))), false) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  if v_email = '' then raise exception 'A contact email is required.' using errcode = '22023'; end if;
  if v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Enter a valid contact email.' using errcode = '22023';
  end if;
  /* THE ADDRESS BEFORE, so the history can say what it changed FROM.
     Read before the update for the obvious reason and recorded only
     when it actually moved: an edit that fixes a typo in the NAME is
     not a change of where the deed goes, and a Recent changes list that
     cannot tell those apart is the one Matt asked to have the no-op
     rows hidden from. */
  select email into v_was from public.agent_contacts where id = p_id;

  update public.agent_contacts
    set name = btrim(coalesce(p_name,'')), email = v_email, phone = nullif(btrim(coalesce(p_phone,'')),''),
        contact_role = nullif(btrim(coalesce(p_role,'')),''), is_primary = coalesce(p_primary,false)
    where id = p_id;

  if coalesce(v_was,'') is distinct from v_email then
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values (case when a_id is not null then 'agency' else 'branch' end,
            coalesce(a_id, b_id),
            'contact_changed',
            coalesce(nullif(v_was,''), 'none') || ' -> ' || v_email,
            coalesce((select full_name from public.users where id = auth.uid()), 'an administrator'),
            auth.uid());
  end if;
  select exists (select 1 from public.agent_contacts
    where ((a_id is not null and agency_id = a_id) or (b_id is not null and branch_id = b_id)) and is_primary) into has_primary;
  if not has_primary then
    update public.agent_contacts set is_primary = true where id = (
      select id from public.agent_contacts
      where (a_id is not null and agency_id = a_id) or (b_id is not null and branch_id = b_id)
      order by created_at asc, id asc limit 1);
  end if;
end $function$;
