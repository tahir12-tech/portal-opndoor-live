-- WHO MAY CHANGE WHICH NOTIFICATION SETTING.
--
-- Matt, 2026-09-30: "a Director can change the notification settings of
-- anyone at or below them in their own agency, not just see them. Each
-- person can still change their own event choices. Two settings are
-- Director-only: turning monthly commission statements on or off (and only
-- for people who can see commission), and whether someone is copied on
-- colleagues' referrals within their position. Opndoor admin can change
-- anyone's."
--
-- Test: supabase/tests/who_may_change_a_notification.test.sql, 13 assertions
-- across four roles. Nine failed first.
--
-- =========================================================================
-- THREE SETTINGS, THREE RULES. They used to share one.
-- =========================================================================
--
--   event choices       self, OR a Director at/above in their own agency,
--                       OR an opndoor admin
--   monthly statements  Director-only -- NOT self -- and only for somebody
--                       who may see commission. Plus admin.
--   copied on referrals Director-only -- NOT self. Plus admin.
--
-- THE NEGATIVE HALF IS WHAT MAKES THIS WORK. "Director-only" REMOVES a
-- capability from self-service rather than merely granting one: a Negotiator
-- may not switch their own statements on, and neither may a Manager.
-- `set_receives_notifications` previously allowed `p_user = auth.uid()`
-- outright, so anybody could copy themselves in on their colleagues'
-- referrals. That arm is withdrawn here, and it is the one change in this
-- migration that takes something away from somebody who has it today.
--
-- "IN THEIR OWN AGENCY" IS THE POSITION LADDER, never `partner_id`. Every
-- agency shares the house partner `opndoor-agents`, so a partner test would
-- let one agency's Director change another agency's staff. That is rule 2,
-- and the test asserts it with two agencies on the same partner.

-- -------------------------------------------------------------------------
-- THE TWO QUESTIONS, WRITTEN ONCE.
--
-- Separate functions rather than repeated inline conditions: the same two
-- questions are asked by three setters, and three copies of a ladder test
-- is how they drift apart. Both are STABLE and read only the caller.
-- -------------------------------------------------------------------------
create or replace function public.caller_is_director()
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select coalesce(public.app_role() = 'management' and public.may_see_commission(), false)
$function$;

comment on function public.caller_is_director() is
  'Director = management AND sees_commission. Director and Manager are one role separated by that flag, so anything Director-only tests the capability and not the role (rule 3).';

create or replace function public.caller_may_set_for(p_user uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  -- At or BELOW the caller, in the caller's OWN agency. `>=` because a lower
  -- rank number is more senior: Director 1, Manager 2, Negotiator 3.
  select coalesce(
    (p_user = auth.uid() or public.user_within_caller_scope(p_user))
    and coalesce(public.level_rank_of(p_user), 99) >= coalesce(public.level_rank_of(auth.uid()), 99),
    false)
$function$;

comment on function public.caller_may_set_for(uuid) is
  'Is this person at or below the caller, within the caller''s own position? Uses the POSITION ladder, never partner_id: every agency shares the house partner, so a partner test would reach into another agency.';

revoke all on function public.caller_is_director() from public, anon;
revoke all on function public.caller_may_set_for(uuid) from public, anon;
grant execute on function public.caller_is_director() to authenticated, service_role;
grant execute on function public.caller_may_set_for(uuid) to authenticated, service_role;

-- -------------------------------------------------------------------------
-- 1. EVENT CHOICES. Self, a Director at or above, or an admin.
-- -------------------------------------------------------------------------
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
       or (public.caller_is_director() and public.caller_may_set_for(p_user))
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

revoke all on function public.set_notification_for(uuid, text, boolean) from public, anon;
grant execute on function public.set_notification_for(uuid, text, boolean) to authenticated;

-- `set_my_notification` becomes the self case of the general one, so there
-- is a single implementation of the locked rule rather than two that can
-- disagree about it.
create or replace function public.set_my_notification(p_type text, p_enabled boolean)
returns void
language plpgsql security definer set search_path to ''
as $function$
begin
  if auth.uid() is null then
    raise exception 'Sign in to change your notifications.' using errcode = '42501';
  end if;
  perform public.set_notification_for(auth.uid(), p_type, p_enabled);
end $function$;

-- -------------------------------------------------------------------------
-- 2. COPIED ON COLLEAGUES' REFERRALS. Director-only, and NOT self.
--
--    The body below is 20261005140000's, with the authorisation replaced.
--    What changes: the `p_user = auth.uid()` arm is GONE, and `management`
--    becomes `caller_is_director()`. Anybody could previously copy
--    themselves in on their colleagues' work.
-- -------------------------------------------------------------------------
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
    or (public.caller_is_director() and public.caller_may_set_for(p_user));

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

-- -------------------------------------------------------------------------
-- 3. MONTHLY STATEMENTS. Director-only, NOT self, and only for somebody who
--    may see commission.
--
--    The Director arm is RESTORED here. It was withdrawn once, leaving the
--    setting opndoor-only; Matt has now given it to Directors, bounded by
--    the same ladder. The level gate above it is untouched and still fires
--    first, so even a Director cannot address a statement to a Manager.
-- -------------------------------------------------------------------------
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
       or (public.caller_is_director() and public.caller_may_set_for(p_user))
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

-- -------------------------------------------------------------------------
-- 4. AND THE TABLE POLICY MATCHES, so a direct write cannot do what the RPC
--    refuses. The RPCs are definer and bypass RLS; this is the other door.
-- -------------------------------------------------------------------------
drop policy if exists uns_write on public.user_notification_settings;
create policy uns_write on public.user_notification_settings for all to authenticated
using (
  user_id = auth.uid()
  or public.is_admin()
  or (public.caller_is_director() and public.caller_may_set_for(user_id))
)
with check (
  user_id = auth.uid()
  or public.is_admin()
  or (public.caller_is_director() and public.caller_may_set_for(user_id))
);
