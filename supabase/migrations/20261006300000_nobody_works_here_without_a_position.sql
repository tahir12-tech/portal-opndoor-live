-- NOBODY WORKS HERE WITHOUT A POSITION.
--
-- Two independent reviews landed on the same root cause from opposite ends.
-- Every fail-open on the people surface has the same shape:
--
--     case when app_has_scope() then <the real test> else true end
--     not public.app_has_scope() or public.app_user_in_scope(id)
--
-- which reads as "narrow this for a positioned caller, and for an unpositioned
-- one there is nothing to narrow by, so allow". On the supplier rail that was
-- harmless, because partner_id was a company. On our own estate the partner is
-- a ROUTE shared by every agency we onboard, so "allow" means every competitor
-- on the route.
--
-- The instinct is to fix each site. That leaves the class alive: the next
-- predicate written against a caller who might hold no position will reach for
-- the same `or true`, because the alternative -- locking a real colleague out
-- of their own screen -- looks worse at the moment of writing.
--
-- So remove the state instead. On OUR estate every person holds a position,
-- always, and an unpositioned row cannot be committed. Then `not
-- app_has_scope()` is not a case to handle, it is a contradiction, and the
-- 20261006310000 migration that strips every one of those arms is removing
-- dead code rather than trading safety for strictness.
--
-- Scoped to our estate deliberately. On the supplier rail partner_id IS the
-- company boundary, a supplier's management genuinely sits above all of their
-- own agencies, and requiring a position there would be ceremony with no
-- boundary behind it.

-- ===========================================================================
-- 1. BACKFILL, THEN REFUSE
-- ===========================================================================
-- Every negotiator on our estate already has a location: home_branch_id, the
-- branch they were invited into. 20261005230000 read that column directly
-- instead of writing the position down, which is what made a profile field
-- load-bearing. Write it down now, as the position it always was.
insert into public.user_scopes (user_id, kind, branch_id, created_by)
select u.id, 'branch', u.home_branch_id, null
from public.users u
join public.partners p on p.id = u.partner_id
where p.referencing_mode = 'opndoor_referenced'
  and u.home_branch_id is not null
  and not exists (select 1 from public.user_scopes s where s.user_id = u.id);

-- And refuse to leave the database in a state the guard below would reject.
-- A migration that installs a rule half the rows already break is a migration
-- that gets disabled at 3am on the Monday, so it fails here instead, naming
-- the people who need placing.
do $backfill$
declare stragglers text;
begin
  select string_agg(u.email || ' (' || u.role || ', ' || u.status || ')', ', ')
    into stragglers
  from public.users u
  join public.partners p on p.id = u.partner_id
  where p.referencing_mode = 'opndoor_referenced'
    and u.role in ('management', 'referrer')
    and u.status in ('active', 'pending')
    and not exists (select 1 from public.user_scopes s where s.user_id = u.id);
  if stragglers is not null then
    raise exception
      'These people on our estate hold no position and have no home branch to derive one from, so they cannot be placed automatically: %. Place them, then re-run.',
      stragglers using errcode = '23514';
  end if;
end $backfill$;

-- ===========================================================================
-- 2. THE GUARD
-- ===========================================================================
-- DEFERRED, because a person and their position are two rows and the insert
-- order between them is nobody's business but the caller's. Checked at commit,
-- so create_invited_user below can write both and neither ordering fails.
create or replace function public.user_must_hold_a_position()
returns trigger
language plpgsql security definer set search_path to ''
as $function$
declare
  v_user uuid;
  u public.users;
begin
  /* RESOLVED IN THE BODY, NOT IN THE DECLARATION, and that is not style.
     plpgsql prepares a declaration's initialiser as one SQL statement and
     resolves every field reference in it up front, so
       case tg_table_name when 'users' then new.id else old.user_id end
     fails with "record old has no field user_id" the moment this fires on
     public.users -- the CASE never gets the chance to short-circuit. The
     repro suite found it: the users arm had not been exercised, because the
     only test that reached it died on a foreign key first. */
  if tg_table_name = 'users' then
    v_user := coalesce(new.id, old.id);
  else
    v_user := coalesce(new.user_id, old.user_id);
  end if;

  select * into u from public.users where id = v_user;
  -- Deleted outright in the same transaction: nothing left to place.
  if not found then return coalesce(new, old); end if;

  if not exists (select 1 from public.partners p
                  where p.id = u.partner_id and p.referencing_mode = 'opndoor_referenced') then
    return coalesce(new, old);
  end if;
  if u.role not in ('management', 'referrer') or u.status not in ('active', 'pending') then
    return coalesce(new, old);
  end if;
  if exists (select 1 from public.user_scopes s where s.user_id = v_user) then
    return coalesce(new, old);
  end if;

  raise exception
    'Everybody on our estate holds a position: a group, a brand or a branch. % has none, so there is nothing to scope what they see. Give them a position, or deactivate them.',
    coalesce(u.email, v_user::text)
    using errcode = '23514';
end $function$;

comment on function public.user_must_hold_a_position() is
  'On our own estate a person with no position is a person with no boundary, because partner_id is a route and not a company. Deferred to commit so a person and their position may be written in either order.';

drop trigger if exists users_must_hold_a_position on public.users;
create constraint trigger users_must_hold_a_position
  after insert or update of role, status, partner_id on public.users
  deferrable initially deferred
  for each row execute function public.user_must_hold_a_position();

-- The other end: removing somebody's last position is the same state arrived
-- at backwards, and Team's "Remove position" button is exactly that gesture.
drop trigger if exists user_scopes_must_leave_a_position on public.user_scopes;
create constraint trigger user_scopes_must_leave_a_position
  after delete or update on public.user_scopes
  deferrable initially deferred
  for each row execute function public.user_must_hold_a_position();

-- ===========================================================================
-- 3. ONE TRANSACTION FOR A PERSON AND THEIR POSITION
-- ===========================================================================
-- invite-user wrote the user row with the service client and then granted the
-- position through a second call, rolling the account back by hand if the
-- grant was refused. Two transactions cannot satisfy a deferred constraint,
-- and the hand-rolled compensation was the only thing standing between a
-- refused grant and an unpositioned account.
--
-- Called AS THE INVITER, not as service_role, so every ladder check below is
-- the inviter's. It is definer only so that it may write public.users at all.
create or replace function public.create_invited_user(
  p_id uuid, p_email text, p_full_name text, p_role text, p_partner uuid,
  p_home_branch uuid, p_sees_commission boolean,
  p_scope_kind text, p_scope_target uuid
) returns void
language plpgsql security definer set search_path to ''
as $function$
declare v_estate boolean;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  select p.referencing_mode = 'opndoor_referenced' into v_estate
    from public.partners p where p.id = p_partner;
  v_estate := coalesce(v_estate, false);

  if not (public.is_admin()
          or (public.app_role() = 'management' and p_partner = public.app_partner())) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- On our estate a position is not optional, and saying so here gives the
  -- caller a sentence rather than a deferred constraint violation at commit.
  if v_estate and (p_scope_kind is null or p_scope_target is null) then
    raise exception 'Everybody on our estate is invited into a position: a group, a brand or a branch. Choose one.'
      using errcode = '22023';
  end if;

  insert into public.users (id, email, full_name, role, partner_id, status,
                            home_branch_id, sees_commission)
  values (p_id, p_email, p_full_name, p_role, p_partner, 'pending',
          p_home_branch, p_role = 'management' and coalesce(p_sees_commission, false));

  if p_scope_kind is not null then
    -- The ladder, the containment test and the audit row all live in
    -- set_user_scope and are not restated here.
    perform public.set_user_scope(p_id, p_scope_kind, p_scope_target);
  end if;
end $function$;

comment on function public.create_invited_user(uuid,text,text,text,uuid,uuid,boolean,text,uuid) is
  'Creates an invited person AND their position in one transaction, as the inviter. Replaces a service-role insert followed by a separate grant with a hand-rolled rollback between them.';

revoke all on function public.create_invited_user(uuid,text,text,text,uuid,uuid,boolean,text,uuid) from public, anon;
grant execute on function public.create_invited_user(uuid,text,text,text,uuid,uuid,boolean,text,uuid) to authenticated, service_role;

-- ===========================================================================
-- 4. AND THE GRANT PATH ITSELF STOPS FAILING OPEN
-- ===========================================================================
-- set_user_scope carried the same arm: an unpositioned manager could place
-- anybody anywhere on the partner, which is how an unpositioned account turned
-- into a positioned one in somebody else's agency.
create or replace function public.set_user_scope(p_user uuid, p_kind text, p_target uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare v_target public.users;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_kind not in ('group','agency','branch') then
    raise exception 'A position is a group, a brand or a branch.' using errcode = '22023';
  end if;

  select * into v_target from public.users where id = p_user;
  if not found then raise exception 'User not found' using errcode = '22023'; end if;

  -- Only a group or agency position can grant positions, and only within the
  -- partner. A branch manager granting positions would be a way out of the
  -- branch. WAS: `not public.app_has_scope() or exists (...)`, so a manager
  -- holding no position at all skipped the test entirely.
  if not (
    public.is_admin()
    or (
      public.app_role() = 'management'
      and v_target.partner_id = public.app_partner()
      and exists (select 1 from public.user_scopes s
                   where s.user_id = auth.uid() and s.kind in ('group','agency'))
    )
  ) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  perform public.assert_may_act_on_user(p_user);

  -- A granter may only grant a position landing entirely inside their own
  -- branch set. Admins are unrestricted; an unpositioned manager no longer
  -- reaches this line at all, so there is no third case.
  if not public.is_admin() then
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
  end if;

  delete from public.user_scopes where user_id = p_user;
  insert into public.user_scopes (user_id, kind, group_id, agency_id, branch_id, created_by)
  values (p_user, p_kind,
          case when p_kind = 'group'  then p_target end,
          case when p_kind = 'agency' then p_target end,
          case when p_kind = 'branch' then p_target end,
          auth.uid());

  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values ('user', p_user, 'position_set', p_kind || ':' || p_target::text,
          (select full_name from public.users where id = auth.uid()), auth.uid());
end $function$;
