-- THE LINT APPLIES TO ME TOO.
--
-- 20261006510000 and 20261006530000 added three raising `if not ... then`
-- guards and did not coalesce-wrap them, and src/data/guardsAreNullSafe.test.ts
-- failed on the next run naming all three.
--
-- All three are `if not exists (...)`, and EXISTS is never NULL, so none of
-- them could actually have gone NULL. That is not a reason to exempt them.
-- D5 is on the record: every guard is wrapped, including the ones that are
-- provably total today, because the alternative is a judgement per guard and a
-- rule that needs an allowlist. Writing the exemption here would be the first
-- entry on that allowlist.

-- notification_recipients(uuid,text)
CREATE OR REPLACE FUNCTION public.notification_recipients(p_application uuid, p_type text)
 RETURNS TABLE(email text, display_name text, recipient_class text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_kind text; v_partner uuid; v_agency uuid; a public.applications;
begin
  if not coalesce(exists (select 1 from public.notification_types() t where t.notification_type = p_type), false) then
    raise exception 'There is no such notification.' using errcode = '22023';
  end if;

  select * into a from public.applications where id = p_application;
  if not found then return; end if;

  select np.kind, np.partner_id, np.agency_id into v_kind, v_partner, v_agency
  from public.notification_party(p_application) np;

  -- The direct rail has no agent-facing party. A direct tenant's deed goes to
  -- the contact THEY named, which deed_delivery_target still resolves on its
  -- own; nothing here invents an agency for them.
  if v_kind = 'direct' then return; end if;

  if v_kind = 'agency' then
    return query
      select r.email, r.display_name,
             case when r.rung = 'referrer' then 'referrer' else 'ticked_users' end
        from public.agency_notification_recipients(p_application) r
       where public.notification_enabled(
               'agency', null, v_agency, p_type,
               case when r.rung = 'referrer' then 'referrer' else 'ticked_users' end);
    return;
  end if;

  -- SUPPLIER. The referrer is a real user row on this rail (attribution is NOT
  -- NULL off the house route), except where the referral came through an API
  -- key with no human attached -- which is the case Q-02's last sentence is
  -- about, and why the agent contact is resolved independently rather than as
  -- a fallback.
  return query
    select u.email, u.full_name, 'referrer'::text
      from public.users u
     where u.id = a.referrer_id
       and u.status = 'active'
       and public.notification_enabled('supplier', v_partner, null, p_type, 'referrer');

  return query
    select c.email, c.name, 'agent_contact'::text
      from public.effective_primary_contact_route(a.branch_id, a.partner_id) c
     where c.email is not null
       and public.notification_enabled('supplier', v_partner, null, p_type, 'agent_contact');
end $function$;

-- set_notification_setting(uuid,uuid,text,text,boolean)
CREATE OR REPLACE FUNCTION public.set_notification_setting(p_partner uuid, p_agency uuid, p_type text, p_recipient text, p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_kind text; v_old boolean; v_label text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if coalesce((p_partner is null) = (p_agency is null), true) then
    raise exception 'Name exactly one party: a supplier partner or an agency.' using errcode = '22023';
  end if;
  v_kind := case when p_agency is not null then 'agency' else 'supplier' end;

  if not coalesce(public.may_edit_notification_matrix(p_partner, p_agency), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if not coalesce(exists (select 1 from public.notification_types() t where t.notification_type = p_type), false) then
    raise exception 'There is no such notification.' using errcode = '22023';
  end if;
  if not coalesce(exists (select 1 from public.notification_recipient_classes(v_kind) c where c.recipient = p_recipient), false) then
    raise exception 'That recipient does not exist for this kind of party.' using errcode = '22023';
  end if;

  -- REFUSED, NOT IGNORED. A locked switch that silently accepts the write and
  -- keeps sending is worse than one that says no.
  if coalesce(public.notification_locked(v_kind, p_type, p_recipient), false) and p_enabled is distinct from true then
    raise exception 'Delivery of the executed deed to its recipient cannot be turned off.' using errcode = '42501';
  end if;

  v_old := public.notification_enabled(v_kind, p_partner, p_agency, p_type, p_recipient);

  /* UPDATE, THEN INSERT IF IT MISSED. Not ON CONFLICT: the table has two
     PARTIAL unique indexes, one per party shape, because NULLs are distinct in
     a unique constraint. A partial index is not a valid conflict target and
     `coalesce(partner_id, agency_id)` is not an index at all, so the original
     form raised 42P10 the first time anybody moved a switch. */
  update public.notification_settings
     set enabled = p_enabled, updated_at = now(), updated_by = auth.uid()
   where notification_type = p_type and recipient = p_recipient
     and ((p_agency is not null and agency_id = p_agency)
       or (p_agency is null and partner_id = p_partner));
  if not found then
    insert into public.notification_settings (partner_id, agency_id, notification_type, recipient, enabled, updated_by)
    values (p_partner, p_agency, p_type, p_recipient, p_enabled, auth.uid());
  end if;

  if v_old is distinct from p_enabled then
    select t.label into v_label from public.notification_types() t where t.notification_type = p_type;
    insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
    values (case when p_agency is not null then 'agency' else 'partner' end,
            coalesce(p_agency, p_partner),
            'notification_setting',
            coalesce(v_label, p_type) || ' to ' || p_recipient || ': '
              || case when p_enabled then 'on' else 'off' end,
            (select full_name from public.users where id = auth.uid()),
            auth.uid());
  end if;
end $function$;

