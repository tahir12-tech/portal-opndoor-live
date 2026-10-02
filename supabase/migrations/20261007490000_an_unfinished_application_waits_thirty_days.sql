-- ===========================================================================
-- AN UNFINISHED DIRECT APPLICATION CLOSES AFTER THIRTY QUIET DAYS, AND
-- REOPENS IF THEY COME BACK.
--
-- Matt, 2026-10-02, verbatim:
--
--   "2. An unfinished direct application expires after 30 days with no
--       activity. Expiry loses nothing: if the tenant signs in again, it
--       reopens where they left off, back to In progress, same reference.
--    3. At 25 days with no activity, email the tenant: their application
--       will close in 5 days, with a link to carry on."
--
-- WHAT EXISTS TODAY. `expire_stale_applications` lapses an application at
-- SENT with the fee unpaid, 15 days on. Nothing at all touches a draft: on
-- dev the oldest unfinished direct application was started on 18 August and
-- is still open 45 days later, and seven of the eight are over 28 days old.
--
-- =========================================================================
-- "NO ACTIVITY" NEEDED A TIMESTAMP, BECAUSE THERE WAS NOT ONE.
-- =========================================================================
--
-- applications has created_at and no updated_at, and a draft writes almost
-- nothing to activity_log -- four of dev's eight have no log row at all. So
-- "30 days with no activity" measured off either of those would close an
-- application somebody worked on this morning. last_activity_at is the
-- column that makes the sentence true.
--
-- IT IS MAINTAINED BY TRIGGERS, not by the twenty-odd write sites in
-- tenant-portal. A tenant's progress lands on applications itself
-- (current_step, the identity patch) and on five child tables, and a new
-- write site added next month would silently stop counting as activity.
-- A BEFORE UPDATE on applications mutates NEW in place, so there is no
-- second write and no recursion; the child tables touch the parent after
-- the fact.
--
-- ONLY WHILE IT IS A DRAFT. The trigger is deliberately blind on any other
-- status: an admin opening a paid application, the nightly sweeps, the
-- webhook emitter and the expiry itself must not look like the tenant
-- coming back. It also means the sweep below cannot reset its own clock.
--
-- =========================================================================
-- EXPIRY LOSES NOTHING, WHICH IS THE WHOLE OF ITEM 2.
-- =========================================================================
--
-- Nothing is deleted and no reference is reissued: the row keeps its
-- guarantee_ref, its profile, its addresses, its incomes and its documents,
-- and only `status` moves. `reopen_expired_draft` moves it back.
--
-- THE DISCRIMINATOR IS sent_at, not a new column. An application that
-- expired from SENT is a finished application whose fee went unpaid, and
-- reinstating that silently is not what was asked for -- it is a decision
-- somebody makes. One that expired as a draft has never been sent, so
-- `sent_at is null` tells the two apart with what is already stored.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. THE CLOCK.
-- ---------------------------------------------------------------------------
alter table public.applications add column if not exists last_activity_at timestamptz;

/* BACKFILLED FROM WHAT WE ACTUALLY KNOW, which is the later of the row's
   own creation and its last activity_log entry. Adding the column WITH a
   default would have stamped every historic draft with today and given
   every one of them another thirty days. */
update public.applications a
   set last_activity_at = greatest(
         a.created_at,
         coalesce((select max(l.at) from public.activity_log l where l.application_id = a.id), a.created_at))
 where a.last_activity_at is null;

alter table public.applications alter column last_activity_at set default now();
alter table public.applications alter column last_activity_at set not null;

comment on column public.applications.last_activity_at is
  'When the tenant last did something on this application, maintained by trigger while the row is a draft and used by expire_stale_drafts / fire_draft_closing_notices. Backfilled by 20261007490000 from greatest(created_at, last activity_log entry); applications has no updated_at and a draft writes almost nothing to activity_log, which is why the column exists.';

create index if not exists applications_draft_activity_idx
  on public.applications (last_activity_at)
  where status = 'draft';

-- ---------------------------------------------------------------------------
-- 2. THE TRIGGERS THAT KEEP IT TRUE.
-- ---------------------------------------------------------------------------
create or replace function public.touch_draft_activity()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  -- BEFORE UPDATE on applications: mutate NEW, write nothing.
  if new.status = 'draft' then new.last_activity_at = now(); end if;
  return new;
end $$;

create or replace function public.touch_parent_draft_activity()
returns trigger language plpgsql security definer set search_path to '' as $$
declare target uuid;
begin
  target := coalesce(new.application_id, old.application_id);
  if target is not null then
    -- No-ops on anything that is not a draft, which is the point: a document
    -- added to a paid application is staff work, not the tenant returning.
    update public.applications set last_activity_at = now()
     where id = target and status = 'draft';
  end if;
  return null;
end $$;

drop trigger if exists applications_touch_draft_activity on public.applications;
create trigger applications_touch_draft_activity
  before update on public.applications
  for each row execute function public.touch_draft_activity();

do $$
declare t text;
begin
  foreach t in array array[
    'application_profiles', 'application_addresses', 'application_incomes',
    'application_documents', 'application_delivery_contacts'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch_draft', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I '
      'for each row execute function public.touch_parent_draft_activity()',
      t || '_touch_draft', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. THE LEDGER FOR THE FIVE-DAY WARNING.
-- ---------------------------------------------------------------------------
/* One notice per application, in the shape guarantee_renewal_notices already
   uses: the ledger IS the idempotency, so a cron that runs twice a day (07:00
   and 08:00 UTC, to cover BST) cannot send twice. The row is DELETED when a
   draft reopens, because the next quiet month earns its own warning. */
create table if not exists public.draft_closing_notices (
  application_id uuid primary key references public.applications(id) on delete cascade,
  sent_at timestamptz not null default now(),
  days_quiet integer
);
comment on table public.draft_closing_notices is
  'One "your application closes in 5 days" notice per unfinished application (20261007490000). Deleted by reopen_expired_draft so a reopened draft can be warned again.';

alter table public.draft_closing_notices enable row level security;
revoke all on table public.draft_closing_notices from public, anon, authenticated;
grant select, insert, delete on table public.draft_closing_notices to service_role;

-- ---------------------------------------------------------------------------
-- 4. THE SWEEP.
-- ---------------------------------------------------------------------------
/* THIRTY DAYS, COUNTED THE WAY THE FIFTEEN-DAY ONE IS: against midnight of
   p_today, so the interval lands on the thirty-first calendar day. Left
   deliberately consistent with expire_stale_applications rather than
   "corrected" into a different arithmetic beside it. */
create or replace function public.expire_stale_drafts(p_today date)
returns integer language plpgsql security definer set search_path to '' as $$
declare n integer;
begin
  with gone as (
    update public.applications a
       set status = 'expired', expired_at = now()
      from public.partners p
     where p.id = a.partner_id
       and a.livemode
       and a.status = 'draft'
       and p.slug = 'opndoor-direct'
       and a.last_activity_at < (p_today::timestamptz - interval '30 days')
    returning a.id
  ),
  logged as (
    insert into public.activity_log(application_id, kind, message, actor, visibility)
    select id, 'expired',
           'Unfinished application closed: 30 days with no activity. It reopens where it left off if the tenant signs in again.',
           'System', 'business'
    from gone
    returning 1
  )
  select count(*) into n from logged;
  return coalesce(n, 0);
end $$;

revoke all on function public.expire_stale_drafts(date) from public, anon, authenticated;
grant execute on function public.expire_stale_drafts(date) to service_role;

-- ---------------------------------------------------------------------------
-- 5. WHO TO WARN, AND THE LEDGER ENTRY THAT STOPS A SECOND ONE.
-- ---------------------------------------------------------------------------
/* RUN AFTER THE SWEEP, ALWAYS. A draft quiet for 40 days is past both
   thresholds; warning first would send "this closes in 5 days" to somebody
   whose application closes in the same run. Expiring first means it is no
   longer a draft and earns no warning, and only the 25-to-30 day band is
   written to. The caller's order is asserted in pgTAP. */
create or replace function public.fire_draft_closing_notices(p_today date)
returns table (
  application_id uuid, guarantee_ref text, tenant_email text,
  tenant_first_name text, prop_addr1 text, prop_postcode text,
  days_quiet integer, closes_on date
)
language plpgsql security definer set search_path to '' as $$
begin
  return query
  with due as (
    select a.id,
           (p_today - a.last_activity_at::date) as quiet
      from public.applications a
      join public.partners p on p.id = a.partner_id
     where a.livemode
       and a.status = 'draft'
       and p.slug = 'opndoor-direct'
       and coalesce(btrim(a.tenant_email), '') <> ''
       and a.last_activity_at < (p_today::timestamptz - interval '25 days')
       and not exists (select 1 from public.draft_closing_notices d where d.application_id = a.id)
  ),
  ins as (
    insert into public.draft_closing_notices (application_id, days_quiet)
    select id, quiet from due
    on conflict (application_id) do nothing
    returning application_id
  )
  select a.id, a.guarantee_ref, a.tenant_email, a.tenant_first_name,
         a.prop_addr1, a.prop_postcode,
         (p_today - a.last_activity_at::date)::integer,
         (a.last_activity_at + interval '30 days')::date
    from public.applications a
    join ins on ins.application_id = a.id;
end $$;

revoke all on function public.fire_draft_closing_notices(date) from public, anon, authenticated;
grant execute on function public.fire_draft_closing_notices(date) to service_role;

-- ---------------------------------------------------------------------------
-- 6. AND IT REOPENS WHERE THEY LEFT OFF.
-- ---------------------------------------------------------------------------
/* SAME ROW, SAME REFERENCE. status goes back to 'draft' -- which the portal
   and the Applications list both read as "In progress" -- expired_at is
   cleared, the warning ledger entry goes so the next quiet month earns its
   own, and the BEFORE trigger above restarts the clock because the new
   status IS 'draft'.

   NEVER AN APPLICATION THAT WAS SENT. `sent_at is null` is the test: an
   application that lapsed with the fee unpaid is finished business and
   reinstating it is somebody's decision, not a side effect of signing in.

   ALL OF THEM, not the most recent: an applicant holding two expired
   drafts would otherwise keep one closed with no way to say so. In
   practice start_application allows one live application at a time, so
   this is one row. */
create or replace function public.reopen_expired_draft(p_applicant uuid)
returns integer language plpgsql security definer set search_path to '' as $$
declare n integer;
begin
  with back as (
    update public.applications a
       set status = 'draft', expired_at = null
     where a.applicant_id = p_applicant
       and a.status = 'expired'
       and a.sent_at is null
    returning a.id
  ),
  cleared as (
    delete from public.draft_closing_notices d using back where d.application_id = back.id
    returning 1
  ),
  logged as (
    insert into public.activity_log(application_id, kind, message, actor, visibility)
    select id, 'reopened',
           'Unfinished application reopened where it left off: the tenant signed in again.',
           'System', 'business'
    from back
    returning 1
  )
  select count(*) into n from logged;
  return coalesce(n, 0);
end $$;

revoke all on function public.reopen_expired_draft(uuid) from public, anon, authenticated;
grant execute on function public.reopen_expired_draft(uuid) to service_role;
