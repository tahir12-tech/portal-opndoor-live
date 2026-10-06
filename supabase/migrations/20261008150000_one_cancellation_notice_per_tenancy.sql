-- ONE CANCELLATION NOTICE PER TENANCY, SENT AFTER THE LAST REFUND.
--
-- Matt, 2026-10-04 (bc): "the 'These guarantees have been cancelled' email
-- went twice each to joe@joe.com and landlord@landlord.com (once per refunded
-- tenant). Send it exactly once per tenancy, after the last tenant's refund,
-- and never again on webhook redeliveries."
--
-- Test: supabase/tests/one_cancellation_notice_per_tenancy.test.sql
--
-- =========================================================================
-- MY BUG, AND THE CAUSE IS THE THING I WAS PLEASED ABOUT
-- =========================================================================
--
-- The cascade refunds each co-tenant through Stripe, and each of those
-- refunds raises its own `charge.refunded`. I made that event run the whole
-- per-tenant path on purpose, so that a refund taken by hand and a refund
-- taken by the cascade go down ONE code path. That is still right for
-- everything that is per tenant: their deed is cancelled, they are emailed.
--
-- The notice to the agent and landlord is per PROPERTY, and it was sitting
-- inside that per-tenant path. Two tenants, two notices. Three tenants,
-- three. The agent reads the same list of cancelled guarantees three times
-- and has to work out whether it happened three times.
--
-- =========================================================================
-- WHY A TABLE AND NOT A CONDITION
-- =========================================================================
--
-- "After the last tenant's refund" sounds like a counted test: send when
-- nobody on the tenancy is still awaiting a refund. That alone is wrong, and
-- wrong in the direction that produces MORE email, not less: once the last
-- refund lands the condition is true for ever, so every webhook redelivery
-- after it satisfies the test and sends again. Stripe redelivers as ordinary
-- behaviour.
--
-- So both halves are needed, and they answer different questions:
--   the CONDITION    is it time yet? (nobody left unrefunded)
--   the RECORD       has it already been done? (unique on the tenancy)
--
-- THE RECORD IS THE AUTHORITY, and the insert is the claim. Two co-tenants'
-- webhooks can arrive at the same instant, both see the condition satisfied,
-- and both try: the unique constraint means exactly one insert returns a row
-- and only that caller sends. No advisory lock, no read-then-write race.
--
-- A SOLE APPLICATION HAS NO TENANCY, so the key is the tenancy where there
-- is one and the application otherwise. One column with a unique index over
-- it, rather than two nullable columns and a partial index each: the key is
-- "the thing this notice is about", and that is one thing.

create table if not exists public.cancellation_notices (
  -- The tenancy, or the application where there is no tenancy. Not a foreign
  -- key for that reason: it references one of two tables depending on shape,
  -- and a key that can point at either is a key that enforces neither. The
  -- writer is a SECURITY DEFINER function, which is where the integrity is.
  subject_id uuid primary key,
  tenancy_id uuid references public.tenancies(id) on delete cascade,
  sent_at    timestamptz not null default now(),
  tenants    integer not null
);

comment on table public.cancellation_notices is
  'One row per tenancy (or sole application) whose agent and landlord have been told its guarantees are cancelled. Claimed by insert, so two co-tenants'' webhooks arriving together cannot both send. Never deleted: a redelivery weeks later must still find it.';

alter table public.cancellation_notices enable row level security;
-- No policy: machinery, not a customer record. Opndoor reads it through the
-- definer function below, and a partner sees the activity row on their own
-- application instead.

-- =========================================================================
-- CLAIMING IT
-- =========================================================================

create or replace function public.claim_cancellation_notice(p_application uuid)
returns boolean language plpgsql security definer set search_path to '' as $function$
declare a public.applications; v_subject uuid; v_left integer; v_count integer;
begin
  select * into a from public.applications where id = p_application;
  if not found then return false; end if;

  v_subject := coalesce(a.tenancy_id, a.id);

  /* IS IT TIME YET? Nobody on this tenancy still paid and unrefunded.
     Counted over the WHOLE family, not over refund_cascades: a tenant
     refunded by hand before the cascade existed has no ledger row, and a
     tenant who never paid has nothing to wait for. The question is about
     the tenancy, so it is asked of the tenancy. */
  select count(*) into v_left
    from public.applications s
   where ((a.tenancy_id is not null and s.tenancy_id = a.tenancy_id)
          or (a.tenancy_id is null and s.id = a.id))
     and s.paid_at is not null
     and coalesce(s.payment_state, '') <> 'refunded';
  if v_left > 0 then return false; end if;

  select count(*) into v_count
    from public.applications s
   where (a.tenancy_id is not null and s.tenancy_id = a.tenancy_id)
      or (a.tenancy_id is null and s.id = a.id);

  /* HAS IT ALREADY BEEN DONE? The insert IS the question, which is what
     makes this safe against two webhooks arriving in the same instant.
     Reading first and then writing would let both read "no" and both
     send. */
  insert into public.cancellation_notices (subject_id, tenancy_id, tenants)
  values (v_subject, a.tenancy_id, v_count)
  on conflict (subject_id) do nothing;

  return found;
end $function$;

revoke all on function public.claim_cancellation_notice(uuid) from public, anon, authenticated;
grant execute on function public.claim_cancellation_notice(uuid) to service_role;

comment on function public.claim_cancellation_notice(uuid) is
  'May this caller send the one per-property cancellation notice? True exactly once per tenancy, and only once every paid tenant on it has been refunded. False for every redelivery and for every co-tenant whose refund was not the last. The insert is the claim, so simultaneous webhooks cannot both win.';
