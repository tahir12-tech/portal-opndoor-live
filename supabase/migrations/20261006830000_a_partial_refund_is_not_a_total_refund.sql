-- R2. A PARTIAL REFUND IS NOT A TOTAL REFUND.
--
-- `apply_stripe_refund` set `payment_state = 'refunded'` unconditionally,
-- whatever amount came back, and OVERWROTE `refunded_amount` rather than
-- adding to it. Measured on dev: a GBP 10 refund against a GBP 1,246.15 fee
-- removed the agency's whole GBP 311.54 commission line, and the payee list
-- went from 5 lines / GBP 1,601.54 to 4 / GBP 1,290.00.
--
-- Three consequences, all live today:
--   - the agency is short-paid its entire commission over ten pounds
--   - stripe-webhook voids an outstanding deed that is still owed
--   - the bordereau drops an executed guarantee that is still enforceable
--
-- Test: supabase/tests/a_partial_refund_is_not_a_total_refund.test.sql
-- It failed first on 6 of 11, with 5 regression guards passing throughout.
--
-- =========================================================================
-- THE NEW STATE, and why it is a state rather than a flag
-- =========================================================================
--
-- A partial refund does not cancel anything. The tenant is still covered,
-- the deed still stands, the underwriter is still on risk. Only money moved.
-- So the row needs to answer two DIFFERENT questions differently:
--
--   "is this guarantee cancelled?"   -> no
--   "how much did we actually keep?" -> the fee, less what went back
--
-- A boolean cannot do that, which is exactly how one word came to wipe a
-- commission line. `partially_refunded` is additive: it widens a CHECK, adds
-- no column and no table, and the referral path does not pass through it.
--
-- EVERY EXISTING READER OF `= 'refunded'` THEREFORE STAYS CORRECT BY
-- CONSTRUCTION -- a partial refund simply is not that value, so the deed is
-- not voided, the bordereau keeps the guarantee, and the renewal notice still
-- goes. The readers that must CHANGE are the ones asking the money question,
-- and they are in the client, in this same commit.

alter table public.applications drop constraint if exists applications_payment_state_check;
alter table public.applications add constraint applications_payment_state_check
  check (payment_state = any (array['awaiting'::text, 'paid'::text,
                                    'partially_refunded'::text, 'refunded'::text]));

-- -------------------------------------------------------------------------
-- WHY THIS IS A LOOP rather than one UPDATE. Each row's decision depends on
-- that row's own paid amount and its own refunds so far, and a joint tenancy
-- can put two applications behind one payment intent. A single statement
-- would need the same arithmetic three times in three column expressions.
-- -------------------------------------------------------------------------
create or replace function public.apply_stripe_refund(p_payment_intent text, p_refund_id text, p_amount numeric default null::numeric)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare r record; v_basis numeric; v_add numeric; v_total numeric;
begin
  for r in
    select id, paid_amount, fee_amount, refunded_amount, stripe_refund_id
      from public.applications
     where stripe_payment_intent_id = p_payment_intent
  loop
    -- What the tenant actually paid on THIS row. paid_amount is the truth;
    -- fee_amount covers a row refunded before the paid amount was recorded.
    v_basis := coalesce(r.paid_amount, r.fee_amount, 0);

    if r.stripe_refund_id is not distinct from p_refund_id then
      -- THE SAME REFUND, REDELIVERED. Stripe retries, and this function is
      -- now additive, so without this the retry would count the money twice.
      -- The rest of the statement still runs: it is idempotent and keeps the
      -- row's other refund columns correct.
      v_total := coalesce(r.refunded_amount, 0);
    else
      -- No amount stated means the whole of what is left, which is how every
      -- existing caller behaved and must keep behaving.
      v_add   := coalesce(p_amount, greatest(v_basis - coalesce(r.refunded_amount, 0), 0));
      v_total := coalesce(r.refunded_amount, 0) + v_add;
    end if;

    -- Never record more back than went out. Stripe will not do this, but the
    -- bordereau and the settlement both divide by this number.
    if v_total > v_basis then v_total := v_basis; end if;

    update public.applications set
      stripe_refund_id   = p_refund_id,
      refunded_at        = coalesce(refunded_at, now()),
      refunded_amount    = v_total,
      -- THE ONE WORD THIS MIGRATION EXISTS FOR.
      payment_state      = case when v_total >= v_basis then 'refunded'
                                else 'partially_refunded' end,
      refund_after_start = (tenancy_start <= current_date)
    where id = r.id;
  end loop;
end $function$;

comment on function public.apply_stripe_refund(text, text, numeric) is
  'Records a Stripe refund. ADDITIVE: refunded_amount accumulates across partial refunds, and the same refund id arriving twice adds nothing. payment_state becomes ''refunded'' only when the refunds reach what was paid; until then ''partially_refunded'', which every "is this cancelled" reader correctly treats as not refunded.';
