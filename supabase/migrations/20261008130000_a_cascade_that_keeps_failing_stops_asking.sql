-- A CASCADE THAT KEEPS FAILING STOPS ASKING, AND STAYS ON THE LIST.
--
-- Correction to 20261008120000, in a new migration rather than an edit to
-- that one, because dev must keep agreeing with a clean filename-order apply.
--
-- Test: supabase/tests/a_joint_refund_refunds_the_whole_tenancy.test.sql
--
-- =========================================================================
-- WHAT I GOT WRONG
-- =========================================================================
--
-- `refund_cascade_work()` returns every pending OR FAILED row, which is what
-- makes the cascade resumable: the next refund webhook to arrive picks up
-- the row that timed out last time. That part is right and is the point.
--
-- WHAT IT MISSED IS THAT "FAILED" IS NOT ALWAYS TRANSIENT. A refund Stripe
-- refuses permanently -- a charge already disputed, a payment intent that
-- never completed, an account restriction -- fails identically to a network
-- timeout. With no ceiling, that row is retried on EVERY refund webhook
-- this estate ever receives, and raises an ops alert each time. The alert
-- that fires forever is the alert nobody reads, so the one genuine failure
-- underneath it is the thing that gets missed.
--
-- FIVE, AND THE NUMBER MATTERS LESS THAN HAVING ONE. Enough to ride out a
-- Stripe outage; few enough that a permanent refusal stops being noise
-- within one working day.
--
-- IT STOPS RETRYING, IT DOES NOT STOP MATTERING. The row stays `failed`, so
-- it stays in `refund_cascade_failures()`, so it stays on Home until
-- somebody deals with it. That distinction is the whole correction: the
-- quiet failure is the one that drops off a list, not the one that stops
-- being retried.
--
-- NO DOUBLE REFUND RISK EITHER WAY, which is worth saying because it is what
-- makes retrying safe at all: the idempotency key is derived from the
-- application id, so a retry after a call that actually succeeded returns
-- Stripe's original refund rather than issuing a second one.

create or replace function public.refund_cascade_work()
returns table (
  application_id uuid, guarantee_ref text, idempotency_key text,
  payment_intent text, fee numeric, attempts integer
) language sql security definer set search_path to '' as $function$
  select c.application_id, a.guarantee_ref, c.idempotency_key,
         a.stripe_payment_intent_id,
         coalesce(a.paid_amount, a.fee_amount, 0),
         c.attempts
    from public.refund_cascades c
    join public.applications a on a.id = c.application_id
   where c.state in ('pending', 'failed')
     and c.attempts < 5
   order by c.created_at
$function$;

revoke all on function public.refund_cascade_work() from public, anon, authenticated;
grant execute on function public.refund_cascade_work() to service_role;

comment on function public.refund_cascade_work() is
  'Co-tenant refunds still to take through Stripe: pending, plus failed ones worth retrying. Failed rows come back, which is what makes the cascade resumable, but only up to five attempts -- a permanent Stripe refusal otherwise retries on every refund webhook forever and buries its own alert. Giving up retrying does NOT clear it: the row stays failed and stays in refund_cascade_failures(), so it stays on Home.';
