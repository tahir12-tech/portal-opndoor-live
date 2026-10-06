-- REPLAY WHAT THE MISSING PARTNER MAP SKIPPED.
--
-- CONFIRMED ON PRODUCTION, not inferred. The live ops alert reads:
--
--   hubspot-sync referral_created GR-20675: no partner map for partner_id
--   1f305284-a6d8-4eb0-9b06-b5fe50648b7b
--
-- firing daily since at least 25 September.
--
-- 20261005250000 backfills hubspot_partner_map and adds the trigger, so every
-- partner has a mapping from the moment that migration lands and every NEW event
-- associates correctly. That is not enough on its own, and this migration exists
-- because of the difference.
--
-- WHY THE BACKFILL ALONE DOES NOT REPAIR THE PAST. In hubspot-sync, a missing map
-- row goes through configGap(), which pushes a warning and raises an incident and
-- DOES NOT THROW. So the event is not an error: the applicant properties are
-- written, the event completes, and the cursor moves past it. Meanwhile the
-- association step deliberately does not write its ledger key
-- ('assoc:<application>:partner'), because it did not happen.
--
-- The result is an applicant in HubSpot with no partner company attached, an
-- unrecorded ledger key that would let it be retried, and a cursor that has
-- already gone past the only events that would trigger the retry. ensureAssoc is
-- reached once per EVENT, so an application whose events have all been drained is
-- never revisited. Backfilling the map fixes the future and leaves that
-- application associated to nothing for ever.
--
-- THE REMEDY IS TO WIND THE CURSOR BACK, and it is safe precisely because of the
-- ledger. Every step that already succeeded recorded its key, so a replay reads
-- 'applied' and skips it: the applicant upsert, the company upserts, the branch
-- association. The ONE step with no key is the one that failed, so a replay does
-- exactly the missing work and nothing else. That is what makes this a repair
-- rather than a re-run.
--
-- SCOPED TO WHAT IS ACTUALLY BROKEN. Only partners that now have an active map
-- row, only applications with no partner-association key, and only where the
-- cursor has genuinely passed them. A partner with nothing missing is not
-- touched, so this is inert on a healthy database, including on dev.

do $$
declare v_rows int;
begin
  with missing as (
    -- The earliest event the sync would read, for each application whose partner
    -- association never happened. Restricted to the same kinds and the same
    -- livemode filter hubspot_pending_events uses, so the rewind cannot land
    -- earlier than the drain would ever read.
    select a.partner_id, min(al.at) as first_at
      from public.applications a
      join public.activity_log al on al.application_id = a.id
     where a.livemode
       and al.kind in ('referral_created','payment_received','deed_signed','deed_issued',
                       'deed_delivered','refunded','withdrawn','tenancy_amended')
       and exists (
         select 1 from public.hubspot_partner_map m
          where m.partner_id = a.partner_id and m.active)
       and not exists (
         select 1 from public.hubspot_sync_events e
          where e.id = 'assoc:' || a.id::text || ':partner')
     group by a.partner_id
  )
  update public.hubspot_sync_cursor_partner c
     set last_at = m.first_at - interval '1 microsecond',
         -- Cleared with the timestamp: the drain compares the PAIR
         -- (at, id) > (last_at, last_id), so a stale id left beside a rewound
         -- timestamp would skip the very first event being replayed.
         last_id = null,
         -- A partner stuck on this is unstuck by the replay, so the flag goes
         -- with it rather than sitting there contradicting a working sync.
         stuck_since = null,
         stuck_error = null,
         updated_at = now()
    from missing m
   where m.partner_id = c.partner_id
     -- Only wind BACK. A cursor already behind the gap needs no help and must
     -- not be dragged forward by this.
     and c.last_at >= m.first_at;

  get diagnostics v_rows = row_count;
  raise notice 'hubspot cursor rewound for % partner(s) with unassociated applications', v_rows;
end $$;

comment on table public.hubspot_sync_cursor_partner is
  'How far the HubSpot sync has drained each partner. Rewinding last_at replays that partner''s events; the hubspot_sync_events ledger makes every already-completed step a no-op, so a replay performs only the work that failed. 20261006130000 used that to repair applications whose partner association was skipped for want of a map row.';
