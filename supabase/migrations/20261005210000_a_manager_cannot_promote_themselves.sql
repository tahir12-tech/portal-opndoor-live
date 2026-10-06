-- A MANAGER CANNOT MAKE THEMSELVES A DIRECTOR.
--
-- 20261005170000 gave an agency three levels. Director and Manager are both role
-- 'management' and differ by one boolean, users.sees_commission, which
-- may_see_commission() reads and which gates the four client-callable rate
-- routes. supabase/tests/manager_sees_no_commission.test.sql proves a Manager
-- gets nothing from any of them.
--
-- It proves that for a Manager whose flag is false. Nothing stopped them setting
-- it true.
--
--   users_mgmt_update allows a management user to update rows where
--   partner_id = app_partner() and role in (management, referrer, developer).
--   Their own row satisfies that. authenticated holds a TABLE-level UPDATE grant
--   on public.users, so it covers every column.
--
-- Proved on dev before this migration, as a Regent manager with sees_commission
-- set false, in a rolled-back transaction:
--
--   update public.users set sees_commission = true where id = auth.uid();
--   select public.may_see_commission();   -->  true
--
-- One PATCH to /rest/v1/users and the level means nothing: the four rate routes
-- open, the statement RPCs answer, and the exports fill in. Every client-side
-- gate in the world is decoration next to that, which is the point worth keeping
-- in mind about client gates generally.
--
-- receives_commission_statements goes the same way and for the same reason. It
-- decides who is EMAILED a monthly commission statement, PDF and CSV attached.
-- A Manager who could set it on their own row would be posted the figures they
-- are not allowed to see. It was already kept off the client as a control (it is
-- admin-only, on the person's row in Agencies) but the column was as writable as
-- any other.
--
-- ---------------------------------------------------------------------------
-- WHY A TRIGGER AND NOT A GRANT
--
-- 20260811180000 established, at length, that a column-level REVOKE cannot
-- subtract from a TABLE-level grant: Postgres accepts the statement and changes
-- nothing. The only way through grants is to drop the table grant and re-grant
-- per column, which that migration did for SELECT on applications.
--
-- That is the wrong tool here. A grant is all-or-nothing per role, and the rule
-- is not "authenticated may never write this column", it is "only an admin may
-- change it". Management must keep UPDATE on public.users: an agency edits its
-- own people's names and statuses through exactly that policy, and re-granting
-- forty columns to take away one would break that and keep breaking it every
-- time somebody adds a column.
--
-- So it is a trigger, the same shape as applications_livemode_immutable, which
-- exists because RLS cannot express this either: a USING clause sees only OLD, a
-- WITH CHECK clause sees only NEW, and a rule about a column CHANGING needs both.
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER, and it matters: the first version of this was DEFINER and let
-- the escalation straight through. Inside a SECURITY DEFINER function
-- current_user is the function OWNER, which is postgres, so the privileged-role
-- escape below matched every caller and the guard never fired once. It needs no
-- elevated rights of its own (is_admin() is itself definer), so invoker is both
-- correct and the only thing that works.
create or replace function public.users_commission_capability_is_admin_only()
returns trigger language plpgsql set search_path to '' as $function$
begin
  if new.sees_commission is distinct from old.sees_commission
     or new.receives_commission_statements is distinct from old.receives_commission_statements then
    -- current_user, not auth.uid(): the privileged database roles are how our own
    -- server-side code writes these (the invite path creates the row as
    -- service_role, and seeding runs as postgres). A signed-in caller arrives as
    -- `authenticated` however senior they are, so an admin is still judged by
    -- is_admin() and not by which connection they came in on.
    if not (public.is_admin() or current_user in ('service_role', 'postgres', 'supabase_admin')) then
      raise exception 'An agency level and who receives commission statements are set by opndoor, not here.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $function$;

comment on function public.users_commission_capability_is_admin_only() is
  'Refuses any change to users.sees_commission or users.receives_commission_statements from a signed-in caller who is not an admin. Without it a Manager could set their own sees_commission true and open every commission route the level exists to close.';

drop trigger if exists users_commission_capability_is_admin_only on public.users;
create trigger users_commission_capability_is_admin_only
  before update on public.users
  for each row execute function public.users_commission_capability_is_admin_only();

-- ---------------------------------------------------------------------------
-- AND A WAY TO SET THE LEVEL THAT IS NOT RAW SQL.
--
-- With the column closed, something has to be able to open it, or the only
-- Directors in the world are the ones the 20261005170000 backfill made and every
-- new one needs somebody at Opndoor in psql. The invite path can create either
-- level (it writes as service_role, and invite-user now passes the level
-- through), and this is the other half: changing the level of somebody who
-- already exists.
--
-- Admin only, deliberately. The level is a commission capability, and a Director
-- promoting their own Manager is a decision about who at that agency sees the
-- agency's income. It is also the level Opndoor's own screens name and manage
-- ("Admin screens use the same three names for agency people"), so the control
-- lives where the naming does. If the product later wants a Director to do it,
-- this is the one function to change.
--
-- Audited, because it is a capability grant and the question "who made this
-- person a Director" has to have an answer.
-- ---------------------------------------------------------------------------
create or replace function public.set_agency_level(p_user uuid, p_level text)
returns void language plpgsql security definer set search_path to '' as $function$
declare
  v_role text;
  v_sees boolean;
  v_old  text;
  v_actor text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if not public.is_admin() then
    raise exception 'Only opndoor may change an agency level.' using errcode = '42501';
  end if;

  -- The three levels, spelled as the product spells them. Anything else is a
  -- typo and must not be guessed at.
  if p_level = 'Director' then v_role := 'management'; v_sees := true;
  elsif p_level = 'Manager' then v_role := 'management'; v_sees := false;
  elsif p_level = 'Negotiator' then v_role := 'referrer'; v_sees := false;
  else
    raise exception 'An agency level is Director, Manager or Negotiator.' using errcode = '22023';
  end if;

  select case when u.role = 'referrer' then 'Negotiator'
              when u.role = 'management' and u.sees_commission then 'Director'
              when u.role = 'management' then 'Manager'
              else u.role end
    into v_old
    from public.users u where u.id = p_user;
  if v_old is null then
    raise exception 'No such person.' using errcode = '22023';
  end if;

  -- Opndoor's own staff are not agency people and have no level to set. Guarding
  -- here rather than letting the update through: this function would otherwise be
  -- a way to turn a superadmin into a referrer.
  if v_old not in ('Director', 'Manager', 'Negotiator') then
    raise exception 'That person is not agency staff, so they have no agency level.' using errcode = '22023';
  end if;

  update public.users set role = v_role, sees_commission = v_sees where id = p_user;

  v_actor := coalesce((select full_name from public.users where id = auth.uid()), 'an administrator');
  insert into public.user_audit (target_user, partner_id, action, old_value, new_value, actor, actor_id)
  select p_user, u.partner_id, 'agency level changed', v_old, p_level, v_actor, auth.uid()
    from public.users u where u.id = p_user;
end $function$;

comment on function public.set_agency_level(uuid, text) is
  'Set an agency person''s level to Director, Manager or Negotiator, writing role and sees_commission together so the two cannot disagree. Admin only and audited: the level decides who sees what the agency earns.';

revoke all on function public.set_agency_level(uuid, text) from public, anon;
grant execute on function public.set_agency_level(uuid, text) to authenticated, service_role;
