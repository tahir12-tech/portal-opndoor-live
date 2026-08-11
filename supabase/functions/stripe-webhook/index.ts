// =====================================================================
// stripe-webhook (verify_jwt = false)
//
// Stripe cannot send a Supabase JWT, so JWT verification is off and security
// is the Stripe signature (STRIPE_WEBHOOK_SECRET). Uses the service role for
// the privileged transition via apply_stripe_payment / apply_stripe_refund.
//
// Idempotency, two layers:
//  1. Each event id is inserted into stripe_events; a duplicate delivery is a
//     no-op (returns 200 without processing).
//  2. apply_stripe_payment only transitions a still-Sent application, so a
//     repeated completed event never double-transitions.
//
// Failure / abandonment (payment_intent.payment_failed, checkout.session.expired)
// leave status untouched. Refunds are recorded without reversing Sent -> Paid.
//
// LIVE AND SANDBOX ARRIVE AT THE SAME URL. Stripe sends test-mode and live-mode
// events to the same endpoint, and the mode is derived from WHICH SIGNING SECRET
// VERIFIES THE SIGNATURE, never from anything in the body. livemode is a field in
// a Stripe event, but reading it would mean trusting a value from a request whose
// authenticity is the very thing being established, so it is deliberately
// ignored. A caller who cannot forge the sandbox HMAC cannot make a live event
// look like a sandbox one.
//
// The verified mode is then cross-checked against the application's own livemode.
// They can only disagree if an event from one mode is replayed against an
// application from the other, so a mismatch is refused outright and raises an ops
// alert rather than being reconciled.
// =====================================================================
import Stripe from "npm:stripe@^17";
import { createClient } from "npm:@supabase/supabase-js@2";
import { generateDeed, voidDocument } from "../_shared/pandadoc.ts";
import { deliverRefund } from "../_shared/refundEmail.ts";
import { deliverPaymentReceipt } from "../_shared/paymentReceiptEmail.ts";
import { titleCaseAddress } from "../_shared/text.ts";
import { stripeSecretFor, stripeWebhookSecrets, maySendOpndoorEmail } from "../_shared/livemodeCredentials.ts";

/**
 * Refuse an event whose mode does not match the application it names.
 *
 * The two can only disagree if an event verified with one mode's signing secret
 * is processed against an application created in the other. That is either a
 * replay of a captured sandbox event against a live application id, or a
 * misconfiguration where the same secret has been set for both modes. Neither is
 * recoverable by picking one, and picking the event's mode would let a forged
 * sandbox event refund a real payment.
 *
 * Returns null when the check passes, or a Response to return immediately.
 *
 * 500 rather than 400, deliberately: 400 tells Stripe the event is permanently
 * bad and it stops retrying, which would hide a misconfiguration. A 500 keeps it
 * retrying and visible while the ops alert is dealt with.
 */
/**
 * One construction site for the Stripe client.
 *
 * There are now two: a throwaway used only to verify the signature, and the real
 * one built from the mode that verification established. The apiVersion is
 * pinned and pinning it is deliberate, so it lives here rather than being
 * repeated. (Note the pinned version does not match the types shipped by
 * stripe@17.7.0, which is a pre-existing condition at HEAD and not touched here:
 * changing it would change the wire behaviour of the live payment path.)
 */
function stripeClient(secret: string): Stripe {
  return new Stripe(secret, { httpClient: Stripe.createFetchHttpClient(), apiVersion: "2024-06-20" });
}

// deno-lint-ignore no-explicit-any
async function refuseOnModeMismatch(service: any, appId: string, eventLivemode: boolean, eventId: string): Promise<Response | null> {
  const { data: row } = await service.from("applications").select("livemode").eq("id", appId).maybeSingle();
  if (!row) return null;                       // unknown id is handled by the callers
  if ((row.livemode === true) === eventLivemode) return null;

  await service.from("ops_alerts").insert({
    alert_type: "stripe_livemode_mismatch",
    detail: `Stripe event ${eventId} verified as ${eventLivemode ? "live" : "sandbox"} but application ${appId} is ${row.livemode ? "live" : "sandbox"}. Refused.`,
  }).then(() => {}, () => {});

  // Drop the dedup row so a corrected redelivery is not swallowed as a duplicate.
  await service.from("stripe_events").delete().eq("id", eventId).then(() => {}, () => {});

  return new Response("Event mode does not match the application.", { status: 500 });
}

Deno.serve(async (req) => {
  const candidates = stripeWebhookSecrets();
  if (candidates.length === 0) return new Response("Webhook secret not configured.", { status: 400 });

  const sig = req.headers.get("stripe-signature");
  const body = await req.text();

  // Verification is pure HMAC over the body and the signing secret; the API key
  // plays no part. So a throwaway client is enough to verify, and the real one is
  // built afterwards from the mode the signature established.
  const verifier = stripeClient("sk_unused_for_verification");
  const provider = Stripe.createSubtleCryptoProvider();

  let event: Stripe.Event | null = null;
  let eventLivemode = false;
  let lastErr = "no signing secret matched";
  for (const c of candidates) {
    try {
      event = await verifier.webhooks.constructEventAsync(body, sig!, c.secret, undefined, provider);
      eventLivemode = c.livemode;
      break;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
  }
  if (!event) return new Response(`Signature verification failed: ${lastErr}`, { status: 400 });

  const secret = stripeSecretFor(eventLivemode);
  if (!secret.ok) return new Response(secret.error, { status: 400 });
  const stripe = stripeClient(secret.value);

  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Layer 1 idempotency: record the event id; a duplicate is skipped.
  const { error: insErr } = await service.from("stripe_events").insert({ id: event.id, type: event.type });
  if (insErr) {
    if (insErr.code === "23505") return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    return new Response(`Could not record event: ${insErr.message}`, { status: 500 }); // let Stripe retry
  }

  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object as Stripe.Checkout.Session;
      const appId = s.metadata?.application_id ?? (typeof s.client_reference_id === "string" ? s.client_reference_id : null);
      const pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id ?? null;
      const amount = (s.amount_total ?? 0) / 100;
      if (appId) {
        // The privileged transition. On a transient DB error supabase-js returns an
        // error object rather than throwing, so check it: delete the dedup row (so a
        // Stripe retry re-processes rather than being deduped to a 200) and throw,
        // which the catch below turns into a 500 + ops alert. Never continue past a
        // failed transition to log/email a payment that did not actually apply.
        const refusal = await refuseOnModeMismatch(service, appId, eventLivemode, event.id);
        if (refusal) return refusal;

        const { error: payErr } = await service.rpc("apply_stripe_payment", { p_application_id: appId, p_payment_intent: pi, p_amount: amount, p_session_id: s.id });
        if (payErr) {
          await service.from("stripe_events").delete().eq("id", event.id);
          throw new Error(`apply_stripe_payment failed: ${payErr.message}`);
        }
        await service.from("stripe_events").update({ application_id: appId }).eq("id", event.id);
        const { data: appRow } = await service.from("applications")
          .select("status, deed_state, guarantee_ref, tenant_title, tenant_last_name, tenant_email, prop_addr1, prop_postcode, livemode")
          .eq("id", appId).maybeSingle();
        // Idempotent post-payment side-effects, run only on the FIRST completed
        // payment for this application (a second DISTINCT Checkout event must not
        // re-log/re-generate/re-email). A prior 'payment_received' row is the marker.
        // A staff-withdrawn anomaly leaves status != 'paid', so nothing fires here.
        const { data: priorPaid } = await service.from("activity_log").select("id").eq("application_id", appId).eq("kind", "payment_received").limit(1);
        if (appRow?.status === "paid" && !priorPaid?.length) {
          await service.from("activity_log").insert({ application_id: appId, kind: "payment_received", message: `Guarantor fee paid (£${amount.toLocaleString("en-GB")}) via Stripe.`, actor: "Stripe" });
          // Generate the deed (fresh or #13 reinstated) unless one already exists.
          if (!appRow.deed_state) await generateDeed(service, appId);
          // #3 Tenant payment receipt.
          // Sandbox sends no Opndoor email. The deed above is different: that is
          // PandaDoc's own watermarked document and rehearsing the tenant's
          // signing journey is the point of sandbox. This is our receipt, to an
          // address a developer typed into a test payload.
          if (appRow.tenant_email && maySendOpndoorEmail(appRow.livemode === true)) {
            const amountGBP = `£${amount.toLocaleString("en-GB", { minimumFractionDigits: amount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
            await deliverPaymentReceipt(service, {
              appId,
              tenantEmail: appRow.tenant_email,
              title: appRow.tenant_title ?? "",
              lastName: appRow.tenant_last_name ?? "",
              // #8 Title-case the address line for display; postcode left raw.
              propertyAddr: [titleCaseAddress(appRow.prop_addr1), appRow.prop_postcode].filter(Boolean).join(", "),
              amount: amountGBP,
              guaranteeRef: appRow.guarantee_ref,
            });
          }
        }
      }
    } else if (event.type === "charge.refunded") {
      const c = event.data.object as Stripe.Charge;
      const pi = typeof c.payment_intent === "string" ? c.payment_intent : c.payment_intent?.id ?? null;
      const refundId = c.refunds?.data?.[0]?.id ?? c.id;
      if (pi) {
        const refundAmount = (c.amount_refunded ?? 0) / 100;
        // Resolve the application from the payment intent first, so the mode can
        // be checked BEFORE the refund is applied rather than after.
        const { data: pre } = await service.from("applications").select("id").eq("stripe_payment_intent_id", pi).maybeSingle();
        if (pre?.id) {
          const refusal = await refuseOnModeMismatch(service, pre.id, eventLivemode, event.id);
          if (refusal) return refusal;
        }
        await service.rpc("apply_stripe_refund", { p_payment_intent: pi, p_refund_id: refundId, p_amount: refundAmount });
        const { data: appRow } = await service.from("applications")
          .select("id, guarantee_ref, refund_after_start, tenant_title, tenant_last_name, tenant_email, prop_addr1, prop_postcode, pandadoc_document_id, deed_state, livemode")
          .eq("stripe_payment_intent_id", pi).maybeSingle();
        if (appRow) {
          await service.from("activity_log").insert({ application_id: appRow.id, kind: "refunded", message: "Payment refunded in Stripe.", actor: "Stripe" });
          if (appRow.refund_after_start) {
            await service.from("activity_log").insert({ application_id: appRow.id, kind: "refund_anomaly", message: "POLICY ANOMALY: refunded on or after the tenancy start date, outside the refund policy. Review required.", actor: "System" });
          }
          if (appRow.pandadoc_document_id && appRow.deed_state === "awaiting_tenant") {
            const voidResult = await voidDocument(appRow.pandadoc_document_id, appRow.livemode === true);
            if (voidResult.ok) {
              await service.from("applications").update({ deed_state: "voided", pandadoc_document_id: null }).eq("id", appRow.id);
              await service.from("activity_log").insert({
                application_id: appRow.id,
                kind: "deed_voided",
                message: "Outstanding deed signing link expired because the payment was refunded.",
                actor: "System",
                visibility: "business",
              });
            }
          }
          // Branded refund confirmation to the tenant (redirected to the review
          // address in test mode). Idempotent: the whole charge.refunded block
          // runs once per event via the stripe_events dedup above.
          // Whole pounds show no decimals; a partial refund shows exactly two.
          const amountGBP = `£${refundAmount.toLocaleString("en-GB", { minimumFractionDigits: refundAmount % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
          if (maySendOpndoorEmail(appRow.livemode === true)) await deliverRefund(service, {
            appId: appRow.id,
            tenantEmail: appRow.tenant_email,
            title: appRow.tenant_title ?? "",
            lastName: appRow.tenant_last_name ?? "",
            // #8 Title-case the address line for display; postcode left raw.
            propertyAddr: [titleCaseAddress(appRow.prop_addr1), appRow.prop_postcode].filter(Boolean).join(", "),
            amount: amountGBP,
            guaranteeRef: appRow.guarantee_ref,
          });
        }
      }
    }
    // payment_intent.payment_failed / checkout.session.expired: acknowledged, no status change.
    return new Response(JSON.stringify({ received: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // #3 A webhook processing failure alerts ops (deduped to one per hour).
    try { await service.rpc("report_ops_incident", { p_type: "webhook_error", p_detail: `stripe-webhook ${event?.type ?? "?"}: ${msg}` }); } catch { /* never mask the original failure */ }
    return new Response(`Handler error: ${msg}`, { status: 500 });
  }
});
