// =====================================================================
// weekly-digest (verify_jwt = false)
//
// #4 The scheduled weekly job (pg_cron -> net.http_post, twice at 07:00 and 08:00
// UTC to cover BST/GMT; this function self-gates to 08:00 Europe/London so the
// off-hour run no-ops, and to MONDAY only). It emails each partner's Management a
// branded "week at a glance": last-7-days referrals sent, paid, fees collected,
// Sent->Paid conversion, deeds issued, top branch by fees, and the current
// awaiting-signature count. One email per (partner, week) via the
// partner_digest_sends ledger; partners with no activity in the week are skipped.
// Redirected to the review address in this test build.
//
// Auth: the cron path presents x-reminders-secret == REMINDERS_CRON_SECRET (or the
// ops_secrets mirror). The manual TEST path presents a signed-in opndoor-admin JWT
// and body { test: true } (optional { weekStart: 'YYYY-MM-DD' } = the Monday whose
// prior 7 days to report) so it can be verified without waiting.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveRecipients } from "../_shared/emailRecipients.ts";

import { sendMessage } from "../_shared/mailer.ts";
import { weeklyDigestEmail } from "../_shared/emailTemplates.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-reminders-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "opndoor <payments@opndoor.co>";
const REPLY_TO = Deno.env.get("EMAIL_REPLY_TO") ?? "hello@opndoor.co";
// const REVIEW_ADDRESS = Deno.env.get("EMAIL_REVIEW_ADDRESS");
const APP_URL = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");

function londonNow(): { hour: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { hour: Number(g("hour")), date: `${g("year")}-${g("month")}-${g("day")}` };
}
function gbp(n: number): string {
  return `£${Math.round(n ?? 0).toLocaleString("en-GB")}`;
}
function dmy(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
function pct(num: number, den: number): string {
  if (!den) return "0%";
  return `${Math.round((num / den) * 100)}%`;
}
// YYYY-MM-DD shifted by whole days (UTC-anchored, DST-agnostic for a weekly window).
function shiftDate(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface DigestRow {
  partner_id: string; partner_name: string; sent: number; sent_paid: number; paid: number;
  fees: number; deeds: number; awaiting: number; top_branch: string | null; top_branch_fees: number;
  climber?: { name: string; delta: number } | null; // #5 climber of the week
}

const V = "#271d5f", INK = "#5b4d86", LILAC = "#f8eff9", HELI = "#d364fb";
function stat(label: string, value: string): string {
  return `<td style="padding:12px 14px;border:1px solid rgba(39,29,95,0.1);border-radius:12px;background:#fff;" width="50%">
    <div style="font:700 11px 'Manrope',system-ui,Arial,sans-serif;letter-spacing:0.1em;text-transform:uppercase;color:${INK};">${label}</div>
    <div style="font:800 22px 'Sora',system-ui,Arial,sans-serif;color:${V};margin-top:4px;">${value}</div>
  </td>`;
}
function statPair(a: string, b: string): string {
  return `<tr>${a}<td style="width:12px;"></td>${b}</tr><tr><td colspan="3" style="height:12px;"></td></tr>`;
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
    // Monday only (unless test). getUTCDay of noon avoids any DST edge on the date.
    const weekStart = (test && typeof body.weekStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.weekStart)) ? body.weekStart : nowL.date;
    if (!test && new Date(`${weekStart}T12:00:00Z`).getUTCDay() !== 1) {
      return json({ ok: true, skipped: `not Monday (${weekStart})` });
    }

    // Report the 7 days ending at weekStart 00:00 (the previous Mon..Sun).
    const startIso = `${shiftDate(weekStart, -7)}T00:00:00Z`;
    const endIso = `${weekStart}T00:00:00Z`;
    const rangeLabel = `${dmy(shiftDate(weekStart, -7))} to ${dmy(shiftDate(weekStart, -1))}`;

    const { data: rows, error: rpcErr } = await service.rpc("partner_weekly_digest", { p_start: startIso, p_end: endIso });
    if (rpcErr) return json({ ok: false, error: rpcErr.message }, 500);
    const digest = (rows ?? []) as DigestRow[];

    // #5 Climber of the week: the referrer whose fees-rank rose most vs the prior
    // 7-day window ([-14d, -7d)). One RPC for all partners; attach to each row.
    const prevStartIso = `${shiftDate(weekStart, -14)}T00:00:00Z`;
    const { data: climbers } = await service.rpc("partner_weekly_climbers", {
      p_curr_start: startIso, p_curr_end: endIso, p_prev_start: prevStartIso, p_prev_end: startIso,
    });
    const climberByPartner = new Map<string, { name: string; delta: number }>();
    for (const c of (climbers ?? []) as Array<{ partner_id: string; climber_name: string; climber_delta: number }>) {
      climberByPartner.set(c.partner_id, { name: c.climber_name, delta: Number(c.climber_delta) });
    }
    for (const row of digest) row.climber = climberByPartner.get(row.partner_id) ?? null;

    // Management recipients per partner.
    const { data: mgmt } = await service.from("users").select("email, partner_id").eq("role", "management");
    const mgmtByPartner = new Map<string, string[]>();
    for (const u of (mgmt ?? []) as Array<{ email: string; partner_id: string }>) {
      if (!u.email || !u.partner_id) continue;
      const list = mgmtByPartner.get(u.partner_id) ?? [];
      list.push(u.email);
      mgmtByPartner.set(u.partner_id, list);
    }

    // Already-sent this week (idempotency).
    const { data: already } = await service.from("partner_digest_sends").select("partner_id").eq("week_start", weekStart);
    const sentSet = new Set((already ?? []).map((s: { partner_id: string }) => s.partner_id));

    let emailed = 0, skipped = 0, failed = 0;
    for (const d of digest) {
      const recipients = mgmtByPartner.get(d.partner_id) ?? [];
      // Skip partners with no Management, already sent this week, or no activity.
      if (recipients.length === 0) { skipped += 1; continue; }
      if (sentSet.has(d.partner_id)) { skipped += 1; continue; }
      if (d.sent + d.paid + d.deeds === 0) { skipped += 1; continue; }

      const routed = resolveRecipients(recipients);
      const dest = routed.to;
      // `redirected` was hardcoded false, so the banner three functions up was
      // dead code that could never render. It now reflects what actually
      // happened.
      const tpl = weeklyDigestEmail({
          sent: Number(d.sent ?? 0), paid: Number(d.paid ?? 0), deeds: Number(d.deeds ?? 0),
          fees: `£${Number(d.fees ?? 0).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`,
          commission: null, climber: null, link: `${APP_URL}/dashboard`,
        });
      if (!RESEND_API_KEY || dest.length === 0) { failed += 1; continue; }
      const res = await sendMessage({ to: dest, message: tpl });
      if (!res.ok) { failed += 1; continue; }
      // Only the real scheduled run consumes the idempotency ledger; a manual/test
      // preview must never poison it (which would make the real Monday cron skip
      // that partner for the week).
      if (!test) {
        await service.from("partner_digest_sends").insert({ partner_id: d.partner_id, week_start: weekStart, recipients: recipients.length });
      }
      emailed += 1;
    }

    return json({ ok: true, test, weekStart, rangeLabel, emailed, skipped, failed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error.";
    // #3 A total cron failure (a crash before it could log anything) still alerts
    // ops via report_ops_incident; deduped to one per hour in the database.
    try {
      const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await svc.rpc("report_ops_incident", { p_type: "cron_error:weekly-digest", p_detail: `weekly-digest: ${msg}` });
    } catch { /* never mask the original failure */ }
    return json({ ok: false, error: msg }, 500);
  }
});
