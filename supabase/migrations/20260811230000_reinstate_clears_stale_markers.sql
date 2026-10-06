-- Defect 10: a reinstated application stops carrying the markers of the state it
-- was rescued from.
--
-- The reinstate branch sets status, paid_at, the Stripe ids, paid_amount and
-- payment_state, and nothing else. So expired_at, withdrawn_at, withdrawn_reason
-- and withdrawn_by_tenant survive on a fully paid application, permanently.
--
-- Nothing misreports today: every current consumer keys on `status`. The cost is
-- the trap. "How many lapsed last quarter?" written as `where expired_at is not
-- null` over-counts by every late payment, and because reinstatement is the
-- DESIGNED outcome of the expiry flow rather than a rarity, the error is
-- systematic and one-directional: it inflates churn and deflates conversion.
--
-- Nothing is lost by clearing them. The history is already in activity_log as
-- the expired or withdrawn row plus the payment_reinstated row, and the partner
-- is told separately by application.reinstated.
--
-- Reproduced byte-for-byte from 20260705115059 with the reinstate branch
-- extended and nothing else changed.

create or replace function public.apply_stripe_payment(
  p_application_id uuid, p_payment_intent text, p_amount numeric, p_session_id text
) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.applications;
begin
  select * into a from public.applications where id = p_application_id;
  if not found then raise exception 'application not found'; end if;
  if a.status = 'sent' then
    update public.applications set
      status = 'paid', paid_at = coalesce(paid_at, now()),
      stripe_payment_intent_id   = coalesce(p_payment_intent, stripe_payment_intent_id),
      stripe_checkout_session_id = coalesce(p_session_id, stripe_checkout_session_id),
      paid_amount   = coalesce(p_amount, paid_amount), payment_state = 'paid'
    where id = p_application_id;
  elsif a.status = 'expired' or (a.status = 'withdrawn' and a.withdrawn_by_tenant) then
    -- Late money wins: reinstate the closed application to Paid.
    update public.applications set
      status = 'paid', paid_at = coalesce(paid_at, now()),
      stripe_payment_intent_id   = coalesce(p_payment_intent, stripe_payment_intent_id),
      stripe_checkout_session_id = coalesce(p_session_id, stripe_checkout_session_id),
      paid_amount   = coalesce(p_amount, paid_amount), payment_state = 'paid',
      -- THE FIX. The row now describes what it is rather than what it was.
      --
      -- withdrawn_by_tenant resets to FALSE, not null: it is not nullable, and
      -- false is the correct reading of "this application was not withdrawn by
      -- the tenant" once it is no longer withdrawn at all.
      expired_at          = null,
      withdrawn_at        = null,
      withdrawn_reason    = null,
      withdrawn_note      = null,
      withdrawn_by        = null,
      withdrawn_by_tenant = false
    where id = p_application_id;
    insert into public.activity_log(application_id, kind, message, actor, visibility)
    values (p_application_id, 'payment_reinstated',
      'Guarantor fee paid after ' || a.status || '; application reinstated to Paid.', 'System', 'business');
  elsif a.status = 'withdrawn' then
    -- Staff withdrawal: record the intent but do NOT flip to paid; flag for refund.
    update public.applications set
      stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent),
      stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id)
    where id = p_application_id;
    insert into public.activity_log(application_id, kind, message, actor, visibility)
    values (p_application_id, 'payment_anomaly',
      'Guarantor fee paid on a WITHDRAWN application. Review and refund required.', 'System', 'business');
  else
    update public.applications set
      stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent),
      paid_amount   = coalesce(paid_amount, p_amount),
      payment_state = coalesce(payment_state, 'paid')
    where id = p_application_id;
  end if;
end $$;

-- The constraint that makes it unable to recur is NOT added here. It would fail
-- validation against existing rows, so it belongs after the backfill, in
-- 20260811240000, which is deliberately separate so it can be run knowingly.
