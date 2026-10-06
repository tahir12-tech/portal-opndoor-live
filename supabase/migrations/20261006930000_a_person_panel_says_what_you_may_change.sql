-- THE PANEL, ASSEMBLED BY THE SERVER, INCLUDING WHAT THE CALLER MAY CHANGE.
--
-- The client half of walk fixes 9, 10 and 12. One round trip returns a
-- person's whole panel.
--
-- Test: supabase/tests/a_person_panel_says_what_you_may_change.test.sql
--
-- =========================================================================
-- WHY THE SERVER DECIDES WHAT IS EDITABLE, AND NOT THE SCREEN
-- =========================================================================
--
-- The three settings now have three different rules: event choices are self
-- or a Director at or above or an admin; monthly statements and
-- copied-on-referrals are Director-only and explicitly NOT self. A client
-- that re-derives those will eventually disagree with the server, and the
-- way that failure presents is the worst kind -- a control that looks live,
-- accepts a click, and throws.
--
-- So the panel carries a flag PER SECTION. There is deliberately no single
-- "may edit" boolean, because for a Negotiator looking at their own panel
-- the honest answer is three different answers: yes to events, no to the
-- other two.
--
-- AND `statements_apply` IS SEPARATE FROM `may_edit_statements`. Matt:
-- "whether they get monthly statements if their level allows it." A
-- Negotiator's level does not allow it, so the section is not shown at all
-- -- which is a different thing from being shown and disabled. Showing a
-- greyed control implies somebody could enable it; the level is not a
-- permission, it is what the person is.

create or replace function public.person_notification_panel(p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_target public.users;
  v_kind text;
  v_may_events boolean;
  v_may_director boolean;
  v_events jsonb;
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;

  select * into v_target from public.users where id = p_user;
  if not coalesce(found, false) then
    raise exception 'No such person.' using errcode = 'P0002';
  end if;

  -- READING somebody's panel is bounded by the same ladder as changing it,
  -- less the Director requirement: a Manager may see their team's, which is
  -- what "Opndoor admin can see every person's choices" implies for the
  -- people who already manage them.
  if coalesce(not (
       public.is_admin()
       or public.app_role() = 'opndoor_manager'
       or p_user = auth.uid()
       or public.caller_may_set_for(p_user)
     ), true) then
    raise exception 'You can only see this for yourself, or for people at or below you in your own agency.'
      using errcode = '42501';
  end if;

  select case when p.is_house_route = false and p.slug <> 'opndoor-agents'
              then 'supplier' else 'agency' end
    into v_kind
    from public.partners p where p.id = v_target.partner_id;
  v_kind := coalesce(v_kind, 'agency');

  v_may_events := coalesce(
    public.is_admin()
    or p_user = auth.uid()
    or (public.caller_is_director() and public.caller_may_set_for(p_user)), false);

  v_may_director := coalesce(
    public.is_admin()
    or (public.caller_is_director() and public.caller_may_set_for(p_user)), false);

  select coalesce(jsonb_agg(jsonb_build_object(
           'type',        t.notification_type,
           'label',       t.label,
           'enabled',     public.user_notification_enabled(p_user, v_kind, t.notification_type),
           'locked',      public.notification_locked(v_kind, t.notification_type, 'referrer'),
           -- The SENTENCE, not a flag. Item 9's complaint was that a box
           -- could not be unticked and nothing said why.
           'lock_reason', case when public.notification_locked(v_kind, t.notification_type, 'referrer')
                               then 'The executed deed always reaches the person it is addressed to. That cannot be switched off.'
                               else null end
         ) order by t.ord), '[]'::jsonb)
    into v_events
    from public.notification_types() t;

  return jsonb_build_object(
    'user_id',             p_user,
    'name',                coalesce(nullif(btrim(v_target.full_name), ''), v_target.email),
    'party_kind',          v_kind,
    'events',              v_events,
    'may_edit_events',     v_may_events,
    -- Copied-on-referrals is an agency-estate idea: the supplier rail has no
    -- positions, so there is nothing to be copied "within". B3.
    'copied_applies',      (v_kind = 'agency'),
    'copied_on',           coalesce(v_target.receives_notifications, false),
    'may_edit_copied',     v_may_director and v_kind = 'agency',
    -- Shown only where the LEVEL allows it, which is not the same question
    -- as whether the caller may change it.
    'statements_apply',    coalesce(v_target.role = 'management' and v_target.sees_commission, false),
    'statements_on',       coalesce(v_target.receives_commission_statements, false),
    'may_edit_statements', v_may_director
  );
end $function$;

comment on function public.person_notification_panel(uuid) is
  'One person''s whole notifications panel in one round trip, INCLUDING a flag per section saying whether this caller may change that section. There is deliberately no single "may edit" boolean: for a Negotiator reading their own panel the honest answer is yes to events and no to the two Director-only settings.';

revoke all on function public.person_notification_panel(uuid) from public, anon;
grant execute on function public.person_notification_panel(uuid) to authenticated;
