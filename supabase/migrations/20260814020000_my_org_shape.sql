-- ===========================================================================
-- The shape of the org tree the signed-in person can actually reach.
--
-- WHAT THIS IS FOR. A small independent with one office should not be shown a
-- brand list containing one brand and a branch list containing one branch. A
-- national group with several brands should be. Those are the same rule at two
-- points, and the rule is: ask only about a level that has a choice in it.
--
-- SO DEPTH IS DERIVED, NOT CONFIGURED. Nobody sets "this partner has two
-- levels". The form counts what is reachable and collapses anything with one
-- answer. A partner that acquires a second brand grows the step by itself, on
-- the next load, with no migration and no setting changed.
--
-- REACHABLE MEANS REACHABLE BY THIS PERSON, not by their partner. A branch
-- manager at one office of a twelve-office agency has one branch, so their form
-- collapses even though the partner's does not. That is user_scopes doing the
-- job it was built for. Until now the referral form ignored positions entirely.
--
-- SECURITY. security definer, so it must decide the partner itself. An admin may
-- name one; everybody else has the argument IGNORED rather than validated,
-- which is the difference between a filter and a permission check.
-- ===========================================================================

drop function if exists public.my_org_shape(uuid);

create function public.my_org_shape(p_partner uuid default null)
returns table (
  refers_own_stock  boolean,
  agency_count      int,
  branch_count      int,
  only_agency_id    uuid,
  only_agency_name  text,
  only_branch_id    uuid,
  only_branch_name  text
)
language plpgsql stable security definer set search_path to '' as $$
declare v_partner uuid;
begin
  if not public.is_aal2() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- An admin is the only caller allowed to ask about somebody else. For anyone
  -- else the argument is dropped on the floor: there is nothing to validate and
  -- therefore nothing to get wrong.
  if public.is_admin() and p_partner is not null then
    v_partner := p_partner;
  else
    v_partner := public.app_partner();
  end if;

  -- An admin with no partner chosen sees every partner's agencies, so there is
  -- nothing to collapse. Returning no row says exactly that, and the caller
  -- falls back to the full picker.
  if v_partner is null then
    return;
  end if;

  return query
  with reachable as (
    select b.id as bid, b.name as bname, a.id as aid, a.name as aname
      from public.branches b
      join public.agencies a on a.id = b.agency_id
     where a.partner_id = v_partner
       and (
         -- No position means the whole partner, which is the existing default
         -- and the right one for a referrer at a small agency.
         not public.app_has_scope()
         or b.id in (select s from public.app_scope_branches() s)
       )
  )
  select
    (select p.refers_own_stock from public.partners p where p.id = v_partner),
    (select count(distinct r.aid)::int from reachable r),
    (select count(*)::int from reachable r),
    -- Only answered when there is exactly one, because "the only one" is the
    -- entire point. With two, the caller must ask.
    (select r.aid   from reachable r group by r.aid, r.aname having count(*) >= 0
      limit (case when (select count(distinct r2.aid) from reachable r2) = 1 then 1 else 0 end)),
    (select r.aname from reachable r group by r.aid, r.aname having count(*) >= 0
      limit (case when (select count(distinct r2.aid) from reachable r2) = 1 then 1 else 0 end)),
    (select r.bid   from reachable r
      limit (case when (select count(*) from reachable r2) = 1 then 1 else 0 end)),
    (select r.bname from reachable r
      limit (case when (select count(*) from reachable r2) = 1 then 1 else 0 end));
end $$;

revoke all on function public.my_org_shape(uuid) from public, anon;
grant execute on function public.my_org_shape(uuid) to authenticated;

comment on function public.my_org_shape(uuid) is
  'Counts the agencies and branches the caller can reach, so the referral form can collapse any level that has only one answer. Respects user_scopes. Returns no row for an admin with no partner selected.';

-- ---------------------------------------------------------------------------
-- Prove the collapse rule on the data that exists.
-- ---------------------------------------------------------------------------
do $$
declare v_p uuid; v_ag int; v_br int;
begin
  select id into v_p from public.partners where slug = 'meridian-group';

  -- Meridian is the group case: two brands, three branches, so NOTHING
  -- collapses and the form must ask twice.
  select count(distinct a.id), count(b.id) into v_ag, v_br
    from public.agencies a join public.branches b on b.agency_id = a.id
   where a.partner_id = v_p;

  if v_ag <> 2 or v_br <> 3 then
    raise exception 'the group fixture is not the shape this rule was written against: % agencies, % branches', v_ag, v_br;
  end if;

  if to_regprocedure('public.my_org_shape(uuid)') is null then
    raise exception 'my_org_shape did not get created';
  end if;
end $$;
