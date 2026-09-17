// =====================================================================
// renewal-notices (verify_jwt = false)
//
// The scheduled daily job (pg_cron -> net.http_post, twice at 07:00 and 08:00
// UTC to cover BST/GMT; this function self-gates to 08:00 Europe/London and the
// off-hour run no-ops). For every in-force guarantee ending within 30 days that
// has not been noticed, it emails the tenant, the agent or landlord on the
// application, and the referrer where there is one, inviting a reply to continue
// cover. One notice per application, enforced by the guarantee_renewal_notices
// ledger inside fire_renewal_notices, and logged to the activity feed.
// Redirected to the review address in this test build.
//
// Auth: the cron path presents x-reminders-secret == REMINDERS_CRON_SECRET (or
// the ops_secrets mirror). The manual TEST path presents a signed-in
// opndoor-admin JWT (or the cron secret) and body { test: true }, optionally
// { date: 'YYYY-MM-DD' } to run against a specific day.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendMessage } from "../_shared/mailer.ts";
import { renewalNoticeEmail } from "../_shared/emailTemplates.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-reminders-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** Current hour and calendar date in Europe/London. */
function londonNow(): { hour: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((x) => x.type === t)?.value ?? "";
  return { hour: Number(g("hour")), date: `${g("year")}-${g("month")}-${g("day")}` };
}

/** yyyy-mm-dd -> "1 September 2027", parsed from the parts so no timezone shifts it. */
function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(d);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const CRON_SECRET = Deno.env.get("REMINDERS_CRON_SECRET") ?? "";

    const body = await req.json().catch(() => ({}));
    const test = !!body.test;
    const service = createClient(SUPABASE_URL, SERVICE);

    // Cron auth: x-reminders-secret must match the edge env OR the ops_secrets mirror.
    const presented = req.headers.get("x-reminders-secret") ?? "";
    let cronAuthed = Boolean(presented) && Boolean(CRON_SECRET) && presented === CRON_SECRET;
    if (!cronAuthed && presented) {
      const { data: sec } = await service.from("ops_secrets").select("secret").eq("name", "reminders_cron").maybeSingle();
      if (sec?.secret && presented === sec.secret) cronAuthed = true;
    }
    let adminAuthed = false;
    if (!cronAuthed) {
      const authHeader = req.headers.get("Authorization") ?? "";
      if (authHeader) {
        const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
        const { data: u } = await userClient.auth.getUser();
        if (u.user?.id) {
          const { data: prof } = await userClient.from("users").select("role").eq("id", u.user.id).maybeSingle();
          adminAuthed = prof?.role === "superadmin";
        }
      }
    }
    if (!cronAuthed && !adminAuthed) return json({ ok: false, error: "Not authorised." }, 401);
    if (!cronAuthed && !test) return json({ ok: false, error: "Manual runs must set { test: true }." }, 400);

    const nowL = londonNow();
    if (!test && nowL.hour !== 8) {
      return json({ ok: true, skipped: `not 08:00 Europe/London (currently ${String(nowL.hour).padStart(2, "0")}:00)` });
    }
    const pToday = (test && typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) ? body.date : nowL.date;

    // Claims each due application into the ledger as it returns it, so this is
    // idempotent: the off-hour run and any re-run send nothing.
    const { data: fired, error: rpcErr } = await service.rpc("fire_renewal_notices", { p_today: pToday });
    if (rpcErr) return json({ ok: false, error: rpcErr.message }, 500);
    const due = (fired ?? []) as Array<{
      application_id: string; guarantee_ref: string; tenant_name: string | null; property_addr: string | null;
      end_date: string; tenant_email: string | null; contact_name: string | null; contact_email: string | null;
      referrer_name: string | null; referrer_email: string | null;
    }>;

    let emailed = 0, emailFailed = 0;
    for (const r of due) {
      const endLabel = fmtDate(String(r.end_date));
      const message = renewalNoticeEmail({
        tenantName: r.tenant_name || "the tenant",
        propertyAddr: r.property_addr || "",
        endDate: endLabel,
      });
      // One email each to the distinct recipients present on the application.
      const recipients = Array.from(new Set(
        [r.tenant_email, r.contact_email, r.referrer_email].filter((e): e is string => typeof e === "string" && e.length > 0),
      ));
      let anySent = false, anyFailed = false;
      for (const to of recipients) {
        const res = await sendMessage({ to, message });
        if (res.ok) { emailed++; anySent = true; } else { emailFailed++; anyFailed = true; }
      }
      const who = [
        r.tenant_email ? "tenant" : null,
        r.contact_email ? "agent/landlord" : null,
        r.referrer_email ? "referrer" : null,
      ].filter(Boolean).join(", ");
      // One activity entry per application. Partner-safe: names who and when.
      await service.from("activity_log").insert({
        application_id: r.application_id,
        kind: anySent ? "renewal_notice_sent" : "renewal_notice_failed",
        message: anySent
          ? `Renewal notice sent to the ${who} — guarantee ends ${endLabel}.`
          : `Renewal notice could not be sent — guarantee ends ${endLabel}.`,
        actor: "System",
        visibility: anySent ? "business" : "internal",
      });
      if (anyFailed && anySent) {
        await service.from("activity_log").insert({
          application_id: r.application_id, kind: "renewal_notice_failed",
          message: "One or more renewal-notice recipients could not be emailed.",
          actor: "System", visibility: "internal",
        });
      }
    }

    return json({ ok: true, test, date: pToday, due: due.length, emailed, emailFailed });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Unexpected error." }, 500);
  }
});
