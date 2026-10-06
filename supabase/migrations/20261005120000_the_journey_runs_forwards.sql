-- THE JOURNEY RUNS FORWARDS.
--
-- There is no ordering enforcement anywhere on public.applications: not one
-- constraint, trigger or check compares two of its eleven journey timestamps.
-- Every in-repo writer stamps now() and is coalesce-guarded, so no RPC and no
-- edge function can write backwards on its own. What can, and did, is a SEED.
--
-- The Regent walk book was seeded by back-dating paid_at to make it look
-- lived-in while sent_at kept the creation time, so three rows were paid five to
-- nine days before they were sent. Nothing refused it, and the consequences are
-- not cosmetic: Sent-to-Paid conversion is computed from these, the timeline
-- renders them in the order it finds them, and the lapse sweep keys on sent_at.
--
-- REFUSE OR FLAG, and the split is not arbitrary. Two clocks write these
-- columns: paid_at, deed_issued_at, deed_executed_at, decided_at and the rest
-- come from Postgres now(); deed_sent_at and deed_viewed_at are written from the
-- Deno runtime in the PandaDoc path. A pair spanning both clocks can invert by
-- milliseconds through nobody's fault, so refusing it would reject a webhook for
-- a skew we caused. Those pairs are FLAGGED. Pairs written by one clock are
-- REFUSED, because there is no honest way for them to invert.
--
-- >= THROUGHOUT, NEVER >. Equality is not tolerated, it is required:
-- set_application_status stamps paid_at and deed_issued_at in one UPDATE, and a
-- pre-referenced row can be created and paid inside a single transaction sharing
-- one now(). A strict test would refuse the ordinary case.
--
-- NULL IS ALWAYS LEGAL. Every arm is null-tolerant: most of these columns are
-- reached only on some journeys, and "has not happened" is not "happened in the
-- wrong order".
--
-- DELIBERATELY NOT ENFORCED, because each looks like a rule and is not:
--   issue_date vs deed_issued_at   issue_date is the generation date PRINTED on
--                                  the deed and is correctly earlier.
--   anything vs tenancy_start      a deed issued before the tenancy starts is
--                                  the normal case, not an anomaly.
--   refunded_at vs paid_at when paid_at is null
--                                  the staff-withdrawn payment branch writes an
--                                  intent with no paid_at, and a refund of that
--                                  intent legitimately stamps refunded_at.
--   deed_issued_at vs deed_executed_at
--                                  three writers give three different
--                                  relationships (equal, one without the other,
--                                  the reverse) and nothing says which is
--                                  canonical. Enforcing a guess would be worse
--                                  than enforcing nothing.

-- ---------------------------------------------------------------------------
-- 1. THE AUDIT, first and separately, so the numbers are known before anything
--    refuses. Run this migration on a copy and read the notices before the
--    constraint below is validated anywhere it matters.
-- ---------------------------------------------------------------------------
do $$
declare r record; v_total bigint := 0;
begin
  for r in
    select 'paid_at before sent_at' as pair, count(*) as n from public.applications where paid_at < sent_at
    union all select 'deed_issued_at before paid_at',   count(*) from public.applications where deed_issued_at < paid_at
    union all select 'deed_executed_at before paid_at', count(*) from public.applications where deed_executed_at < paid_at
    union all select 'deed_viewed_at before deed_sent_at', count(*) from public.applications where deed_viewed_at < deed_sent_at
    union all select 'refunded_at before paid_at',      count(*) from public.applications where paid_at is not null and refunded_at < paid_at
    union all select 'withdrawn_at before sent_at',     count(*) from public.applications where withdrawn_at < sent_at
    union all select 'expired_at before sent_at',       count(*) from public.applications where expired_at < sent_at
    union all select 'decided_at before sent_at',       count(*) from public.applications where decided_at < sent_at
    union all select 'provider_verdict_at before sent_at', count(*) from public.applications where provider_verdict_at < sent_at
  loop
    if r.n > 0 then raise notice 'OUT OF SEQUENCE: % -> % row(s)', r.pair, r.n; end if;
    v_total := v_total + r.n;
  end loop;
  raise notice 'journey sequence audit: % row(s) out of order', v_total;
end $$;

-- ---------------------------------------------------------------------------
-- 2. THE REFUSAL. NOT VALID first so the constraint binds new writes
--    immediately without a table scan, then validated: on a database with
--    existing violations the VALIDATE will fail loudly, which is the intended
--    outcome. Repair the rows the audit named, then run the validate.
-- ---------------------------------------------------------------------------
alter table public.applications drop constraint if exists applications_journey_sequence;
alter table public.applications add constraint applications_journey_sequence check (
      (paid_at              is null or paid_at              >= sent_at)
  and (deed_issued_at       is null or paid_at is null or deed_issued_at   >= paid_at)
  and (deed_executed_at     is null or paid_at is null or deed_executed_at >= paid_at)
  and (deed_viewed_at       is null or deed_sent_at is null or deed_viewed_at >= deed_sent_at)
  and (refunded_at          is null or paid_at is null or refunded_at     >= paid_at)
  and (withdrawn_at         is null or withdrawn_at         >= sent_at)
  and (expired_at           is null or expired_at           >= sent_at)
  and (decided_at           is null or decided_at           >= sent_at)
  and (provider_verdict_at  is null or provider_verdict_at  >= sent_at)
) not valid;

comment on constraint applications_journey_sequence on public.applications is
  'The journey runs forwards. Same-clock pairs only: every column here is stamped by Postgres now(), except deed_sent_at which appears solely as the lower bound of deed_viewed_at (both Deno). Cross-clock pairs are flagged by the trigger below rather than refused, because they can invert by millisecond skew. >= throughout: several writers stamp two of these in one statement.';

alter table public.applications validate constraint applications_journey_sequence;

-- ---------------------------------------------------------------------------
-- 3. THE FLAG, for what must be visible rather than refused. Shaped exactly
--    like awaiting_staff_send (20260925150000), which is the precedent for "a
--    thing staff must work, made filterable".
-- ---------------------------------------------------------------------------
alter table public.applications
  add column if not exists sequence_anomaly boolean not null default false;

comment on column public.applications.sequence_anomaly is
  'A journey timestamp landed out of order across the Postgres/Deno clock boundary. Flagged rather than refused: the pair can invert by millisecond skew through no writer''s fault, and rejecting a PandaDoc webhook for it would lose the event. Staff-facing.';

create index if not exists applications_sequence_anomaly_idx
  on public.applications (sequence_anomaly) where sequence_anomaly;

-- Explicitly granted, like every other column: the table is column-granted and a
-- new column is invisible to authenticated until it is named.
grant select (sequence_anomaly) on public.applications to authenticated;

create or replace function public.flag_sequence_anomaly()
returns trigger language plpgsql set search_path to '' as $function$
begin
  -- CROSS-CLOCK PAIRS ONLY. deed_sent_at is stamped by the Deno runtime in
  -- pandadoc.ts; deed_issued_at and deed_executed_at by Postgres. A deed
  -- executed "before" it was sent is almost always skew, and occasionally a
  -- genuine ordering fault worth a human's eye. Either way the row is written.
  new.sequence_anomaly :=
       (new.deed_issued_at   is not null and new.deed_sent_at is not null and new.deed_issued_at   < new.deed_sent_at)
    or (new.deed_executed_at is not null and new.deed_sent_at is not null and new.deed_executed_at < new.deed_sent_at)
    or (new.deed_executed_at is not null and new.deed_viewed_at is not null and new.deed_executed_at < new.deed_viewed_at);
  return new;
end $function$;

drop trigger if exists applications_flag_sequence_anomaly on public.applications;
create trigger applications_flag_sequence_anomaly
  before insert or update on public.applications
  for each row execute function public.flag_sequence_anomaly();

-- Backfill, so the first view of the queue is honest rather than empty.
update public.applications set sequence_anomaly = true
 where not sequence_anomaly
   and ( (deed_issued_at   is not null and deed_sent_at is not null and deed_issued_at   < deed_sent_at)
      or (deed_executed_at is not null and deed_sent_at is not null and deed_executed_at < deed_sent_at)
      or (deed_executed_at is not null and deed_viewed_at is not null and deed_executed_at < deed_viewed_at) );
