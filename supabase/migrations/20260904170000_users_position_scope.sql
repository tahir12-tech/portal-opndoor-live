-- Enforce the position ladder on the USERS / team surface, at the boundary.
--
-- THE LEAK. The Users screen reads the SECURITY DEFINER RPC list_managed_users,
-- which returned every colleague in the (shared) partner to a scoped manager, and
-- the user-action RPCs (reset MFA, set status, rename, change role) gated only on
-- partner, so a manager could act on any colleague by uuid. Tightening the RLS
-- users_select policy alone would NOT fix the screen, because it reads the definer
-- RPC. So both the RPC and the policies are scoped here.
--
-- "STAFF IN MY BRANCHES" has no canonical meaning (public.users carries no
-- branch_id). The rule chosen, encoded once in app_user_in_scope() and reused by
-- every read and action:
--   self                                            -> always visible
--   a referrer who has REFERRED into one of my branches
--   a colleague ATTACHED (user_agency_attachments) to one of my branches
--   a manager whose OWN position OVERLAPS mine       -> my brand/group head up the
--     chain is visible; a competing agency's managers never overlap, so never appear
-- Overlap (not subset) keeps the chain of command visible without surfacing a
-- competitor. A brand-new user with no activity, attachment or position is not yet
-- placed and stays invisible to a scoped manager until their first referral; admins
-- and unscoped managers always see everyone (fail-open on the unscoped branch).
--
-- PRESERVED: unscoped management (no user_scopes) sees/acts on the whole partner
-- (the `not app_has_scope()` branch of every CASE); referrer sees only self;
-- developer keeps partner breadth; superadmin/is_admin sees all; the self-service,
-- last-admin and role-model guards in the action RPCs are untouched; the Rightmove
-- referral path does not pass through any of this. Additive: new function/policy
-- versions only. Verified by impersonation after apply (user_scopes is populated on
-- dev, so the old empty-user_scopes assertion is replaced by that end-to-end check).

-- ---- helpers ----
-- The scope->branch expansion, parameterised by user (app_scope_branches() is the
-- auth.uid() case; this is the same union for an arbitrary target, used to test
-- whether another manager's position overlaps the caller's).
create or replace function public.app_scope_branches_for(p_user uuid)
 returns setof uuid language sql stable security definer set search_path to ''
as $function$
  select b.id from public.user_scopes s
  join public.agencies a on a.group_id = s.group_id
  join public.branches b on b.agency_id = a.id
  where s.user_id = p_user and s.kind = 'group'
  union
  select b.id from public.user_scopes s
  join public.branches b on b.agency_id = s.agency_id
  where s.user_id = p_user and s.kind = 'agency'
  union
  select s.branch_id from public.user_scopes s
  where s.user_id = p_user and s.kind = 'branch'
$function$;
revoke all on function public.app_scope_branches_for(uuid) from public, anon;
grant execute on function public.app_scope_branches_for(uuid) to authenticated, service_role;

-- Is target user p_user inside the CALLER's position? Self, or (holding a position)
-- a referrer/colleague located in my branches, or a manager whose scope overlaps mine.
create or replace function public.app_user_in_scope(p_user uuid)
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select p_user = auth.uid()
    or (public.app_has_scope() and (
         exists (select 1 from public.applications a
                  where a.referrer_id = p_user
                    and a.branch_id in (select public.app_scope_branches()))
      or exists (select 1 from public.user_agency_attachments ua
                  join public.branches b on b.agency_id = ua.agency_id
                  where ua.user_id = p_user
                    and b.id in (select public.app_scope_branches()))
      or exists (select 1 from public.app_scope_branches_for(p_user) x
                  where x in (select public.app_scope_branches()))
    ));
$function$;
revoke all on function public.app_user_in_scope(uuid) from public, anon;
grant execute on function public.app_user_in_scope(uuid) to authenticated, service_role;

-- ---- list_managed_users: the Users screen read (definer, bypasses RLS) ----
create or replace function public.list_managed_users()
 returns table(id uuid, full_name text, email text, role text, status text, partner_slug text, last_sign_in_at timestamp with time zone, has_mfa boolean)
 language sql stable security definer set search_path to ''
as $function$
  select u.id, u.full_name, u.email, u.role, u.status,
         p.slug as partner_slug,
         au.last_sign_in_at,
         exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified') as has_mfa
  from public.users u
  left join public.partners p on p.id = u.partner_id
  left join auth.users au on au.id = u.id
  where public.is_aal2()
    and (public.is_admin()
         or (public.app_role() = 'management' and u.partner_id = public.app_partner()
             and (not public.app_has_scope() or public.app_user_in_scope(u.id)))
         or u.id = auth.uid());
$function$;

-- ---- users_select (RLS): keep the referrer-name embed / direct reads in step ----
drop policy if exists users_select on public.users;
create policy users_select on public.users for select to authenticated
using (
  public.is_admin()
  or (public.app_role() = 'management' and partner_id = public.app_partner()
      and (not public.app_has_scope() or public.app_user_in_scope(id)))
  or (public.app_role() = 'developer' and partner_id = public.app_partner())
  or (id = auth.uid())
);

-- ---- user_scopes_select (RLS): the "Sees" column narrows with the list ----
drop policy if exists user_scopes_select on public.user_scopes;
create policy user_scopes_select on public.user_scopes for select to authenticated
using (
  public.is_admin()
  or (user_id = auth.uid())
  or (exists (select 1 from public.users u where u.id = user_scopes.user_id and u.partner_id = public.app_partner())
      and (not public.app_has_scope() or public.app_user_in_scope(user_id)))
);

-- ---- action RPCs: a scoped manager may only act on staff inside their position.
--      The `cur.role <> 'superadmin'`, self-service, last-admin and role-model
--      guards are untouched; the scope clause is added to each management gate. ----
create or replace function public.admin_reset_user_mfa(p_user uuid)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare cur public.users; who text; me uuid := auth.uid();
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into cur from public.users where id = p_user;
  if cur.id is null then raise exception 'User not found' using errcode = '22023'; end if;
  if not (public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and (not public.app_has_scope() or public.app_user_in_scope(cur.id)))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  delete from auth.mfa_factors where user_id = p_user;
  delete from auth.sessions where user_id = p_user;
  insert into public.user_audit(target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'reset_mfa', 'enrolled', 'reset', who, me);
end $function$;

create or replace function public.admin_set_user_status(p_user uuid, p_status text)
 returns users language plpgsql security definer set search_path to ''
as $function$
declare cur public.users; res public.users; who text; me uuid := auth.uid(); old_status text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_status not in ('active','deactivated') then raise exception 'Invalid status' using errcode = '22023'; end if;
  select * into cur from public.users where id = p_user;
  if cur.id is null then raise exception 'User not found' using errcode = '22023'; end if;
  if not (public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and (not public.app_has_scope() or public.app_user_in_scope(cur.id)))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_status = 'deactivated' and p_user = me then
    raise exception 'You cannot deactivate your own account.' using errcode = '42501';
  end if;
  if p_status = 'deactivated' and cur.role = 'superadmin'
     and (select count(*) from public.users where role = 'superadmin' and status = 'active') <= 1 then
    raise exception 'At least one active opndoor admin must remain.' using errcode = '42501';
  end if;
  old_status := cur.status;
  if old_status = p_status then return cur; end if;
  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  update public.users set status = p_status where id = p_user returning * into res;
  if p_status = 'deactivated' then
    update auth.users set banned_until = 'infinity' where id = p_user;
    delete from auth.sessions where user_id = p_user;
  else
    update auth.users set banned_until = null where id = p_user;
  end if;
  insert into public.user_audit(target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'status', old_status, p_status, who, me);
  return res;
end $function$;

create or replace function public.admin_update_user_name(p_user uuid, p_full_name text)
 returns users language plpgsql security definer set search_path to ''
as $function$
declare cur public.users; res public.users; who text; me uuid := auth.uid(); v_name text := btrim(coalesce(p_full_name,''));
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if v_name = '' then raise exception 'A name is required.' using errcode = '22023'; end if;
  if length(v_name) > 120 then raise exception 'That name is too long.' using errcode = '22023'; end if;
  select * into cur from public.users where id = p_user;
  if cur.id is null then raise exception 'User not found' using errcode = '22023'; end if;
  if not (public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and (not public.app_has_scope() or public.app_user_in_scope(cur.id)))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if cur.full_name = v_name then return cur; end if;
  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  update public.users set full_name = v_name where id = p_user returning * into res;
  insert into public.user_audit(target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'name', cur.full_name, v_name, who, me);
  return res;
end $function$;

create or replace function public.admin_update_user_role(p_user uuid, p_role text)
 returns users language plpgsql security definer set search_path to ''
as $function$
declare cur public.users; res public.users; who text; me uuid := auth.uid();
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_role not in ('superadmin','management','referrer','developer') then
    raise exception 'Invalid role' using errcode = '22023';
  end if;
  select * into cur from public.users where id = p_user;
  if cur.id is null then raise exception 'User not found' using errcode = '22023'; end if;
  if not (public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and (not public.app_has_scope() or public.app_user_in_scope(cur.id)))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  -- A branch-scoped manager cannot change roles at all (unchanged).
  if not public.is_admin() and public.app_has_scope() then
    if not exists (select 1 from public.user_scopes s
                    where s.user_id = me and s.kind in ('group','agency')) then
      raise exception 'A branch manager cannot change roles.' using errcode = '42501';
    end if;
  end if;
  -- Role-model wall (unchanged).
  if cur.role = 'superadmin' and p_role <> 'superadmin' then
    raise exception 'An opndoor admin cannot be reassigned to a partner role.' using errcode = '22023';
  end if;
  if cur.role <> 'superadmin' and p_role not in ('management','referrer','developer') then
    raise exception 'A partner user can only be Management, Referrer or Developer.' using errcode = '22023';
  end if;
  if p_user = me and p_role <> cur.role then
    raise exception 'You cannot change your own role.' using errcode = '42501';
  end if;
  if cur.role = 'superadmin' and p_role <> 'superadmin'
     and (select count(*) from public.users where role = 'superadmin' and status = 'active') <= 1 then
    raise exception 'At least one active opndoor admin must remain.' using errcode = '42501';
  end if;
  update public.users set role = p_role where id = p_user returning * into res;
  select full_name into who from public.users where id = me;
  insert into public.user_audit(user_id, action, detail, actor, actor_id)
  values (p_user, 'role_changed', format('%s -> %s', cur.role, p_role), coalesce(who, 'opndoor admin'), me);
  return res;
end $function$;

-- ---- set_user_scope: a scoped granter may only grant a position that lands
--      WITHIN their own reach (closes the grant-over-a-competitor gap). The target
--      USER may be anyone in the partner (delegating your own scope downward,
--      including to a new hire), so no p_user restriction is added. ----
create or replace function public.set_user_scope(p_user uuid, p_kind text, p_target uuid)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare v_target public.users;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_kind not in ('group','agency','branch') then
    raise exception 'Scope must be group, agency or branch. A negotiator simply has none.' using errcode = '22023';
  end if;

  select * into v_target from public.users where id = p_user;
  if not found then raise exception 'User not found' using errcode = '22023'; end if;

  -- Only a group or agency position can grant positions, and only within the
  -- partner. A branch manager granting positions would be a way out of the branch.
  if not (
    public.is_admin()
    or (
      public.app_role() = 'management'
      and v_target.partner_id = public.app_partner()
      and (
        not public.app_has_scope()
        or exists (select 1 from public.user_scopes s
                    where s.user_id = auth.uid() and s.kind in ('group','agency'))
      )
    )
  ) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- A scoped granter may only grant a position that lands entirely within their
  -- own branch set: no branch the granted (kind, target) expands to may sit outside
  -- app_scope_branches(). Admins and unscoped managers are unrestricted.
  if not public.is_admin() and public.app_has_scope() then
    if exists (
      select 1 from (
        select b.id from public.agencies a join public.branches b on b.agency_id = a.id
          where p_kind = 'group' and a.group_id = p_target
        union
        select b.id from public.branches b where p_kind = 'agency' and b.agency_id = p_target
        union
        select p_target where p_kind = 'branch'
      ) tb(id)
      where tb.id not in (select public.app_scope_branches())
    ) then
      raise exception 'You can only grant a position within your own scope.' using errcode = '42501';
    end if;
  end if;

  insert into public.user_scopes (user_id, kind, group_id, agency_id, branch_id, created_by)
  values (
    p_user, p_kind,
    case when p_kind = 'group'  then p_target end,
    case when p_kind = 'agency' then p_target end,
    case when p_kind = 'branch' then p_target end,
    auth.uid()
  )
  on conflict do nothing;
end $function$;
