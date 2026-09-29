-- WHAT THE SIXTH ROUND FOUND: the ladder, and the door beside it.
--
-- HIGH 2. `authenticated` held table-wide UPDATE on public.users -- all twelve
-- columns, role and sees_commission included -- and both gates on that write
-- read the PRE-IMAGE:
--
--   users_mgmt_update      level_rank_of(id), which reads the OLD row
--   users_level_ladder_guard   may_act_on_user(old.id), explicitly OLD
--
-- So nothing in the path ever looked at the level the row BECOMES, and
-- assert_may_grant_level never ran. Measured on dev, rolled back: as Regent's
-- Manager, `update public.users set role='developer'` on their own Negotiator
-- succeeded. That is the standing ruling -- no developer on the house partner
-- BY ANY PATH -- broken by the one path nobody had closed, and it writes no
-- user_audit row and does not clear receives_commission_statements on a
-- demotion either.
--
-- THE FIX IS THE GRANT, NOT A BETTER TRIGGER. Nothing in this product writes
-- public.users directly: every path is an RPC (admin_update_user_role,
-- set_agency_level, admin_update_user_name, set_user_status,
-- set_receives_notifications, create_invited_user), and every one of them is
-- SECURITY DEFINER owned by the table owner, so none of them needs the
-- authenticated grant. Checked: no `.from('users')` write anywhere in src/, and
-- the only edge-function writes use the service key. The grant was pure
-- surface. A cleverer trigger would leave the surface there and hope the next
-- guard is written correctly.
--
-- INSERT GOES TOO, and for the same reason plus a second: users_mgmt_insert's
-- own role allowlist is `('management','referrer','developer')`, so the INSERT
-- door could seat a developer on the house partner exactly as the UPDATE door
-- could. Nothing uses it; create_invited_user is the way a person is made.
--
-- The policies stay. They are inert without a grant, and leaving them means a
-- future re-grant is still governed rather than wide open.

revoke update on table public.users from authenticated;
revoke insert on table public.users from authenticated;

-- create_invited_user(uuid,text,text,text,uuid,uuid,boolean,text,uuid)
CREATE OR REPLACE FUNCTION public.create_invited_user(p_id uuid, p_email text, p_full_name text, p_role text, p_partner uuid, p_home_branch uuid, p_sees_commission boolean, p_scope_kind text, p_scope_target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_estate boolean; v_level text;
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
  if p_role not in ('management', 'referrer', 'developer') then
    raise exception 'A portal user is a manager, a referrer or a developer.' using errcode = '22023';
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
    raise exception 'Everybody on our estate is invited into a position: a group, a brand or a branch. Choose one.'
      using errcode = '22023';
  end if;

  -- THE LADDER, asked the only way it can be asked about somebody who does
  -- not exist: on the LEVEL they are being given. invite-user asks this too,
  -- before it mints an auth account; asking again here is what makes the
  -- rule a property of the function rather than of one caller.
  v_level := case when p_role = 'referrer' then 'Negotiator'
                  when coalesce(p_sees_commission, false) then 'Director'
                  else 'Manager' end;
  if p_role in ('management', 'referrer') then
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

-- set_agency_group(uuid,uuid)
CREATE OR REPLACE FUNCTION public.set_agency_group(p_agency uuid, p_group uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := auth.uid(); a_pid uuid; g_pid uuid; v_old_group uuid; v_rate numeric; v_name text; v_agr uuid;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select partner_id into a_pid from public.agencies where id = p_agency;
  if a_pid is null then raise exception 'Agency not found' using errcode = '22023'; end if;
  if not coalesce((public.is_admin() or (public.app_role() = 'management' and a_pid = public.app_partner()
                                and public.app_may_reach_agency(p_agency))), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  /* THE GROUP BEING LEFT IS A GROUP TOO. Round 6, HIGH 1. The reach test
     below sits inside `if p_group is not null`, so passing null skipped it
     entirely and an agency- or branch-level manager could detach their own
     agency from its group. That is not a tidy-up: app_scoped_agencies matches
     a group holder only via `a.group_id = s.group_id`, so the group Director
     -- who holds nothing but that group scope -- loses the agency, its
     branches and every person in them from their reach, and app_reachable_group
     then refuses to let anyone at that agency put it back. Only Opndoor can
     reverse it.

     So the caller must reach where it IS as well as where it is going. */
  select group_id into v_old_group from public.agencies where id = p_agency;
  if v_old_group is not null and v_old_group is distinct from p_group then
    if not coalesce((public.is_admin() or public.app_reachable_group(v_old_group, a_pid)), false) then
      raise exception 'You can only move an agency out of a group you hold.' using errcode = '42501';
    end if;
  end if;

  if p_group is not null then
    select partner_id into g_pid from public.agency_groups where id = p_group;
    if g_pid is null then raise exception 'Group not found' using errcode = '22023'; end if;
    if g_pid <> a_pid then raise exception 'The group and the agency are under different partners.' using errcode = '22023'; end if;

    -- THE MISSING TEST, and the only line added to this function.
    if not coalesce((public.is_admin() or public.app_reachable_group(p_group, g_pid)), false) then
      raise exception 'You can only file an agency under a group you hold.' using errcode = '42501';
    end if;

    -- Moving an all-in agency under a group that already charges is the same
    -- breach as adding the charge above it, and touches no rate, so no rate
    -- trigger would see it.
    v_agr := public.active_agreement_on('agency', p_agency);
    if v_agr is not null and (select coverage from public.pricing_agreements where id = v_agr) = 'all_in' then
      select g.agent_rate, g.name into v_rate, v_name from public.agency_groups g where g.id = p_group;
      if v_rate is not null then
        raise exception '%', public.all_in_breach_sentence(
          v_name, v_rate,
          (select name from public.agencies where id = p_agency),
          public.agreement_max_rate(v_agr)) using errcode = '22023';
      end if;
    end if;
  end if;

  update public.agencies set group_id = p_group where id = p_agency;
  insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
  values ('agency', p_agency, 'group_set', coalesce((select name from public.agency_groups where id = p_group), 'detached'),
    coalesce((select full_name from public.users where id = me), 'an administrator'), me);
end $function$;

-- PER COLUMN, because a column-level REVOKE cannot subtract from a table-level
-- GRANT -- the trap 20260811180000 documents and 20261006380000 fell into. The
-- table grant is removed and the columns that carry no authority are granted
-- back by name.
--
-- WRITABLE: full_name and email are governed by users_identity_guard (which
-- refuses an email change by a non-admin and is what several tests assert);
-- receives_notifications by users_notifications_tick_guard; last_active_at is
-- a heartbeat.
--
-- NOT WRITABLE, because each is an authority and has its own door:
--   role, sees_commission        set_agency_level / admin_update_user_role
--   status                       admin_set_user_status
--   home_branch_id               set_home_branch
--   receives_commission_statements  set_receives_commission_statements
--   partner_id, id, created_at   not a thing anybody edits
grant update (full_name, email, last_active_at, receives_notifications)
  on table public.users to authenticated;
