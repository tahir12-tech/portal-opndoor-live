-- ===========================================================================
-- The CRM sync stops being one queue that any rail can stop.
--
-- THE FAILURE THIS CLOSES
-- hubspot_pending_events is a single FIFO over activity_log filtered only by
-- livemode and event kind, with NO partner predicate
-- (20260810270000_livemode_definer_predicates.sql:299-311). The sync loop breaks
-- on the first exception and holds a SINGLETON cursor at the last success
-- (supabase/functions/hubspot-sync/index.ts:425,:434). So one poisoned event
-- from any partner freezes every partner's CRM updates indefinitely, and the
-- only signal is a single ops incident at the moment it first fails.
--
-- Today that is survivable because there is one live partner. The four-rail work
-- ends that: a direct-signup or LIB event that throws would stop Rightmove's
-- referral, fee_paid and deed_issued events from reaching the CRM, silently.
-- Separating HubSpot pipelines per channel does not help. The pipelines are the
-- destination; this is the queue, and there is one of it.
--
-- WHAT THIS DOES
-- The cursor becomes one row per partner and the pending-events feed takes a
-- partner. A partner that throws holds only its own cursor. Everything else
-- drains past it.
--
-- WHY NOT THE BETTER SHAPE
-- The better shape is the one this repo already built for partner webhooks:
-- independent per-row deliveries with backoff and dead-lettering, which is what
-- REGRESSION.md B7.5 asserts and what the prose under it admits this sync does
-- not have. Converting is a rewrite of a live integration against a live CRM.
-- Partitioning is small, removes the cross-rail blocking outright, and does not
-- touch how any single event is processed. Recorded in HANDOVER.md as the
-- follow-up rather than pretended away.
--
-- ADDITIVE FOR THE REFERRAL PATH? The table shape changes, so not literally.
-- Rightmove's observable behaviour is preserved exactly: their cursor is seeded
-- from the singleton, so the first run after this migration resumes from the
-- same event it would have resumed from. What changes is that they can no
-- longer be blocked by somebody else. REGRESSION.md F2 asserts both halves.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. One cursor per partner, seeded from the singleton so nothing replays.
-- ---------------------------------------------------------------------------
create table if not exists public.hubspot_sync_cursor_partner (
  partner_id  uuid primary key references public.partners(id) on delete cascade,
  last_at     timestamptz not null,
  last_id     uuid,
  -- Set when a run fails for this partner, cleared on the next success. This is
  -- what a staleness check reads: "stuck since" is a different and more useful
  -- question than "when did we last succeed", because a partner with no events
  -- is legitimately quiet and must not alert.
  stuck_since timestamptz,
  stuck_error text,
  updated_at  timestamptz not null default now()
);

alter table public.hubspot_sync_cursor_partner enable row level security;
-- No policies: service_role only, exactly as the singleton it replaces.

comment on table public.hubspot_sync_cursor_partner is
  'Per-partner CRM sync position. Replaces the singleton hubspot_sync_cursor so one partner''s poisoned event cannot hold every other partner''s feed. stuck_since drives the staleness alert.';

-- Seed every existing partner from the singleton. A partner that has never
-- synced starts where the singleton is, which is the same event the old code
-- would have given them, so nothing replays and nothing is skipped.
insert into public.hubspot_sync_cursor_partner (partner_id, last_at, last_id)
select p.id, c.last_at, c.last_id
from public.partners p
cross join public.hubspot_sync_cursor c
where c.id
on conflict (partner_id) do nothing;

-- A partner created later must not start at the beginning of time and replay
-- every historical event into the CRM. It starts now.
create or replace function public.hubspot_seed_partner_cursor() returns trigger
language plpgsql security definer set search_path to '' as $function$
begin
  insert into public.hubspot_sync_cursor_partner (partner_id, last_at, last_id)
  values (new.id, now(), null)
  on conflict (partner_id) do nothing;
  return new;
end $function$;

drop trigger if exists partners_seed_hubspot_cursor on public.partners;
create trigger partners_seed_hubspot_cursor
  after insert on public.partners
  for each row execute function public.hubspot_seed_partner_cursor();

-- ---------------------------------------------------------------------------
-- 2. The feed takes a partner.
--
-- Return type is unchanged, so this is create or replace rather than a drop.
-- The ONLY difference from 20260810270000:299-311 is the p_partner predicate.
-- Reproduced in full because Postgres cannot patch a body; nothing else moved.
-- ---------------------------------------------------------------------------
create or replace function public.hubspot_pending_events(
  p_partner uuid, p_last_at timestamptz, p_last_id uuid, p_kinds text[], p_limit int
) returns table(event_id uuid, kind text, at timestamptz, application_id uuid, app jsonb)
language sql security definer set search_path = '' as $$
  select al.id, al.kind, al.at, al.application_id, to_jsonb(a.*)
  from public.activity_log al
  join public.applications a on a.id = al.application_id
  where a.livemode
    and a.partner_id = p_partner
    and al.kind = any(p_kinds)
    and (al.at, al.id) > (p_last_at, coalesce(p_last_id, '00000000-0000-0000-0000-000000000000'::uuid))
  order by al.at asc, al.id asc
  limit p_limit
$$;

revoke all on function public.hubspot_pending_events(uuid, timestamptz, uuid, text[], int) from public, anon;
grant execute on function public.hubspot_pending_events(uuid, timestamptz, uuid, text[], int) to service_role;

-- The old four-argument signature is DROPPED, not left callable. A defaulted or
-- surviving old signature means an un-updated caller silently resolves to the
-- unpartitioned version and the head-of-line blocking comes straight back with
-- nothing to show for it.
--
-- DEPLOY ORDER, AND THE WINDOW IT OPENS. Dropping it means the CURRENTLY
-- DEPLOYED hubspot-sync starts failing the moment this migration applies, and
-- keeps failing until the new function is deployed. That is deliberate and it is
-- the safe direction: it fails loudly, on every run, with "function does not
-- exist", rather than quietly syncing through an unpartitioned queue nobody has
-- noticed is still there.
--
-- Nothing is lost in the window. Cursors are preserved per partner, the sync is
-- idempotent, and the cron simply retries. Expect ops incidents for as long as
-- the window is open, so apply this migration and deploy hubspot-sync together.
drop function if exists public.hubspot_pending_events(timestamptz, uuid, text[], int);

-- ---------------------------------------------------------------------------
-- 3. Which partners to drain, and the staleness question.
-- ---------------------------------------------------------------------------
create or replace function public.hubspot_sync_partners()
returns table (partner_id uuid, last_at timestamptz, last_id uuid)
language sql stable security definer set search_path = '' as $$
  select c.partner_id, c.last_at, c.last_id
  from public.hubspot_sync_cursor_partner c
  join public.partners p on p.id = c.partner_id
  order by c.last_at asc
$$;

revoke all on function public.hubspot_sync_partners() from public, anon;
grant execute on function public.hubspot_sync_partners() to service_role;

create or replace function public.hubspot_mark_cursor(
  p_partner uuid, p_last_at timestamptz, p_last_id uuid
) returns void
language sql security definer set search_path = '' as $$
  insert into public.hubspot_sync_cursor_partner (partner_id, last_at, last_id, stuck_since, stuck_error, updated_at)
  values (p_partner, p_last_at, p_last_id, null, null, now())
  on conflict (partner_id) do update
    set last_at = excluded.last_at, last_id = excluded.last_id,
        stuck_since = null, stuck_error = null, updated_at = now();
$$;

create or replace function public.hubspot_mark_stuck(
  p_partner uuid, p_error text
) returns void
language sql security definer set search_path = '' as $$
  update public.hubspot_sync_cursor_partner
     set stuck_since = coalesce(stuck_since, now()),   -- first failure wins, so age is real
         stuck_error = left(coalesce(p_error, ''), 500),
         updated_at  = now()
   where partner_id = p_partner;
$$;

revoke all on function public.hubspot_mark_cursor(uuid, timestamptz, uuid) from public, anon;
revoke all on function public.hubspot_mark_stuck(uuid, text) from public, anon;
grant execute on function public.hubspot_mark_cursor(uuid, timestamptz, uuid) to service_role;
grant execute on function public.hubspot_mark_stuck(uuid, text) to service_role;

-- The alert. Threshold is an argument rather than a constant so the caller
-- states the promise: the agreed tolerance is one day.
create or replace function public.hubspot_stale_partners(p_max_age interval default interval '24 hours')
returns table (partner_id uuid, partner_name text, stuck_since timestamptz, age interval, stuck_error text)
language sql stable security definer set search_path = '' as $$
  select c.partner_id, p.name, c.stuck_since, now() - c.stuck_since, c.stuck_error
  from public.hubspot_sync_cursor_partner c
  join public.partners p on p.id = c.partner_id
  where c.stuck_since is not null
    and now() - c.stuck_since > p_max_age
  order by c.stuck_since asc
$$;

comment on function public.hubspot_stale_partners(interval) is
  'Partners whose CRM feed has been stuck longer than the tolerance. Reads stuck_since, not last_at, so a partner with no events is quiet rather than alarming. Agreed tolerance is 24 hours.';

revoke all on function public.hubspot_stale_partners(interval) from public, anon;
grant execute on function public.hubspot_stale_partners(interval) to service_role;
grant execute on function public.hubspot_stale_partners(interval) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The singleton stays, unused, until the function is deployed.
--
-- Dropping it here would break the currently deployed hubspot-sync the moment
-- this migration applies and before the new function ships. It is left in place
-- and emptied of meaning by the code change; removing it is a follow-up once
-- the deploy is confirmed. HANDOVER.md carries that as an open item.
-- ---------------------------------------------------------------------------
comment on table public.hubspot_sync_cursor is
  'SUPERSEDED by hubspot_sync_cursor_partner (20260812030000). Kept only so applying this migration ahead of deploying the new hubspot-sync does not break the running one. Safe to drop once the partitioned sync is confirmed live.';
