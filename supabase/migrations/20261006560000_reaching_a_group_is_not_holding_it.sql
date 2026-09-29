-- REACHING A GROUP IS NOT HOLDING IT.
--
-- 20261006550000 closed round 6's HIGH 1 -- an agency manager detaching their
-- own agency from its group, which silently removes it, its branches and all
-- its people from the group Director's reach -- by asking
-- app_reachable_group about the group being LEFT.
--
-- That predicate is the wrong one for leaving. Its second arm is "the group
-- sitting above an agency you reach", which is exactly right when FILING an
-- agency into a group (you must be able to see where it is going) and exactly
-- wrong when taking one out: every manager inside the group satisfies it,
-- including the one whose detachment the finding is about. The test written
-- against the fix caught it immediately -- the manager detached and no
-- exception was raised.
--
-- Leaving asks for the group position itself. The person who loses authority
-- is the group's Director, so it is theirs to give up, or Opndoor's.

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
    /* HOLD THE GROUP, not merely reach it. app_reachable_group admits "the
       group sitting above an agency you reach", which is right for filing an
       agency INTO a group and wrong for taking one out: the person who loses
       authority is the group's own Director, and an agency manager inside the
       group satisfies that predicate. So leaving asks for the group position
       itself. */
    if not coalesce((public.is_admin()
         or exists (select 1 from public.user_scopes s
                     where s.user_id = auth.uid() and s.kind = 'group'
                       and s.group_id = v_old_group)), false) then
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
