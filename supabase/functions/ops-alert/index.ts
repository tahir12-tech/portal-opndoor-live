// =====================================================================
// ops-alert (verify_jwt = false)
//
// #3 Operational failure alerting. Called (fire-and-forget, via pg_net) by the
// activity_log failure trigger and by report_ops_incident for infra failures.
// It formats a branded ops email describing what failed, which application, the
// error and a deep link, and sends it to OPS_ALERT_ADDRESS (falling back to the
// test review address). Dedupe is handled in the database (ops_alerts): by the
// time we are called, at most one alert per failure type per application per hour
// has been recorded, so we simply send.
//
// Auth: the DB presents x-ops-secret, matched against REMINDERS_CRON_SECRET (edge
// env) OR the ops_secrets mirror (resilient to a drifted/unset edge env, exactly
// like the reminder crons). No other caller is accepted.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

import { sendMessage } from "../_shared/mailer.ts";
import { opsAlertEmail } from "../_shared/emailTemplates.ts";
import { timingSafeEqual } from "../_shared/partnerAuth.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ops-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "opndoor <payments@opndoor.co>";
const REPLY_TO = Deno.env.get("EMAIL_REPLY_TO") ?? "hello@opndoor.co";
// Production sets OPS_ALERT_ADDRESS; in this test build it falls back to the review address.
/* OPS_ALERT_ADDRESS and EMAIL_REVIEW_ADDRESS are no longer read here. Q-04:
   who receives an internal alert is the routing table's answer, and a type
   with nobody routed to it falls back to support@opndoor.co inside
   ops_route_recipients -- which also SAYS it fell back, so an unrouted
   critical alert does not look like a configured one. */
const APP_URL = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");

// Human-readable label per failure type (partner-safe wording is irrelevant here:
// this email only ever goes to the opndoor ops address).
const LABELS: Record<string, string> = {
  deed_error: "Deed generation failed",
  deed_delivery_failed: "Deed email to the agent failed to send",
  deed_reminder_failed: "Deed signature reminder failed to send",
  deed_undelivered: "Deed issued but not delivered (no agent contact)",
  deed_void_failed: "Refunded, but the deed signing link could NOT be expired (link may be live)",
  deed_signed_after_refund: "Deed signed AFTER refund, issuance blocked (review required)",
  expiry_reminder_email_failed: "Expiry reminder email failed to send",
  payment_reminder_email_failed: "Payment reminder email failed to send",
  payment_email_failed: "Payment email failed to send",
  refund_email_failed: "Refund confirmation email failed to send",
  refund_anomaly: "Refund policy anomaly (review required)",
  payment_anomaly: "Payment received on a withdrawn application (review + refund)",
  /* A REFUND ON COMMISSION WE HAD ALREADY STATEMENTED. Without an entry
     here the fan-out still routes it -- routing reads
     ops_notification_types, which has it -- but the email subject reads
     the raw type, and an ops alert that says
     "commission_refunded_after_statement" is one somebody has to decode
     before they can act on it. */
  commission_refunded_after_statement: "Refund on commission already sent on a statement",
  cron_error: "Scheduled job error",
  webhook_error: "Webhook processing error",
};

const VALHALLA = "#271d5f";
const DANGER = "#c0392b";
const INK_SOFT = "#5b4d86";
const LILAC = "#f8eff9";

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;font:600 12px 'Manrope',system-ui,Arial,sans-serif;color:${INK_SOFT};white-space:nowrap;vertical-align:top;">${label}</td>
    <td style="padding:6px 0 6px 16px;font:600 14px 'Manrope',system-ui,Arial,sans-serif;color:${VALHALLA};">${value}</td>
  </tr>`;
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const CRON_SECRET = Deno.env.get("REMINDERS_CRON_SECRET") ?? "";
    const service = createClient(SUPABASE_URL, SERVICE);

    // Auth: x-ops-secret must match the edge env OR the ops_secrets mirror.
    const presented = req.headers.get("x-ops-secret") ?? "";
    // Constant time: a cron secret is a bearer credential, and `===` leaks a
    // matching prefix through timing the way a password compare does. The
    // helper already existed for the partner API and the webhook verifier.
    let authed = Boolean(presented) && Boolean(CRON_SECRET) && timingSafeEqual(presented, CRON_SECRET);
    if (!authed && presented) {
      const { data: sec } = await service.from("ops_secrets").select("secret").eq("name", "reminders_cron").maybeSingle();
      if (sec?.secret && timingSafeEqual(presented, sec.secret)) authed = true;
    }
    if (!authed) return json({ ok: false, error: "Not authorised." }, 401);

    const body = await req.json().catch(() => ({}));
    const type = String(body.alert_type ?? "unknown");
    const message = String(body.message ?? "");
    const appId = body.application_id ? String(body.application_id) : null;

    if (!RESEND_API_KEY) return json({ ok: false, error: "Resend not configured." }, 500);

    // Enrich with the application context (ref/tenant/partner) when present.
    let ref: string | null = null, tenant: string | null = null, partner: string | null = null;
    if (appId) {
      const { data: app } = await service
        .from("applications")
        .select("guarantee_ref, tenant_title, tenant_first_name, tenant_last_name, partner:partners(name)")
        .eq("id", appId)
        .maybeSingle();
      if (app) {
        ref = app.guarantee_ref ?? null;
        tenant = [app.tenant_title, app.tenant_first_name, app.tenant_last_name].filter((x) => (x ?? "").toString().trim()).join(" ") || null;
        // deno-lint-ignore no-explicit-any
        const p = app.partner as any;
        partner = (Array.isArray(p) ? p[0]?.name : p?.name) ?? null;
      }
    }
    const link = ref && APP_URL ? `${APP_URL}/applications/${encodeURIComponent(ref)}` : null;
    // Cron/webhook alert_types carry a source suffix (e.g. "cron_error:weekly-digest")
    // so distinct jobs dedupe separately; still render a clean human label.
    const label = LABELS[type]
      ?? (type.startsWith("cron_error") ? "Scheduled job error"
        : type.startsWith("webhook_error") ? "Webhook processing error"
        : type);
    /* WHO GETS IT IS THE ROUTING TABLE'S ANSWER. Q-04. This used to be one
       address out of OPS_ALERT_ADDRESS ?? EMAIL_REVIEW_ADDRESS ?? "", and if
       neither was set the function returned 500 and the alert was lost with
       nothing but an ops_alerts row to show for it.

       The suffix is stripped for routing and kept for the email: the five
       cron_error:<fn> and webhook_error:<fn> variants dedupe separately, which
       is right, and route together, which is also right -- nobody would set
       five switches differently. */
    const routeType = type.split(":")[0];
    const { data: routed } = await service.rpc("ops_route_recipients", { p_type: routeType });
    const rows = (routed ?? []) as Array<{ email: string; fellback: boolean }>;
    const recipients = rows.map((r) => (r.email ?? "").trim()).filter(Boolean);
    const fellback = rows.some((r) => r.fellback === true);

    /* NOTHING TO SEND IS A REAL ANSWER for a non-critical type: somebody
       switched it off, and an unwanted alert is how an inbox stops being read.
       A CRITICAL type never reaches here empty -- ops_route_recipients falls
       back rather than returning nothing. */
    if (!recipients.length) return json({ ok: true, skipped: "no recipients routed", type, ref });

    /* AND THE FALLBACK SAYS SO IN THE EMAIL. A critical alert that arrived at
       support because its own routing was empty looks identical to one that
       was routed there deliberately, and telling those apart is the whole
       point of having a floor. Built as a new message rather than mutating
       the template, so opsAlertEmail stays the single description of the
       ordinary case. */
    const base = opsAlertEmail({ type, label, ref, message, link });
    const tpl = fellback
      ? {
        ...base,
        subject: `[UNROUTED] ${base.subject}`,
        blocks: [
          { p: 'This alert has nobody routed to receive it, so it came here. Set its recipients on the internal notifications page.' },
          ...base.blocks,
        ],
      }
      : base;

    // ONE SEND WITH EACH AS A RECIPIENT, like every other notification.
    // sendMessage returns a SendResult, not a fetch Response: the shared sender
    // already turned the provider's reply into ok plus a reason.
    const res = await sendMessage({ to: recipients, message: tpl });
    if (!res.ok) return json({ ok: false, error: res.error ?? "Send failed." }, 502);
    return json({ ok: true, sent_to: recipients, fellback, type, ref });
  } catch (e) {
    return json({ ok: false, error: "The operational alert could not be sent." }, 500);
  }
});
