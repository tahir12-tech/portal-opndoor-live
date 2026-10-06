// A FULL REFUND ON A JOINT TENANCY REFUNDS THE WHOLE TENANCY.
//
// Matt (al): "on a joint tenancy, when one tenant's fee is fully refunded in
// Stripe, the tenancy isn't going ahead, so automatically refund every other
// paid tenant on that tenancy through Stripe, cancel all their deeds, and
// treat the whole tenancy as refunded ... if any co-tenant's refund fails,
// alert ops and show it on Home."
//
// =============================================================================
// THIS IS THE ONLY CODE IN THE PORTAL THAT MOVES MONEY OUTWARD BY ITSELF
// =============================================================================
//
// Everything else waits for a person. This is triggered by a webhook and
// refunds strangers. So it is written around what happens when it goes wrong.
//
// THE LEDGER IS WRITTEN BEFORE THE MONEY MOVES. `start_refund_cascade` opens a
// row per co-tenant; only then is Stripe called. A crash between the two
// leaves a pending row that the next delivery picks up, rather than a refund
// nobody recorded or a record of a refund that never happened.
//
// THE IDEMPOTENCY KEY IS DERIVED, NOT GENERATED. It is
// `refund-cascade-<application id>`, computed in SQL, so the retry after a
// timeout sends the SAME key and Stripe returns the original refund instead
// of making a second one. A generated key would be a new key every time,
// which is the same as having none, and the failure mode is refunding a
// tenant twice.
//
// IT SWEEPS, IT DOES NOT JUST PROCESS. `refund_cascade_work()` returns every
// open row in the estate, not only this tenancy's, so a row that failed last
// week is retried by today's unrelated refund. That is deliberate: there is no
// cron for this, and a queue nobody drains is a queue that silently stops.
// The five-attempt ceiling in 20261008130000 is what keeps a permanent
// refusal from making noise forever.
//
// EACH REFUND RAISES ITS OWN charge.refunded WEBHOOK, which is how the rest
// happens and why there is no deed or email handling here: the co-tenant's
// own event runs apply_stripe_refund, cancels their guarantee and emails
// them, exactly as if they had been refunded by hand. Their event also calls
// start_refund_cascade, which enrols nobody new because everyone is already
// in the ledger or already refunded. That is the loop's stopping condition,
// and it is the `on conflict do nothing` in SQL rather than a flag here.

interface CascadeRow {
  application_id: string;
  guarantee_ref: string;
  idempotency_key: string;
  payment_intent: string | null;
  fee: number;
  attempts: number;
}

export interface CascadeOutcome {
  refunded: string[];
  failed: Array<{ ref: string; error: string }>;
  skipped: string[];
}

export async function runRefundCascade(
  service: { rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> },
  // Narrow on purpose: the only thing this needs from Stripe is refunds.create,
  // and a wider type would let somebody reach for charges or payouts here.
  stripe: { refunds: { create: (p: Record<string, unknown>, o: Record<string, unknown>) => Promise<{ id: string }> } },
): Promise<CascadeOutcome> {
  const out: CascadeOutcome = { refunded: [], failed: [], skipped: [] };

  const { data, error } = await service.rpc("refund_cascade_work");
  if (error) {
    // Nothing is recorded and nothing is refunded. Stripe retries the event,
    // and the ledger rows are still there to be picked up.
    throw new Error(`Could not read the refund cascade queue: ${error.message}`);
  }
  const work = (data ?? []) as CascadeRow[];

  for (const w of work) {
    /* NO PAYMENT INTENT MEANS NOTHING TO REFUND, and it is recorded as
       SKIPPED rather than failed. `start_refund_cascade` only enrols paid
       applications, so this is close to impossible -- which is exactly why
       it must not be silent if it happens. Failed would put it on the Home
       warning and have somebody hunt a Stripe error that does not exist. */
    if (!w.payment_intent) {
      await service.rpc("record_refund_cascade", {
        p_application: w.application_id, p_state: "skipped",
        p_error: "No Stripe payment intent on the application, so there is nothing to refund.",
      });
      out.skipped.push(w.guarantee_ref);
      continue;
    }

    try {
      const refund = await stripe.refunds.create(
        { payment_intent: w.payment_intent },
        { idempotencyKey: w.idempotency_key },
      );
      await service.rpc("record_refund_cascade", {
        p_application: w.application_id, p_state: "succeeded", p_refund_id: refund.id,
      });
      out.refunded.push(w.guarantee_ref);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      /* RECORDED FIRST, ALERTED SECOND. If the alert itself throws, the
         failure is still written down and still on Home; the other way round
         a failed alert would lose the record of the failed refund. */
      await service.rpc("record_refund_cascade", {
        p_application: w.application_id, p_state: "failed", p_error: msg,
      });
      await service.rpc("report_ops_incident", {
        p_type: "refund_cascade_failed",
        p_detail: `${w.guarantee_ref}: the automatic refund of a co-tenant could not be taken through Stripe (${msg}). `
          + `Attempt ${w.attempts + 1} of 5. The other tenants on this tenancy have been refunded and their guarantees cancelled, `
          + `so this one is the odd one out until it is resolved. Refund it in Stripe by hand if this keeps failing.`,
        p_application_id: w.application_id,
      }).then(() => {}, () => {/* never mask the refund failure with an alerting failure */});
      out.failed.push({ ref: w.guarantee_ref, error: msg });
      /* AND THE LOOP CARRIES ON. One co-tenant Stripe will not refund must
         not strand the other two: a cascade that stops at the first failure
         leaves MORE people half-refunded than one that keeps going. */
    }
  }

  return out;
}
