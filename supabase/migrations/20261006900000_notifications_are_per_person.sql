-- NOTIFICATIONS ARE GENUINELY PER PERSON.
--
-- Matt, 2026-09-30: "genuinely per person, for agency and supplier users as
-- well as Opndoor staff. Each person chooses which events they are told
-- about for the referrals they can see, on their own panel... The locked
-- items stay locked for everyone... Replace the agency-wide event switches
-- with this; migrate today's agency settings onto each existing person so
-- nobody's emails change on the day it ships."
--
-- Test: supabase/tests/notifications_are_per_person.test.sql
--
-- =========================================================================
-- WHAT THIS DOES NOT CHANGE, said first because it is the whole safety story
-- =========================================================================
--
-- It does NOT change WHICH REFERRALS anybody can see. A person's position
-- still decides that, exactly as before. This changes only WHICH EVENTS they
-- are emailed about within what they already reach. A per-person setting
-- must never become a way to widen reach, and nothing below touches the
-- ladder that decides it.
--
-- =========================================================================
-- THE ONE PART THAT CANNOT BE PER PERSON
-- =========================================================================
--
-- The supplier rail's `agent_contact` is not a user. It is resolved from
-- `agent_contacts` by `effective_primary_contact_route`: a name and an email
-- with no login and no `public.users` row. There is nobody to hold a
-- preference, so that class stays a PARTY setting and keeps using
-- `notification_settings`. It is the only recipient when a referral arrives
-- through an API key with no human attached -- the case Q-02 exists for --
-- so removing it would silently stop an executed deed reaching a supplier.
--
-- Every class that IS a user becomes per person: the agency rail's
-- `referrer` and `ticked_users`, and the supplier rail's `referrer`.
--
-- =========================================================================
-- WHY THE MIGRATION IS A JOIN AND NOT A COPY
-- =========================================================================
--
-- Today's settings are keyed by recipient CLASS, and the class is a property
-- of (person, referral) rather than of the person: the same person is the
-- `referrer` class on their own referral and `ticked_users` on a colleague's.
-- So a person's new single setting has to cover both roles they can play.
--
-- It is seeded as the OR of the classes they can occupy. That direction is
-- chosen deliberately: OR can only ever keep an email that was being sent,
-- never remove one. Seeding with AND, or with one class arbitrarily, would
-- silently stop somebody being emailed and nobody would find out until a
-- deed did not arrive.
--
-- On dev every party is on defaults and both agency classes default ON, so
-- in practice the seed is exact rather than merely safe. The test builds a
-- party whose two classes DISAGREE precisely so that the "merely safe" case
-- is exercised too.

-- -------------------------------------------------------------------------
-- 1. THE TABLE. One row per person per event. No party column: the party is
--    a property of the person, and duplicating it here would let the two
--    disagree.
-- -------------------------------------------------------------------------
create table if not exists public.user_notification_settings (
  user_id           uuid not null references public.users(id) on delete cascade,
  notification_type text not null,
  enabled           boolean not null,
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  primary key (user_id, notification_type)
);

comment on table public.user_notification_settings is
  'Which events each person is emailed about, within the referrals their position already reaches. Replaces the per-party, per-recipient-class switches for every class that is a USER. The supplier rail''s agent_contact is not a user and keeps using notification_settings.';

alter table public.user_notification_settings enable row level security;

-- READ: yourself, an opndoor admin, or somebody who may act on you -- so a
-- Director can SEE their team's choices, which is what Matt asked for, from
-- the row on the agency page.
create policy uns_select on public.user_notification_settings for select to authenticated
using (
  user_id = auth.uid()
  or public.is_admin()
  or public.app_role() = 'opndoor_manager'
  or coalesce(public.may_act_on_user(user_id), false)
);

-- WRITE: yourself, or an opndoor admin. Matt's words name two capabilities,
-- "each person chooses" and an admin "can see". Read literally a Director
-- may not change their staff's, which is a real change from today and is
-- flagged in QUEUE.md rather than decided silently.
create policy uns_write on public.user_notification_settings for all to authenticated
using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

create policy require_aal2 on public.user_notification_settings as restrictive to authenticated
using (public.is_aal2()) with check (public.is_aal2());

revoke all on table public.user_notification_settings from anon;
grant select, insert, update, delete on table public.user_notification_settings to authenticated;

-- -------------------------------------------------------------------------
-- 2. THE GATE. What the send path asks instead of the class question.
--
--    LOCKED WINS, ALWAYS, for everyone. Matt: "The locked items stay locked
--    for everyone." A stored row saying false cannot switch off the executed
--    deed reaching the person it is addressed to.
--
--    NO ROW MEANS THE DEFAULT, not "off". A person invited tomorrow has no
--    rows, and must behave exactly as the product does today rather than
--    silently receiving nothing.
-- -------------------------------------------------------------------------
create or replace function public.user_notification_enabled(
  p_user uuid, p_kind text, p_type text)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select case
    -- The rail's primary recipient class is the one that can be locked, and
    -- on both rails with users that class is 'referrer'.
    when public.notification_locked(p_kind, p_type, 'referrer') then true
    else coalesce(
      (select s.enabled from public.user_notification_settings s
        where s.user_id = p_user and s.notification_type = p_type),
      -- Unset: the class defaults, OR-ed exactly as the migration seeds
      -- them, so an unmigrated person and a migrated one behave the same.
      coalesce(public.notification_default(p_kind, p_type, 'referrer'), false)
      or coalesce(public.notification_default(p_kind, p_type,
            case when p_kind = 'agency' then 'ticked_users' else 'referrer' end), false))
  end
$function$;

revoke all on function public.user_notification_enabled(uuid, text, text) from public, anon;
grant execute on function public.user_notification_enabled(uuid, text, text) to authenticated, service_role;

-- -------------------------------------------------------------------------
-- 3. A PERSON CHOOSES, FOR THEMSELVES.
--
--    The locked refusal is by name and in plain English, because walk fix 14
--    is in force and "notification_locked returned true" is not a sentence a
--    letting agent can act on.
-- -------------------------------------------------------------------------
create or replace function public.set_my_notification(p_type text, p_enabled boolean)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare v_kind text;
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  if auth.uid() is null then
    raise exception 'Sign in to change your notifications.' using errcode = '42501';
  end if;
  if not coalesce(exists (select 1 from public.notification_types() t
                           where t.notification_type = p_type), false) then
    raise exception 'There is no such notification.' using errcode = '22023';
  end if;

  v_kind := case when exists (
      select 1 from public.users u join public.partners p on p.id = u.partner_id
       where u.id = auth.uid() and p.is_house_route = false
         and p.slug <> 'opndoor-agents')
    then 'supplier' else 'agency' end;

  if public.notification_locked(v_kind, p_type, 'referrer') and not p_enabled then
    raise exception 'The executed deed always reaches the person it is addressed to. That cannot be switched off.'
      using errcode = '42501';
  end if;

  insert into public.user_notification_settings (user_id, notification_type, enabled, updated_by)
  values (auth.uid(), p_type, p_enabled, auth.uid())
  on conflict (user_id, notification_type)
  do update set enabled = excluded.enabled, updated_at = now(), updated_by = excluded.updated_by;
end $function$;

revoke all on function public.set_my_notification(text, boolean) from public, anon;
grant execute on function public.set_my_notification(text, boolean) to authenticated;

-- -------------------------------------------------------------------------
-- 4. THE MIGRATION ITSELF, as a function so it is testable and re-runnable.
--
--    Idempotent on purpose: `on conflict do nothing` means running it twice
--    cannot overwrite a choice somebody has since made. A migration that
--    clobbers a real preference on a re-run is worse than one that does
--    nothing.
-- -------------------------------------------------------------------------
create or replace function public.migrate_notification_settings_to_people()
returns integer
language plpgsql security definer set search_path to ''
as $function$
declare v_rows integer;
begin
  with people as (
    select u.id as user_id,
           case when p.is_house_route = false and p.slug <> 'opndoor-agents'
                then 'supplier' else 'agency' end as kind,
           (select s.agency_id from public.user_scopes s
             where s.user_id = u.id and s.agency_id is not null limit 1) as agency_id,
           u.partner_id
      from public.users u
      join public.partners p on p.id = u.partner_id
     where u.role in ('management', 'referrer')
  )
  insert into public.user_notification_settings (user_id, notification_type, enabled)
  select pe.user_id, t.notification_type,
         -- The OR of every class this person can occupy. Never narrows.
         coalesce(public.notification_enabled(pe.kind, pe.partner_id, pe.agency_id,
                                              t.notification_type, 'referrer'), false)
         or (pe.kind = 'agency' and coalesce(public.notification_enabled(
               pe.kind, pe.partner_id, pe.agency_id, t.notification_type, 'ticked_users'), false))
    from people pe
    cross join public.notification_types() t
  on conflict (user_id, notification_type) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows;
end $function$;

revoke all on function public.migrate_notification_settings_to_people() from public, anon, authenticated;
grant execute on function public.migrate_notification_settings_to_people() to service_role;

comment on function public.migrate_notification_settings_to_people() is
  'Seeds each person''s notification settings from their party''s class settings, as the OR of every class they can occupy. OR never removes an email that was being sent; AND or picking one class could. Idempotent: a re-run cannot overwrite a choice somebody has since made.';

-- Run it once, now, for everybody who exists today.
select public.migrate_notification_settings_to_people();
