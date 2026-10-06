-- TURN OFF ALL THE ONES THAT CAN BE.
--
-- Matt (ap) item 2: "Every email to a portal user is on by default, and
-- each person can switch any of it off, including their copy of the signed
-- deed, plus a 'Turn off all' switch. Two things can never be switched off:
-- account emails (invites, password resets, two-factor), and delivery of
-- the signed deed to the agency it's for."
--
-- Test: supabase/tests/turn_off_all.test.sql
--
-- =========================================================================
-- "ALL" CANNOT MEAN ALL, AND THE FUNCTION HAS TO SAY WHICH
-- =========================================================================
--
-- Two things are locked on by (ap)'s own next sentence, so a switch
-- labelled "Turn off all" that silently left two on would be a control
-- that lies about what it did. It turns off everything that CAN be, and
-- returns how many -- so the screen can say what happened rather than
-- assume.
--
-- ONE CALL, NOT A LOOP FROM THE CLIENT. The alternative is the dialog
-- firing one RPC per notification type, which is a partial failure waiting
-- to happen: half off, half on, and nothing to tell the reader which half.
--
-- IT REUSES set_notification_for RATHER THAN WRITING ROWS ITSELF, so the
-- locked-cell rule, the party-kind resolution and the permission test are
-- applied by the one function that owns them. A second writer would be a
-- second opinion about which cells are locked.

create or replace function public.turn_off_all_notifications(p_user uuid)
returns integer language plpgsql security definer set search_path to '' as $function$
declare v_kind text; v_off integer := 0; r record;
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  if not coalesce(exists (select 1 from public.users where id = p_user), false) then
    raise exception 'No such person.' using errcode = 'P0002';
  end if;

  /* THE SAME PERMISSION TEST AS ONE SWITCH, in the same whole-condition
     form: `not` binds tighter than `or`, so wrapping the operand would
     re-associate it -- the precedence bug 20261006480000 fixed once and
     guardsAreNullSafe refuses this shape for. */
  if coalesce(not (
       public.is_admin()
       or p_user = auth.uid()
       or (public.caller_leads_their_party() and public.caller_may_set_for(p_user))
     ), true) then
    raise exception 'You can only change this for yourself, or for people at or below you in your own agency.'
      using errcode = '42501';
  end if;

  -- The party kind of the TARGET, as set_notification_for resolves it: an
  -- opndoor admin turning off a supplier's person applies the supplier's
  -- locked rules, not their own.
  select case when p.is_house_route = false and p.slug <> 'opndoor-agents'
              then 'supplier' else 'agency' end
    into v_kind
    from public.users u join public.partners p on p.id = u.partner_id
   where u.id = p_user;

  for r in select t.notification_type from public.notification_types() t loop
    /* SKIPPED, NOT ATTEMPTED AND CAUGHT. set_notification_for RAISES on a
       locked cell, and swallowing that exception would mean this function
       could not tell "locked, as designed" from "refused, something is
       wrong". Asking notification_locked first is the same question the
       other function asks, so the two cannot disagree about which. */
    if public.notification_locked(coalesce(v_kind, 'agency'), r.notification_type, 'referrer') then
      continue;
    end if;
    perform public.set_notification_for(p_user, r.notification_type, false);
    v_off := v_off + 1;
  end loop;

  return v_off;
end $function$;

revoke all on function public.turn_off_all_notifications(uuid) from public, anon;
grant execute on function public.turn_off_all_notifications(uuid) to authenticated, service_role;

comment on function public.turn_off_all_notifications(uuid) is
  'Switch off every notification this person CAN switch off, and return how many. The locked cells -- account emails, and delivery of the signed deed to the agency it is for -- are skipped rather than attempted, so a caller can say what actually happened. Permission and the locked rule are set_notification_for''s, applied by calling it rather than by writing rows here.';
