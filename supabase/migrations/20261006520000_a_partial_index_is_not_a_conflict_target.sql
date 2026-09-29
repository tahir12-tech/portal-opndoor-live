-- A PARTIAL INDEX IS NOT A CONFLICT TARGET.
--
-- set_notification_setting in 20261006510000 upserted with
--
--   on conflict (coalesce(partner_id, agency_id), notification_type, recipient)
--
-- which is not an index and could never have matched one. notification_settings
-- has two PARTIAL unique indexes, one per party shape, because NULLs are
-- distinct in a unique constraint and a single index over both columns would
-- let the same cell be stored twice. A partial index cannot be an ON CONFLICT
-- target either way.
--
-- plpgsql does not plan a statement until it runs it, so the function was
-- created without complaint and raised 42P10 the first time anybody moved a
-- switch. The test found it on the first run, which is the whole reason the
-- test was written before the screen.
--
-- Replaced with update-then-insert, which needs no conflict target at all.

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

  if not exists (select 1 from public.notification_types() t where t.notification_type = p_type) then
    raise exception 'There is no such notification.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.notification_recipient_classes(v_kind) c where c.recipient = p_recipient) then
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
