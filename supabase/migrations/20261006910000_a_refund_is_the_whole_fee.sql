-- A REFUND IS THE WHOLE FEE. THERE IS NO SUCH THING AS A PART REFUND.
--
-- Matt, 2026-09-30: "Opndoor never gives partial refunds. A refund is always
-- the full fee. Make the refund action refuse any amount other than the full
-- fee... instead of changing how partial refunds affect commission."
--
-- Test: supabase/tests/a_refund_is_the_whole_fee.test.sql
--
-- =========================================================================
-- THE THING THAT MAKES THIS DELICATE
-- =========================================================================
--
-- THERE IS NO REFUND ACTION IN THE PORTAL. Nothing in the product creates a
-- Stripe refund. `apply_stripe_refund` has exactly one caller,
-- `stripe-webhook`, and it is not performing a refund -- it is RECORDING one
-- that already happened inside Stripe because somebody refunded there by
-- hand.
--
-- You cannot refuse a fact. If this function simply raises and nothing else
-- changes: Stripe has moved the money, the webhook 500s, Stripe retries for
-- ever, and the application is never marked refunded AT ALL -- still fully
-- paid, commission still paid, deed still live, underwriter still billed.
-- That is worse than the over-correction it replaces.
--
-- So the refusal is paired with a change in `stripe-webhook`, which
-- recognises THIS ERROR CODE, raises a loud ops incident naming the
-- guarantee and the amount, and returns 200 so Stripe stops retrying. The
-- divergence between Stripe and the row is left VISIBLE rather than
-- mis-applied or silently looped. That is the honest handling of something
-- the business says never happens.
--
-- =========================================================================
-- THE WHOLE FEE OF WHAT, EXACTLY
-- =========================================================================
--
-- A joint tenancy can put TWO applications behind one payment intent, and
-- Stripe refunds the payment, not the row. So "the whole fee" is the SUM
-- across every application on that intent, not one row's share. Comparing
-- against a single row would refuse every legitimate full refund of a joint
-- tenancy, which is the opposite of the intended rule.
--
-- R2 is NOT reverted. Its `partially_refunded` state stays: this refusal
-- only prevents FUTURE partials and says nothing about history, so if any
-- application was already mis-marked by the old unconditional flip, R2's
-- logic is still what distinguishes it. The state simply becomes unreachable
-- going forward, which is what "never happens" should look like in a schema.

create or replace function public.apply_stripe_refund(p_payment_intent text, p_refund_id text, p_amount numeric default null::numeric)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare r record; v_basis numeric; v_total_basis numeric; v_total numeric;
begin
  -- THE WHOLE FEE ON THIS PAYMENT, across every application behind it.
  select coalesce(sum(coalesce(a.paid_amount, a.fee_amount, 0)), 0)
    into v_total_basis
    from public.applications a
   where a.stripe_payment_intent_id = p_payment_intent;

  -- MATT'S RULE. An amount that is not the whole fee is refused, and nothing
  -- is written. No amount at all still means the whole fee, which is how
  -- every existing caller behaves and must keep behaving.
  if p_amount is not null and p_amount <> v_total_basis then
    raise exception
      'A refund must be the whole fee of %. Opndoor does not give part refunds; % was reported by Stripe and has not been recorded.',
      v_total_basis::text, p_amount::text
      using errcode = '22023';
  end if;

  for r in
    select id, paid_amount, fee_amount, refunded_amount, stripe_refund_id
      from public.applications
     where stripe_payment_intent_id = p_payment_intent
  loop
    v_basis := coalesce(r.paid_amount, r.fee_amount, 0);

    -- The same refund redelivered. Stripe retries, and this must not count
    -- the money twice; the rest of the statement is idempotent.
    if r.stripe_refund_id is not distinct from p_refund_id then
      v_total := coalesce(r.refunded_amount, 0);
    else
      v_total := v_basis;
    end if;

    update public.applications set
      stripe_refund_id   = p_refund_id,
      refunded_at        = coalesce(refunded_at, now()),
      refunded_amount    = v_total,
      payment_state      = case when v_total >= v_basis then 'refunded'
                                else 'partially_refunded' end,
      refund_after_start = (tenancy_start <= current_date)
    where id = r.id;
  end loop;
end $function$;

comment on function public.apply_stripe_refund(text, text, numeric) is
  'Records a Stripe refund. REFUSES any amount that is not the whole fee (errcode 22023): Opndoor does not give part refunds. "The whole fee" is the SUM across every application on that payment intent, because a joint tenancy puts two behind one payment and Stripe refunds the payment. stripe-webhook matches on 22023 to raise an ops incident and return 200, so a partial reported by Stripe is made visible rather than retried for ever.';
