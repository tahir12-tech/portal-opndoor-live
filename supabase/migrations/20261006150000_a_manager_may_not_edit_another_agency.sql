-- A MANAGER MAY NOT EDIT ANOTHER AGENCY'S PEOPLE.
--
-- THE DEFECT. users_mgmt_update reads, in full:
--
--   app_role() = 'management'
--   and partner_id = app_partner()
--   and role in ('management','referrer','developer')
--
-- No scope, no level, no self test. On the SUPPLIER rail that is defensible,
-- because one supplier is one company and partner_id is a real boundary. On the
-- AGENCY rail it is not: every independently onboarded agency shares the one
-- house partner 'opndoor-agents', so `partner_id = app_partner()` is not "my
-- company", it is "every agency Opndoor has onboarded".
--
-- On dev that partner currently carries FOUR unrelated, competing agencies
-- (Harborview, Northgate, Regent's, Southbank) and 24 management users between
-- them. Any one of those Managers could PATCH any of the other 23 rows through
-- PostgREST: rename them, change their email, move their home branch.
--
-- users_level_ladder_guard (20261006091000) already protects `role` and
-- `status`, which is why this was not total. Every other column was open.
--
-- THE FIX IS ON THE POLICY, not on a trigger in front of it. A trigger can only
-- refuse a write that the policy has already admitted, one column at a time,
-- and the list of columns keeps growing. The boundary belongs where the boundary
-- is decided.
--
-- CONTAINMENT, NOT OVERLAP. The predicate is "every branch the target reaches is
-- a branch I reach". app_user_in_scope (20260904170000) is the OVERLAP form and
-- is the right answer for READING a colleague; it is the wrong answer for
-- writing, because two Managers of the same agency overlap, and so would a
-- branch Manager and the group Director above them. The containment form already
-- existed as commission_tick_target_within_caller; it is not commission's idea,
-- so it is lifted out under its own name and the commission one now calls it.

-- ---------------------------------------------------------------------------
-- THE PREDICATE, named for what it is.
-- ---------------------------------------------------------------------------
create or replace function public.user_within_caller_scope(p_user uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  with caller as (
    select c.branch_id from public.app_scope_branches() as c(branch_id)
  ),
  target as (
    select t.branch_id from public.app_scope_branches_for(p_user) as t(branch_id)
    union
    -- A negotiator holds no scope row, so their only location is the branch they
    -- were invited into. Without this arm they would be unreachable rather than
    -- protected: an empty target set fails the containment test below.
    select u.home_branch_id from public.users u
     where u.id = p_user and u.home_branch_id is not null
  )
  select exists (select 1 from target)
     and not exists (
       select 1 from target t2
        where t2.branch_id not in (select c2.branch_id from caller c2)
     )
$function$;

comment on function public.user_within_caller_scope(uuid) is
  'Does the caller''s position CONTAIN this person''s? Every branch the target reaches must be a branch the caller reaches. Containment, not overlap: overlap is the right test for reading a colleague and the wrong one for writing to them, because two managers of one agency overlap and so do a branch manager and the group director above them.';

-- One implementation. The commission tick keeps its name and its meaning.
create or replace function public.commission_tick_target_within_caller(p_user uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select public.user_within_caller_scope(p_user)
$function$;

-- ---------------------------------------------------------------------------
-- THE POLICY, scoped.
-- ---------------------------------------------------------------------------
drop policy if exists users_mgmt_update on public.users;
create policy users_mgmt_update on public.users
  for update
  using (
    public.app_role() = 'management'
    and partner_id = public.app_partner()
    and role in ('management', 'referrer', 'developer')
    -- MY OWN PEOPLE, not every agency on the house route.
    --
    -- A positionless management user is refused outright rather than given the
    -- partner. That is the case the old policy got most wrong: no position used
    -- to mean no narrowing, so the least-configured account had the widest
    -- write. An unpositioned manager can still be given a position, which is
    -- the fix, and can still edit their own row through the clause below.
    and (public.user_within_caller_scope(id) or id = auth.uid())
    -- AT OR BELOW MY OWN LEVEL. Containment alone lets a Manager write to the
    -- Director beside them, because two agency-scoped people contain each
    -- other. Equality is allowed deliberately: a Manager may edit another
    -- Manager and themselves, which is what "at or below" means and what makes
    -- the tickbox self-service.
    and (id = auth.uid()
         or coalesce(public.level_rank_of(id), 99) >= coalesce(public.level_rank_of(auth.uid()), 99))
  )
  with check (
    public.app_role() = 'management'
    and partner_id = public.app_partner()
    and role in ('management', 'referrer', 'developer')
    and (public.user_within_caller_scope(id) or id = auth.uid())
    and (id = auth.uid()
         or coalesce(public.level_rank_of(id), 99) >= coalesce(public.level_rank_of(auth.uid()), 99))
  );

-- ---------------------------------------------------------------------------
-- WHO IS COPIED ON A REFERRAL'S NOTIFICATIONS.
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists receives_notifications boolean not null default false;

comment on column public.users.receives_notifications is
  'Copied on everything the referrer receives for referrals within this person''s own position: a branch-positioned user for their branch, an agency-positioned user for every branch in the agency, a group-positioned user for the whole group. Default off. The scope is the position they already hold, never a second setting.';

-- authenticated reads columns explicitly on this table (see the column-grant
-- guard in applications_column_grants.test.sql for why a missing grant is a
-- 500 rather than a blank).
grant select (receives_notifications) on public.users to authenticated;

/* THE TRIGGER, because the policy is necessary and not sufficient.

   The policy above says WHO may write to a row. This says HOW this particular
   column may be written: through its own RPC, never by a PATCH that happens to
   carry the field alongside a name change. Same shape as
   users_commission_tick_guard (20261005140000), for the same reason: the RPC
   is where the audit is written, and a column that can be set without it is a
   column with no trail. */
create or replace function public.users_notifications_tick_guard()
returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  if coalesce(current_setting('app.setting_notifications_tick', true), 'off') <> 'on' then
    raise exception 'Who receives notifications is changed from the person''s row, not by editing them directly.'
      using errcode = '42501';
  end if;
  return new;
end $function$;

drop trigger if exists users_notifications_tick_guard on public.users;
create trigger users_notifications_tick_guard
  before update of receives_notifications on public.users
  for each row
  when (new.receives_notifications is distinct from old.receives_notifications)
  execute function public.users_notifications_tick_guard();

/* THE WRITER.

   Opndoor admin, or a Director or Manager of that person's own agency acting on
   somebody at or below their own position. Self is always allowed, which is why
   this cannot reuse assert_may_act_on_user: that one is STRICTLY below and
   refuses self outright, and a Director who cannot tick their own box would
   have to ask Opndoor to do it. */
create or replace function public.set_receives_notifications(p_user uuid, p_on boolean)
returns boolean
language plpgsql security definer set search_path to ''
as $function$
declare
  v_ok boolean;
  v_partner uuid;
begin
  if not public.is_aal2() then
    raise exception 'MFA required' using errcode = '42501';
  end if;

  select partner_id into v_partner from public.users where id = p_user;
  if v_partner is null and not exists (select 1 from public.users where id = p_user) then
    raise exception 'No such person.' using errcode = 'P0002';
  end if;

  v_ok := public.is_admin()
    or (public.app_role() = 'management'
        and v_partner = public.app_partner()
        and (p_user = auth.uid() or public.user_within_caller_scope(p_user))
        and (p_user = auth.uid()
             or coalesce(public.level_rank_of(p_user), 99) >= coalesce(public.level_rank_of(auth.uid()), 99)));

  if not v_ok then
    raise exception 'You can only change this for people at or below your own position, in your own agency.'
      using errcode = '42501';
  end if;

  perform set_config('app.setting_notifications_tick', 'on', true);
  update public.users set receives_notifications = coalesce(p_on, false) where id = p_user;
  perform set_config('app.setting_notifications_tick', 'off', true);

  /* AUDITED INTO org_audit, NOT activity_log. activity_log.application_id is
     NOT NULL and this is not about an application, so a row there throws
     23502 on the first call. The commission tick had the same problem and
     solved it the same way: the record belongs against the PARTY, which is
     what somebody later asks about ("who turned this on for Regent"). */
  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  select coalesce(c.level, 'user'), coalesce(c.org_id, p_user),
         case when coalesce(p_on, false) then 'notifications_on' else 'notifications_off' end,
         coalesce(nullif(btrim(u.full_name), ''), u.email)
           || case when coalesce(p_on, false) then ' now receives ' else ' no longer receives ' end
           || 'notifications for their position',
         coalesce((select a.full_name from public.users a where a.id = auth.uid()), 'System'),
         auth.uid()
    from public.users u
    left join lateral public.commission_statement_party(p_user) c on true
   where u.id = p_user;

  return coalesce(p_on, false);
end $function$;

revoke all on function public.set_receives_notifications(uuid, boolean) from public;
grant execute on function public.set_receives_notifications(uuid, boolean) to authenticated;
