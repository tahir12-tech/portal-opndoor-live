/* =====================================================================
   SUPPLIER MANAGEMENT SEES ITS OWN COMMISSION, IN THE ROW AND NOT ONLY
   IN THE DIALOG.

   Matt, 2026-10-03: "Fix the supplier invite, and fix View as to read the
   viewed person's access, not the admin's. Tell me which existing supplier
   users would be affected on live."

   TWO THINGS, AND THE SECOND IS THE ONE THAT WAS MISSING. The invite was
   fixed the same day in two places -- the client's SUPPLIER_LEVELS now passes
   seesCommission true, and 20261007830000 stopped the agency ladder refusing
   the call -- but `create_invited_user` still took the flag from whoever
   called it, and the rows the defect had ALREADY written were left as they
   were. The session reads the signed-in user's own `sees_commission` straight
   off their row (SessionContext, resolve()), so those people go on seeing no
   Commission payable tile and no statements however the invite behaves now.

   MEASURED ON DEV BEFORE CHANGING ANYTHING, which is the answer to Matt's
   question about live. Supplier-partner users by level and flag:

     management, sees_commission = false   2   joe@bloggs.com (active)
                                               test@kestrel.com (active)
     management, sees_commission = true    2   director@kestrel.dev.test (active)
                                               123@opndoor.co (pending)
     developer,  sees_commission = false   1   something@bloggs.com (active)

   So on dev it is two active Kestrel Management users, one of them the
   Matthew Dwyer account Matt reported it from. The same query run on live
   names whoever it is there; this migration corrects them when it is applied,
   whichever they turn out to be.

   THE DEVELOPER IS LEFT ALONE, deliberately: "Developer: uses the Dev Centre
   and API; no commission" is Matt's own description of that level.

   THE AGENCY RAIL IS NOT TOUCHED. There, management with the flag off is a
   MANAGER -- a real level, chosen on purpose -- and the flag is the only thing
   that tells a Manager from a Director. Backfilling it there would promote
   every Manager in the product.
   ===================================================================== */

CREATE OR REPLACE FUNCTION public.create_invited_user(p_id uuid, p_email text, p_full_name text, p_role text, p_partner uuid, p_home_branch uuid, p_sees_commission boolean, p_scope_kind text, p_scope_target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_estate boolean; v_our_estate boolean; v_supplier boolean; v_level text;
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
  select p.partner_kind = 'agency', p.partner_kind = 'supplier'
    into v_our_estate, v_supplier
    from public.partners p where p.id = p_partner;
  v_our_estate := coalesce(v_our_estate, false);
  v_supplier := coalesce(v_supplier, false);
  if v_our_estate and p_role in ('management', 'referrer') then
    perform public.assert_may_grant_level(v_level);
  end if;

  if p_scope_kind is not null then
    perform public.assert_may_grant_position(p_scope_kind, p_scope_target);
  end if;

  /* AND ON THE SUPPLIER RAIL, MANAGEMENT IS THE TOP AND SEES COMMISSION.

     Matt, 2026-10-03: "I invited Matthew Dwyer as 'Management' from Kestrel's
     own Add user dialog, whose only options are Management, Referrer and
     Developer. So supplier 'Management' invited that way gets
     sees_commission = false, which is the defect: supplier Management must
     see commission."

     FORCED HERE AND NOT TRUSTED FROM THE CALLER, which is the half 20261007830000
     left undone. That migration stopped the AGENCY ladder refusing a supplier's
     invite, and the flag went on being whatever the caller sent -- so the client
     passing `seesCommission: true` fixed the dialog Matt used and nothing else.
     Every other door to this function (the edge function, a replayed request, an
     older bundle still in somebody's tab) could still create a supplier's
     Management blind to their own commission, and the screen would be right about
     a row that was wrong.

     IT IS NOT A DEFAULT, it is the rail. The agency ladder has two management
     levels and the flag is what tells them apart, which is why that arm still
     reads the caller. A supplier's rail has ONE: Management, Referrer,
     Developer. There is no supplier Manager to be, so there is nothing for a
     false to mean except a mistake. */
  insert into public.users (id, email, full_name, role, partner_id, status,
                            home_branch_id, sees_commission)
  values (p_id, p_email, p_full_name, p_role, p_partner, 'pending',
          p_home_branch,
          p_role = 'management'
            and (v_supplier or coalesce(p_sees_commission, false)));

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


/* =====================================================================
   AND THE ROWS THE DEFECT ALREADY WROTE.

   NARROWED TO THE SUPPLIER RAIL by the partner's own kind, which is the
   fact that means it. `referencing_mode` would have read the same on every
   partner we hold today and would be wrong the first time a supplier is set
   to "opndoor referenced".

   THE CAPABILITY SETTING, because `users_commission_capability_is_admin_only`
   refuses a change to this column unless it is on. A migration runs as
   postgres, which that trigger exempts, so this is belt and braces -- and it
   is the documented way to touch the column, so it is how it is touched.

   RECORDED, because it is an access change and Recent changes is where access
   changes are read. Actor 'opndoor' rather than a person: nobody did this, a
   correction did, and inventing an actor would put a name on it that was not
   there.
   ===================================================================== */
select set_config('app.setting_commission_capability', 'on', true);

insert into public.user_audit (target_user, partner_id, action, old_value, new_value, actor)
select u.id, u.partner_id, 'level', 'Management (no commission)', 'Management', 'opndoor'
  from public.users u
  join public.partners p on p.id = u.partner_id
 where p.partner_kind = 'supplier'
   and u.role = 'management'
   and coalesce(u.sees_commission, false) = false;

update public.users u
   set sees_commission = true
  from public.partners p
 where p.id = u.partner_id
   and p.partner_kind = 'supplier'
   and u.role = 'management'
   and coalesce(u.sees_commission, false) = false;

select set_config('app.setting_commission_capability', 'off', true);
