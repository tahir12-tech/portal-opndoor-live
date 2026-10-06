-- TURN OFF ALL REPORTS WHAT IT CHANGED, NOT WHAT IT TOUCHED.
--
-- A correction to 20261008210000, in a new migration because that one is
-- already on dev.
--
-- The dialog says "N notifications switched off", and "There was nothing
-- left to switch off" when N is 0. The function it reports counted every
-- unlocked cell it WROTE -- which is all of them, every time. So a second
-- press said "9 notifications switched off" having switched off nothing,
-- and the sentence written for N = 0 could never be reached.
--
-- IT STILL WRITES EVERY UNLOCKED CELL, and only the count changes. An
-- unset cell reads as its class default, so skipping the ones that are
-- already off would leave them unset: the day a default flips from off to
-- on, a person who had pressed "Turn off all" would start receiving that
-- email again, having been told it was off. Writing the row makes the
-- answer the person's, not the default's.
create or replace function public.turn_off_all_notifications(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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
       other function asks, so the two cannot disagree about which.

       'referrer' is the recipient class a USER ROW carries on both rails,
       which is why user_notification_enabled hardcodes it too. On the
       agency rail that class is the locked one, so an agency person keeps
       their copy of the signed deed. On the supplier rail the locked
       recipient is 'agent_contact' -- the agency's own mailbox, which is
       not a person -- so a supplier person really can switch off all of
       their own email, and the count says so. */
    if public.notification_locked(coalesce(v_kind, 'agency'), r.notification_type, 'referrer') then
      continue;
    end if;
    -- COUNTED BEFORE THE WRITE, because after it every cell is off and the
    -- count would be of the loop rather than of the change.
    if coalesce(public.user_notification_enabled(
                  p_user, coalesce(v_kind, 'agency'), r.notification_type), false) then
      v_off := v_off + 1;
    end if;
    perform public.set_notification_for(p_user, r.notification_type, false);
  end loop;

  return v_off;
end $$;

revoke all on function public.turn_off_all_notifications(uuid) from public, anon;
grant execute on function public.turn_off_all_notifications(uuid) to authenticated;
