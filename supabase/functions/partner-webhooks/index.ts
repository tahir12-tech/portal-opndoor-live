// =====================================================================
// partner-webhooks (verify_jwt = false)
//
// The outbound webhook dispatcher. Claims due deliveries, POSTs each to its
// endpoint, settles the outcome. Driven by cron; see the scheduling note at the
// bottom of 20260810170000_partner_webhook_claim.sql for why the schedule is a
// deployment step rather than a migration.
//
// Authenticated with the ops secret, matching the other cron-driven functions
// here. Not partner facing: no API key reaches this.
//
// THE ONE PROPERTY THAT MATTERS. Deliveries are processed CONCURRENTLY and
// settled INDEPENDENTLY. A slow or failing endpoint delays only its own rows.
// This is the whole point of the design, and it is why the code below does not
// look like hubspot-sync's ordered loop with a break: that shape is what makes
// one bad event block a feed for ever.
//
// Each attempt has its own timeout. Without one, a partner whose server accepts
// a connection and then never responds would hold a slot until the platform
// kills the whole invocation, and a handful of those would stall the run.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { signedHeaders } from "../_shared/webhookSigning.ts";

/** Deliveries claimed per run. */
const BATCH = 50;

/** Concurrent in-flight deliveries. Bounded so one run cannot exhaust sockets. */
const CONCURRENCY = 10;

/** Per-attempt timeout. */
const TIMEOUT_MS = 10_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Delivery = {
  delivery_id: string;
  endpoint_id: string;
  url: string;
  secret: string;
  event_id: string;
  event_type: string;
  payload: unknown;
  attempts: number;
};

Deno.serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const service = createClient(SUPABASE_URL, SERVICE);

  // ---- auth: same ops-secret posture as the other cron-driven functions -----
  const presented = req.headers.get("x-ops-secret") ?? "";
  const { data: expected } = await service
    .from("ops_secrets").select("secret").eq("name", "reminders_cron").maybeSingle();

  if (!expected?.secret || presented !== expected.secret) {
    return json({ ok: false, error: "Unauthorised." }, 401);
  }

  const { data: claimed, error: claimErr } = await service
    .rpc("claim_partner_webhook_deliveries", { p_limit: BATCH });

  if (claimErr) return json({ ok: false, error: claimErr.message }, 500);

  const deliveries = (claimed ?? []) as Delivery[];
  if (deliveries.length === 0) return json({ ok: true, claimed: 0, delivered: 0, failed: 0 });

  let delivered = 0;
  let failed = 0;

  async function attempt(d: Delivery): Promise<void> {
    const body = JSON.stringify(d.payload);
    let status: number | null = null;
    let error: string | null = null;

    try {
      const headers = await signedHeaders(d.secret, body, d.event_id, d.event_type);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(d.url, { method: "POST", headers, body, signal: ctrl.signal });
        status = res.status;
        // Drain the body so the connection can be reused and does not leak.
        await res.text().catch(() => "");
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      error = String(e);
    }

    // Any 2xx is success. A 410 Gone means the endpoint is permanently retired,
    // so retrying it for a day helps nobody: jump straight to dead by exhausting
    // the schedule rather than crawling through eight attempts.
    const ok = status !== null && status >= 200 && status < 300;
    const permanent = status === 410;

    if (permanent) {
      await service.from("partner_webhook_deliveries")
        .update({ dead_at: new Date().toISOString(), claimed_at: null, last_status: status,
                  last_error: "Endpoint returned 410 Gone" })
        .eq("id", d.delivery_id);
      failed++;
      return;
    }

    await service.rpc("settle_partner_webhook_delivery", {
      p_delivery: d.delivery_id,
      p_ok: ok,
      p_status: status,
      p_error: ok ? null : (error ?? `HTTP ${status}`),
    });

    if (ok) delivered++; else failed++;
  }

  // Bounded concurrency. Deliberately NOT an ordered loop: each delivery settles
  // on its own, so a failure never delays the ones behind it.
  const queue = [...deliveries];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      await attempt(next);
    }
  });
  await Promise.all(workers);

  return json({ ok: true, claimed: deliveries.length, delivered, failed });
});
