/* =====================================================================
   THE OPNDOOR TEAM PANEL IS OPNDOOR'S, NOT AN AGENCY'S.

   Matt, 2026-09-30, verbatim: "Opndoor team notifications panel: for an
   Opndoor staff member it shows only Opndoor's internal alerts (the ones
   the old Internal notifications page listed), grouped Critical,
   Operations, Commercial, Information, each switchable per person, with
   the rule that a critical alert can never be left with nobody explained
   beside any box that can't be unticked. It must not show the agency
   sections ("Copied on colleagues' referrals", referral events)."

   NOTHING NEW IS BEING MODELLED HERE, which is worth saying because the
   instruction sounds like a build. All of it exists:
   `ops_notification_types()` is the catalogue and already carries
   exactly those four groups and a `critical` flag, `ops_routes` is the
   per-person routing the old page wrote, `set_ops_route` is the
   admin-only setter, and `ops_routes_keep_the_floor` has been refusing
   to leave a critical alert with nobody since it was written.

   WHAT WAS WRONG IS WHO THE PANEL THOUGHT IT WAS TALKING TO. An Opndoor
   person has no `partner_id`, the kind lookup answered nothing, and the
   coalesce made them an AGENCY user -- so they were offered "Copied on
   colleagues' referrals" within a position they do not hold and the
   referral events of an estate that is not theirs, while the alerts they
   actually receive were on a page that walk fix 10 removed from the
   menu. Their settings had nowhere to be read.

   AND THE FLOOR RULE COULD NOT SPEAK. The database refuses to unroute
   the last recipient of a critical alert; the panel had no way to say so
   beside the box, which is exactly what item 9 complained about in the
   first place ("Ticked boxes can't be unticked and nothing says why").
   ===================================================================== */

create or replace function public.person_notification_panel(p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_target public.users;
  v_kind text;
  v_internal jsonb;
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

  /* THREE PARTY KINDS NOW, AND OPNDOOR IS THE ONE THAT WAS MISSING.
     Matt, 2026-09-30: "Opndoor team notifications panel: for an Opndoor
     staff member it shows only Opndoor's internal alerts ... It must not
     show the agency sections ("Copied on colleagues' referrals",
     referral events)."

     An Opndoor person has NO partner_id at all, so this select answered
     nothing and the coalesce below made them an AGENCY: they were being
     offered "Copied on colleagues' referrals" within a position they do
     not hold, and the referral events of an estate that is not theirs.
     The panel was built for a partner user and reused for staff without
     anybody asking what staff actually receive.

     ASKED OF THE ROLE, not of the partner, because that is what makes
     somebody ours: `is_opndoor_staff()` answers about the CALLER and the
     question here is about the TARGET. */
  if v_target.role in ('superadmin', 'opndoor_manager') then
    v_kind := 'opndoor';
  else
    select case when p.is_house_route = false and p.slug <> 'opndoor-agents'
                then 'supplier' else 'agency' end
      into v_kind
      from public.partners p where p.id = v_target.partner_id;
    v_kind := coalesce(v_kind, 'agency');
  end if;

  v_may_events := coalesce(
    public.is_admin()
    or p_user = auth.uid()
    or (public.caller_leads_their_party() and public.caller_may_set_for(p_user)), false);

  v_may_director := coalesce(
    public.is_admin()
    or (public.caller_leads_their_party() and public.caller_may_set_for(p_user)), false);

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

  /* OPNDOOR'S OWN ALERTS, in the four groups the old Internal
     notifications page had: Critical, Operations, Commercial,
     Information. `ops_notification_types()` is that catalogue and it
     already carries the group and the critical flag, so nothing is
     re-listed here.

     THE LOCK IS THE FLOOR RULE, SAID OUT LOUD. `ops_routes_keep_the_floor`
     already refuses to leave a critical alert with nobody -- the
     database has enforced that since it was written -- and the panel
     could not SAY so. Matt: "with the rule that a critical alert can
     never be left with nobody explained beside any box that can't be
     unticked." A box that is simply dead, with no sentence next to it,
     reads as a bug and invites somebody to "fix" it.

     LOCKED ONLY WHEN THIS PERSON IS THE LAST ONE. Ticked and two live
     recipients: unticking is fine and the box is live. Ticked and one:
     this is the floor, and the reason belongs beside it. Unticked: there
     is nothing to lose by ticking. */
  if v_kind = 'opndoor' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'type',     t.alert_type,
             'label',    t.label,
             'group',    t.grp,
             'critical', t.critical,
             'enabled',  coalesce(r.enabled, false),
             'locked',   (t.critical and coalesce(r.enabled, false)
                          and public.ops_route_live_count(t.alert_type) <= 1),
             'lock_reason', case when (t.critical and coalesce(r.enabled, false)
                                       and public.ops_route_live_count(t.alert_type) <= 1)
                                 then 'This is the only place this critical alert goes. Add another recipient before switching it off here.'
                                 else null end
           ) order by t.ord), '[]'::jsonb)
      into v_internal
      from public.ops_notification_types() t
      left join public.ops_routes r
        on r.alert_type = t.alert_type and r.user_id = p_user;
  else
    v_internal := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'user_id',             p_user,
    'name',                coalesce(nullif(btrim(v_target.full_name), ''), v_target.email),
    'party_kind',          v_kind,
    'events',              case when v_kind = 'opndoor' then '[]'::jsonb else v_events end,
    'internal',            v_internal,
    /* WHO MAY CHANGE ONE. `set_ops_route` is admin-only and enforces that
       itself; this is the panel agreeing with it rather than deciding. */
    'may_edit_internal',   coalesce(public.is_admin(), false),
    'may_edit_events',     v_may_events,
    -- Copied-on-referrals is an agency-estate idea: the supplier rail has no
    -- positions, so there is nothing to be copied "within". B3.
    'copied_applies',      (v_kind = 'agency'),
    'copied_on',           coalesce(v_target.receives_notifications, false),
    'may_edit_copied',     v_may_director,
    -- Shown only where the LEVEL allows it, which is not the same question
    -- as whether the caller may change it.
    'statements_apply',    coalesce(v_target.role = 'management' and v_target.sees_commission, false),
    'statements_on',       coalesce(v_target.receives_commission_statements, false),
    'may_edit_statements', v_may_director
  );
end $function$;
