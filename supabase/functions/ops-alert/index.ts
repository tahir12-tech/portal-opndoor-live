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
const OPS_ADDRESS = Deno.env.get("OPS_ALERT_ADDRESS") ?? Deno.env.get("EMAIL_REVIEW_ADDRESS") ?? "";
const APP_URL = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");

// Human-readable label per failure type (partner-safe wording is irrelevant here:
// this email only ever goes to the opndoor ops address).
const LABELS: Record<string, string> = {
  deed_error: "Deed generation failed",
  deed_delivery_failed: "Deed email to the agent failed to send",
  deed_reminder_failed: "Deed signature reminder failed to send",
  deed_undelivered: "Deed issued but not delivered (no agent contact)",
  expiry_reminder_email_failed: "Expiry reminder email failed to send",
  payment_reminder_email_failed: "Payment reminder email failed to send",
  payment_email_failed: "Payment email failed to send",
  refund_email_failed: "Refund confirmation email failed to send",
  refund_anomaly: "Refund policy anomaly (review required)",
  payment_anomaly: "Payment received on a withdrawn application (review + refund)",
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
    let authed = Boolean(presented) && Boolean(CRON_SECRET) && presented === CRON_SECRET;
    if (!authed && presented) {
      const { data: sec } = await service.from("ops_secrets").select("secret").eq("name", "reminders_cron").maybeSingle();
      if (sec?.secret && presented === sec.secret) authed = true;
    }
    if (!authed) return json({ ok: false, error: "Not authorised." }, 401);

    const body = await req.json().catch(() => ({}));
    const type = String(body.alert_type ?? "unknown");
    const message = String(body.message ?? "");
    const appId = body.application_id ? String(body.application_id) : null;

    if (!OPS_ADDRESS) return json({ ok: false, error: "No OPS_ALERT_ADDRESS/EMAIL_REVIEW_ADDRESS configured." }, 500);
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
    const tpl = opsAlertEmail({ type, label, ref, message, link });

    const res = await sendMessage({ to: dest, message: tpl });
    // sendMessage returns a SendResult, not a fetch Response: the shared sender
    // already turned the provider's reply into ok plus a reason.
    if (!res.ok) return json({ ok: false, error: res.error ?? "Send failed." }, 502);
    return json({ ok: true, sent_to: OPS_ADDRESS, type, ref });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
