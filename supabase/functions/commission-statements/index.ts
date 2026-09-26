// =====================================================================
// commission-statements (verify_jwt = false)
//
// The scheduled monthly job (pg_cron -> net.http_post, twice at 07:00 and 08:00
// UTC to cover BST/GMT; this function self-gates to 08:00 Europe/London and the
// off-hour run no-ops, exactly as expiry-reminders and expiry-cohorts do).
//
// On the 1st of each month, or the next day that is not a UK bank holiday, it
// posts the previous calendar month's commission statement: one email per payee
// that earned anything, with the total in the subject and in the body, the
// constituent applications attached as a PDF, and a link to the same statement
// in the portal. Opndoor staff get one consolidated settlement email the same
// morning.
//
// WEEKENDS ARE SEND DAYS. A Saturday 1st sends on the Saturday. Only a bank
// holiday moves the date. See UK_BANK_HOLIDAYS and statementSendDay below.
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
import { bytesToBase64, sendMessage } from "../_shared/mailer.ts";
import { renderTablePdf, type PdfColumn } from "../_shared/pdf.ts";
import type { Block, Message } from "../_shared/emailLayout.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-reminders-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

/**
 * THE PAYMENT TERMS SENTENCE. The client's own wording, supplied 2026-09-26.
 *
 * One exported constant, rendered verbatim in the email body and in the
 * attachment, so the two can never say different things. If the terms change,
 * this one string changes and both follow.
 */
export const PAYMENT_TERMS_LINE = "Paid by the 15th of the following month.";

/**
 * The attachment is a PDF, written by _shared/pdf.ts.
 *
 * Resend reads the content type off the filename, so the ".pdf" here is what
 * makes the attachment arrive as application/pdf rather than a download the
 * recipient's mail client refuses to preview. There is no content_type field on
 * the shared Attachment type for that reason; if one is ever needed, it is
 * added in _shared/mailer.ts, not worked around here.
 *
 * WHAT WAS LOST. This used to be a CSV, which opened in Excel and reconciled
 * line by line. A PDF does not. Anyone who needs the numbers in a spreadsheet
 * downloads the month from the Reporting page, which still exports xlsx.
 */
const ATTACHMENT_FORMAT = "pdf" as const;
const ATTACHMENT_MEDIA_TYPE = "application/pdf";

/**
 * A cell with nothing in it reads as one hyphen.
 *
 * Not blank, because a blank cell in a money table looks like a rendering
 * failure; not "None", because that is a value and this is an absence; and not
 * an em dash, which the house style keeps out of copy. A historic line that
 * recorded no commission source is genuinely unknown, and the hyphen says so.
 */
const EMPTY_CELL = "-";

/** Current hour and calendar date in Europe/London. */
function londonNow(): { hour: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour: "2-digit", hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { hour: Number(g("hour")), date: `${g("year")}-${g("month")}-${g("day")}` };
}

/**
 * UK BANK HOLIDAYS, England and Wales, from gov.uk/bank-holidays.
 *
 * A static table, because an Edge Function on a cron cannot depend on reaching
 * gov.uk at 08:00 on the 1st: a fetch that times out would either skip a month
 * of statements or send them on a holiday, and neither is better than a list
 * somebody maintains.
 *
 * THIS TABLE MUST BE EXTENDED BEFORE IT RUNS OUT. It covers 2026 to 2030. The
 * last entry is 2030-12-26; after that, copy the next years off gov.uk and
 * paste them in. statementSendDay logs loudly and falls back to the 1st if it
 * is asked about a year that is not here, so the failure is visible in the
 * function logs and in every dry run rather than silent.
 *
 * Scotland and Northern Ireland differ (2 January, 12 July, St Andrew's Day).
 * England and Wales is the right list: it is the calendar the payment runs and
 * the recipients' own banks keep.
 */
const UK_BANK_HOLIDAYS: readonly string[] = [
  // 2026
  "2026-01-01", // New Year's Day
  "2026-04-03", // Good Friday
  "2026-04-06", // Easter Monday
  "2026-05-04", // Early May
  "2026-05-25", // Spring
  "2026-08-31", // Summer
  "2026-12-25", // Christmas Day
  "2026-12-28", // Boxing Day, substitute for Saturday the 26th
  // 2027
  "2027-01-01",
  "2027-03-26",
  "2027-03-29",
  "2027-05-03",
  "2027-05-31",
  "2027-08-30",
  "2027-12-27", // Christmas Day, substitute for Saturday the 25th
  "2027-12-28", // Boxing Day, substitute for Sunday the 26th
  // 2028
  "2028-01-03", // New Year's Day, substitute for Saturday the 1st
  "2028-04-14",
  "2028-04-17",
  "2028-05-01",
  "2028-05-29",
  "2028-08-28",
  "2028-12-25",
  "2028-12-26",
  // 2029
  "2029-01-01",
  "2029-03-30",
  "2029-04-02",
  "2029-05-07",
  "2029-05-28",
  "2029-08-27",
  "2029-12-25",
  "2029-12-26",
  // 2030
  "2030-01-01",
  "2030-04-19",
  "2030-04-22",
  "2030-05-06",
  "2030-05-27",
  "2030-08-26",
  "2030-12-25",
  "2030-12-26",
];
const HOLIDAY_SET = new Set(UK_BANK_HOLIDAYS);

/** Whether the table above has anything at all to say about a year. */
function bankHolidaysKnownFor(year: number): boolean {
  return UK_BANK_HOLIDAYS.some((d) => d.startsWith(`${year}-`));
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * The day of the month the statements go out: the 1st, or the next day that is
 * not a UK bank holiday.
 *
 * WEEKENDS DO NOT MATTER. A Saturday or Sunday 1st is a send day. This is not
 * an oversight and not the old rule left behind: statements are an email and a
 * PDF, nobody has to be at a desk to receive them, and a weekend rule would
 * have pushed a Saturday 1st to the 3rd for no reason anyone could point at.
 * Only a bank holiday moves it, because that is when the payment behind the
 * statement cannot clear.
 *
 * `covered` is false when the holiday table has run out. The caller surfaces
 * that; the day falls back to the 1st, so an unmaintained table sends on time
 * and possibly on a holiday, rather than skipping a month in silence.
 */
function statementSendDay(year: number, month1: number): { day: number; covered: boolean } {
  if (!bankHolidaysKnownFor(year)) {
    console.error(
      `commission-statements: UK_BANK_HOLIDAYS has no entries for ${year}. ` +
        `The table has run out and must be extended from gov.uk/bank-holidays. ` +
        `Treating every day as a working day, so statements send on the 1st.`,
    );
    return { day: 1, covered: false };
  }
  // Four in a row is the worst Christmas can do; fourteen is room to spare.
  for (let d = 1; d <= 14; d++) {
    if (!HOLIDAY_SET.has(`${year}-${pad2(month1)}-${pad2(d)}`)) return { day: d, covered: true };
  }
  return { day: 1, covered: true }; // unreachable
}

const ordinal = (d: number) =>
  `${d}${d >= 11 && d <= 13 ? "th" : d % 10 === 1 ? "st" : d % 10 === 2 ? "nd" : d % 10 === 3 ? "rd" : "th"}`;

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

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** How a frozen line's source reads in a statement. Mirrors SOURCE_LABEL in
    src/data/commissionSplit.ts, so the PDF and the screen use one vocabulary.
    A historic line recorded no source and prints EMPTY_CELL rather than being
    called standard, which is the whole point of storing it. */
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

/** The statement's columns: the same ones, in the same order, as the table on
    the Reporting page, so a reader can hold the two side by side.

    The widths are points and must sum to no more than 515.28, the printable
    width of A4 portrait inside the margins. Ten columns is what the screen
    shows and what reconciles, so they are tight; a value that outruns its
    column is truncated with an ellipsis rather than allowed to collide with the
    next one. The full value is always on the Reporting page. */
const STATEMENT_COLUMNS: PdfColumn[] = [
  { header: "Reference", width: 44 },
  { header: "Tenant", width: 68 },
  { header: "Branch", width: 54 },
  { header: "Tenancy", width: 66 },
  // Wide enough for "100.00%", not just "50.00%". A share that truncates to
  // "100.0..." is worse than useless on a money document.
  { header: "Share", width: 36, align: "right" },
  { header: "Paid", width: 44 },
  { header: "Fee charged", width: 48, align: "right" },
  { header: "Rate", width: 28, align: "right" },
  // "Opndoor standard" is the longest SOURCE_LABEL and has to fit whole.
  { header: "Source", width: 66 },
  { header: "Commission", width: 60, align: "right" },
]; // 514

function statementPdf(payee: PayeeRow, lines: LineRow[], label: string): Uint8Array {
  return renderTablePdf({
    title: "opndoor commission statement",
    meta: [
      ["Payee", payee.org_name],
      ["Month", label],
      ["Basis", "Commission on fees paid in the month, refunds excluded"],
      ["Applications", String(lines.length)],
      ["Total commission", gbp(num(payee.total))],
    ],
    columns: STATEMENT_COLUMNS,
    rows: lines.map((l) => [
      l.guarantee_ref,
      l.tenant_name,
      l.branch_name,
      l.tenancy_place,
      l.share_percent == null ? EMPTY_CELL : `${Number(num(l.share_percent).toFixed(2))}%`,
      dmy(l.paid_on),
      gbp(num(l.fee)),
      pct(num(l.rate)),
      l.source ? (SOURCE_LABEL[l.source] ?? l.source) : EMPTY_CELL,
      gbp(num(l.commission)),
    ]),
    total: { label: "Total", value: gbp(num(payee.total)) },
    // Along the bottom of every page, which is where a statement carries its
    // terms, and where a multi-page one still carries them on page three.
    footer: PAYMENT_TERMS_LINE,
  });
}

/** The staff settlement, the same way: four columns and a grand total. */
function settlementPdf(payees: PayeeRow[], label: string, grand: number): Uint8Array {
  return renderTablePdf({
    title: "opndoor commission settlement",
    meta: [
      ["Month", label],
      ["Payees", String(payees.length)],
      ["Total payable", gbp(grand)],
    ],
    columns: [
      { header: "Payee", width: 250 },
      { header: "Level", width: 80 },
      { header: "Applications", width: 80, align: "right" },
      { header: "Commission", width: 100, align: "right" },
    ], // 510
    rows: payees.map((p) => [p.org_name, p.level, String(p.line_count), gbp(num(p.total))]),
    total: { label: "Total", value: gbp(grand) },
    footer: PAYMENT_TERMS_LINE,
  });
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
    const [ty, tm, td] = nowL.date.split("-").map(Number);
    const send = statementSendDay(ty, tm);
    // Reported on every response, dry or not, so the schedule can be read off a
    // run without anybody having to work out what the rule did today.
    const schedule = {
      rule: "The 1st of the month, or the next day that is not a UK bank holiday. Weekends are send days.",
      today: nowL.date,
      sendDate: `${ty}-${pad2(tm)}-${pad2(send.day)}`,
      isSendDay: td === send.day,
      bankHolidaysKnownForYear: send.covered,
      bankHolidayTableEndsAfter: UK_BANK_HOLIDAYS[UK_BANK_HOLIDAYS.length - 1],
    };

    // Production gate, in two parts: the right hour, and the right day.
    if (!test && !dry) {
      if (nowL.hour !== 8) {
        return json({ ok: true, skipped: `not 08:00 Europe/London (currently ${String(nowL.hour).padStart(2, "0")}:00)`, schedule });
      }
      if (!schedule.isSendDay) {
        return json({ ok: true, skipped: `not the send day for this month (that is the ${ordinal(send.day)})`, schedule });
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
    const would: Array<{
      payee: string; level: string; total: number; applications: number; to: string[];
      attachment: { filename: string; mediaType: string; bytes: number };
    }> = [];

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
        // The attachment is BUILT here, then thrown away. A dry run that only
        // counted rows would prove the recipients and not the PDF, and the
        // generator is the new part: a malformed one would first be noticed by
        // an agency on the 1st. Building it costs a few milliseconds and turns
        // a crash in the writer into a failed rehearsal instead.
        const pdf = statementPdf(p, lines, label);
        would.push({
          payee: p.org_name, level: p.level, total, applications: lines.length, to,
          attachment: {
            filename: `opndoor-commission-${monthKey}.${ATTACHMENT_FORMAT}`,
            mediaType: ATTACHMENT_MEDIA_TYPE,
            bytes: pdf.length,
          },
        });
        continue;
      }

      const res = await sendMessage({
        to,
        message: statementMessage({ payeeName: p.org_name, label, total, applications: lines.length, appUrl: APP_URL }),
        attachments: [{
          filename: `opndoor-commission-${monthKey}.${ATTACHMENT_FORMAT}`,
          // Bytes, so the chunked encoder, not the CSV path's
          // btoa(unescape(encodeURIComponent(...))), which corrupts binary.
          content: bytesToBase64(statementPdf(p, lines, label)),
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
      const res = await sendMessage({
        to: staffTo,
        message: settlementMessage({
          label, grand, payees, unaddressed, posted, alreadySent, failed, appUrl: APP_URL,
        }),
        attachments: [{
          filename: `opndoor-settlement-${monthKey}.${ATTACHMENT_FORMAT}`,
          content: bytesToBase64(settlementPdf(payees, label, grand)),
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
      // What the schedule decided, and what the attachment is. Both here on
      // every response, because "which day does this fire" and "is it still a
      // CSV" are the two questions asked of this function.
      schedule,
      attachment: { format: ATTACHMENT_FORMAT, mediaType: ATTACHMENT_MEDIA_TYPE },
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
      // who would be written to, with what figure, and with what attached.
      ...(dry ? { would } : {}),
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
