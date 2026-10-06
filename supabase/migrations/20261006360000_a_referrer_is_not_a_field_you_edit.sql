-- A REFERRER IS NOT A FIELD YOU EDIT.
--
-- The last of the second review's findings, and the smallest: the management
-- arm of applications_update does not constrain referrer_id. That column is
-- RUNG ONE of agency_notification_recipients -- "the user who sent the
-- referral receives the executed deed and every per-application
-- notification" -- so a manager inside the application's own scope could
-- rewrite who the deed goes to by PATCHing a column, without touching the
-- deed path at all.
--
-- Bounded today by their not being able to read another agency's user uuids,
-- which is a property of users_select rather than of this write. Rule 1 says
-- who receives the deed; it should not depend on a read policy elsewhere
-- happening to stay narrow.
--
-- A column trigger rather than a policy clause, matching the six that already
-- guard id, role, status, sees_commission, receives_commission_statements,
-- receives_notifications and home_branch_id on public.users. A policy can
-- only filter; a trigger can say why.
create or replace function public.applications_referrer_guard()
returns trigger
language plpgsql
as $function$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if public.is_admin() then return new; end if;
  -- The new referrer must be somebody the caller reaches, and must sit on the
  -- application's own agency rather than merely on the route.
  if new.referrer_id is not null and not public.app_may_reach_user(new.referrer_id) then
    raise exception 'A referral can only be reassigned to somebody in your own part of the business.'
      using errcode = '42501';
  end if;
  if old.referrer_id is not null and not public.app_may_reach_user(old.referrer_id) then
    raise exception 'You can only reassign a referral that is already one of yours.'
      using errcode = '42501';
  end if;
  return new;
end $function$;

comment on function public.applications_referrer_guard() is
  'referrer_id decides who receives the executed deed and every per-application notification, so changing it is a delivery decision and not a field edit. Both ends are checked: the person it leaves and the person it lands on.';

drop trigger if exists applications_referrer_guard on public.applications;
create trigger applications_referrer_guard
  before update of referrer_id on public.applications
  for each row
  when (new.referrer_id is distinct from old.referrer_id)
  execute function public.applications_referrer_guard();
