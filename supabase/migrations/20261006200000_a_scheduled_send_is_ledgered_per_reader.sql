-- A SCHEDULED SEND IS LEDGERED PER READER, NOT PER PARTNER.
--
-- The weekly digest and the expiry-cohort CSV are about to be built per
-- READER, because on the agency rail one partner is four competing agencies
-- and a per-partner email carries all of their rows to all of their people.
--
-- Their idempotency ledgers are keyed by partner and period:
--
--   expiry_cohort_sends   primary key (partner_id, cohort_month)
--   partner_digest_sends  unique      (partner_id, week_start)
--
-- Sending per reader against those keys means the first reader's send marks
-- the partner done and every other reader on it is skipped for the month. The
-- ledger would quietly do the opposite of what it is for.
--
-- The key gains the reader. NULLABLE and defaulting to null so the existing
-- rows stay valid and a caller that has not been updated still writes a
-- partner-level row: the unique index below treats null as its own value
-- through coalesce, so a partner-level row and a per-reader row cannot
-- collide with each other.

alter table public.expiry_cohort_sends
  add column if not exists user_id uuid references public.users(id) on delete cascade;

alter table public.partner_digest_sends
  add column if not exists user_id uuid references public.users(id) on delete cascade;

-- The primary key cannot carry a nullable column, so the per-reader uniqueness
-- is an index over a coalesced key. The all-zero uuid stands for "the whole
-- partner", which is what a row with no reader has always meant.
alter table public.expiry_cohort_sends drop constraint if exists expiry_cohort_sends_pkey;
create unique index if not exists expiry_cohort_sends_reader_key
  on public.expiry_cohort_sends (partner_id, cohort_month, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.partner_digest_sends drop constraint if exists partner_digest_sends_partner_id_week_start_key;
create unique index if not exists partner_digest_sends_reader_key
  on public.partner_digest_sends (partner_id, week_start, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid));

comment on column public.expiry_cohort_sends.user_id is
  'The reader this cohort was sent to. Null means a pre-20261006200000 partner-level send. The cohort is built per reader now, because on the agency rail a partner is several unrelated agencies and the CSV carries tenant names.';
comment on column public.partner_digest_sends.user_id is
  'The reader this digest was sent to. Null means a pre-20261006200000 partner-level send.';
