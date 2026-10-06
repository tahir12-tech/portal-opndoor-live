-- livemode on the idempotency ledger.
--
-- The unique key is (partner_id, endpoint, idempotency_key) and carries no mode.
-- A developer who rehearses with Idempotency-Key "abc" and then replays the same
-- request against live gets the SANDBOX response back: HTTP 201, a GR-TEST-
-- guarantee reference, and a sandbox payment link. The API reports success, no
-- live application exists, and the real tenant is handed a link that charges a
-- test card. Reusing a key across the switch to live is exactly what a careful
-- integrator does when verifying their retry logic still works, so this is a
-- likely path rather than a contrived one.
--
-- The mode belongs in the key, not in a filter, because the failure is a
-- collision rather than a disclosure: filtering on read would turn the replay
-- into "no prior row found" and a 500, when what should happen is that the two
-- requests simply never meet.

alter table public.partner_api_requests
  add column if not exists livemode boolean not null default true;

drop index if exists public.partner_api_requests_idem_idx;

create unique index partner_api_requests_idem_idx
  on public.partner_api_requests (partner_id, livemode, endpoint, idempotency_key);

comment on column public.partner_api_requests.livemode is
  'Which mode the key that made this request was in. Part of the idempotency unique key so a sandbox rehearsal and a live request can share an Idempotency-Key without either replaying the other.';
