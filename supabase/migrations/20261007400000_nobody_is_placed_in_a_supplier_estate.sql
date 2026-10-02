-- =========================================================================
-- NOBODY IS EVER PLACED IN A SUPPLIER'S ESTATE.
--
-- Matt, 2026-10-02, deciding the question left for him overnight:
--
--   "Nobody is ever positioned at an agency or branch in a supplier's
--    estate. A supplier's own staff sit at the supplier level only (they
--    choose the agency and branch on each referral, but are never
--    positioned there), and supplier-estate agencies never get logins.
--    Enforce it: refuse any position or invite that would place someone
--    at a supplier-estate agency or branch."
--
-- I had written this rule the night before and backed it out, because it
-- broke two fixtures that modelled a supplier's referrer sitting at a
-- branch. Those fixtures were the thing that was wrong; they are rewritten
-- in the same commit.
--
-- THREE DOORS, AND ALL THREE ARE SHUT.
--
--   1. `user_scopes` itself, with a trigger. It is the backstop: every
--      path that places somebody writes a row here, `set_user_scope` and
--      `create_invited_user` included, and a rule on the table cannot be
--      gone round by a new caller nobody has written yet.
--   2. `assert_may_grant_position`, so the INVITE refuses with the reason
--      before it has created an account. A backstop that fires after the
--      auth user exists is a correct refusal and a bad experience.
--   3. `users.home_branch_id`, which is the other half of "placed".
--      Matt's sentence is "sit at the supplier level only"; a home branch
--      is where the product says somebody works, and it is printed on
--      every people list. A supplier's referrer with a home branch inside
--      the supplier's estate is exactly the shape being ruled out, and it
--      is what the `tenant_isolation` fixture had.
--
-- 22023, NOT 42501, in all three. This is a rule about the shape of the
-- estate and not about who is asking: it fires for an Opndoor admin, for
-- the service role and for postgres exactly as it fires for anybody.
-- Reserving 42501 for authorisation is what lets
-- src/data/testsRunAsTheirRole.test.ts tell the two apart.
--
-- NOTHING ON DEV BREAKS: measured before writing, 0 positions and 0 home
-- branches sit in a supplier estate today.
-- =========================================================================

-- ---------------------------------------------------------------------------
-- 1. THE POSITION.
-- ---------------------------------------------------------------------------
create or replace function public.user_scopes_not_in_a_supplier_estate()
returns trigger
language plpgsql security definer set search_path to ''
as $$
declare v_partner uuid; v_name text;
begin
  if new.agency_id is not null then
    select a.partner_id, a.name into v_partner, v_name
      from public.agencies a where a.id = new.agency_id;
  elsif new.branch_id is not null then
    select b.partner_id, b.name into v_partner, v_name
      from public.branches b where b.id = new.branch_id;
  elsif new.group_id is not null then
    select g.partner_id, g.name into v_partner, v_name
      from public.agency_groups g where g.id = new.group_id;
  else
    return new;
  end if;

  if coalesce(public.is_supplier_estate(v_partner), false) then
    raise exception
      'Agencies that come through a supplier do not have logins, so nobody can be positioned at %. A supplier''s own people sit at the supplier.', v_name
      using errcode = '22023';
  end if;
  return new;
end $$;

revoke all on function public.user_scopes_not_in_a_supplier_estate() from public, anon, authenticated;

drop trigger if exists user_scopes_not_in_a_supplier_estate on public.user_scopes;
create trigger user_scopes_not_in_a_supplier_estate
  before insert or update on public.user_scopes
  for each row execute function public.user_scopes_not_in_a_supplier_estate();

-- ---------------------------------------------------------------------------
-- 2. THE HOME BRANCH, which is the other half of being placed somewhere.
-- ---------------------------------------------------------------------------
create or replace function public.home_branch_not_in_a_supplier_estate()
returns trigger
language plpgsql security definer set search_path to ''
as $$
declare v_partner uuid; v_name text;
begin
  if new.home_branch_id is null then return new; end if;
  -- Only when it CHANGES, so a row that already carries one can still be
  -- edited for anything else. There are none on dev; this is about the
  -- row that somebody imports later.
  if tg_op = 'UPDATE' and new.home_branch_id is not distinct from old.home_branch_id then
    return new;
  end if;

  select b.partner_id, b.name into v_partner, v_name
    from public.branches b where b.id = new.home_branch_id;

  if coalesce(public.is_supplier_estate(v_partner), false) then
    raise exception
      'Agencies that come through a supplier do not have logins, so nobody works at %. A supplier''s own people sit at the supplier.', v_name
      using errcode = '22023';
  end if;
  return new;
end $$;

revoke all on function public.home_branch_not_in_a_supplier_estate() from public, anon, authenticated;

drop trigger if exists home_branch_not_in_a_supplier_estate on public.users;
create trigger home_branch_not_in_a_supplier_estate
  before insert or update on public.users
  for each row execute function public.home_branch_not_in_a_supplier_estate();

-- ---------------------------------------------------------------------------
-- 3. AND THE INVITE SAYS SO FIRST. Regenerated from its definition in
--    20261006470000 with the estate test added above the admin
--    short-circuit; everything else is as it was, comments included.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_may_grant_position(p_kind text, p_target uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_partner uuid;
begin
  if p_kind not in ('group','agency','branch') then
    raise exception 'A position is a group, a brand or a branch.' using errcode = '22023';
  end if;
  if p_target is null then
    raise exception 'Choose the group, brand or branch for this position.' using errcode = '22023';
  end if;

  /* AND NOT IN A SUPPLIER'S ESTATE, WHOEVER IS ASKING. Matt, 2026-10-02:
     "Nobody is ever positioned at an agency or branch in a supplier's
     estate. A supplier's own staff sit at the supplier level only (they
     choose the agency and branch on each referral, but are never
     positioned there), and supplier-estate agencies never get logins."

     ABOVE the admin short-circuit, because this is not about reach. An
     Opndoor admin reaches every estate and must still not do this; the
     rule is about the shape of the estate, not about the caller's part
     of the business. The trigger on user_scopes is the backstop that
     cannot be gone round; this is here so the INVITE refuses with the
     reason before it has created anybody. */
  select coalesce(a.partner_id, b.partner_id, g.partner_id) into v_partner
    from (select 1) one
    left join public.agencies a      on p_kind = 'agency' and a.id = p_target
    left join public.branches b      on p_kind = 'branch' and b.id = p_target
    left join public.agency_groups g on p_kind = 'group'  and g.id = p_target;
  if coalesce(public.is_supplier_estate(v_partner), false) then
    raise exception 'Agencies that come through a supplier do not have logins, so nobody can be placed at one. A supplier''s own people sit at the supplier.'
      using errcode = '22023';
  end if;

  if public.is_admin() then return; end if;

  -- Only a group or agency position can grant positions at all. A branch
  -- manager granting one would be a way out of the branch they were given.
  if not coalesce(exists (select 1 from public.user_scopes s
                  where s.user_id = auth.uid() and s.kind in ('group','agency')), false) then
    raise exception 'Only a brand or group manager places people.' using errcode = '42501';
  end if;

  -- THE TARGET ITSELF. This is the arm that was missing, and it is the one
  -- that answers for a target with nothing under it yet.
  if p_kind = 'agency' then
    if not coalesce(public.app_may_reach_agency(p_target), false) then
      raise exception 'You can only place somebody inside your own part of the business.' using errcode = '42501';
    end if;
  elsif p_kind = 'branch' then
    if not coalesce(public.app_may_reach_branch(p_target), false) then
      raise exception 'You can only place somebody inside your own part of the business.' using errcode = '42501';
    end if;
  else
    select partner_id into v_partner from public.agency_groups where id = p_target;
    if v_partner is null then raise exception 'Group not found' using errcode = '22023'; end if;
    if not coalesce(public.app_reachable_group(p_target, v_partner), false) then
      raise exception 'You can only place somebody inside your own part of the business.' using errcode = '42501';
    end if;
  end if;

  -- AND the branch set below it, unchanged. A group I hold that has grown a
  -- branch I do not is still a position I may not hand out.
  if exists (
    select 1 from (
      select b.id from public.agencies a
       join public.branches b on b.agency_id = a.id
      where p_kind = 'agency' and a.id = p_target
      union all
      select b.id from public.agency_groups g
       join public.agencies a on a.group_id = g.id
       join public.branches b on b.agency_id = a.id
      where p_kind = 'group' and g.id = p_target
      union all
      select p_target where p_kind = 'branch'
    ) granted(branch_id)
    where granted.branch_id not in (select public.app_scope_branches())
  ) then
    raise exception 'You can only place somebody inside your own part of the business.'
      using errcode = '42501';
  end if;
end $function$;

-- ---------------------------------------------------------------------------
-- 4. AND NOTHING ALREADY PLACED BREAKS THE RULE.
-- ---------------------------------------------------------------------------
do $$
declare v_scopes int; v_homes int;
begin
  select count(*) into v_scopes
  from public.user_scopes s
  left join public.agencies a      on a.id = s.agency_id
  left join public.branches b      on b.id = s.branch_id
  left join public.agency_groups g on g.id = s.group_id
  where public.is_supplier_estate(coalesce(a.partner_id, b.partner_id, g.partner_id));

  select count(*) into v_homes
  from public.users u join public.branches b on b.id = u.home_branch_id
  where public.is_supplier_estate(b.partner_id);

  if v_scopes > 0 or v_homes > 0 then
    raise exception '% positions and % home branches sit in a supplier estate', v_scopes, v_homes;
  end if;
end $$;
