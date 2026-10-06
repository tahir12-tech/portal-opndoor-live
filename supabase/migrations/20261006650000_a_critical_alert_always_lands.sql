-- A CRITICAL ALERT ALWAYS LANDS.
--
-- The resolver every internal send asks, the write path, and the audit.
--
-- THE FALLBACK IS AN ALERT ABOUT ITSELF. "Any critical type left empty falls
-- back to support@opndoor.co with an alert saying so." The trigger in
-- 20261006640000 makes that hard to reach, and hard is not impossible: the
-- table is empty before anybody configures it, and a whole team can be
-- deactivated in one transaction with the constraint deferred. So the
-- resolver falls back AND returns `fellback`, and the sender says so in the
-- email. A silent fallback would mean the floor was never tested until the
-- day somebody went looking for an alert that had been arriving somewhere
-- else for a month.

create or replace function public.ops_route_recipients(p_type text)
returns table(email text, display_name text, source text, fellback boolean)
language plpgsql stable security definer set search_path to '' as $function$
declare v_known boolean; v_critical boolean; v_n int;
begin
  select true, t.critical into v_known, v_critical
    from public.ops_notification_types() t where t.alert_type = p_type;

  /* AN UNKNOWN KIND STILL HAS TO LAND. A new alert added in code before it is
     added to ops_notification_types has no routing rows, and losing it is
     exactly the failure this function exists to prevent. It falls back and
     says so, which is also how the gap gets noticed. */
  if not coalesce(v_known, false) then
    return query select 'support@opndoor.co'::text, 'opndoor support'::text, 'fallback'::text, true;
    return;
  end if;

  select public.ops_route_live_count(p_type) into v_n;
  if v_n > 0 then
    return query
      select coalesce(u.email, b.email),
             coalesce(u.full_name, b.name),
             case when r.user_id is not null then 'person' else 'inbox' end,
             false
        from public.ops_routes r
        left join public.users u on u.id = r.user_id
        left join public.ops_inboxes b on b.id = r.inbox_id
       where r.alert_type = p_type
         and r.enabled
         and ((r.user_id is not null and u.status = 'active')
           or (r.inbox_id is not null and b.active));
    return;
  end if;

  /* Nobody. For a CRITICAL type that is the fallback case the instruction
     names. For a non-critical type it is a legitimate "we do not want these",
     so nothing is sent and nothing is claimed. */
  if coalesce(v_critical, false) then
    return query select 'support@opndoor.co'::text, 'opndoor support'::text, 'fallback'::text, true;
  end if;
end $function$;

comment on function public.ops_route_recipients(text) is
  'The one door for an internal alert. Returns the live recipients of a type, '
  'or the support fallback WITH fellback=true for a critical type that has '
  'none -- and for a type nobody has added to ops_notification_types yet, '
  'because losing a new alert is the failure this exists to prevent.';

-- ---------------------------------------------------------------------------
-- THE SCREEN'S READ
-- ---------------------------------------------------------------------------
-- Every type crossed with every possible recipient, with the current value.
-- Opndoor staff are users with no partner; a supplier's or agency's people are
-- not routable and are not offered.
create or replace function public.ops_routing_matrix()
returns table(alert_type text, label text, grp text, critical boolean, type_ord int,
              recipient_kind text, recipient_id uuid, recipient_name text,
              recipient_email text, enabled boolean, live_count int)
language plpgsql stable security definer set search_path to '' as $function$
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  -- superadmin edits, opndoor_manager views. Nobody else sees it at all.
  if not coalesce(public.is_opndoor_staff(), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return query
  with people as (
    select u.id, u.full_name as name, u.email
      from public.users u
     where u.partner_id is null and u.status = 'active'
  ),
  boxes as (
    select b.id, b.name, b.email from public.ops_inboxes b where b.active
  ),
  recips as (
    select 'person'::text as kind, p.id, p.name, p.email from people p
    union all
    select 'inbox'::text, x.id, x.name, x.email from boxes x
  )
  select t.alert_type, t.label, t.grp, t.critical, t.ord,
         r.kind, r.id, r.name, r.email,
         coalesce(o.enabled, false),
         public.ops_route_live_count(t.alert_type)
    from public.ops_notification_types() t
    cross join recips r
    left join public.ops_routes o
      on o.alert_type = t.alert_type
     and ((r.kind = 'person' and o.user_id = r.id) or (r.kind = 'inbox' and o.inbox_id = r.id))
   order by t.ord, r.kind desc, r.name;
end $function$;

-- ---------------------------------------------------------------------------
-- THE WRITE
-- ---------------------------------------------------------------------------
create or replace function public.set_ops_route(
  p_type text, p_kind text, p_recipient uuid, p_enabled boolean)
returns void
language plpgsql security definer set search_path to '' as $function$
declare v_label text; v_who text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  -- ONLY SUPERADMIN EDITS. opndoor_manager reads the matrix above and cannot
  -- reach this; everybody else cannot reach either.
  if not coalesce(public.is_admin(), false) then
    raise exception 'Only an opndoor admin can change where internal alerts go.' using errcode = '42501';
  end if;
  if p_kind not in ('person','inbox') then
    raise exception 'A recipient is a person or an inbox.' using errcode = '22023';
  end if;
  select t.label into v_label from public.ops_notification_types() t where t.alert_type = p_type;
  if v_label is null then
    raise exception 'There is no such alert.' using errcode = '22023';
  end if;

  if p_enabled then
    insert into public.ops_routes (alert_type, user_id, inbox_id, enabled, updated_by)
    values (p_type,
            case when p_kind = 'person' then p_recipient end,
            case when p_kind = 'inbox'  then p_recipient end,
            true, auth.uid())
    on conflict do nothing;
  end if;

  update public.ops_routes
     set enabled = p_enabled, updated_at = now(), updated_by = auth.uid()
   where alert_type = p_type
     and ((p_kind = 'person' and user_id = p_recipient)
       or (p_kind = 'inbox'  and inbox_id = p_recipient));

  -- The floor is the trigger's job, not this function's: turning the last one
  -- off, deleting it, and deactivating the person who holds it are three
  -- different statements and only a trigger catches all three.

  select coalesce(u.full_name, b.name) into v_who
    from (select 1) _
    left join public.users u on p_kind = 'person' and u.id = p_recipient
    left join public.ops_inboxes b on p_kind = 'inbox' and b.id = p_recipient;

  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values ('ops_route', p_recipient, 'ops_route',
          v_label || ': ' || case when p_enabled then 'on' else 'off' end
            || ' for ' || coalesce(v_who, p_kind),
          (select full_name from public.users where id = auth.uid()), auth.uid());
end $function$;

revoke all on function public.ops_route_recipients(text) from public, anon, authenticated;
grant execute on function public.ops_route_recipients(text) to service_role;
revoke all on function public.ops_routing_matrix() from public, anon;
grant execute on function public.ops_routing_matrix() to authenticated, service_role;
revoke all on function public.set_ops_route(text, text, uuid, boolean) from public, anon;
grant execute on function public.set_ops_route(text, text, uuid, boolean) to authenticated, service_role;
