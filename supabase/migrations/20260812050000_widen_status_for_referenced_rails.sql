-- ===========================================================================
-- Three new statuses, for the rails where WE arrange the reference.
--
-- THIS IS THE ONE PIECE OF THE FOUR-RAIL WORK THAT IS NOT ADDITIVE.
-- Everything else adds tables, columns and functions. This rewrites two CHECK
-- constraints that every application on the referral path is validated against
-- on every insert and every status change. Get an arm wrong here and Rightmove's
-- create path or payment path starts refusing, immediately, for every row.
--
-- Both constraints are reproduced IN FULL below because Postgres cannot patch a
-- constraint body. The five existing arms are copied verbatim from
-- 20260705115059_application_expiry_and_reinstate.sql:9-18 and the new arms are
-- appended after them, so a reviewer can diff the top of each list against that
-- file and see nothing moved.
--
-- ---------------------------------------------------------------------------
-- WHY ONLY THREE NEW STATUSES, AND WHY THE RAILS REJOIN THE EXISTING MACHINE
-- ---------------------------------------------------------------------------
-- The obvious design gives every rail its own states. That is wrong, and it
-- would put the referral path's machinery out of reach of the new rails for no
-- benefit.
--
-- Once the referencing provider approves a rail 1 or rail 2 applicant, that
-- application is in EXACTLY the state a referral is in the moment it is
-- created: awaiting the guarantee fee, with a payment link out. So it becomes
-- 'sent', and from there it is sent -> paid -> deed with the existing payment
-- link, the existing chasers, the existing 15-day lapse and the existing deed
-- generation. Nothing is duplicated and nothing new has to learn those rules.
--
-- The new states are therefore a PREFIX, not a parallel machine:
--
--   draft        account exists, form in progress, nothing paid
--   referencing  eligibility fee taken, with the referencing provider
--   declined     provider said no. Terminal.
--        |
--        +--> approved becomes 'sent', and the existing path takes over
--
-- RAIL 4 (inbound hand-over) USES NO NEW STATE AT ALL. It arrives already
-- referenced, which is the same shape as the API rail, so it starts at 'sent'
-- and inherits the payment link, the reminders and the lapse for free.
--
-- ---------------------------------------------------------------------------
-- WHY EVERY NEW ARM SAYS paid_at IS NULL
-- ---------------------------------------------------------------------------
-- paid_at means the GUARANTEE FEE has been paid. It is what every money surface
-- keys on: the league, the digest, the commission snapshot, the bordereau and
-- hydrate's fee totals all read paid_at or status in ('paid','deed'). The
-- eligibility fee is not that, must never write paid_at, and these arms make it
-- impossible to write one by accident: a row in 'referencing' with a paid_at is
-- rejected by the database rather than quietly counted as revenue.
-- ===========================================================================

alter table public.applications drop constraint if exists applications_status_check;
alter table public.applications add constraint applications_status_check
  check (status = any (array[
    -- the five that exist today, unchanged
    'sent','paid','deed','withdrawn','expired',
    -- the referenced-by-us prefix
    'draft','referencing','declined'
  ]));

alter table public.applications drop constraint if exists applications_status_dates;
alter table public.applications add constraint applications_status_dates
  check ((status = 'sent')
      or (status = 'withdrawn' and paid_at is null)
      or (status = 'expired' and paid_at is null)
      or (status = 'paid' and paid_at is not null)
      or (status = 'deed' and paid_at is not null and deed_issued_at is not null)
      -- new, and all three assert the same thing: no guarantee fee has been
      -- taken yet, so no money surface may count them.
      or (status = 'draft' and paid_at is null)
      or (status = 'referencing' and paid_at is null)
      or (status = 'declined' and paid_at is null));

-- ---------------------------------------------------------------------------
-- Prove the five original arms survived the rewrite.
--
-- This is the assertion REGRESSION.md F1.6 exists to re-run by hand. Doing it
-- here as well means a dropped arm fails the migration rather than the first
-- Rightmove payment after it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_arm text;
  v_missing text := '';
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public' and t.relname = 'applications'
    and c.conname = 'applications_status_dates';

  if v_def is null then
    raise exception 'applications_status_dates is missing after the rewrite';
  end if;

  -- Each of these is a behaviour the referral path depends on. Matching on the
  -- normalised text Postgres gives back, not on the source above.
  foreach v_arm in array array[
    '(status = ''paid''::text) AND (paid_at IS NOT NULL)',
    '(status = ''deed''::text) AND (paid_at IS NOT NULL)',
    '(deed_issued_at IS NOT NULL)',
    '(status = ''withdrawn''::text) AND (paid_at IS NULL)',
    '(status = ''expired''::text) AND (paid_at IS NULL)'
  ]
  loop
    if position(v_arm in v_def) = 0 then
      v_missing := v_missing || case when v_missing = '' then '' else '; ' end || v_arm;
    end if;
  end loop;

  if v_missing <> '' then
    raise exception
      'applications_status_dates lost an arm the referral path depends on: %. Definition is now: %',
      v_missing, v_def;
  end if;
end $$;

do $$
declare v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public' and t.relname = 'applications'
    and c.conname = 'applications_status_check';

  -- All eight, and nothing silently dropped from the original five.
  if position('sent' in v_def) = 0 or position('paid' in v_def) = 0
     or position('deed' in v_def) = 0 or position('withdrawn' in v_def) = 0
     or position('expired' in v_def) = 0 or position('draft' in v_def) = 0
     or position('referencing' in v_def) = 0 or position('declined' in v_def) = 0 then
    raise exception 'applications_status_check is missing a status: %', v_def;
  end if;
end $$;

comment on constraint applications_status_dates on public.applications is
  'Positive OR-chain over named statuses, so an unknown status is rejected outright. Every new-rail arm requires paid_at IS NULL: paid_at means the guarantee fee, and the eligibility fee must never write it. See 20260812050000.';
