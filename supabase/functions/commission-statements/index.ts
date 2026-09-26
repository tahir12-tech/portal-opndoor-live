// =====================================================================
// commission-statements (verify_jwt = false)
//
// The scheduled monthly job (pg_cron -> net.http_post, twice at 07:00 and 08:00
// UTC to cover BST/GMT; this function self-gates to 08:00 Europe/London and the
// off-hour run no-ops, exactly as expiry-reminders and expiry-cohorts do).
//
// On the FIRST WORKING DAY of each month it posts the previous calendar month's
// commission statement: one email per payee that earned anything, with the total
// in the subject and in the body, the constituent applications attached, and a
// link to the same statement in the portal. Opndoor staff get one consolidated
// settlement email the same morning.
//
// WHAT IS NOT HERE. The statement is not computed in TypeScript. The screen's
// copy (getCommissionStatements in src/data/liveAnalytics.ts) reads a hydrated
// browser store that a cron has no access to, so the same question is asked in
// SQL by commission_statement_lines / commission_statement_payees, which the
// migration comments explain at length. This file formats and posts; it does no
// arithmetic on money beyond adding up rows the database already rounded.
//
// Idempotent: commission_statement_sends holds one row per (month, payee), so
// the off-hour run, a retry and a re-run post nothing a second time.
//
// Auth: the cron path presents x-reminders-secret == REMINDERS_CRON_SECRET (or
// the ops_secrets mirror). The manual path presents a signed-in opndoor-admin
// JWT with { test: true }, optionally { month: 'YYYY-MM' }. Either path may add
// ?dry=1 (or { dry: true }) to get back exactly what WOULD be sent, sending
// nothing and writing nothing.
//
// Every email routes through the shared sender, so EMAIL_REVIEW_ADDRESS
// redirects the lot and a rehearsal cannot reach a real agency.
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendMessage } from "../_shared/mailer.ts";
import type { Block, Message } from "../_shared/emailLayout.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-reminders-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/**
 * THE PAYMENT TERMS SENTENCE, AWAITING THE CLIENT'S OWN WORDING.
 *
 * Matt has not supplied it. Plausible terms are worse than no terms: "payable
 * within 30 days of statement date" reads like a commitment, would be quoted
 * back at us by an agency chasing payment, and nobody here agreed to it. So the
 * placeholder ships visibly, in the place the real sentence will occupy, and
 * whoever has the wording replaces this one string.
 *
 * DO NOT INVENT A VALUE FOR THIS.
 */
export const PAYMENT_TERMS_LINE = "PAYMENT TERMS: [to be supplied]";

/**
 * THE ATTACHMENT IS A CSV, AND THE RULING ASKED FOR A PDF.
 *
 * This repo has no PDF writer. Deeds are PDFs because PandaDoc renders them from
 * a template and we download the bytes; there is no template for a statement and
 * no generator to point at one. The branded exports the portal offers
 * (exportBranded -> xlsxTemplate.ts) are xlsx, written by a browser-only library.
 * Adding a PDF dependency to an Edge Function to satisfy the wording would be a
 * new runtime dependency chosen by an agent rather than by the team.
 *
 * So the statement attaches as CSV, which opens in Excel, reconciles line by
 * line, and is honest about what it is. This is flagged as outstanding, not
 * quietly substituted.
 */
const ATTACHMENT_FORMAT: "csv" | "pdf" = "csv";

/** Current hour and calendar date in Europe/London. */
function londonNow(): { hour: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { hour: Number(g("hour")), date: `${g("year")}-${g("month")}-${g("day")}` };
}

/**
 * The first working day of a month, as a day number.
 *
 * WEEKENDS ONLY. UK bank holidays are not in this repo and there is no calendar
 * to read one from, so 2 January and Easter Monday are treated as working days.
 * Inventing a holiday table here would be a guess that silently goes stale every
 * year; the gap is reported rather than papered over.
 */
function firstWorkingDay(year: number, month1: number): number {
  for (let d = 1; d <= 7; d++) {
    const dow = new Date(Date.UTC(year, month1 - 1, d)).getUTCDay(); // 0 Sun, 6 Sat
    if (dow !== 0 && dow !== 6) return d;
  }
  return 1; // unreachable: a seven-day run of weekends does not exist
}

/** 'YYYY-MM' of the calendar month before the given London date. */
function previousMonthKey(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

/** 'YYYY-MM' -> 'September 2026'. */
function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" })
    .format(new Date(Date.UTC(y, m - 1, 1)));
}

/** yyyy-mm-dd -> dd/mm/yyyy, parsed from the parts so no timezone shifts it. */
function dmy(iso: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? "");
}

/** The portal's money format, to the penny, matching the statement on screen. */
function gbp(n: number): string {
  return `£${(n ?? 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function pct(rate: number): string {
  return `${Number((rate * 100).toFixed(2))}%`;
}

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCSV(rows: (string | number)[][]): string {
  // The BOM is what makes Excel open a £ sign as a £ sign.
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
/** Base64 for a Resend attachment. Text, so the UTF-8 round trip is explicit. */
function textToBase64(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** How a frozen line's source reads in a statement. Mirrors SOURCE_LABEL in
    src/data/commissionSplit.ts, so the CSV and the screen use one vocabulary.
    A historic line recorded no source and stays blank rather than being called
    standard, which is the whole point of storing it. */
const SOURCE_LABEL: Record<string, string> = {
  standard: "Opndoor standard",
  agreement: "Agreement",
  rate: "Set rate",
};

interface PayeeRow {
  payee_key: string;
  level: "group" | "agency" | "branch";
  org_id: string | null;
  org_name: string;
  partner_id: string | null;
  line_count: number;
  total: number | string;
}
interface LineRow {
  payee_key: string;
  guarantee_ref: string;
  tenant_name: string;
  tenancy_place: string;
  branch_name: string;
  paid_on: string;
  fee: number | string;
  share_percent: number | string | null;
  rate: number | string;
  source: string | null;
  commission: number | string;
}
interface RecipientRow { email: string; full_name: string | null; source: string }

const num = (v: number | string | null | undefined): number => (v == null ? 0 : Number(v));

/** The statement as a spreadsheet: the same columns, in the same order, as the
    table on the Reporting page, so a reader can hold the two side by side. */
function statementCsv(payee: PayeeRow, lines: LineRow[], label: string): string {
  const rows: (string | number)[][] = [
    ["opndoor commission statement"],
    ["Payee", payee.org_name],
    ["Month", label],
    ["Basis", "Commission on fees paid in the month, refunds excluded"],
    ["Applications", lines.length],
    ["Total commission", gbp(num(payee.total))],
    [PAYMENT_TERMS_LINE],
    [],
    ["Reference", "Tenant", "Branch", "Tenancy", "Share", "Paid", "Fee charged", "Rate", "Source", "Commission"],
    ...lines.map((l) => [
      l.guarantee_ref,
      l.tenant_name,
      l.branch_name,
      l.tenancy_place,
      l.share_percent == null ? "" : `${Number(num(l.share_percent).toFixed(2))}%`,
      dmy(l.paid_on),
      gbp(num(l.fee)),
      pct(num(l.rate)),
      l.source ? (SOURCE_LABEL[l.source] ?? l.source) : "",
      gbp(num(l.commission)),
    ]),
    [],
    ["", "", "", "", "", "", "", "", "Total", gbp(num(payee.total))],
  ];
  return toCSV(rows);
}

/** One payee's email. Total in the subject and in the body, per the ruling. */
function statementMessage(opts: {
  payeeName: string; label: string; total: number; applications: number; appUrl: string;
}): Message {
  const blocks: Block[] = [
    { p: `Your commission statement for <b>${esc(opts.label)}</b> is attached. It comes to <b>${esc(gbp(opts.total))}</b>.` },
    {
      rows: [
        ["Month", opts.label],
        ["Applications", String(opts.applications)],
        ["Total commission", gbp(opts.total)],
      ],
    },
    { p: "It covers every application that paid in the month, and the commission each one earned. Refunded applications are excluded." },
    // Rendered verbatim. See PAYMENT_TERMS_LINE.
    { p: esc(PAYMENT_TERMS_LINE) },
    { small: "The same figures are on your Reporting page, where you can pick any month and download it again." },
  ];
  return {
    subject: `Commission statement for ${opts.label}: ${gbp(opts.total)}`,
    heading: `${opts.payeeName}: ${gbp(opts.total)}`,
    blocks,
    ...(opts.appUrl ? { action: { label: "Open your statement", href: `${opts.appUrl}/dashboard` } } : {}),
  };
}

/** The one consolidated email to Opndoor staff: what went out, and what could
    not be addressed. Staff-facing, so it may name every payee.

    No dry-run variant of this exists on purpose. A dry run returns what it would
    post in the response body and sends nothing at all, so a "this was only a
    rehearsal" banner here would be a line of copy that never renders. */
function settlementMessage(opts: {
  label: string; grand: number; payees: PayeeRow[]; unaddressed: string[];
  posted: number; alreadySent: number; failed: number; appUrl: string;
}): Message {
  const LIST_CAP = 25;
  const top = opts.payees.slice(0, LIST_CAP);
  const blocks: Block[] = [
    {
      p: opts.payees.length
        ? `Commission earned in <b>${esc(opts.label)}</b> comes to <b>${esc(gbp(opts.grand))}</b> across ${opts.payees.length} ${opts.payees.length === 1 ? "payee" : "payees"}.`
        : `No commission accrued in <b>${esc(opts.label)}</b>, so no statements were posted.`,
    },
    {
      rows: [
        ["Month", opts.label],
        ["Total payable", gbp(opts.grand)],
        ["Statements posted", String(opts.posted)],
        ...(opts.alreadySent ? ([["Already posted earlier", String(opts.alreadySent)]] as [string, string][]) : []),
        ...(opts.failed ? ([["Could not be emailed", String(opts.failed)]] as [string, string][]) : []),
      ],
    },
  ];
  if (top.length) {
    blocks.push({ h: "By payee" });
    blocks.push({ rows: top.map((p) => [`${p.org_name} (${p.level})`, gbp(num(p.total))] as [string, string]) });
    if (opts.payees.length > top.length) {
      blocks.push({ small: `${opts.payees.length - top.length} more are in the attached file.` });
    }
  }
  if (opts.unaddressed.length) {
    blocks.push({ h: "Nobody to send to" });
    blocks.push({ p: "These payees earned commission and have no active person ticked to receive statements, and no finance address. Nothing was posted for them." });
    blocks.push({ list: opts.unaddressed.map((n) => esc(n)) });
  }
  return {
    subject: `Commission settlement for ${opts.label}: ${gbp(opts.grand)}`,
    heading: `Settlement for ${opts.label}`,
    blocks,
    ...(opts.appUrl ? { action: { label: "Open Reporting", href: `${opts.appUrl}/dashboard` } } : {}),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const CRON_SECRET = Deno.env.get("REMINDERS_CRON_SECRET") ?? "";
    const APP_URL = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");

    const body = await req.json().catch(() => ({}));
    const test = !!body.test;
    // Either spelling: the query string, because a dry run is usually typed into
    // a browser or a curl, and the body, because the other crons take flags there.
    const dry = new URL(req.url).searchParams.get("dry") === "1" || !!body.dry;
    const service = createClient(SUPABASE_URL, SERVICE);

    // Cron auth: x-reminders-secret must match the edge env OR the ops_secrets
    // mirror (resilient to a drifted edge env; the crons pass the Vault secret).
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
    if (!cronAuthed && !test && !dry) {
      return json({ ok: false, error: "Manual runs must set { test: true } or ?dry=1." }, 400);
    }

    const nowL = londonNow();
    // Production gate, in two parts: the right hour, and the right day.
    if (!test && !dry) {
      if (nowL.hour !== 8) {
        return json({ ok: true, skipped: `not 08:00 Europe/London (currently ${String(nowL.hour).padStart(2, "0")}:00)` });
      }
      const [ty, tm, td] = nowL.date.split("-").map(Number);
      const fwd = firstWorkingDay(ty, tm);
      if (td !== fwd) {
        return json({ ok: true, skipped: `not the first working day of the month (that is the ${fwd}${fwd === 1 ? "st" : fwd === 2 ? "nd" : fwd === 3 ? "rd" : "th"})` });
      }
    }

    const monthKey = (typeof body.month === "string" && /^\d{4}-\d{2}$/.test(body.month))
      ? body.month
      : previousMonthKey(nowL.date);
    const label = monthLabel(monthKey);
    const monthStart = `${monthKey}-01`;

    // THE STATEMENT, from the database. One call for the payees, one for every
    // line in the month; the lines are grouped here rather than fetched per payee.
    const { data: payeeData, error: payeeErr } = await service.rpc("commission_statement_payees", { p_month: monthStart });
    if (payeeErr) return json({ ok: false, error: payeeErr.message }, 500);
    const payees = (payeeData ?? []) as PayeeRow[];

    const { data: lineData, error: lineErr } = await service.rpc("commission_statement_lines", { p_month: monthStart });
    if (lineErr) return json({ ok: false, error: lineErr.message }, 500);
    const linesByPayee = new Map<string, LineRow[]>();
    for (const l of (lineData ?? []) as LineRow[]) {
      const list = linesByPayee.get(l.payee_key) ?? [];
      list.push(l);
      linesByPayee.set(l.payee_key, list);
    }
    // Oldest payment first, then reference, which is how the screen sorts a
    // statement and therefore how a reader expects to scan it.
    for (const list of linesByPayee.values()) {
      list.sort((a, b) => (a.paid_on < b.paid_on ? -1 : a.paid_on > b.paid_on ? 1 : a.guarantee_ref.localeCompare(b.guarantee_ref)));
    }

    // Already posted (idempotency). A dry run reads this too, so it can tell you
    // it would post nothing rather than pretending it would post everything.
    const { data: sentRows } = await service.from("commission_statement_sends")
      .select("payee_key").eq("statement_month", monthKey);
    const alreadyPosted = new Set((sentRows ?? []).map((s: { payee_key: string }) => s.payee_key));

    const grand = payees.reduce((s, p) => s + num(p.total), 0);

    let posted = 0, alreadySent = 0, failed = 0, nothingDue = 0;
    const unaddressed: string[] = [];
    const would: Array<{ payee: string; level: string; total: number; applications: number; to: string[] }> = [];

    for (const p of payees) {
      if (alreadyPosted.has(p.payee_key)) { alreadySent += 1; continue; }
      const lines = linesByPayee.get(p.payee_key) ?? [];
      const total = num(p.total);
      // "At least one line" is the ruling's test. A payee whose lines all came to
      // nothing is not owed anything, and an email reading "your commission is
      // £0.00" is noise rather than a statement.
      if (!lines.length || total <= 0) { nothingDue += 1; continue; }

      const { data: recData, error: recErr } = await service.rpc("commission_statement_recipients", {
        p_level: p.level, p_org_id: p.org_id,
      });
      if (recErr) { failed += 1; continue; }
      const to = ((recData ?? []) as RecipientRow[]).map((r) => r.email).filter(Boolean);
      if (!to.length) { unaddressed.push(`${p.org_name} (${gbp(total)})`); continue; }

      if (dry) {
        would.push({ payee: p.org_name, level: p.level, total, applications: lines.length, to });
        continue;
      }

      const res = await sendMessage({
        to,
        message: statementMessage({ payeeName: p.org_name, label, total, applications: lines.length, appUrl: APP_URL }),
        attachments: [{
          filename: `opndoor-commission-${monthKey}.${ATTACHMENT_FORMAT}`,
          content: textToBase64(statementCsv(p, lines, label)),
        }],
      });
      if (!res.ok) { failed += 1; continue; }
      await service.from("commission_statement_sends").insert({
        statement_month: monthKey, payee_key: p.payee_key, recipients: to.length, total,
      });
      posted += 1;
    }

    // ---- The consolidated settlement email, to Opndoor staff only. ----
    const { data: staff } = await service.from("users")
      .select("email, role, status")
      .in("role", ["superadmin", "opndoor_manager"])
      .eq("status", "active");
    const staffTo = Array.from(new Set(
      (staff ?? []).map((u: { email: string | null }) => (u.email ?? "").trim()).filter(Boolean),
    ));

    let settlementSent = false;
    const settlementKey = "@settlement";
    if (staffTo.length && !alreadyPosted.has(settlementKey) && !dry) {
      const csv = toCSV([
        ["opndoor commission settlement"],
        ["Month", label],
        ["Total payable", gbp(grand)],
        [],
        ["Payee", "Level", "Applications", "Commission"],
        ...payees.map((p) => [p.org_name, p.level, p.line_count, gbp(num(p.total))]),
        [],
        ["", "", "Total", gbp(grand)],
      ]);
      const res = await sendMessage({
        to: staffTo,
        message: settlementMessage({
          label, grand, payees, unaddressed, posted, alreadySent, failed, appUrl: APP_URL,
        }),
        attachments: [{
          filename: `opndoor-settlement-${monthKey}.${ATTACHMENT_FORMAT}`,
          content: textToBase64(csv),
        }],
      });
      if (res.ok) {
        settlementSent = true;
        await service.from("commission_statement_sends").insert({
          statement_month: monthKey, payee_key: settlementKey, recipients: staffTo.length, total: grand,
        });
      } else {
        failed += 1;
      }
    }

    return json({
      ok: true,
      dry,
      test,
      month: monthKey,
      monthLabel: label,
      payees: payees.length,
      totalPayable: grand,
      posted,
      alreadySent,
      nothingDue,
      failed,
      unaddressed,
      settlement: {
        recipients: staffTo.length,
        sent: settlementSent,
        alreadySent: alreadyPosted.has(settlementKey),
        ...(dry ? { to: staffTo } : {}),
      },
      // Only a dry run answers this, and it is the whole point of one: exactly
      // who would be written to, and with what figure.
      ...(dry ? { would, attachmentFormat: ATTACHMENT_FORMAT } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unexpected error.";
    // A total cron failure (a crash before it could log anything) still alerts
    // ops via report_ops_incident; deduped to one per hour in the database.
    try {
      const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await svc.rpc("report_ops_incident", {
        p_type: "cron_error:commission-statements",
        p_detail: `commission-statements: ${msg}`,
      });
    } catch { /* never mask the original failure */ }
    return json({ ok: false, error: msg }, 500);
  }
});
