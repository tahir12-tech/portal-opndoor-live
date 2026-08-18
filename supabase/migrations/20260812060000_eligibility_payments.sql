-- ===========================================================================
-- The eligibility fee gets its own ledger, and cannot be mistaken for the
-- guarantee fee by anything.
--
-- THE FAILURE THIS IS SHAPED TO PREVENT
-- stripe-webhook resolves an application from metadata.application_id and has
-- no notion of what a payment is FOR (supabase/functions/stripe-webhook/index.ts:127).
-- Send a GBP 20 eligibility payment through that path and apply_stripe_payment
-- flips status to 'paid', which fires deed generation and emails the tenant a
-- receipt for a Deed of Guarantee they have not bought and may not qualify for
-- (:154-157). That is not a rounding error, it is issuing a legal instrument on
-- a GBP 20 payment.
--
-- ---------------------------------------------------------------------------
-- WHY THE GUARANTEE FEE IS NOT MOVED INTO THIS TABLE
-- ---------------------------------------------------------------------------
-- The tidy design is one payments ledger holding both. It is not worth what it
-- costs today. The guarantee fee's home is payment_state, paid_at and the
-- stripe_* columns on applications, and every money surface in the system reads
-- those: the league, the weekly digest, the commission snapshot, the bordereau,
-- hydrate's fee totals, the refund path. Moving it means editing the referral
-- path's payment write, which is the single highest-risk edit available, in
-- exchange for nothing a user would notice.
--
-- So this table records ELIGIBILITY payments only, and the guarantee fee stays
-- exactly where it is. The referral path does not gain a row here, does not
-- read this table, and is not aware it exists. The unified ledger is recorded
-- in HANDOVER.md as the shape to move to when something else forces the issue.
--
-- ---------------------------------------------------------------------------
-- THE DISCRIMINATOR, AND WHY ABSENCE MEANS GUARANTEE
-- ---------------------------------------------------------------------------
-- Stripe metadata gains `purpose`. The webhook branches on it BEFORE reaching
-- apply_stripe_payment, and treats a MISSING purpose as the guarantee fee.
--
-- That default is the whole safety property. Every Checkout session that exists
-- today, every session already in flight, and every session created by code
-- that has not been redeployed carries no purpose, and all of them must keep
-- behaving exactly as they do now. A default of 'eligibility', or a required
-- field, would turn every in-flight referral payment into an error the moment
-- this ships. The referral path is therefore unchanged BY CONSTRUCTION rather
-- than by remembering to be careful.
-- ===========================================================================

create table if not exists public.application_eligibility_payments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,

  amount   numeric(10,2) not null check (amount >= 0),
  currency text not null default 'GBP',

  -- The Stripe handles. session id is unique, which is the idempotency spine:
  -- a redelivered checkout.session.completed cannot record a second payment.
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id   text,

  -- Same meaning as everywhere else: a sandbox rehearsal is not a real payment.
  -- NOT NULL with no default, deliberately, so a writer has to state it.
  livemode boolean not null,

  paid_at    timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- One eligibility fee per application. A tenant who pays twice is a refund
-- conversation, not a second row, and a partial unique index says so in the
-- database rather than in a comment.
create unique index if not exists application_eligibility_payments_one_per_app
  on public.application_eligibility_payments (application_id);

create index if not exists application_eligibility_payments_paid_idx
  on public.application_eligibility_payments (paid_at);

alter table public.application_eligibility_payments enable row level security;

-- Visibility follows the application, expressed as an EXISTS against it rather
-- than by restating the partner rule, so this table cannot drift away from the
-- visibility of the row it belongs to.
drop policy if exists eligibility_payments_select on public.application_eligibility_payments;
create policy eligibility_payments_select on public.application_eligibility_payments
  for select to authenticated
  using (exists (select 1 from public.applications a where a.id = application_id));

-- No write policy. The only writer is the Stripe webhook under service_role.

comment on table public.application_eligibility_payments is
  'The GBP 20 eligibility fee on the rails where Opndoor arranges the reference. Deliberately NOT the guarantee fee, which stays in payment_state/paid_at/stripe_* on applications and is what every money surface reads. Nothing on the referral path writes or reads this table. Not refundable in software: a decline does not refund, by decision.';

-- ---------------------------------------------------------------------------
-- Recording one, and the state move that goes with it.
--
-- draft -> referencing is here rather than in the Edge Function because the
-- payment and the state change are the same fact and must not be able to
-- half-happen. Note what it does NOT do: no paid_at, no payment_state, no
-- status 'paid'. applications_status_dates would reject a 'referencing' row
-- carrying a paid_at anyway (20260812050000), so this is belt and braces over a
-- database-enforced rule rather than the only thing holding the line.
-- ---------------------------------------------------------------------------
create or replace function public.record_eligibility_payment(
  p_application uuid,
  p_amount numeric,
  p_session text,
  p_payment_intent text,
  p_livemode boolean
) returns public.application_eligibility_payments
language plpgsql security definer set search_path to ''
as $function$
declare a public.applications; r public.application_eligibility_payments;
begin
  select * into a from public.applications where id = p_application;
  if not found then
    raise exception 'Application % not found', p_application using errcode = '22023';
  end if;

  -- Mode must agree. A sandbox key must not be able to record a live payment,
  -- and the mismatch is a refusal rather than a coercion.
  if a.livemode is distinct from p_livemode then
    raise exception 'Eligibility payment livemode does not match the application'
      using errcode = '22023';
  end if;

  -- An eligibility fee only means anything on a rail where we arrange the
  -- reference. On a pre-referenced rail there is nothing to pay for, and taking
  -- one would be charging for work nobody is going to do.
  if a.referencing_mode <> 'opndoor_referenced' then
    raise exception 'Application % is not on a rail that takes an eligibility fee', p_application
      using errcode = '22023';
  end if;

  insert into public.application_eligibility_payments
    (application_id, amount, stripe_checkout_session_id, stripe_payment_intent_id, livemode)
  values (p_application, p_amount, p_session, p_payment_intent, p_livemode)
  on conflict (application_id) do update
    set stripe_checkout_session_id = coalesce(public.application_eligibility_payments.stripe_checkout_session_id,
                                              excluded.stripe_checkout_session_id)
  returning * into r;

  -- Only ever forwards, and only from draft. A redelivered webhook for an
  -- application already in referencing must not rewind or re-fire anything.
  if a.status = 'draft' then
    update public.applications set status = 'referencing' where id = p_application;
  end if;

  return r;
end $function$;

comment on function public.record_eligibility_payment(uuid, numeric, text, text, boolean) is
  'Records the eligibility fee and moves draft -> referencing. Writes no paid_at, no payment_state and never status paid, so no money surface counts it and no deed is generated. Refuses on a rail that does not take an eligibility fee.';

revoke all on function public.record_eligibility_payment(uuid, numeric, text, text, boolean) from public, anon, authenticated;
grant execute on function public.record_eligibility_payment(uuid, numeric, text, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- A standing guard: no eligibility payment may exist against an application
-- that any money surface would count. This is the invariant the whole split
-- exists to protect, so it is checked rather than assumed.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1
    from public.application_eligibility_payments e
    join public.applications a on a.id = e.application_id
    where a.paid_at is not null and a.status in ('paid','deed')
      and a.referencing_mode <> 'opndoor_referenced'
  ) then
    raise exception 'An eligibility payment exists against a pre-referenced application';
  end if;
end $$;
