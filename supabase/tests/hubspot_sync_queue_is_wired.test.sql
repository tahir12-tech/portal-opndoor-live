-- THE HUBSPOT SYNC QUEUE IS WIRED TO EVERY PARTNER IT DRAINS.
--
-- Reported as a recurring fault on the live portal: "a HubSpot sync error".
-- Two database properties decide whether that fault is possible, and neither
-- was asserted anywhere.
--
-- ONE, THE SIGNATURE. 20260812030000 drops the four-argument
-- hubspot_pending_events and creates a five-argument one, deliberately, so
-- that a deployment older than the migration fails loudly instead of quietly
-- draining an unpartitioned queue. That is the right call and it makes the
-- deploy ORDER load-bearing: migration and function together, function never
-- behind. The assertions below are the paper version of that order. They also
-- refuse a re-added overload, which would be worse than either state: an
-- un-updated caller would resolve to the old unpartitioned function and the
-- head-of-line blocking would come back with nothing on the surface to show.
--
-- TWO, THE PARTNER MAP, WHICH IS THE ACTUAL FAULT. hubspot-sync makes the
-- PRIMARY applicant-to-partner association from hubspot_partner_map. The seed
-- migration 20260705150500 filled that table from `partners` as it stood on
-- 2026-07-05 and nothing has filled it since. The per-partner cursor work
-- added a trigger that seeds hubspot_sync_cursor_partner on partner insert and
-- gave it NO companion for the map. So every partner created after the seed
-- has a cursor, is drained on every run, produces events, and has no map row.
-- On dev that is all seven of them, and the assertions below are consequently
-- RED: that is the fault, stated as a property, rather than a passing test
-- written after the fact. They go green when the map is seeded and given the
-- same insert trigger the cursor has.
--
-- The edge function no longer THROWS on this (a throw stopped that partner's
-- queue for ever); it gates the association and keeps draining. Gating stops
-- the outage. It does not make the association appear, which is what these
-- assertions are for.

begin;
select plan(10);

-- ---------------------------------------------------------------------------
-- The signature the deployed function calls, and only that one.
-- ---------------------------------------------------------------------------
select has_function('public', 'hubspot_pending_events',
  array['uuid', 'timestamp with time zone', 'uuid', 'text[]', 'integer'],
  'the partitioned five-argument hubspot_pending_events exists');

select hasnt_function('public', 'hubspot_pending_events',
  array['timestamp with time zone', 'uuid', 'text[]', 'integer'],
  'the unpartitioned four-argument signature is gone, so no caller can resolve to it');

select ok(has_function_privilege('service_role',
  'public.hubspot_pending_events(uuid, timestamptz, uuid, text[], integer)', 'execute'),
  'service_role can read the queue, which is the only caller that should');

select ok(not has_function_privilege('authenticated',
  'public.hubspot_pending_events(uuid, timestamptz, uuid, text[], integer)', 'execute'),
  'a signed-in user cannot read another partner''s whole application rows through it');

select ok(not has_function_privilege('anon',
  'public.hubspot_pending_events(uuid, timestamptz, uuid, text[], integer)', 'execute'),
  'anon cannot read the queue');

-- ---------------------------------------------------------------------------
-- Every partner the sync drains can actually be synced.
--
-- RED TODAY. This is the fault: a cursor without a map row is a partner whose
-- every event fails on the association step, for ever, with one ops-alert in
-- the first hour and silence after it.
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int
     from public.hubspot_sync_cursor_partner c
     join public.partners p on p.id = c.partner_id
     left join public.hubspot_partner_map m on m.partner_id = c.partner_id and m.active
    where m.partner_id is null),
  0,
  'every partner with a sync cursor has an active hubspot_partner_map row');

-- ---------------------------------------------------------------------------
-- And the mechanism behind it, so the fix is a trigger rather than a one-off
-- backfill that the next partner walks straight back out of.
-- ---------------------------------------------------------------------------
insert into public.partners (id, slug, name, referencing_mode, partner_rate, agent_rate, is_house_route, refers_own_stock)
values ('92000000-0000-0000-0000-000000000001', 'zzz-hubspot', 'ZZZ HubSpot', 'pre_referenced_open', 0.25, 0.10, true, true);

select ok(
  exists (select 1 from public.hubspot_sync_cursor_partner where partner_id = '92000000-0000-0000-0000-000000000001'),
  'a new partner is given a sync cursor, so the sync starts draining it immediately');

select ok(
  exists (select 1 from public.hubspot_partner_map where partner_id = '92000000-0000-0000-0000-000000000001' and active),
  'a new partner is given a hubspot_partner_map row, so what is drained can be synced');

-- ---------------------------------------------------------------------------
-- The ledger can carry the bounded-retry state the function now writes, with
-- no schema change: one row per failed attempt, one row when the event is
-- parked. Asserted here because the whole point of counting attempts in the
-- ledger rather than a new column was that the ledger already allows it.
-- ---------------------------------------------------------------------------
insert into public.hubspot_sync_events (id, event_id, target, application_id) values
  ('fail:92000000-0000-0000-0000-0000000000ee:1', '92000000-0000-0000-0000-0000000000ee', 'failed', null),
  ('fail:92000000-0000-0000-0000-0000000000ee:2', '92000000-0000-0000-0000-0000000000ee', 'failed', null),
  ('dead:92000000-0000-0000-0000-0000000000ee',   '92000000-0000-0000-0000-0000000000ee', 'dead_letter', null);

select is(
  (select count(*)::int from public.hubspot_sync_events
    where event_id = '92000000-0000-0000-0000-0000000000ee' and target = 'failed'),
  2,
  'failed attempts accumulate per event, which is what bounds the retry');

select is(
  (select count(*)::int from public.hubspot_sync_events
    where event_id = '92000000-0000-0000-0000-0000000000ee' and target = 'dead_letter'),
  1,
  'a parked event is recorded by name, so it can be replayed rather than lost');

select * from finish();
rollback;
