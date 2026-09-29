-- REACH IS NOT CONTAINMENT.
--
-- Round 7, C. `app_may_reach_user` is AGENCY-granular: it answers "can you
-- SEE this person", and a branch manager can see the whole agency. The
-- containment predicate is `user_within_caller_scope`, and 20261006220000
-- says so in its own comment -- "Overlap, not containment ... Writing is
-- user_within_caller_scope". Seven write RPCs asked the first and none asked
-- the second.
--
-- Measured on dev, rolled back, as branchmanager@meridian.invalid holding ONE
-- branch position at Northgate Central, against marcus@meridian.invalid, a
-- referrer at Northgate WEST -- a sibling branch of the same agency:
--
--   app_may_reach_user        true
--   user_within_caller_scope  false
--   set_agency_level(marcus, 'Director')  ->  role management, sees_commission
--
-- and the same caller could also reset his password, deactivate him, wipe his
-- MFA, rename him and move him into their own branch. A branch-caged manager
-- minting a Director two branches over is rule 1 and rule 3 at once.
--
-- The tell was already in the codebase: set_receives_notifications is the one
-- function in this family that asks containment, and it correctly refuses
-- exactly this caller with exactly this message.
--
-- ONE PLACE, NOT SEVEN. All seven affected RPCs -- set_agency_level,
-- admin_set_user_status, admin_reset_user_mfa, admin_update_user_name,
-- authorise_password_reset, admin_cancel_invite, set_home_branch -- already
-- call assert_may_act_on_user. A rule added to seven places is a rule the
-- eighth will not have.
--
-- AND NOT ON THE SUPPLIER RAIL. user_within_caller_scope requires the TARGET
-- to hold a position, and positions are mandatory only on the house partner.
-- Applying it unconditionally would refuse every supplier manager acting on
-- their own staff -- backlog B3 arriving early and as a lock. There the
-- partner IS the company and partner_id is already the containment.

CREATE OR REPLACE FUNCTION public.assert_may_act_on_user(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_caller int; v_target int;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  -- Opndoor staff sit above all three levels and manage their own team, so the
  -- ladder does not judge them. The guards that already exist for them are
  -- untouched and still apply: at least one active admin must remain, you cannot
  -- change your own role, an admin cannot be reassigned to a partner role.
  if public.is_opndoor_staff() then return; end if;

  v_caller := public.level_rank_of(auth.uid());
  if v_caller is null then
    raise exception 'Your account has no agency level, so it cannot act on people.' using errcode = '42501';
  end if;

  if not coalesce(exists (select 1 from public.users where id = p_user), false) then
    raise exception 'No such person.' using errcode = '22023';
  end if;

  -- Self is AT your own level, so the rule refuses it. Editing your own NAME is
  -- the documented exception and is handled at that one call site, not here:
  -- admin_update_user_name asks this only when the target is somebody else.
  if p_user = auth.uid() then
    raise exception 'You cannot do this to your own account.' using errcode = '42501';
  end if;

  /* REACH IS NOT CONTAINMENT. Round 7, C.
     app_may_reach_user -- which is what level_rank_of applies, and therefore
     what the ladder below has always been standing on -- is AGENCY-granular:
     it answers "can you see this person", and a branch manager can see the
     whole agency. Containment is `user_within_caller_scope`, and the comment
     on 20261006220000 says so in terms: "Overlap, not containment ... Writing
     is user_within_caller_scope." Seven write RPCs asked the first and none
     asked the second.

     Measured on dev, rolled back, as a manager holding ONE branch position at
     Northgate Central, against a referrer at Northgate West -- a sibling
     branch of the same agency:

       app_may_reach_user        true
       user_within_caller_scope  false
       set_agency_level(target, 'Director')  ->  management, sees_commission

     So a branch-caged manager minted a Director two branches over. The same
     caller is correctly refused by set_receives_notifications, which is the
     one function in this family that asks containment instead of reach.

     Put here rather than in the seven callers because every one of them
     already calls this, and a rule added to seven places is a rule the eighth
     will not have.

     ONLY ON OUR ESTATE. user_within_caller_scope requires the TARGET to hold
     a position, and positions are mandatory only on the house partner
     (20261006300000). On the supplier rail nobody holds one, so applying this
     unconditionally would refuse every supplier manager acting on their own
     staff -- which is backlog B3 arriving early and as a lock. There the
     partner IS the company and partner_id is the containment. */
  if exists (
    select 1 from public.users u
      join public.partners pt on pt.id = u.partner_id
     where u.id = p_user and pt.referencing_mode = 'opndoor_referenced'
  ) and not coalesce(public.user_within_caller_scope(p_user), false) then
    raise exception 'You can only do this for people at or below your own position, in your own part of the agency.'
      using errcode = '42501';
  end if;

  v_target := public.level_rank_of(p_user);
  if v_target is null then
    raise exception 'That person has no agency level, so only opndoor may act on them.' using errcode = '42501';
  end if;

  if v_caller >= v_target then
    raise exception 'You can only do this to someone below your own level.' using errcode = '42501';
  end if;
end $function$;
