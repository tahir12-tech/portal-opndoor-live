/* =====================================================================
   Q4. A SUPPLIER'S MANAGEMENT MANAGES ITS OWN PEOPLE'S NOTIFICATIONS.

   Matt, 2026-09-30, verbatim: "Q4: yes. A supplier's Management user can
   change the notification settings of anyone at the same supplier, the
   same way an agency Director can for their agency. Referrers can change
   only their own event choices. Monthly statements stay Management-only."

   WHY IT COULD NOT WORK BEFORE, AND IT WAS NOT A UI OVERSIGHT.
   `caller_may_set_for` tests the ladder through `user_within_caller_scope`,
   which requires the TARGET to hold a row in `user_scopes`. A supplier's
   staff never hold one, and deliberately: `user_must_hold_a_position`
   returns early off the estate and says why -- "on the supplier rail
   partner_id IS the company boundary ... requiring a position there would
   be ceremony with no boundary behind it."

   So the guard was not refusing a supplier's management. It was finding
   nothing to reason about and answering no. Recorded as B3 and as round
   6's M10, and this closes both.

   -------------------------------------------------------------------
   THE NEW ARM TESTS partner_id, AND THAT IS RULE 2 RATHER THAN A BREACH
   -------------------------------------------------------------------

   On the AGENCY rail every agency Opndoor onboards shares the house
   partner `opndoor-agents`, so `partner_id = app_partner()` is a ROUTE
   and never a company boundary -- the single most repeated finding in
   this whole effort, and the thing CI rejects a new migration for.

   On the SUPPLIER rail the partner IS the company. This is the one rail
   where that column is the correct test, and the arm below is written so
   it can NEVER fire on a house partner: `is_house_route = false` AND the
   slug is not `opndoor-agents`, which is the same two-part test the panel
   function already uses to decide a party's kind. Get that wrong and
   every agency's management reaches every other agency on the estate.

   -------------------------------------------------------------------
   TWO PREDICATES, BECAUSE THE TWO HALVES ARE DIFFERENT QUESTIONS
   -------------------------------------------------------------------

   The gates read `caller_is_director() and caller_may_set_for(p_user)`:
   am I senior enough, and is this person mine. Both halves need the
   supplier's answer, and they need different ones.

   `caller_is_director()` is deliberately NOT widened. It means what it
   says -- an agency Director, which is `management` plus the commission
   bit -- and it is asked elsewhere about commission. A supplier has no
   Director/Manager split at all (decision D11: "positions are an
   agency-estate thing and this rail has none"), so "Director" is not a
   thing to test for there. Matt's word is Management.

   Hence `caller_leads_their_party()`: an agency Director, or a
   supplier's `management`. One name, asked at the five gates, so the two
   rails cannot drift apart the way they did here.

   -------------------------------------------------------------------
   WHAT IS NOT CHANGED, ON PURPOSE
   -------------------------------------------------------------------

   The ORDER of the checks in `set_receives_commission_statements`. It
   tests the target's LEVEL before the caller's permission, and its own
   comment says why: "'change their level first' is the useful answer even
   to somebody who would not have been allowed anyway." That is a
   considered trade-off -- an unauthorised caller learns the target's
   level -- and reversing it was not asked for. Flagged rather than
   flipped.
   ===================================================================== */

/* IS THE CALLER THE ONE WHO LEADS THEIR OWN PARTY?
   An agency Director, or a supplier's management. Not an agency Manager,
   who is `management` without the commission bit and is below a Director. */
create or replace function public.caller_leads_their_party()
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select coalesce(
    public.caller_is_director()
    or (public.app_role() = 'management'
        and exists (select 1
                      from public.users u
                      join public.partners p on p.id = u.partner_id
                     where u.id = auth.uid()
                       and coalesce(p.is_house_route, false) = false
                       and p.slug <> 'opndoor-agents')),
    false)
$function$;

comment on function public.caller_leads_their_party() is
  'Q4. True for an agency Director, or for a supplier''s management user. Not an agency Manager. The supplier arm can never fire on a house partner, because on the agency rail partner_id is a route and not a company.';

revoke all on function public.caller_leads_their_party() from public, anon;
grant execute on function public.caller_leads_their_party() to authenticated, service_role;

/* IS THIS PERSON MINE TO CHANGE?
   Unchanged on the agency rail: at or below the caller, in the caller's
   own agency, by position. New supplier arm: the same real supplier, both
   sides, with the house partners excluded on both. */
create or replace function public.caller_may_set_for(p_user uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  -- At or BELOW the caller, in the caller's OWN agency. `>=` because a lower
  -- rank number is more senior: Director 1, Manager 2, Negotiator 3.
  select coalesce(
    (
      (p_user = auth.uid() or public.user_within_caller_scope(p_user))
      and coalesce(public.level_rank_of(p_user), 99) >= coalesce(public.level_rank_of(auth.uid()), 99)
    )
    -- Q4. THE SUPPLIER RAIL, where the partner IS the company. Both sides
    -- must sit on the SAME partner and that partner must be a real
    -- supplier: if this fired on a house partner, every agency's
    -- management would reach every other agency on the estate.
    or exists (
      select 1
        from public.users me
        join public.users them on them.id = p_user
        join public.partners p on p.id = me.partner_id
       where me.id = auth.uid()
         and them.partner_id = me.partner_id
         and coalesce(p.is_house_route, false) = false
         and p.slug <> 'opndoor-agents'
    ),
    false)
$function$;

comment on function public.caller_may_set_for(uuid) is
  'Whether the caller may change a notification setting for this person. Agency rail: at or below them, in their own agency, by position. Supplier rail (Q4): anybody at the same real supplier, because there partner_id IS the company boundary. Never fires on a house partner.';

revoke all on function public.caller_may_set_for(uuid) from public, anon;
grant execute on function public.caller_may_set_for(uuid) to authenticated, service_role;

/* ---- the gates, regenerated EXPLICITLY -------------------------------

   WRITTEN OUT IN FULL, NOT REWRITTEN WITH STRING SURGERY. The first
   version of this migration used a `do` block that read each function
   with `pg_get_functiondef`, substituted the predicate and executed the
   result. It worked on dev and `npm run drift` immediately reported the
   four functions as drifted -- because `schema-final-state.mjs` computes
   the final state from the FILES and cannot see inside a do-block that
   builds DDL at run time. That is decision D7's blind spot, and a
   migration the drift check cannot model is a migration whose effect
   nobody can verify against a clean apply.

   So each body below is the LAST definition -- 20261006920000 for the
   three RPCs, 20261006930000 for the panel -- with `caller_is_director()`
   replaced by `caller_leads_their_party()` and, in the panel, the
   agency-only restriction on `may_edit_copied` removed. Nothing else is
   touched.
   --------------------------------------------------------------------- */

create or replace function public.set_notification_for(p_user uuid, p_type text, p_enabled boolean)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare v_kind text;
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  if not coalesce(exists (select 1 from public.users where id = p_user), false) then
    raise exception 'No such person.' using errcode = 'P0002';
  end if;
  if not coalesce(exists (select 1 from public.notification_types() t
                           where t.notification_type = p_type), false) then
    raise exception 'There is no such notification.' using errcode = '22023';
  end if;

  -- WHOLE-CONDITION FORM, `coalesce(not (...), true)`. `not` binds tighter
  -- than `or`, so wrapping the OPERAND of a compound condition re-associates
  -- it -- the precedence bug 20261006480000 exists to have fixed once, and
  -- guardsAreNullSafe refuses this shape for exactly that reason.
  if coalesce(not (
       public.is_admin()
       or p_user = auth.uid()
       or (public.caller_leads_their_party() and public.caller_may_set_for(p_user))
     ), true) then
    raise exception 'You can only change this for yourself, or for people at or below you in your own agency.'
      using errcode = '42501';
  end if;

  -- The party kind of the TARGET, not the caller: an opndoor admin changing
  -- a supplier's person must apply the supplier's locked rules.
  select case when p.is_house_route = false and p.slug <> 'opndoor-agents'
              then 'supplier' else 'agency' end
    into v_kind
    from public.users u join public.partners p on p.id = u.partner_id
   where u.id = p_user;

  if public.notification_locked(coalesce(v_kind, 'agency'), p_type, 'referrer') and not coalesce(p_enabled, false) then
    raise exception 'The executed deed always reaches the person it is addressed to. That cannot be switched off.'
      using errcode = '42501';
  end if;

  insert into public.user_notification_settings (user_id, notification_type, enabled, updated_by)
  values (p_user, p_type, coalesce(p_enabled, false), auth.uid())
  on conflict (user_id, notification_type)
  do update set enabled = excluded.enabled, updated_at = now(), updated_by = excluded.updated_by;
end $function$;

create or replace function public.set_receives_notifications(p_user uuid, p_on boolean)
returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare v_ok boolean;
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  if not coalesce(exists (select 1 from public.users where id = p_user), false) then
    raise exception 'No such person.' using errcode = 'P0002';
  end if;

  v_ok := public.is_admin()
    or (public.caller_leads_their_party() and public.caller_may_set_for(p_user));

  if not coalesce(v_ok, false) then
    raise exception 'You can only change this for people at or below your own position, in your own agency.'
      using errcode = '42501';
  end if;

  perform set_config('app.setting_notifications_tick', 'on', true);
  update public.users set receives_notifications = coalesce(p_on, false) where id = p_user;
  perform set_config('app.setting_notifications_tick', 'off', true);

  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  select coalesce(c.level, 'user'), coalesce(c.org_id, p_user),
         case when coalesce(p_on, false) then 'notifications_on' else 'notifications_off' end,
         coalesce(nullif(btrim(u.full_name), ''), u.email)
           || case when coalesce(p_on, false) then ' now receives ' else ' no longer receives ' end
           || 'notifications for their position',
         coalesce((select a.full_name from public.users a where a.id = auth.uid()), 'System'),
         auth.uid()
    from public.users u
    left join lateral public.commission_statement_party(p_user) c on true
   where u.id = p_user;

  return coalesce(p_on, false);
end $function$;

create or replace function public.set_receives_commission_statements(p_user uuid, p_on boolean)
returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare
  v_target public.users; v_actor text; v_level text; v_org uuid; v_org_name text;
  v_on boolean := coalesce(p_on, false);
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  select * into v_target from public.users where id = p_user;
  if not coalesce(found, false) then raise exception 'User not found' using errcode = '22023'; end if;

  /* THE LEVEL, FIRST. A statement IS a commission figure, so only somebody
     who may see commission may be addressed one. This fires before the
     permission test on purpose: "change their level first" is the useful
     answer even to somebody who would not have been allowed anyway. */
  if v_on and not (v_target.role = 'management' and v_target.sees_commission) then
    raise exception 'Only a Director receives a commission statement. Change their level first.'
      using errcode = '22023';
  end if;

  select c.level, c.org_id, c.org_name into v_level, v_org, v_org_name
  from public.commission_statement_party(p_user) c;
  if v_level is null then
    raise exception 'This person is not attached to a group, agency or branch, so there is no commission statement for them to receive.'
      using errcode = '22023';
  end if;

  if coalesce(not (
       public.is_admin()
       or (public.caller_leads_their_party() and public.caller_may_set_for(p_user))
     ), true) then
    raise exception 'Only a Director, or Opndoor, decides who receives a commission statement.'
      using errcode = '42501';
  end if;

  select full_name into v_actor from public.users where id = auth.uid();

  perform set_config('app.setting_commission_tick', 'on', true);
  update public.users set receives_commission_statements = v_on where id = p_user;
  perform set_config('app.setting_commission_tick', 'off', true);

  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values (
    v_level, v_org,
    case when v_on then 'commission_statements_on' else 'commission_statements_off' end,
    coalesce(nullif(btrim(v_target.full_name), ''), v_target.email)
      || case when v_on then ' now receives ' else ' no longer receives ' end
      || coalesce(v_org_name, 'this party') || '''s monthly commission statement',
    coalesce(v_actor, 'an administrator'), auth.uid()
  );

  return v_on;
end $function$;

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
    'may_edit_copied',     v_may_director,
    -- Shown only where the LEVEL allows it, which is not the same question
    -- as whether the caller may change it.
    'statements_apply',    coalesce(v_target.role = 'management' and v_target.sees_commission, false),
    'statements_on',       coalesce(v_target.receives_commission_statements, false),
    'may_edit_statements', v_may_director
  );
end $function$;

/* AND THE WRITE POLICY, which carries the same pair and is not a function.
   Re-created rather than altered: a policy's USING clause cannot be
   edited in place. Verbatim from 20261006920000 with the one substitution. */
drop policy if exists uns_write on public.user_notification_settings;
create policy uns_write on public.user_notification_settings for all to authenticated
using (
  user_id = auth.uid()
  or public.is_admin()
  or (public.caller_leads_their_party() and public.caller_may_set_for(user_id))
)
with check (
  user_id = auth.uid()
  or public.is_admin()
  or (public.caller_leads_their_party() and public.caller_may_set_for(user_id))
);
