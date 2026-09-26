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
 * AND A CSV, SECOND.
 *
 * The paragraph above used to say the CSV was lost and that anyone wanting the
 * numbers in a spreadsheet should download the month from Reporting. That is a
 * fair answer for somebody who has the portal open and a poor one for a finance
 * mailbox that is reconciling from the email. Both go, PDF first, because the
 * PDF is the statement and the CSV is the working: a mail client shows the
 * first attachment as the document and the order is the only signal of which
 * is which.
 *
 * They are the same numbers from the same rows, built in the same pass. There
 * is no second query and so no way for them to disagree.
 */
const CSV_MEDIA_TYPE = "text/csv";

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCSV(rows: (string | number)[][]): string {
  // The BOM is what makes Excel open a pound sign as a pound sign.
  return "\ufeff" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}
/** Base64 for a text attachment. The UTF-8 round trip is explicit because
    btoa() alone throws on any character above U+00FF, and the BOM is one. */
function textToBase64(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}

/**
 * A cell with nothing in it reads as one hyphen.
 *
 * Not blank, because a blank cell in a money table looks like a rendering
 * failure; not "None", because that is a value and this is an absence; and not
 * an em dash, which the house style keeps out of copy. A historic line that
 * recorded no commission source is genuinely unknown, and the hyphen says so.
 */
const EMPTY_CELL = "-";

/**
 * THE STATEMENT'S NUMBER, AND WHERE IT COMES FROM.
 *
 * public.commission_statement_ref(p_month, p_payee_key) returns
 * STMT-YYYY-MM-NNNN, assigned once per payee per month and identical on every
 * later call. The portal's own download of the same statement
 * (buildCommissionStatementDoc in src/data/exportsService.ts) calls the same RPC
 * with the same payee key, which is id-based on both sides, so the number on
 * this PDF and the number on that spreadsheet are one number. Nothing here
 * derives it: a reference either comes from the one place that stores it or it
 * is not printed.
 *
 * A DRY RUN DOES NOT ASK FOR ONE. ?dry=1 writes nothing, and with this RPC the
 * first call IS the assignment, so a rehearsal would take a real number for a
 * statement nobody received. Every payee a dry run reaches is by definition one
 * that has not been posted (posted payees are skipped by the idempotency check
 * above it), so there is no number yet to show and the honest thing to print is
 * when it will appear.
 */
const REF_ON_SEND = "Assigned when the statement is posted";

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
 * neither a weekend nor a UK bank holiday.
 *
 * BOTH MATTER, and the interesting case is where they compound. 1 January 2028
 * is a Saturday; the 2nd is a Sunday; gov.uk moves New Year's Day to Monday the
 * 3rd as a substitute holiday. So the December 2027 statements go out on
 * TUESDAY 4 JANUARY, three days late, and that is correct: the statement says
 * what is payable and the payment behind it cannot move until the banks are
 * open.
 *
 * The substitute holidays are already in the table as the dates they are
 * OBSERVED, not the dates they commemorate, which is what makes this work: the
 * 3rd is listed, so the loop steps over it without needing to know why.
 *
 * `covered` is false when the holiday table has run out. The caller surfaces
 * that; weekends are still skipped, because those need no table, and the day
 * falls back to the first weekday. An unmaintained table sends on time and
 * possibly on a holiday, rather than skipping a month in silence.
 */
function statementSendDay(year: number, month1: number): { day: number; covered: boolean } {
  const covered = bankHolidaysKnownFor(year);
  if (!covered) {
    console.error(
      `commission-statements: UK_BANK_HOLIDAYS has no entries for ${year}. ` +
        `The table has run out and must be extended from gov.uk/bank-holidays. ` +
        `Weekends are still skipped; bank holidays are not, so a statement may ` +
        `go out on one rather than a month being skipped in silence.`,
    );
  }
  // Fourteen is room to spare: the worst case is a Saturday 1st followed by
  // Christmas-scale substitutes, which is four or five days, never fourteen.
  for (let d = 1; d <= 14; d++) {
    // getUTCDay: 0 Sunday, 6 Saturday. Date.UTC avoids the local-timezone shift
    // that would make the 1st read as the previous day west of Greenwich.
    const dow = new Date(Date.UTC(year, month1 - 1, d)).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (covered && HOLIDAY_SET.has(`${year}-${pad2(month1)}-${pad2(d)}`)) continue;
    return { day: d, covered };
  }
  return { day: 1, covered }; // unreachable
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

/* ---------------------------------------------------------------------
   THE COLUMN RULE, COPIED FROM THE CLIENT.

   A column that says the same thing on every line is dropped, from the header
   as well as the body, and its one value moves up into the header block. The
   reasoning, and why this is not viewerShape, is written out in full at the top
   of src/data/statementColumns.ts.

   THIS IS A COPY AND IT IS MEANT TO BE. An Edge Function runs on Deno and
   cannot import from src/, and a rule this small does not earn a published
   package. So the block below is character for character the block of the same
   name in src/data/statementColumns.ts, and src/data/statementColumns.test.ts
   reads both files and fails the moment they differ. If you change one, change
   the other; the test will tell you if you forget.
   --------------------------------------------------------------------- */

// ---- BEGIN SHARED STATEMENT COLUMN RULE ----
// One rule, two copies, held identical by src/data/statementColumns.test.ts:
//   src/data/statementColumns.ts                        (the screen)
//   supabase/functions/commission-statements/index.ts   (the PDF and the CSV)
// Edit one and you must edit the other. The test fails until you do.

/** The three columns of a statement that can turn out to hold one value for
    every line. The rest (reference, tenant, date, share, rate, money) differ
    row by row by nature, and a statement with one line is still a statement. */
export type StatementDimension = 'agency' | 'branch' | 'source';

/** The only fields of a line this rule reads. A rendering that does not carry
    a dimension leaves it undefined, which is not the same as every row sharing
    a value: it means there is no such column to drop. */
export interface StatementRow {
  agency?: string | null;
  branch?: string | null;
  source?: string | null;
}

export interface StatementShape {
  agencies: number;
  branches: number;
  sources: number;
  /** True when the dimension holds at most one value across these rows, which
      is when its column goes. Named after viewerShape's oneAgency/oneBranch so
      the two read as the single idea they are. */
  oneAgency: boolean;
  oneBranch: boolean;
  oneSource: boolean;
  /** The one value, for the header line that replaces the column. Null when
      the rows hold several, and also when the one thing they share is holding
      none: "every line is missing its branch" is not a fact worth a line. */
  onlyAgency: string | null;
  onlyBranch: string | null;
  onlySource: string | null;
}

/** Distinct values in one dimension.

    AN ABSENT VALUE COUNTS AS A VALUE. A statement where some lines name a
    branch and some do not has two things to say and keeps the column; dropping
    it there would quietly attribute the unbranched lines to the named branch.
    Only when EVERY line is missing it does the dimension collapse, and then
    there is nothing left to name. */
function countDimension(
  values: readonly (string | null | undefined)[],
): { count: number; only: string | null } {
  const seen = new Set<string>();
  let blank = false;
  for (const v of values) {
    const s = (v ?? '').trim();
    if (s) seen.add(s);
    else blank = true;
  }
  const count = seen.size + (blank ? 1 : 0);
  return { count, only: count === 1 && seen.size === 1 ? [...seen][0] : null };
}

/**
 * What these rows have more than one of.
 *
 * NO ROWS ANSWERS ONE OF EVERYTHING, deliberately, exactly as viewerShape's
 * empty book does: an empty statement is not the place to offer a Branch
 * column. The `<= 1` is what puts zero and one together on purpose rather than
 * by accident, and it would not survive somebody rewriting it as `=== 1`.
 */
export function statementShape(rows: readonly StatementRow[]): StatementShape {
  const agency = countDimension(rows.map((r) => r.agency));
  const branch = countDimension(rows.map((r) => r.branch));
  const source = countDimension(rows.map((r) => r.source));
  return {
    agencies: agency.count,
    branches: branch.count,
    sources: source.count,
    oneAgency: agency.count <= 1,
    oneBranch: branch.count <= 1,
    oneSource: source.count <= 1,
    onlyAgency: agency.only,
    onlyBranch: branch.only,
    onlySource: source.only,
  };
}

/** Whether this dimension's column should be left out of the table. */
export function dimensionCollapsed(shape: StatementShape, dim: StatementDimension): boolean {
  return dim === 'agency' ? shape.oneAgency : dim === 'branch' ? shape.oneBranch : shape.oneSource;
}

/** A statement column as the PDF and the CSV declare it. Structurally a
    PdfColumn from _shared/pdf.ts plus the dimension tag, so the surviving list
    can be handed straight to renderTablePdf. */
export interface StatementColumn {
  header: string;
  /** Points. The PDF lays out on these, the CSV ignores them, and the screen
      has no widths at all: it reads the booleans above and lets CSS do it. */
  width: number;
  align?: 'left' | 'right';
  /** Set only on the columns that can collapse. */
  dim?: StatementDimension;
}

/**
 * The columns that survive, with the dropped ones' width shared out.
 *
 * WHY REDISTRIBUTE. The PDF's widths are absolute points chosen to fill the
 * printable width of A4. Dropping a column and leaving the rest where they are
 * would pull the table up short of the right margin, so a statement with one
 * branch would look narrow and left-heavy rather than tidy: the reader would
 * see a rendering fault where we meant to save them a column.
 *
 * Proportional, because every column was sized to what it has to hold and
 * their relative sizes are still right. Handing the whole surplus to one column
 * would make that one luxurious and leave the others as tight as they were.
 *
 * Unrounded on purpose: the writer rounds to two decimals as it draws, so the
 * survivors still sum to exactly what the full set summed to, which is the
 * property that keeps the table inside the page.
 */
export function keepColumns(
  columns: readonly StatementColumn[],
  shape: StatementShape,
): StatementColumn[] {
  const keep = columns.filter((c) => !c.dim || !dimensionCollapsed(shape, c.dim));
  if (keep.length === columns.length) return columns.slice();
  const before = columns.reduce((s, c) => s + c.width, 0);
  const after = keep.reduce((s, c) => s + c.width, 0);
  if (!after) return keep.slice();
  const scale = before / after;
  return keep.map((c) => ({ ...c, width: c.width * scale }));
}
// ---- END SHARED STATEMENT COLUMN RULE ----

/** The dimensions of one month's lines, for the rule above. There is no agency
    per line to give it: commission_statement_lines returns the payee, the
    branch and the frozen rate source, and nothing between them. A group payee
    spanning two agencies would keep an Agency column the moment the RPC and
    LineRow carry one, and until then there is no column to drop. */
function shapeOf(lines: LineRow[]): StatementShape {
  return statementShape(lines.map((l) => ({ branch: l.branch_name, source: l.source })));
}

/** The header block's label and value pairs for the columns that collapsed.
    A dropped column must not take its fact with it: a statement that was all
    Leeds still says Leeds, once, at the top. */
function collapsedMeta(shape: StatementShape): Array<[string, string]> {
  const meta: Array<[string, string]> = [];
  if (shape.onlyBranch) meta.push(["Branch", shape.onlyBranch]);
  if (shape.onlySource) meta.push(["Source", SOURCE_LABEL[shape.onlySource] ?? shape.onlySource]);
  return meta;
}

/** One line's cells, in STATEMENT_COLUMNS order, with the collapsed columns
    left out so the row still lines up with the header. `empty` is the one thing
    the PDF and the CSV genuinely disagree about: a hyphen on a page, nothing at
    all in a column somebody is going to sum. */
function statementCells(l: LineRow, shape: StatementShape, empty: string): string[] {
  const cells: string[] = [l.guarantee_ref, l.tenant_name];
  if (!shape.oneBranch) cells.push(l.branch_name || empty);
  cells.push(
    l.tenancy_place,
    l.share_percent == null ? empty : `${Number(num(l.share_percent).toFixed(2))}%`,
    dmy(l.paid_on),
    gbp(num(l.fee)),
    pct(num(l.rate)),
  );
  if (!shape.oneSource) cells.push(l.source ? (SOURCE_LABEL[l.source] ?? l.source) : empty);
  cells.push(gbp(num(l.commission)));
  return cells;
}

/** The statement's columns: the same ones, in the same order, as the table on
    the Reporting page, so a reader can hold the two side by side.

    The widths are points and must sum to no more than 515.28, the printable
    width of A4 portrait inside the margins. Ten columns is what the screen
    shows and what reconciles, so they are tight; a value that outruns its
    column is truncated with an ellipsis rather than allowed to collide with the
    next one. The full value is always on the Reporting page.

    Branch and Source carry a `dim` tag: those are the two that can hold one
    value for every line, and keepColumns drops them and shares their points
    out among the rest, so a nine-column statement still reaches the right
    margin. The sum below is what the survivors always add back up to. */
const STATEMENT_COLUMNS: StatementColumn[] = [
  { header: "Reference", width: 44 },
  { header: "Tenant", width: 68 },
  { header: "Branch", width: 54, dim: "branch" },
  { header: "Tenancy", width: 66 },
  // Wide enough for "100.00%", not just "50.00%". A share that truncates to
  // "100.0..." is worse than useless on a money document.
  { header: "Share", width: 36, align: "right" },
  { header: "Paid", width: 44 },
  { header: "Fee charged", width: 48, align: "right" },
  { header: "Rate", width: 28, align: "right" },
  // "Opndoor standard" is the longest SOURCE_LABEL and has to fit whole.
  { header: "Source", width: 66, dim: "source" },
  { header: "Commission", width: 60, align: "right" },
]; // 514

function statementPdf(payee: PayeeRow, lines: LineRow[], label: string, reference: string): Uint8Array {
  const shape = shapeOf(lines);
  // Typed as PdfColumn[] at the seam: StatementColumn is a PdfColumn plus the
  // dimension tag, and this is where the compiler proves it still is.
  const columns: PdfColumn[] = keepColumns(STATEMENT_COLUMNS, shape);
  return renderTablePdf({
    title: "opndoor commission statement",
    meta: [
      ["Payee", payee.org_name],
      ["Month", label],
      // What the dropped columns took with them, said once.
      ...collapsedMeta(shape),
      // The stored number, so a finance team can reconcile this document by
      // reference and find the same one in the portal. See REF_ON_SEND.
      ["Statement reference", reference],
      ["Basis", "Commission on fees paid in the month, refunds excluded"],
      ["Applications", String(lines.length)],
      ["Total commission", gbp(num(payee.total))],
    ],
    columns,
    rows: lines.map((l) => statementCells(l, shape, EMPTY_CELL)),
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

/**
 * The same statement as a spreadsheet, built from the same rows in the same
 * pass, so the two attachments cannot disagree. Column order matches the PDF,
 * which matches the table on the Reporting page, so all three can be held side
 * by side.
 */
function statementCsv(payee: PayeeRow, lines: LineRow[], label: string, reference: string): string {
  const shape = shapeOf(lines);
  const columns = keepColumns(STATEMENT_COLUMNS, shape);
  return toCSV([
    ["opndoor commission statement"],
    ["Payee", payee.org_name],
    ["Month", label],
    // The same two lines the PDF puts in its header block, for the same reason:
    // a column that was dropped must not take its one value with it.
    ...collapsedMeta(shape),
    ["Statement reference", reference],
    ["Basis", "Commission on fees paid in the month, refunds excluded"],
    ["Applications", lines.length],
    ["Total commission", gbp(num(payee.total))],
    [PAYMENT_TERMS_LINE],
    [],
    columns.map((c) => c.header),
    // A spreadsheet cell is left EMPTY where the PDF prints a hyphen: the
    // hyphen is a typographic answer to a blank box on a page, and in a column
    // somebody is going to sum it is a value that breaks the sum.
    ...lines.map((l) => statementCells(l, shape, "")),
    [],
    // Padded from the surviving columns, not from ten: a dropped column moves
    // the Total label left, and a hard-coded row would leave it stranded in the
    // middle of the table.
    [...Array.from({ length: Math.max(columns.length - 2, 0) }, () => ""), "Total", gbp(num(payee.total))],
  ]);
}

/** The staff settlement as a spreadsheet, mirroring settlementPdf. */
function settlementCsv(payees: PayeeRow[], label: string, grand: number): string {
  return toCSV([
    ["opndoor commission settlement"],
    ["Month", label],
    ["Payees", payees.length],
    ["Total payable", gbp(grand)],
    [PAYMENT_TERMS_LINE],
    [],
    ["Payee", "Level", "Applications", "Commission"],
    ...payees.map((p) => [p.org_name, p.level, p.line_count, gbp(num(p.total))]),
    [],
    ["", "", "Total", gbp(grand)],
  ]);
}

/** One payee's email. Total in the subject and in the body, per the ruling. */
function statementMessage(opts: {
  payeeName: string; label: string; total: number; applications: number; reference: string; appUrl: string;
}): Message {
  const blocks: Block[] = [
    { p: `Your commission statement for <b>${esc(opts.label)}</b> is attached. It comes to <b>${esc(gbp(opts.total))}</b>.` },
    {
      rows: [
        ["Month", opts.label],
        // In the body as well as on the attachment: somebody replying to this
        // email about one statement can quote its number without opening a PDF.
        ["Statement reference", opts.reference],
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
      rule: "The 1st of the month, or the next day that is neither a weekend nor a UK bank holiday.",
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
      columns: string[]; reference: string;
      attachments: { filename: string; mediaType: string; bytes: number }[];
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

      /* THE STATEMENT'S NUMBER. Asked for AFTER the recipient check, because the
         first call assigns it: a payee nobody can be written to would otherwise
         take a number for a statement that was never posted, and the month's
         sequence would have a hole in it.

         A failed call skips the payee, exactly as a failed recipient lookup
         does. A statement exists to be reconciled by its reference, and posting
         one that has no number while the portal shows it with one is worse than
         posting nothing this morning: the failure is counted, reported in the
         staff settlement email, and nothing is written to
         commission_statement_sends, so a re-run posts it once the RPC answers. */
      let reference = REF_ON_SEND;
      if (!dry) {
        const { data: refData, error: refErr } = await service.rpc("commission_statement_ref", {
          p_month: monthKey, p_payee_key: p.payee_key,
        });
        if (refErr || typeof refData !== "string" || !refData) { failed += 1; continue; }
        reference = refData;
      }

      if (dry) {
        // The attachment is BUILT here, then thrown away. A dry run that only
        // counted rows would prove the recipients and not the PDF, and the
        // generator is the new part: a malformed one would first be noticed by
        // an agency on the 1st. Building it costs a few milliseconds and turns
        // a crash in the writer into a failed rehearsal instead.
        const pdf = statementPdf(p, lines, label, reference);
        const csv = statementCsv(p, lines, label, reference);
        would.push({
          payee: p.org_name, level: p.level, total, applications: lines.length, to, reference,
          // Which columns this payee's statement came out with. Reading it off
          // the response is the only way to check the column rule without
          // opening the PDF, and the PDF is the one thing a rehearsal cannot
          // show you.
          columns: keepColumns(STATEMENT_COLUMNS, shapeOf(lines)).map((c) => c.header),
          attachments: [
            { filename: `opndoor-commission-${monthKey}.pdf`, mediaType: ATTACHMENT_MEDIA_TYPE, bytes: pdf.length },
            { filename: `opndoor-commission-${monthKey}.csv`, mediaType: CSV_MEDIA_TYPE, bytes: new TextEncoder().encode(csv).length },
          ],
        });
        continue;
      }

      const res = await sendMessage({
        to,
        message: statementMessage({ payeeName: p.org_name, label, total, applications: lines.length, reference, appUrl: APP_URL }),
        // PDF FIRST. A mail client shows the first attachment as the document,
        // so the order is the only signal of which is the statement and which
        // is the working.
        attachments: [{
          filename: `opndoor-commission-${monthKey}.pdf`,
          // Bytes, so the chunked encoder, never the text path's
          // btoa(unescape(encodeURIComponent(...))), which corrupts binary.
          content: bytesToBase64(statementPdf(p, lines, label, reference)),
        }, {
          filename: `opndoor-commission-${monthKey}.csv`,
          content: textToBase64(statementCsv(p, lines, label, reference)),
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
          filename: `opndoor-settlement-${monthKey}.pdf`,
          content: bytesToBase64(settlementPdf(payees, label, grand)),
        }, {
          filename: `opndoor-settlement-${monthKey}.csv`,
          content: textToBase64(settlementCsv(payees, label, grand)),
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
      attachments: [
        { format: ATTACHMENT_FORMAT, mediaType: ATTACHMENT_MEDIA_TYPE },
        { format: "csv", mediaType: CSV_MEDIA_TYPE },
      ],
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
