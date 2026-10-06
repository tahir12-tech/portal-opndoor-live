/* =====================================================================
   THE OPNDOOR TEAM CAN BE INVITED, AND A SUPPLIER'S MANAGEMENT CAN INVITE.

   TWO REFUSALS FROM ONE FUNCTION, both reported on 2026-10-03.

   Matt: "Blocker: Add opndoor team member with 'opndoor manager' selected
   fails with 'A portal user is a manager, a referrer or a developer.' The
   invite path doesn't accept the opndoor manager level."

   That sentence is this function's own, and it was the ONLY thing refusing:
   `invite-user` has had a branch for superadmin and opndoor_manager since it
   was written, which is why the failure read as a level problem rather than a
   missing case. Five roles now, with opndoor's own two admitted only for an
   `is_admin()` caller, with no partner and no position -- each refused by its
   own sentence rather than arriving as a constraint violation.

   AND THE SECOND, FOUND WHILE FIXING THE FIRST: `assert_may_grant_level` was
   asked on every management and referrer invite, including a supplier's. It
   knows three words, Director, Manager and Negotiator, and they are the
   AGENCY ladder. On the supplier rail that translated "Management" into an
   agency level through `sees_commission` -- the defect Matt reported on
   Matthew Dwyer -- and `level_rank_of` is null for a supplier's own people,
   so a supplier's Management inviting a colleague was refused with a sentence
   about a ladder they are not on. invite-user got the same gate the same day;
   this is the half that would have refused anyway.
   ===================================================================== */

CREATE OR REPLACE FUNCTION public.create_invited_user(p_id uuid, p_email text, p_full_name text, p_role text, p_partner uuid, p_home_branch uuid, p_sees_commission boolean, p_scope_kind text, p_scope_target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_estate boolean; v_our_estate boolean; v_level text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  select p.referencing_mode = 'opndoor_referenced' into v_estate
    from public.partners p where p.id = p_partner;
  v_estate := coalesce(v_estate, false);

  if not coalesce((public.is_admin()
          or (public.app_role() = 'management' and p_partner = public.app_partner())), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  /* THE ROLE IS NOT FREE TEXT. Round 6, M3. This function is SECURITY DEFINER
     and granted to authenticated, so it is reachable straight from PostgREST,
     and the level assertion below runs only `if p_role in ('management',
     'referrer')`. Anything else skipped the ladder completely -- so a Manager
     called it with p_role := 'developer' and put a developer on the house
     partner, which the standing ruling forbids BY ANY PATH and which
     admin_update_user_role and invite-user both already refuse. */
  /* FIVE ROLES, NOT THREE. Matt, 2026-10-03: "Add opndoor team member with
     'opndoor manager' selected fails with 'A portal user is a manager, a
     referrer or a developer.' The invite path doesn't accept the opndoor
     manager level. Fix it so both opndoor admin and opndoor manager can be
     invited."

     THE ALLOWLIST WAS WRITTEN FOR A PARTNER'S PEOPLE and the opndoor team
     page calls the same door. invite-user has handled both roles since it was
     written -- there is a branch for them four lines into its admin arm -- so
     the refusal came from here and nowhere else, which is why it read as a
     level problem rather than a missing case.

     AND THEY ARE OPNDOOR'S OWN SEATS, so only Opndoor may create one. The
     permission test above admits a partner's management for their own
     partner; without this they could ask for a superadmin. */
  if p_role not in ('management', 'referrer', 'developer', 'superadmin', 'opndoor_manager') then
    raise exception 'A portal user is a manager, a referrer, a developer, an opndoor admin or an opndoor manager.' using errcode = '22023';
  end if;
  if p_role in ('superadmin', 'opndoor_manager') then
    if not coalesce(public.is_admin(), false) then
      raise exception 'Only opndoor can add somebody to the opndoor team.' using errcode = '42501';
    end if;
    /* NO PARTNER, which users_partner_by_role enforces as a CHECK -- said here
       so the refusal names the reason instead of arriving as a constraint
       violation. */
    if p_partner is not null then
      raise exception 'An opndoor admin or manager belongs to no supplier or agency.' using errcode = '22023';
    end if;
    /* AND NO POSITION. A position is a place on our agency estate; opndoor's
       own staff sit above all of it, which is why assert_may_act_on_user
       exempts them. */
    if p_scope_kind is not null or p_scope_target is not null then
      raise exception 'An opndoor admin or manager holds no position at an agency.' using errcode = '22023';
    end if;
  end if;
  if v_estate and p_role = 'developer' then
    raise exception 'There is no developer on our own estate.' using errcode = '42501';
  end if;

  /* AND THE HOME BRANCH IS A PLACEMENT. Round 6, M4. 20261006500000 bound
     home_branch_id on the users_mgmt_insert policy and noted that rows made
     here are unaffected, because a definer function owned by the table owner
     does not meet the policy. That was true and was the gap: this door did no
     branch test of its own, so a Manager could place an invitee at any branch
     on the estate. set_home_branch checks both ends; so does this now. */
  if p_home_branch is not null
     and not coalesce(public.is_admin(), false)
     and not coalesce(public.app_may_reach_branch(p_home_branch), false) then
    raise exception 'You can only place somebody at a branch you reach.' using errcode = '42501';
  end if;

  if v_estate and (p_scope_kind is null or p_scope_target is null) then
    raise exception 'Choose which branch, brand or agency this person works at. Everyone needs one before they can be invited.'
      using errcode = '22023';
  end if;

  -- THE LADDER, asked the only way it can be asked about somebody who does
  -- not exist: on the LEVEL they are being given. invite-user asks this too,
  -- before it mints an auth account; asking again here is what makes the
  -- rule a property of the function rather than of one caller.
  v_level := case when p_role = 'referrer' then 'Negotiator'
                  when coalesce(p_sees_commission, false) then 'Director'
                  else 'Manager' end;
  /* OUR OWN ESTATE ONLY, 2026-10-03, and this is the SQL half of the same
     correction invite-user got the same day.

     `assert_may_grant_level` knows exactly three words -- Director, Manager,
     Negotiator -- and they are the AGENCY ladder. A supplier's rail has no
     such ladder: its levels are Management, Referrer and Developer, and which
     of them a caller may grant is decided by the partner's kind, not by a
     rank. Running it on a supplier invite did two wrong things at once:

       it translated "Management" into an agency level through
       `sees_commission`, which is how supplier Management came to be created
       as a "Manager" -- the defect Matt reported on Matthew Dwyer; and

       `level_rank_of` is null for a supplier's own people, who hold no
       position, so a supplier's Management inviting a colleague was refused
       with "You can only give someone a level at or below your own", a
       sentence about a ladder they are not on.

     `partner_kind`, NOT `referencing_mode`: the question is what the partner
     IS. `v_estate` above still reads the mode and is left alone deliberately
     -- it gates the developer refusal and the position requirement, both of
     which are correct today and neither of which was reported -- but the two
     agree for every partner we hold, and the mode version is listed for
     After launch. */
  select p.partner_kind = 'agency' into v_our_estate
    from public.partners p where p.id = p_partner;
  v_our_estate := coalesce(v_our_estate, false);
  if v_our_estate and p_role in ('management', 'referrer') then
    perform public.assert_may_grant_level(v_level);
  end if;

  if p_scope_kind is not null then
    perform public.assert_may_grant_position(p_scope_kind, p_scope_target);
  end if;

  insert into public.users (id, email, full_name, role, partner_id, status,
                            home_branch_id, sees_commission)
  values (p_id, p_email, p_full_name, p_role, p_partner, 'pending',
          p_home_branch, p_role = 'management' and coalesce(p_sees_commission, false));

  if p_scope_kind is not null then
    insert into public.user_scopes (user_id, kind, group_id, agency_id, branch_id, created_by)
    values (p_id, p_scope_kind,
            case when p_scope_kind = 'group'  then p_scope_target end,
            case when p_scope_kind = 'agency' then p_scope_target end,
            case when p_scope_kind = 'branch' then p_scope_target end,
            auth.uid());
    insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
    values ('user', p_id, 'position_set', p_scope_kind || ':' || p_scope_target::text,
            (select full_name from public.users where id = auth.uid()), auth.uid());
  end if;
end $function$;
