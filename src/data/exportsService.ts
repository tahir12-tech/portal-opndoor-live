/* =====================================================================
   Exports service (all GBP, dd/mm/yyyy, British). Rows are synthesised to
   match the modelled counts, exactly as the prototype does. Role gating is
   enforced here too, not just on the button: the application export is
   blocked for referrers, and the bordereau is opndoor-admin only.

   The three human-facing exports (Performance, Application, League) are
   branded .xlsx built from one shared template (xlsxTemplate.ts). The
   Bordereau stays a clean, unbranded CSV: its audience is the underwriter's
   import { feeBaseFor } from './commissionSplit';
import process, and branding risks breaking it.

   Live mode builds every figure from the hydrated live application set (the
   buildLive and buildReal paths), with the same scoping and gating; mock/test
   mode uses the parametric model. Both feed the same BrandedDoc blocks, so the
   export format is identical regardless of source.
   ===================================================================== */
import type { LeagueRow, LeagueView, PartnerScope, Period, Role } from './types';
import { ALL_PARTNERS, maySeeCommission } from './types';
import {
  ANNUAL, APP_BRANCHES, APP_RENTS, APP_REFERRERS, AVG_RENT,
  BX_FIRST, BX_FLATS, BX_LAST, BX_STREETS, BX_TITLES, TREND_MONTHS,
} from './mock/analyticsModel';
import { partnerName, getRatesFor, scopeFor } from './partnersService';
import { isAgencyUser } from './capabilities';
import { viewerShape } from './viewerShape';
// The statement column rule, shared with the screen and (as a copied block) with
// the PDF and the CSV the cron emails. See statementColumns.ts.
import { dimensionCollapsed, statementShape, type StatementDimension } from './statementColumns';
import { guaranteeExpiry, allFull, findRecord, type FullApp } from './applicationsService';
import { getLeague } from './leagueService';
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';
import { periodRange as realPeriodRange, scopeFull, basisInPeriod, inRange } from './paymentMetrics';
import { liveAvailable, liveAggregate, liveVolume, liveMonths, getCommissionSettlement, getAgentCommissionSettlement, getCommissionStatements, livePartnerBreakdown, type SettlementApp } from './liveAnalytics';
// Type-only import: building the document specs needs no runtime code, so the
// heavy xlsx library is not pulled into the main bundle. It is dynamically
// imported in exportBranded, on demand, when an export is actually run.
import type { BrandedDoc, ColType, Column, KeyValue, TableRow } from './xlsxTemplate';
import { feeBaseFor, totalRate, linesFor, agentRailApp } from './commissionSplit';

/** A named branded sheet + the download filename (the xlsx-free document spec). */
export interface BrandedExport {
  sheets: { name: string; doc: BrandedDoc }[];
  filename: string;
}

/**
 * An export with no content, returned when the caller is not entitled to the
 * document. A builder that emits commission has to refuse for itself: relying on
 * a hidden button means the function is one direct call away from handing over a
 * commission statement.
 *
 * Empty rather than throwing, so a mis-wired button downloads nothing instead of
 * crashing the page it was clicked from.
 */
function emptyExport(name: string): BrandedExport {
  return { sheets: [], filename: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-unavailable` };
}

/** Generated-date stamp for the metadata line (dd/mm/yyyy, British). */
function generatedOn(): string {
  return new Date().toLocaleDateString('en-GB');
}

/**
 * Build and download a branded workbook. Lazily loads the xlsx library so it
 * is fetched only when a user runs an export, not on first paint.
 */
export async function exportBranded(built: BrandedExport): Promise<void> {
  const { buildBrandedWorkbook, downloadXlsx } = await import('./xlsxTemplate');
  downloadXlsx(buildBrandedWorkbook(built.sheets), built.filename);
}

const DAY = 86400000;
const TODAY = new Date(2026, 5, 26);
const ALLTIME_START = new Date(2024, 8, 1);
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function dmy(x: Date): string {
  return `${pad(x.getDate())}/${pad(x.getMonth() + 1)}/${x.getFullYear()}`;
}
/* =====================================================================
   ONE MONEY FORMATTER, AND IT IS THE ONLY WAY INTO A CELL.

   Reported: the monthly trend printed September as £4,431.00 where every other
   surface said £4,430.77. Nothing was formatting wrong; the VALUE had already
   been rounded to whole pounds upstream and was then printed into a column of
   pence, so the one table that rounded disagreed by 23p with the year it
   summarises. The general shape of the bug is a money value taking its own
   route to a cell: a Math.round() here, a whole-pound 'money' column there, a
   hand-rolled pound string somewhere else.

   So there is one route. money() is the only thing that turns a number into a
   money cell, MONEY is the only column type a figure may carry, moneyCol() and
   moneyKv() are how a money column and a money key/value line are declared, and
   moneyText() is the same value as text for the cells that have to be able to
   stay blank. exportMoney.test.ts walks every document this file generates and
   fails on a money cell that did not come through here.

   fmtBig() in analyticsService is a different job and stays there: "£4.4k" is a
   headline on a dashboard tile, and it must never produce a cell in a table of
   figures.
   ===================================================================== */

/** The only number format a figure anybody reconciles may carry: pence. The
    template also offers 'money' (whole pounds), which is a HEADLINE format; a
    column of rounded pounds does not foot to the payments it describes. */
const MONEY: Extract<ColType, 'money2'> = 'money2';

/**
 * A money value on its way into a cell, at the penny.
 *
 * Rounds to 2dp and never further. The server apportions a joint tenancy's
 * shares to the penny, and summing them back in floating point reintroduces the
 * dust the apportionment exists to remove: a cell reading 2769.2299999999996 is
 * a defect. Rounding to the POUND is the defect this block exists to stop.
 */
function money(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

/** A money column. Every one in this file is declared here. */
function moneyCol(header: string): Column {
  return { header, type: MONEY };
}

/** A money key/value line, for the summary and settlement blocks. */
function moneyKv(label: string, value: number): KeyValue {
  return { label, value: money(value), type: MONEY };
}

/** Money as TEXT, to the penny, for the cells that are strings rather than
    numeric columns (a CSV, or a column that must stay blank when there is no
    amount: a numeric cell renders the empty string as £0.00 and would claim a
    refund of nothing was issued).

    WAS `Math.round(n)`, whole pounds. Fine in a headline, wrong in anything
    anybody reconciles: a £1,384.61 refund printed as £1,385 is a 72p
    discrepancy the export invented. Built on money(), so the text and the
    numeric cells cannot round differently. */
function moneyText(n: number): string {
  return `£${money(n).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The house empty-cell glyph. A cell with nothing in it reads as one hyphen:
    not blank, which looks like a rendering failure, and not an em dash, which
    the house style keeps out of copy. The same glyph the statement PDF uses. */
const EMPTY = '-';
function addDays(x: Date, n: number): Date {
  return new Date(x.getTime() + n * DAY);
}

function periodRange(p: Period): [Date, Date] {
  if (p.id === 'thismonth') return [new Date(2026, 5, 1), new Date(2026, 5, 30)];
  if (p.id === 'lastmonth') return [new Date(2026, 4, 1), new Date(2026, 4, 31)];
  if (p.id === 'last7') return [addDays(TODAY, -6), TODAY];
  if (p.id === 'last30') return [addDays(TODAY, -29), TODAY];
  if (p.id === 'last90') return [addDays(TODAY, -89), TODAY];
  if (p.id === 'last12m') return [new Date(2025, 5, 27), TODAY];
  return [ALLTIME_START, TODAY];
}

type CsvRow = (string | number)[];
function toCSV(rows: CsvRow[]): string {
  return rows.map((r) => r.map((s) => `"${String(s).replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

/** Trigger a browser download of a CSV string. Written UTF-8 with a BOM so Excel
    reads £ and accented characters correctly (without the BOM it assumes the
    legacy locale codepage and mangles them). */
export function downloadCsv(csv: string, name: string): void {
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

interface EntityRow {
  name: string;
  parent: string;
  sent: number;
  paid: number;
  deed: number;
  fees: number;
}
interface ExportModel {
  sent: number;
  paid: number;
  deed: number;
  fees: number;
  stuckSent: number;
  stuckPaid: number;
  agencies: EntityRow[];
  branches: EntityRow[];
  referrers: EntityRow[];
}

function exportModel(role: Role, period: Period): ExportModel {
  const isRef = role === 'referrer';
  const sent = isRef ? Math.max(1, Math.round(period.fSent * (38 / 342))) : period.fSent;
  const paid = Math.round(sent * period.sp);
  const deed = Math.round(paid * period.pd);
  const fees = paid * AVG_RENT;
  const kc = sent / (isRef ? 38 : 342);
  const stuckSent = Math.round((isRef ? 8 : 74) * kc);
  const stuckPaid = Math.round((isRef ? 3 : 27) * kc);
  const shape = isRef
    ? { agencies: [['Foxglove Residential', 38, 88000]], branches: [['South Kensington', 16, 37000, 'Foxglove Residential'], ['Chelsea', 13, 34000, 'Foxglove Residential'], ['Fulham', 9, 18000, 'Foxglove Residential']], referrers: [['April', 14, 32000], ['March', 13, 30000], ['February', 11, 27000]] }
    : { agencies: [['Foxglove Residential', 214, 246240], ['Marylebone & Co', 152, 168000], ['Northbank Lettings', 108, 98000], ['Hartwell Residential', 96, 72000]], branches: [['South Kensington', 78, 169000, 'Foxglove Residential'], ['Marylebone', 72, 147000, 'Marylebone & Co'], ['Shoreditch', 63, 101000, 'Northbank Lettings'], ['Chelsea', 61, 153000, 'Foxglove Residential'], ['Clapham', 58, 82000, 'Hartwell Residential'], ['Fitzrovia', 54, 110000, 'Marylebone & Co']], referrers: [['Priya Nair', 38, 88000], ['James Okafor', 33, 82000], ['Sophie Bennett', 29, 63000], ['Daniel Wright', 24, 57000], ['Aisha Khan', 21, 45000], ['Marcus Lin', 17, 34000]] };
  const entity = (rows: (string | number)[][]): EntityRow[] =>
    rows.map((r) => {
      const es = Math.max(1, Math.round((r[1] as number) * kc));
      const ep = Math.round(es * period.sp);
      const ed = Math.round(ep * period.pd);
      return { name: r[0] as string, parent: (r[3] as string) || '', sent: es, paid: ep, deed: ed, fees: ep * AVG_RENT };
    });
  return { sent, paid, deed, fees, stuckSent, stuckPaid, agencies: entity(shape.agencies), branches: entity(shape.branches), referrers: entity(shape.referrers) };
}

function bands(total: number, shares: [number, number]): [number, number, number] {
  const a = Math.round(total * shares[0]);
  const b = Math.round(total * shares[1]);
  return [a, b, Math.max(0, total - a - b)];
}

function scopeLabel(role: Role): string {
  const sc = scopeFor(role);
  return sc === ALL_PARTNERS ? 'All partners (combined)' : partnerName(sc);
}

/**
 * Is this document going to one of OUR agencies, rather than to Opndoor staff
 * or to a supplier?
 *
 * ASKED OF THE PARTY, NOT THE ROLE, because the role cannot answer it.
 * 'management' is worn both by a supplier's staff — who are owed a partner
 * settlement and expect every partner column in it — and by the manager of one
 * of our own agencies, for whom the route partner is house plumbing
 * (opndoor-agents) that must never be printed on anything they open. Same role,
 * opposite documents; `role !== 'superadmin'` would have handed the agency the
 * supplier's paperwork. isAgencyUser reads the party in scope, and it is the
 * same question the nav and the route guard ask, so a document and the screen
 * that offered it cannot disagree about who the reader is.
 *
 * Note this is the KIND of reader, which is why it is isAgencyUser and not
 * viewerShape.oneAgency: an Opndoor admin filtered to a single agency still gets
 * the admin document, with its partner columns, because that is what they are
 * there to read. How MUCH of a document to draw is viewerShape's question, and
 * is asked separately below.
 */
function agencyFacing(role: Role): boolean {
  return isAgencyUser(role, scopeFor(role));
}

/**
 * What an agency-facing document calls the slice it covers, in place of "Whole
 * estate".
 *
 * "Whole estate" is Opndoor's phrase for its book of agencies. To the agency
 * inside it the words claim a reach they do not have, and "estate" is one of the
 * two words that must never reach a customer's screen. Their own name is the
 * honest label, and it is taken from the same scoped book every figure below is
 * summed from, so the header cannot name an agency the rows do not contain.
 */
function agencyScopeLabel(role: Role, scope: PartnerScope = scopeFor(role)): string {
  const names = new Set(scopeFull(allFull(), role, scope).map((a) => a.agency).filter(Boolean));
  if (names.size === 1) return [...names][0];
  // More than one: a group holding several of our agencies. None at all: a book
  // with nothing in it yet, where the singular is the honest reading (see the
  // empty-book note in viewerShape).
  return names.size > 1 ? 'Your agencies' : 'Your agency';
}

/**
 * The expiry date to PRINT for an application.
 *
 * A GUARANTEE expires; an application does not. Several call sites read
 * `expiry ?? guaranteeExpiry(tenancyStart)`, which believed a tenancy start was
 * enough to know when cover ends. It is not. An application that is Sent, or
 * Paid and still waiting on its deed, has no cover at all, and printing
 * 31/05/2027 against it states an end date for a guarantee that was never
 * issued — a date an operator will chase and a landlord may rely on.
 *
 * So: blank until the deed exists. After it does, the stored expiry, and only
 * then the tenancy-start computation, which stays as the fallback for a deed
 * whose expiry was never written back.
 */
function expiryOf(a: Pick<FullApp, 'status' | 'deedAt' | 'expiry' | 'tenancyStart'>): Date | null {
  const issued = a.status === 'deed' || a.deedAt != null;
  if (!issued) return null;
  return a.expiry ?? (a.tenancyStart ? guaranteeExpiry(a.tenancyStart) : null);
}

/** The metadata line under the title: period, scope, partner, generated date.
    A null partnerLabel omits the partner segment entirely rather than printing
    an empty one: on an agency-facing document there is no partner to name. */
function brandMeta(period: Period, scopeText: string, partnerLabel: string | null): string {
  const rng = periodRange(period);
  const partnerBit = partnerLabel ? `Partner: ${partnerLabel} · ` : '';
  return `${period.label} (${dmy(rng[0])} to ${dmy(rng[1])}) · ${scopeText} · ${partnerBit}Generated ${generatedOn()} · GBP`;
}
function fileStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/* WHY A BRANCH ROW CAN SHOW NOTHING. Lifted from the League branch board, which
   states the same rule on screen, so the export and the board explain themselves
   the same way. Carried wherever a branch table shows commission. */
const BRANCH_COMMISSION_NOTE = 'A branch earns commission only where it holds a rate of its own. Where it does not, the commission on its referrals is earned by the agency, so the branch row shows nothing.';
/* The referrer figure is not a payment to anybody, which the column heading
   ("Attributed ...") says and this sentence explains. */
const REFERRER_COMMISSION_NOTE = 'Referrer commission columns are attribution (commission generated by each referrer’s referrals), not a payment to the referrer.';

// Branch/agency/referrer breakdown table columns (Sent to Deed is a fraction for the pct format).
const BREAKDOWN_COLS = (first: string, showParent: boolean): Column[] => [
  { header: first, type: 'text' },
  ...(showParent ? [{ header: 'Parent agency', type: 'text' } as Column] : []),
  { header: 'Referrals', type: 'int' },
  // Pence, like every other money column in this file: a table of fees that
  // rounds to the pound cannot be reconciled against the settlement it feeds.
  moneyCol('Fees collected'),
  { header: 'Sent', type: 'int' },
  { header: 'Paid', type: 'int' },
  { header: 'Deed issued', type: 'int' },
  { header: 'Sent to Deed', type: 'pct' },
];
function breakdownRows(list: EntityRow[], showParent: boolean): TableRow[] {
  return list.map((e) =>
    showParent
      ? [e.name, e.parent, e.sent, money(e.fees), e.sent, e.paid, e.deed, e.sent ? e.deed / e.sent : 0]
      : [e.name, e.sent, money(e.fees), e.sent, e.paid, e.deed, e.sent ? e.deed / e.sent : 0],
  );
}


/** Live performance export: every figure summed from the hydrated application set.
    Exported so the agency-facing rules can be tested without Supabase:
    buildPerformanceDoc below picks between this and the parametric model on
    liveAvailable(), which a unit test cannot satisfy, and this is the path that
    actually ships. */
export function buildLivePerformanceDoc(role: Role, period: Period): BrandedExport {
  const scope = scopeFor(role);
  // #109: referrer-tier exports must strip ALL partner/agent commission lines and
  // columns. Management/opndoor-admin exports keep them.
  const showComm = maySeeCommission(role);
  // Two different questions, deliberately separate. `agency` is WHO is reading
  // (see agencyFacing): it removes the partner, which is ours and not theirs.
  // `shape` is HOW MUCH they have: it removes a breakdown that ranks a
  // population of one against a header that already names it.
  const agency = agencyFacing(role);
  const shape = viewerShape(role, scope);
  const a = liveAggregate(role, scope, period);
  const vol = liveVolume(role, scope, period);
  // Header percentages are the EFFECTIVE rate implied by the actual snapshotted
  // commission (gross commission / gross fees), never a live partner rate, so the
  // label always matches the money below even after a partner's rate has been
  // changed and even for an all-partners scope with a mix of snapshotted rates.
  // Gross/gross (not net/net) keeps it exact regardless of partial refunds.
  const pPct = a.feesGross ? Math.round(((a.partnerCommNet + a.partnerCommExcl) / a.feesGross) * 100) : 0;
  const aPct = a.feesGross ? Math.round(((a.agentCommNet + a.agentCommExcl) / a.feesGross) * 100) : 0;
  // What the period's fees were a basis OF, read off the fees themselves. Every
  // header that said "of one month rent" now says what was actually charged, or
  // "the guarantee fee" when the period is mixed or empty.
  const basisWord = a.feeBasis.phrase || 'the guarantee fee';
  /* Live breakdown columns carry net commission per row, so the agency/branch/
     referrer tables reconcile to the summary commission totals.

     THE COMMISSION HEADERS ARE A LIST, NOT A PAIR. They were a fixed [partner,
     agent] tuple, which made "no partner column" unexpressible: the best an
     agency-facing export could do was print the heading and a column of zeroes,
     which is the partner asserting itself on their document anyway. A list of
     one is the agency's own commission and nothing else. */
  const LIVE_BREAKDOWN_COLS = (first: string, showParent: boolean, comm: string[]): Column[] => [
    { header: first, type: 'text' },
    ...(showParent ? [{ header: 'Parent agency', type: 'text' } as Column] : []),
    { header: 'Referrals', type: 'int' },
    moneyCol('Fees collected'),
    { header: 'Sent', type: 'int' },
    { header: 'Paid', type: 'int' },
    { header: 'Deed issued', type: 'int' },
    { header: 'Sent to Deed', type: 'pct' },
    ...comm.map((header): Column => moneyCol(header)),
  ];
  const brk = (rows: LeagueRow[], showParent: boolean): TableRow[] =>
    rows.map((e) => {
      // e.conv, not deed/refs: LeagueRow.conv already divides by TENANCIES sent,
      // which is the only denominator comparable with a deed count.
      const base = showParent
        ? [e.name, e.sub, e.refs, money(e.fees), e.refs, e.paid, e.deed, e.conv]
        : [e.name, e.refs, money(e.fees), e.refs, e.paid, e.deed, e.conv];
      // #109: referrer breakdown rows carry NO commission columns. An agency
      // carries one: their own. Everyone else keeps both, in the old order.
      if (!showComm) return base as TableRow;
      return (agency
        ? [...base, money(e.agentComm)]
        : [...base, money(e.partnerComm), money(e.agentComm)]) as TableRow;
    });
  // #109: breakdown columns — commission columns for non-referrers only.
  const brkCols = (first: string, showParent: boolean, comm: string[]): Column[] =>
    showComm ? LIVE_BREAKDOWN_COLS(first, showParent, comm) : BREAKDOWN_COLS(first, showParent);

  const blocks: BrandedDoc['blocks'] = [
    { kind: 'section', title: 'Summary' },
    {
      kind: 'keyvalue',
      items: [
        { label: 'Referrals sent', value: a.sent, type: 'int' },
        { label: 'Referrals paid', value: a.paid, type: 'int' },
        { label: 'Deeds issued', value: a.deed, type: 'int' },
        { label: 'Referrals paid (tenancies)', value: a.paidTenancies, type: 'int' },
        { label: 'Conversion: Sent to Paid', value: a.sent ? a.paid / a.sent : 0, type: 'pct' },
        /* APPLICANT GRAIN ON BOTH SIDES. These briefly used tenancy
           denominators, which was right while one deed covered a whole let and
           only the lead reached Deed Issued. Each tenant now signs their own
           deed, so `deed` counts applicants and a tenancy denominator would
           report a three-person let as 300% converted. */
        { label: 'Conversion: Paid to Deed', value: a.paid ? a.deed / a.paid : 0, type: 'pct' },
        { label: 'Conversion: Sent to Deed', value: a.sent ? a.deed / a.sent : 0, type: 'pct' },
        moneyKv('Total guaranteed rent value', a.guaranteed),
        moneyKv('Guarantor fees collected (gross)', a.feesGross),
        ...(showComm ? (agency ? [
          /* ONE LINE, NO BLENDED RATE. An agency is owed commission on terms they
             signed, per application; a single percentage across a period of
             mixed rates is a number that appears in no agreement and matches no
             line below it, and the moment a group rate or a branch rate sits in
             the same period it stops being any party's rate at all. The amount
             is the sum of what the frozen lines actually paid. */
          moneyKv('Commission (agreed terms)', a.agentCommNet),
        ] : [
          /* "of one month rent" was true until deal-shape pricing and is now
             false of every negotiated party. The basis is stated as it actually
             was over the period's fees, and the partner line is dropped entirely
             on the agent rail, where the figure is a structural zero. */
          ...(a.noPartnerCut ? [] : [
            moneyKv(`Partner commission (${pPct}% of ${basisWord}, net of refunds)`, a.partnerCommNet),
          ]),
          moneyKv(`Agent commission (${aPct}% of ${basisWord}, net of refunds)`, a.agentCommNet),
        ]) : []),
        // Per TENANCY, not per applicant: every sibling row carries the whole
        // let's rent, so averaging over applicants inflated it by the tenant count.
        moneyKv('Average monthly rent (per tenancy)', a.avgRent),
        moneyKv('Average guarantor fee (per applicant)', a.paid ? a.feesGross / a.paid : 0),
        { label: 'Total deeds issued', value: a.deed, type: 'int' },
        moneyKv('Total value of deeds issued', a.guaranteed),
      ],
    },
    { kind: 'blank' },
    { kind: 'section', title: 'Payments and refunds (this period, live)' },
    {
      kind: 'keyvalue',
      items: [
        moneyKv('Guarantor fees collected (gross)', a.feesGross),
        moneyKv(`Refunds (${a.refundCount})`, a.refundValue),
        moneyKv('Net fees after refunds', a.feesNet),
        ...(showComm ? (agency ? [
          moneyKv('Commission (agreed terms), net of refunds', a.agentCommNet),
          // Their own excluded commission only. partnerCommExcl is a structural
          // zero on the agent rail, and adding zero to their figure under a
          // label naming somebody else would be the partner turning up again.
          moneyKv('Commission excluded on refunded fees', a.agentCommExcl),
        ] : [
          ...(a.noPartnerCut ? [] : [
            moneyKv(`Partner commission (${pPct}%, net of refunds)`, a.partnerCommNet),
          ]),
          moneyKv(`Agent commission (${aPct}%, net of refunds)`, a.agentCommNet),
          moneyKv(a.noPartnerCut ? 'Commission excluded on refunded fees' : 'Commission excluded on refunded fees (partner + agent)', a.partnerCommExcl + a.agentCommExcl),
        ]) : []),
      ],
    },
    { kind: 'blank' },
    { kind: 'section', title: 'Operational health' },
    {
      kind: 'keyvalue',
      items: [
        { label: 'Stuck at Sent (awaiting payment)', value: a.stuckSent, type: 'int' },
        { label: 'Stuck at Paid (awaiting deed)', value: a.stuckPaid, type: 'int' },
        { label: 'Awaiting tenant signature', value: a.awaiting, type: 'int' },
        { label: 'Awaiting signature more than 7 days', value: a.awaitingAged, type: 'int' },
        { label: 'Average days Sent to Paid', value: a.avgSentToPaidDays == null ? '-' : `${a.avgSentToPaidDays.toFixed(1)} days` },
        { label: 'Average days Paid to Deed', value: a.avgPaidToDeedDays == null ? '-' : `${a.avgPaidToDeedDays.toFixed(1)} days` },
      ],
    },
    { kind: 'blank' },
  ];
  /* Per-partner commission for the period (partner + agent, gross and net). The
     net columns sum to the summary's partner/agent commission totals.

     NOT ON AN AGENCY'S COPY. A table of what each partner earned is Opndoor's
     internal split; for an agency it is one row naming house plumbing against
     their own money. The whole section goes, rather than being reduced to a
     single anonymous row. */
  if (maySeeCommission(role) && !agency) {
    const pb = livePartnerBreakdown(role, scope, period);
    blocks.push(
      { kind: 'section', title: 'Commission by partner (this period)' },
      {
        kind: 'table',
        columns: [
          { header: 'Partner', type: 'text' },
          { header: 'Paid', type: 'int' },
          moneyCol('Fees collected (gross)'),
          moneyCol('Partner commission (gross)'),
          moneyCol('Partner commission (net)'),
          moneyCol('Agent commission (gross)'),
          moneyCol('Agent commission (net)'),
        ],
        rows: pb.map((p) => [p.partnerName, p.paid, money(p.feesGross), money(p.partnerCommGross), money(p.partnerCommNet), money(p.agentCommGross), money(p.agentCommNet)] as TableRow),
      },
      { kind: 'blank' },
    );
  }
  /* The commission headings, per reader. An agency has exactly one commission,
     so it needs no adjective saying whose; everyone else keeps the pair. */
  const NET_COMM: string[] = agency ? ['Commission (net)'] : ['Partner commission (net)', 'Agent commission (net)'];
  const ATTR_COMM: string[] = agency ? ['Attributed commission (net)'] : ['Attributed partner commission (net)', 'Attributed agent commission (net)'];
  /* BREAKDOWNS APPEAR WHERE THERE IS SOMETHING TO BREAK DOWN. Over a single
     agency, "Breakdown by agency" is one row repeating the header above it, and
     over a single branch the branch table is that same row a third time. The
     count is viewerShape's, taken over the whole book rather than the period, so
     a quiet month never makes a table come and go. Only agency-facing documents
     collapse: an Opndoor admin narrowed to one agency is reading the estate's
     document and expects its shape. */
  if (maySeeCommission(role) && !(agency && shape.oneAgency)) {
    blocks.push({ kind: 'section', title: 'Breakdown by agency' }, { kind: 'table', columns: LIVE_BREAKDOWN_COLS('Agency', false, NET_COMM), rows: brk(vol.agencies, false) }, { kind: 'blank' });
  }
  if (!(agency && shape.oneBranch)) {
    blocks.push(
      { kind: 'section', title: 'Breakdown by branch' },
      /* A BRANCH IS ATTRIBUTED, NOT PAID, unless it holds a rate of its own:
         under the additive split the payee is usually the agency above it, and
         the figure here is already the branch's OWN lines (liveVolume uses
         orgRate at branch level), which is why a branch with no rate shows
         nothing. Same treatment as the referrer table below, for the same
         reason: a number in a breakdown row is not a payee's statement. */
      { kind: 'table', columns: brkCols('Branch', true, agency ? ATTR_COMM : NET_COMM), rows: brk(vol.branches, true) },
      ...(maySeeCommission(role) && agency ? [{ kind: 'keyvalue' as const, items: [{ label: 'Note', value: BRANCH_COMMISSION_NOTE }] }] : []),
      { kind: 'blank' },
    );
  }
  blocks.push(
    { kind: 'section', title: role === 'referrer' ? 'Breakdown by month' : 'Breakdown by referrer' },
    // The referrer figures are commission ATTRIBUTED to the referrals they generated
    // (partner + agent share), for insight — not a payment owed to the referrer.
    { kind: 'table', columns: brkCols(role === 'referrer' ? 'Month' : 'Referrer', false, role === 'referrer' ? NET_COMM : ATTR_COMM), rows: brk(vol.referrers, false) },
    ...(maySeeCommission(role) ? [{ kind: 'keyvalue' as const, items: [{ label: 'Note', value: REFERRER_COMMISSION_NOTE }] }] : []),
    { kind: 'blank' },
  );
  blocks.push(
    { kind: 'section', title: 'Monthly trend (last 12 months)' },
    {
      kind: 'table',
      columns: [
        { header: 'Month', type: 'text' },
        { header: 'Referrals', type: 'int' },
        moneyCol('Fees collected (gross)'),
        { header: 'Deeds issued', type: 'int' },
      ],
      // Straight off liveMonths, which no longer rounds: it returned whole
      // pounds for the dashboard's headline tile, and September read £4,431.00
      // here beside £4,430.77 everywhere else. This carried a re-summing
      // workaround for one release; the fix went to the data layer instead.
      rows: liveMonths(role, scope).map((mo) => [mo.label, mo.refs, money(mo.fees), mo.deeds]),
    },
  );

  /* Commission settlement: prior calendar month, payable on the 15th, net of
     refunds. The PARTNER settlement is Opndoor's own paperwork: what we owe a
     supplier. An agency is not a party to it and never sees it; their money is
     the agent settlement immediately below. */
  if (maySeeCommission(role) && !agency) {
    const st = getCommissionSettlement(role, scope);
    const settleDay = `${st.settlementDate.getDate()}/${pad(st.settlementDate.getMonth() + 1)}/${st.settlementDate.getFullYear()}`;
    blocks.push({ kind: 'blank' }, { kind: 'section', title: `Commission settlement (${st.monthLabel}, payable ${settleDay})` });
    if (!st.partners.length) {
      blocks.push({ kind: 'keyvalue', items: [{ label: 'Payable', value: 'No partner commission accrued in the prior calendar month.' }] });
    } else {
      blocks.push({
        kind: 'keyvalue',
        // Pence throughout the settlement (money-reconciliation surface).
        items: st.partners.map((p) => moneyKv(`Commission payable to ${p.partnerName}`, p.commission)),
      });
      blocks.push({
        kind: 'table',
        columns: [
          { header: 'Partner', type: 'text' },
          { header: 'Guarantee reference', type: 'text' },
          { header: 'Branch', type: 'text' },
          { header: 'Agency', type: 'text' },
          { header: 'Paid date', type: 'text' },
          moneyCol('Guarantor fee'),
          moneyCol('Partner commission'),
        ],
        // ap.fee, not ap.rent: the column says Guarantor fee and now carries one.
        rows: st.partners.flatMap((p) => p.apps.map((ap) => [p.partnerName, ap.ref, ap.branch, ap.agency, dmy(ap.paidAt), money(ap.fee), money(ap.commission)] as TableRow)),
      });
    }
  }

  /* Agent commission settlement: the same money from the payee's side,
     aggregated per payee (agency, group or branch), prior calendar month, net of
     refunds. THIS one an agency does see: it is what we owe them. On their copy
     the word "Agent" comes off every label, because on a document addressed to
     the agency there is only one commission and it is theirs. */
  if (maySeeCommission(role)) {
    const ag = getAgentCommissionSettlement(role, scope);
    const agDay = `${ag.settlementDate.getDate()}/${pad(ag.settlementDate.getMonth() + 1)}/${ag.settlementDate.getFullYear()}`;
    blocks.push({ kind: 'blank' }, { kind: 'section', title: `${agency ? 'Commission settlement' : 'Agent commission settlement'} (${ag.monthLabel}, payable ${agDay})` });
    /* PAYEES, not the agencies rollup. `agencies` is agency-level lines only;
       under an additive split a group or a branch is a payee too, and their
       money was simply missing from this table while the dashboard showed it.
       The sum of `payees` IS ag.total; the sum of `agencies` is not. */
    if (!ag.payees.length) {
      blocks.push({ kind: 'keyvalue', items: [{ label: 'Payable', value: `No ${agency ? '' : 'agent '}commission accrued in the prior calendar month.` }] });
    } else {
      blocks.push({
        kind: 'keyvalue',
        items: [
          ...ag.payees.map((a) => moneyKv(`${agency ? 'Commission' : 'Agent commission'} payable to ${a.agency} (${a.level})`, a.commission)),
          moneyKv(`Total ${agency ? '' : 'agent '}commission payable`, ag.total),
        ],
      });
      blocks.push({
        kind: 'table',
        columns: [
          { header: 'Payee', type: 'text' },
          { header: 'Payee level', type: 'text' },
          { header: 'Guarantee reference', type: 'text' },
          { header: 'Branch', type: 'text' },
          { header: 'Paid date', type: 'text' },
          moneyCol('Guarantor fee'),
          moneyCol(agency ? 'Commission' : 'Agent commission'),
        ],
        rows: ag.payees.flatMap((a) => a.apps.map((ap) => [a.agency, a.level, ap.ref, ap.branch, dmy(ap.paidAt), money(ap.fee), money(ap.commission)] as TableRow)),
      });
    }
  }

  const [ds, de] = realPeriodRange(period);
  // Their own name where the estate used to be, and no partner segment at all.
  const scopeText = role === 'referrer' ? 'Your referrals only' : agency ? agencyScopeLabel(role) : 'Whole estate';
  const metaLine = `${period.label} (${dmy(ds)} to ${dmy(de)}) · ${scopeText} · ${agency ? '' : `Partner: ${scopeLabel(role)} · `}Generated ${generatedOn()} · GBP · Live records`;
  const doc: BrandedDoc = { reportName: 'Performance export', metaLine, blocks };
  return { sheets: [{ name: 'Performance', doc }], filename: `opndoor-performance-${period.id}-${fileStamp()}.xlsx` };
}

/** Performance export: branded single-sheet .xlsx for the selected period and scope. */
export function buildPerformanceDoc(role: Role, period: Period): BrandedExport {
  if (liveAvailable()) return buildLivePerformanceDoc(role, period);
  const m = exportModel(role, period);
  const xrates = getRatesFor(scopeFor(role));
  const showComm = maySeeCommission(role); // #109: referrer exports carry no commission
  // Same two questions as the live builder, and the same answers: the demo
  // document an agency downloads must obey the rules the real one obeys, or the
  // demo teaches them to expect a document we do not send.
  const agency = agencyFacing(role);
  const shape = viewerShape(role, scopeFor(role));
  const sB = bands(m.stuckSent, [0.55, 0.3]);
  const pB = bands(m.stuckPaid, [0.5, 0.33]);

  const blocks: BrandedDoc['blocks'] = [
    { kind: 'section', title: 'Summary' },
    {
      kind: 'keyvalue',
      items: [
        { label: 'Referrals sent', value: m.sent, type: 'int' },
        { label: 'Referrals paid', value: m.paid, type: 'int' },
        { label: 'Deeds issued', value: m.deed, type: 'int' },
        { label: 'Conversion: Sent to Paid', value: m.sent ? m.paid / m.sent : 0, type: 'pct' },
        { label: 'Conversion: Paid to Deed', value: m.paid ? m.deed / m.paid : 0, type: 'pct' },
        { label: 'Conversion: Sent to Deed', value: m.sent ? m.deed / m.sent : 0, type: 'pct' },
        moneyKv('Total guaranteed rent value', m.deed * ANNUAL),
        moneyKv('Guarantor fees collected', m.fees),
        ...(showComm ? (agency ? [
          // One line, their own, and no rate in the label: see the live builder.
          moneyKv('Commission (agreed terms)', m.fees * xrates.agent),
        ] : [
          moneyKv('Partner commission (share of one month rent)', m.fees * xrates.partner),
          moneyKv('Agent commission (share of one month rent)', m.fees * xrates.agent),
        ]) : []),
        moneyKv('Average monthly rent', AVG_RENT),
        moneyKv('Average guarantor fee', m.paid ? m.fees / m.paid : 0),
        { label: 'Total deeds issued', value: m.deed, type: 'int' },
        moneyKv('Total value of deeds issued', m.deed * ANNUAL),
      ],
    },
    { kind: 'blank' },
    { kind: 'section', title: 'Stuck applications by age band' },
    {
      kind: 'table',
      columns: [
        { header: 'Stage', type: 'text' },
        { header: '7 to 14 days', type: 'int' },
        { header: '14 to 30 days', type: 'int' },
        { header: '30+ days', type: 'int' },
        { header: 'Total', type: 'int' },
      ],
      rows: [
        ['Stuck at Sent (awaiting payment)', sB[0], sB[1], sB[2], m.stuckSent],
        ['Stuck at Paid (awaiting deed)', pB[0], pB[1], pB[2], m.stuckPaid],
      ],
    },
    { kind: 'blank' },
  ];

  // (Live payment/refund figures are produced by buildLivePerformanceDoc; this
  // synthetic path is only reached in mock/test mode.)

  // The breakdown-collapse rule, as in the live builder: only where the viewer
  // has more than one of the thing, and only on their own document.
  if (maySeeCommission(role) && !(agency && shape.oneAgency)) {
    blocks.push({ kind: 'section', title: 'Breakdown by agency' }, { kind: 'table', columns: BREAKDOWN_COLS('Agency', false), rows: breakdownRows(m.agencies, false) }, { kind: 'blank' });
  }
  if (!(agency && shape.oneBranch)) {
    blocks.push({ kind: 'section', title: 'Breakdown by branch' }, { kind: 'table', columns: BREAKDOWN_COLS('Branch', true), rows: breakdownRows(m.branches, true) }, { kind: 'blank' });
  }
  blocks.push(
    { kind: 'section', title: role === 'referrer' ? 'Breakdown by month' : 'Breakdown by referrer' },
    { kind: 'table', columns: BREAKDOWN_COLS(role === 'referrer' ? 'Month' : 'Referrer', false), rows: breakdownRows(m.referrers, false) },
    { kind: 'blank' },
  );
  blocks.push(
    { kind: 'section', title: 'Monthly trend (last 12 months)' },
    {
      kind: 'table',
      columns: [
        { header: 'Month', type: 'text' },
        { header: 'Referrals', type: 'int' },
        moneyCol('Fees collected'),
        { header: 'Deeds issued', type: 'int' },
      ],
      rows: TREND_MONTHS.map((t) => {
        const paid = Math.round(t[1] * 0.78);
        return [t[0], t[1], money(paid * AVG_RENT), Math.round(paid * 0.9)];
      }),
    },
  );

  const doc: BrandedDoc = {
    reportName: 'Performance export',
    metaLine: brandMeta(
      period,
      role === 'referrer' ? 'Your referrals only' : agency ? agencyScopeLabel(role) : 'Whole estate',
      agency ? null : scopeLabel(role),
    ),
    blocks,
  };
  return { sheets: [{ name: 'Performance', doc }], filename: `opndoor-performance-${period.id}-${fileStamp()}.xlsx` };
}

/** What the dashboard period filters the application export on. */
export type ExportBasis = 'referred' | 'paid' | 'deed' | 'activity';

export const BASIS_META: Record<ExportBasis, { label: string; recon: string; hint: string }> = {
  referred: { label: 'by referral sent date', recon: 'equals Referrals sent in the performance export for this period', hint: 'Applications first referred (Sent) within the period. Status shown is the latest state now, so payments and deeds that happened later still appear.' },
  paid: { label: 'by payment date', recon: 'equals the referrals Paid in this period (reconciles to fees collected)', hint: 'Applications whose guarantor fee was paid within the period, whenever they were referred. Use this to reconcile fees and commission each month.' },
  deed: { label: 'by deed issue date', recon: 'equals the Deeds issued in this period', hint: 'Applications whose Deed of Guarantee was issued within the period, whenever they were referred.' },
  activity: { label: 'by any event in the period', recon: 'every application with a Sent, Paid or Deed Issued event in this period', hint: 'Everything that moved in the period: any application Sent, Paid or Deed issued within it, including referrals from earlier months that paid or issued now. An "Activity in period" column lists which events fell in the period.' },
};

interface SynthApp {
  ref: string;
  agency: string;
  branch: string;
  referrer: string;
  status: 'sent' | 'paid' | 'deed';
  sent: Date;
  paid: Date | null;
  deed: Date | null;
  rent: number;
  tStart: Date;
  expiry: Date | null;
  events?: string[];
}

/**
 * Synthesise application rows on one of four bases so the row count reconciles
 * to the matching funnel figure (referred -> Sent, paid -> Paid, deed -> Deeds;
 * activity -> anything that moved in the window).
 */
function generateApplications(period: Period, basis: ExportBasis): SynthApp[] {
  const [start, end] = periodRange(period);
  const spanDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY));
  const inWin = (x: Date | null): boolean => !!x && x >= start && x <= end;
  const withEvents = (a: SynthApp): SynthApp => {
    const ev: string[] = [];
    if (inWin(a.sent)) ev.push('Sent');
    if (inWin(a.paid)) ev.push('Paid');
    if (inWin(a.deed)) ev.push('Deed Issued');
    a.events = ev;
    return a;
  };
  const mk = (i: number, refBase: number, o: { status: SynthApp['status']; sent: Date; paid: Date | null; deed: Date | null }): SynthApp => {
    const b = APP_BRANCHES[i % APP_BRANCHES.length];
    const rent = APP_RENTS[(i * 7) % APP_RENTS.length];
    const tStart = addDays(o.sent, 14 + (i % 10));
    const expiry = o.deed ? guaranteeExpiry(tStart) : null;
    return withEvents({ ref: `GR-${refBase + i}`, agency: b[1], branch: b[0], referrer: APP_REFERRERS[(i * 3) % APP_REFERRERS.length], status: o.status, sent: o.sent, paid: o.paid, deed: o.deed, rent, tStart, expiry });
  };

  if (basis === 'activity') {
    const apps: SynthApp[] = [];
    const sentN = period.fSent;
    const paidInWin = Math.round(sentN * period.sp);
    const deedInWin = Math.round(paidInWin * period.pd);
    // 1) referred in period (latest status)
    const paidOfCohort = Math.round(sentN * period.sp);
    const deedOfCohort = Math.round(paidOfCohort * period.pd);
    for (let i = 0; i < sentN; i++) {
      const st: SynthApp['status'] = i < deedOfCohort ? 'deed' : i < paidOfCohort ? 'paid' : 'sent';
      const s1 = addDays(start, Math.floor(((i + 0.5) / sentN) * spanDays));
      const p1 = st !== 'sent' ? addDays(s1, 3 + (i % 5)) : null;
      const d1 = st === 'deed' && p1 ? addDays(p1, 1 + (i % 3)) : null;
      apps.push(mk(i, 31000, { status: st, sent: s1, paid: p1, deed: d1 }));
    }
    // 2) carried in from earlier months, paid this period (not deed yet)
    const carriedPaid = Math.round(paidInWin * 0.35);
    for (let i = 0; i < carriedPaid; i++) {
      const p2 = addDays(start, Math.floor(((i + 0.5) / Math.max(1, carriedPaid)) * spanDays));
      apps.push(mk(i, 34000, { status: 'paid', sent: addDays(p2, -(24 + (i % 20))), paid: p2, deed: null }));
    }
    // 3) carried in from earlier months, deed issued this period
    const carriedDeed = Math.round(deedInWin * 0.3);
    for (let i = 0; i < carriedDeed; i++) {
      const d3 = addDays(start, Math.floor(((i + 0.5) / Math.max(1, carriedDeed)) * spanDays));
      const p3 = addDays(d3, -(2 + (i % 4)));
      const s3 = addDays(p3, -(26 + (i % 18)));
      apps.push(mk(i, 37000, { status: 'deed', sent: s3, paid: p3, deed: d3 }));
    }
    return apps.filter((a) => a.events && a.events.length);
  }

  const N = basis === 'paid' ? Math.round(period.fSent * period.sp) : basis === 'deed' ? Math.round(period.fSent * period.sp * period.pd) : period.fSent;
  const apps: SynthApp[] = [];
  for (let i = 0; i < N; i++) {
    const payLag = 3 + (i % 5);
    const deedLag = 1 + (i % 3);
    let sent: Date;
    let paid: Date | null;
    let deed: Date | null;
    let status: SynthApp['status'];
    if (basis === 'paid') {
      paid = addDays(start, Math.floor(((i + 0.5) / N) * spanDays));
      sent = addDays(paid, -payLag);
      const hasDeed = i < Math.round(N * period.pd);
      deed = hasDeed ? addDays(paid, deedLag) : null;
      status = hasDeed ? 'deed' : 'paid';
    } else if (basis === 'deed') {
      deed = addDays(start, Math.floor(((i + 0.5) / N) * spanDays));
      paid = addDays(deed, -deedLag);
      sent = addDays(paid, -payLag);
      status = 'deed';
    } else {
      const paidN = Math.round(N * period.sp);
      const deedN = Math.round(paidN * period.pd);
      status = i < deedN ? 'deed' : i < paidN ? 'paid' : 'sent';
      sent = addDays(start, Math.floor(((i + 0.5) / N) * spanDays));
      paid = status !== 'sent' ? addDays(sent, payLag) : null;
      deed = status === 'deed' && paid ? addDays(paid, deedLag) : null;
    }
    const b = APP_BRANCHES[i % APP_BRANCHES.length];
    const rent = APP_RENTS[(i * 7) % APP_RENTS.length];
    const tStart = addDays(sent, 14 + (i % 10));
    const expiry = deed ? guaranteeExpiry(tStart) : null;
    apps.push({ ref: `GR-${31000 + i}`, agency: b[1], branch: b[0], referrer: APP_REFERRERS[(i * 3) % APP_REFERRERS.length], status, sent, paid, deed, rent, tStart, expiry });
  }
  return apps;
}

/** Application export from live records (Supabase mode), with refund columns. */
/** The LIVE application export. Exported so its column contract can be tested
    without Supabase: buildApplicationDoc below picks between this and the
    synthetic generator on SUPABASE_ENABLED, which a unit test cannot satisfy,
    and the columns are the half that actually changed. */
export function buildRealApplicationDoc(role: Role, period: Period, basis: ExportBasis, meta: { label: string; recon: string; hint: string }): BrandedExport {
  const [start, end] = realPeriodRange(period);
  // #2 Withdrawn is terminal and out of the funnel: exclude it so the referred/
  // activity bases reconcile with the performance export (whose Sent excludes
  // withdrawn) and a withdrawn row is never rendered as "Awaiting payment".
  const apps = scopeFull(allFull(), role, scopeFor(role)).filter((a) => !a.withdrawn && !a.expired && basisInPeriod(a, basis, start, end));
  const STATUS: Record<FullApp['status'], string> = { draft: 'In progress', referencing: 'Awaiting decision', declined: 'Declined', sent: 'Sent', paid: 'Paid', deed: 'Deed Issued', withdrawn: 'Withdrawn', expired: 'Expired' };
  // Who is reading. On an agency's copy the Partner column and the Partner
  // commission column do not exist: the first names house plumbing on every row,
  // the second is a structural zero on every row (see agentRailApp).
  const agency = agencyFacing(role);
  /* HOW MUCH OF ONE THEY HAVE, which is the other question (see agencyFacing).
     An Agency column reading the same name on forty rows and a Branch column
     reading the same office under it are two columns of one word, and the same
     rule already takes them off the Applications table, the League boards and
     the Reporting charts. Same predicate, same book, so the export and the
     screen it was downloaded from cannot show different columns.

     `measured` is the guard viewerShape cannot give: an empty book answers "one
     of everything" deliberately, and scopeFull hands some roles nothing at all,
     so collapsing on a measurement of zero would strip the columns off a file
     that still holds several of each. Lifted from Applications.tsx, where the
     same sentence is written out at length. */
  const shape = viewerShape(role, scopeFor(role));
  const measured = shape.agencies > 0;
  const showAgency = !(measured && shape.oneAgency);
  const showBranch = !(measured && shape.oneBranch);
  /* The payees column earns its place only where a row has more than one payee.
     On the common single-payee book it is the agency's own name and their own
     rate repeated on every line, which the Commission rate column beside it
     already says; under a group or a branch split it is the only place the
     reader can see WHO the commission divides between. Measured over the rows
     being exported, not the book: this file's lines are what it describes. */
  const manyPayees = apps.some((a) => linesFor(a).length > 1);

  const columns: Column[] = [
    ...(agency ? [] : [{ header: 'Partner', type: 'text' } as Column]),
    { header: 'Guarantee reference', type: 'text' },
    ...(showAgency ? [{ header: 'Agency', type: 'text' } as Column] : []),
    ...(showBranch ? [{ header: 'Branch', type: 'text' } as Column] : []),
    { header: 'Referrer', type: 'text' },
    { header: 'Status', type: 'text' },
    { header: 'Payment state', type: 'text' },
    { header: 'Sent date', type: 'text' },
    { header: 'Paid date', type: 'text' },
    { header: 'Deed issued date', type: 'text' },
    { header: 'Refund date', type: 'text' },
    /* Text, not a money column, so an application that was never refunded can
       stay BLANK: a numeric cell would render the empty string as £0.00 and
       claim a refund of nothing was issued. The amount itself carries pence
       (moneyText), because a £1,384.61 refund shown as £1,385 cannot be
       reconciled against the payment it reverses. */
    { header: 'Refund amount', type: 'text' },
    /* THE TENANCY BLOCK. One row per APPLICATION, as before — a joint tenancy is
       N applicants who each pay and each get a row — but with the columns that
       make those rows readable as one let. Without them two £3,000 rows look
       like £6,000 of business, and the Guarantor fee column cannot be summed at
       all. Tenancy total repeats on each sibling so any single row states the
       whole let; the reader sums Guarantor fee, or reads the total once, and
       gets the same number either way.

       NO LEAD TENANT COLUMN. There used to be one, reading Yes on position 1 and
       No on the rest, and it named something real while one deed covered a whole
       let and only the lead ever reached Deed Issued. Every tenant now signs
       their own deed over their own share, so "Lead tenant: No" is a fact about
       nothing a reader can act on: whether THAT tenant's deed exists is Status
       and Deed issued date, on that tenant's own row. Position in the tenancy is
       still here, in Tenancy position, which is where it belongs. */
    { header: 'Tenancy ID', type: 'text' },
    { header: 'Tenancy position', type: 'text' },
    { header: 'Share of tenancy', type: 'text' },
    // Named for what it is: on a joint tenancy every sibling row carries the
    // WHOLE let's rent, so a reader summing this column doubles the book.
    moneyCol('Monthly rent (whole tenancy)'),
    moneyCol('Share of rent'),
    // WAS `a.rent`. The fee has not been one month's rent since deal-shape
    // pricing: Regent's single tenant is charged three weeks. This column
    // claimed £2,400 where £1,661.54 was taken.
    moneyCol('Guarantor fee charged'),
    { header: 'Fee basis (weeks of rent)', type: 'text' },
    moneyCol('Tenancy total fee'),
    ...(agency ? [] : [moneyCol('Partner commission')]),
    moneyCol(agency ? 'Commission' : 'Agent commission'),
    { header: 'Commission rate', type: 'pct' },
    ...(manyPayees ? [{ header: 'Commission payees', type: 'text' } as Column] : []),
    { header: 'Tenancy start date', type: 'text' },
    { header: 'Expiry date', type: 'text' },
    { header: 'Refund policy anomaly', type: 'text' },
  ];
  if (basis === 'activity') columns.push({ header: 'Activity in period', type: 'text' });

  /* The tenancy shape, measured over the WHOLE scoped book rather than the
     filtered rows: a tenancy whose second tenant paid outside the period is
     still a tenancy of two, and "1 of 1" on a joint let would be a lie told by
     the filter. Same reason the total fee is summed here. */
  const wholeBook = scopeFull(allFull(), role, scopeFor(role));
  const tenancySize = new Map<string, number>();
  const tenancyFee = new Map<string, number>();
  for (const a of wholeBook) {
    if (!a.tenancyId) continue;
    tenancySize.set(a.tenancyId, (tenancySize.get(a.tenancyId) ?? 0) + 1);
    tenancyFee.set(a.tenancyId, (tenancyFee.get(a.tenancyId) ?? 0) + feeBaseFor(a));
  }
  // To the penny, through the one formatter: the shares were apportioned to the
  // penny by the server and summing them back in floating point reintroduces the
  // dust the apportionment exists to remove.
  for (const [k, v] of tenancyFee) tenancyFee.set(k, money(v));

  const rows: TableRow[] = apps.map((a) => {
    const ev: string[] = [];
    if (inRange(a.sentAt, start, end)) ev.push('Sent');
    if (inRange(a.paidAt, start, end)) ev.push('Paid');
    if (inRange(a.deedAt, start, end)) ev.push('Deed Issued');
    const payState = a.refunded ? 'Refunded' : a.paidAt ? 'Paid' : 'Awaiting payment';
    // Commission is only earned once the guarantor fee is actually collected, so
    // it is zero until Paid and zero again if refunded (never-paid and refunded
    // rows both read £0, not earned-looking money). Rates are the application's
    // SNAPSHOT (frozen at creation), so a past-period export stays immune to edits.
    const earned = !!a.paidAt && !a.refunded;
    // NO PARTNER COMMISSION ON THE AGENT RAIL. partner_rate is populated on every
    // row whichever rail it came in on, so multiplying by it on one of our own
    // agencies invented a payable nobody owes. Same rule as liveAggregate, so the
    // export foots to the dashboard.
    const partnerComm = earned && !agentRailApp(a) ? feeBaseFor(a) * a.partnerRate : 0;
    // The LINES, not the scalar. Equal today — agent_rate is written as their
    // total — but the lines are the authority and can name their payees.
    const agentComm = earned ? feeBaseFor(a) * totalRate(a) : 0;
    const payees = linesFor(a).map((l) => `${l.orgName} ${Math.round(l.rate * 10000) / 100}%`).join(' + ');
    const exp = expiryOf(a);
    const row: TableRow = [
      ...(agency ? [] : [partnerName(a.partner)]),
      a.ref,
      ...(showAgency ? [a.agency] : []),
      ...(showBranch ? [a.branch] : []),
      a.referrer, STATUS[a.status], payState,
      a.sentAt ? dmy(a.sentAt) : '', a.paidAt ? dmy(a.paidAt) : '', a.deedAt ? dmy(a.deedAt) : '',
      a.refundedAt ? dmy(a.refundedAt) : '', a.refundedAmount != null ? moneyText(a.refundedAmount) : '',
      a.tenancyId ?? '',
      a.tenancyId && a.tenancyPosition ? `${a.tenancyPosition} of ${tenancySize.get(a.tenancyId) ?? a.tenancyPosition}` : '',
      a.sharePercent == null ? '' : `${a.sharePercent}%`,
      money(a.rent),
      /* A TENANCY OF ONE HAS NO RECORDED SHARE BECAUSE THEIR SHARE IS ALL OF IT.
         This was `a.shareAmount ?? ''`, and a blank in a numeric column renders
         as £0.00: the file told the reader to sum this column instead of the
         repeated rent, and the sum then left out every single-tenant let. */
      money(a.shareAmount ?? a.rent),
      money(feeBaseFor(a)),
      a.feeBasisWeeks == null ? '' : String(Number(Number(a.feeBasisWeeks).toFixed(2))),
      money(a.tenancyId ? (tenancyFee.get(a.tenancyId) ?? feeBaseFor(a)) : feeBaseFor(a)),
      ...(agency ? [] : [money(partnerComm)]),
      money(agentComm), totalRate(a),
      ...(manyPayees ? [payees] : []),
      // WAS `a.expiry`, which is right by accident and wrong by intent: it is
      // blank on an unissued row only while nothing has written a date to it.
      // expiryOf says the rule out loud, and says it the same way here, on the
      // bordereau and on the expiries file.
      a.tenancyStart ? dmy(a.tenancyStart) : '', exp ? dmy(exp) : '',
      a.refundAfterStart ? 'Yes - refunded after tenancy start' : '',
    ];
    if (basis === 'activity') row.push(ev.join(', '));
    return row;
  });

  const scopeText = agency ? agencyScopeLabel(role) : 'Whole estate';
  const metaLine = `${period.label} (${dmy(start)} to ${dmy(end)}) · ${scopeText} (${meta.label}) · ${agency ? '' : `Partner: ${scopeLabel(role)} · `}Generated ${generatedOn()} · GBP`;
  const doc: BrandedDoc = {
    reportName: 'Application export',
    metaLine,
    blocks: [
      {
        kind: 'keyvalue',
        items: [
          { label: 'Basis', value: `Filtered ${meta.label}` },
          { label: 'Applications', value: `${apps.length} live records` },
          { label: 'Note', value: 'Live records, pseudonymised by guarantee reference. Payment state, refund date and refund amount are included. A refund does not reverse a Paid application.' },
          { label: 'Joint tenancies', value: 'One row per applicant, each with the tenancy id, their position and their share. Guarantor fee charged is what THAT applicant paid; the shares sum to Tenancy total fee, which is charged once for the whole let. Monthly rent is the whole tenancy\u2019s and repeats on each row: sum Share of rent instead.' },
        ],
      },
      { kind: 'blank' },
      { kind: 'table', columns, rows },
    ],
  };
  return { sheets: [{ name: 'Applications', doc }], filename: `opndoor-applications-${basis}-${period.id}-${fileStamp()}.xlsx` };
}

/**
 * Application-level (pseudonymised) export on the chosen basis, as a branded
 * .xlsx. Blocked for referrers. The four-basis selection is unchanged.
 */
export function buildApplicationDoc(role: Role, period: Period, basis: ExportBasis = 'referred'): BrandedExport | null {
  // Positive: only the two roles entitled to commission build this document. The
  // live path emits Partner commission and Agent commission columns, so a
  // deny-list of one granted them to every other role.
  if (!maySeeCommission(role)) return null;
  const meta = BASIS_META[basis];
  if (SUPABASE_ENABLED && allFull().length) return buildRealApplicationDoc(role, period, basis, meta);
  const apps = generateApplications(period, basis);
  const STATUS: Record<SynthApp['status'], string> = { sent: 'Sent', paid: 'Paid', deed: 'Deed Issued' };

  const columns: Column[] = [
    { header: 'Guarantee reference', type: 'text' },
    { header: 'Agency', type: 'text' },
    { header: 'Branch', type: 'text' },
    { header: 'Referrer', type: 'text' },
    { header: 'Status', type: 'text' },
    { header: 'Sent date', type: 'text' },
    { header: 'Paid date', type: 'text' },
    { header: 'Deed issued date', type: 'text' },
    moneyCol('Monthly rent'),
    moneyCol('Guarantor fee'),
    { header: 'Tenancy start date', type: 'text' },
    // Blank unless the synthetic row has a deed, same rule as expiryOf: the
    // generator already only dates an expiry where it dated a deed.
    { header: 'Expiry date', type: 'text' },
  ];
  if (basis === 'activity') columns.push({ header: 'Activity in period', type: 'text' });

  const rows: TableRow[] = apps.map((a) => {
    const row: TableRow = [a.ref, a.agency, a.branch, a.referrer, STATUS[a.status], dmy(a.sent), a.paid ? dmy(a.paid) : '', a.deed ? dmy(a.deed) : '', money(a.rent), money(a.rent), dmy(a.tStart), a.expiry ? dmy(a.expiry) : ''];
    if (basis === 'activity') row.push((a.events || []).join(', '));
    return row;
  });

  const agency = agencyFacing(role);
  const doc: BrandedDoc = {
    reportName: 'Application export',
    metaLine: brandMeta(
      period,
      `${agency ? agencyScopeLabel(role) : 'Whole estate'} (${meta.label})`,
      agency ? null : scopeLabel(role),
    ),
    blocks: [
      {
        kind: 'keyvalue',
        items: [
          { label: 'Basis', value: `Filtered ${meta.label}` },
          { label: 'Applications', value: `${apps.length} (${meta.recon})` },
          { label: 'Note', value: 'Pseudonymised by guarantee reference. No tenant names or contact details are included. Status is the latest state; paid and deed dates are shown whenever they occurred.' },
        ],
      },
      { kind: 'blank' },
      { kind: 'table', columns, rows },
    ],
  };
  return { sheets: [{ name: 'Applications', doc }], filename: `opndoor-applications-${basis}-${period.id}-${fileStamp()}.xlsx` };
}

/* ---- League export: three branded sheets (Agencies, Branches, Referrers) ---- */
function leaguePartnerLabel(scope: PartnerScope, partner: string): string {
  if (scope !== ALL_PARTNERS) return partnerName(scope);
  if (partner) return partnerName(partner);
  return 'All partners (combined)';
}
/* The league workbook is not in the performance/application ruling, but it is a
   document an agency downloads from their own League page, and the same house
   rule applies to it: no partner column, no estate. Its commission attribution
   is already per-org (liveVolume/groupRows use orgRate), so only the headings
   and the meta line change. */
function leagueColumns(view: LeagueView, agency: boolean): Column[] {
  const first: Column = { header: view === 'agency' ? 'Agency' : view === 'branch' ? 'Branch' : 'Referrer', type: 'text' };
  const core: Column[] = [
    { header: 'Referrals', type: 'int' },
    moneyCol('Fees collected'),
    { header: 'Paid', type: 'int' },
    { header: 'Deeds', type: 'int' },
    { header: 'Sent to Paid', type: 'pct' },
    { header: 'Sent to Deed', type: 'pct' },
  ];
  if (view === 'referrer') return [first, ...core];
  const comm: Column[] = agency
    // A branch board row shows the branch's OWN commission, which is nothing
    // where it holds no rate of its own; hence the note on the sheet.
    ? [moneyCol(view === 'branch' ? 'Own commission' : 'Commission')]
    : [moneyCol('Partner commission'), moneyCol('Agent commission')];
  return [first, { header: 'Detail', type: 'text' }, ...core, ...comm];
}
function leagueRows(view: LeagueView, rows: LeagueRow[], showPartner: boolean, agency: boolean): TableRow[] {
  return rows.map((r) => {
    // Keep per-row partner attribution in the export when viewing across
    // partners (the on-screen Partner tag's export twin, #52).
    const detail = showPartner && r.partner ? `${r.sub}${r.sub ? ' · ' : ''}${r.partner}` : r.sub;
    if (view === 'referrer') return [r.name, r.refs, money(r.fees), r.paid, r.deed, r.sp, r.conv];
    const base = [r.name, detail, r.refs, money(r.fees), r.paid, r.deed, r.sp, r.conv];
    return agency ? [...base, money(r.agentComm)] : [...base, money(r.partnerComm), money(r.agentComm)];
  });
}

/**
 * League export: a branded workbook for the selected league view, or all three
 * views when no specific view is supplied. It respects role + partner scoping.
 * In live (Supabase) mode the tables are period-filtered by real dates (same
 * as the on-screen league); in mock mode the league is the modelled current
 * book. The metadata date range reflects the actual window filtered.
 */
export function buildLeagueDoc(role: Role, scope: PartnerScope, partner: string, period: Period, view?: LeagueView): BrandedExport {
  // The league workbook carries per-agency and per-branch commission and had no
  // role test at all, relying on the button being hidden. A builder that emits
  // commission has to refuse for itself.
  if (!maySeeCommission(role)) return emptyExport('League');
  const views: { view: LeagueView; name: string }[] = view
    ? [{ view, name: view === 'agency' ? 'Agencies' : view === 'branch' ? 'Branches' : 'Referrers' }]
    : [
        { view: 'agency', name: 'Agencies' },
        { view: 'branch', name: 'Branches' },
        { view: 'referrer', name: 'Referrers' },
      ];
  // The caller passes the scope here rather than leaving it to scopeFor, so both
  // questions are asked of the scope this workbook was actually built over.
  const agency = isAgencyUser(role, scope);
  const scopeText = role === 'referrer' ? 'Your slice' : agency ? agencyScopeLabel(role, scope) : 'Whole estate';
  const partnerLabel = agency ? null : leaguePartnerLabel(scope, partner);
  let metaLine: string;
  if (liveAvailable()) {
    const [ds, de] = realPeriodRange(period);
    metaLine = `${period.label} (${dmy(ds)} to ${dmy(de)}) · ${scopeText} · ${partnerLabel ? `Partner: ${partnerLabel} · ` : ''}Generated ${generatedOn()} · GBP · Live records`;
  } else {
    metaLine = brandMeta(period, scopeText, partnerLabel);
  }
  const showPartner = scope === ALL_PARTNERS && !partner;
  const sheets = views.map(({ view, name }) => ({
    name,
    doc: {
      reportName: `League table: ${name}`,
      metaLine,
      blocks: [
        { kind: 'table', columns: leagueColumns(view, agency), rows: leagueRows(view, getLeague(view, { role, scope, partner, period }), showPartner, agency) },
        ...(agency && view === 'branch' ? [{ kind: 'keyvalue' as const, items: [{ label: 'Note', value: BRANCH_COMMISSION_NOTE }] }] : []),
      ],
    } as BrandedDoc,
  }));
  return { sheets, filename: `opndoor-league-${fileStamp()}.xlsx` };
}

/* =====================================================================
   Commission statements (#6): one branded statement per payee — per partner
   (partner commission) and per agency (agent commission) — for the current
   settlement (prior calendar month, payable the 15th, net of refunds).

   FOOTING GUARANTEE: each builder reads the SAME settlement data the dashboard
   renders (getCommissionSettlement / getAgentCommissionSettlement, same role +
   scope), so the statement's total EQUALS the on-screen settlement figure by
   construction — it is the sum of the identical per-application commission the
   dashboard sums. Tenant is shown as INITIALS ONLY (privacy).
   ===================================================================== */

/** dd/mm/yyyy HH:MM generated stamp for a statement (British, local time). */
function dmyhm(x: Date): string {
  return `${dmy(x)} ${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

/**
 * THE STATEMENT'S NUMBER, READ FROM WHERE IT IS STORED.
 *
 * It was derived from the payee's NAME (statementRef, just below, which the two
 * SETTLEMENT statements still use): STMT-AG-REGENT-S-LETTINGS-202609. Rename the
 * agency and September's reference changes, so the statement a finance team filed
 * last month and the one they download today are the same money under two
 * numbers, with nothing to tell them those are one document.
 *
 * public.commission_statement_ref(p_month, p_payee_key) assigns
 * STMT-YYYY-MM-NNNN once per payee per month and returns that same answer on
 * every later call. It is deliberately NOT recomputed here: one stored number is
 * the answer, and a client able to derive its own would be a second opinion. The
 * cron's edge function calls the same RPC with the same payee key, which is
 * id-based on both sides so a rename moves nothing, and that is what makes the
 * number on the emailed PDF and the number in this spreadsheet one number.
 *
 * NO DATABASE, NO NUMBER. A demo book has never been through the RPC and a
 * failed call must not invent one, so both read as the empty glyph rather than as
 * a plausible reference nothing can be reconciled against.
 */
async function storedStatementRef(monthKey: string, payeeKey: string): Promise<string> {
  if (!SUPABASE_ENABLED) return EMPTY;
  const { data, error } = await sb().rpc('commission_statement_ref', {
    p_month: monthKey, p_payee_key: payeeKey,
  });
  return !error && typeof data === 'string' && data ? data : EMPTY;
}

/** A deterministic statement reference from the payee id + settlement month:
    `<prefix>-<PAYEE-SLUG>-<YYYYMM>` (e.g. STMT-RIGHTMOVE-202606).

    STILL THE SETTLEMENT STATEMENTS' REFERENCE, and only theirs:
    buildPartnerStatementDoc and buildAgentStatementDoc both print one of these.
    Those two documents address a settlement month rather than a stored statement
    and have no payee key to ask the RPC with (the partner one is not even keyed
    on a payee the table knows). The month statement, which is what a payee
    reconciles by, now reads the stored number instead. */
function statementRef(prefix: string, payeeId: string, monthLabel: string): string {
  const [mName, yr] = monthLabel.split(' '); // monthLabel is e.g. "June 2026"
  const mIdx = MONTH_NAMES.indexOf(mName);
  const yyyymm = mIdx >= 0 && yr ? `${yr}${pad(mIdx + 1)}` : monthLabel.replace(/\s+/g, '');
  const slug = payeeId.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${prefix}-${slug}-${yyyymm}`;
}

/** Per-application commission lines (guarantee reference, tenant initials, paid
    date, fee, applied rate, commission). Pence throughout (money-reconciliation
    surface); the applied rate is derived as commission / fee.

    THE FEE COLUMN IS THE FEE. It printed `rent` and derived the rate from it,
    on the assumption — true until deal-shape pricing — that a guarantee fee WAS
    one month's rent. On Regent's terms a single tenant is charged three weeks:
    the statement showed £2,400 against a £332.31 commission and called the rate
    13.85%, when £1,661.54 was charged at the 20% actually agreed. */
const STATEMENT_COLS: Column[] = [
  { header: 'Guarantee reference', type: 'text' },
  { header: 'Tenant', type: 'text' },
  { header: 'Paid date', type: 'text' },
  moneyCol('Fee'),
  { header: 'Rate', type: 'pct' },
  moneyCol('Commission'),
];

/** The per-line rows plus a footing total row. The total commission is the sum of
    the per-application commission, which IS the settlement's stated commission
    (assert-equal: totalComm === settlement commission for this payee). */
function statementRows(apps: SettlementApp[]): { rows: TableRow[]; totalFee: number; totalComm: number } {
  let totalFee = 0;
  let totalComm = 0;
  const rows: TableRow[] = apps.map((ap) => {
    totalFee += ap.fee;
    totalComm += ap.commission;
    const rate = ap.fee ? ap.commission / ap.fee : 0; // derived applied rate = commission / fee
    // Tenant shown as INITIALS ONLY; the guarantee reference stands alone when unknown.
    return [ap.ref, ap.tenantInitials || '', dmy(ap.paidAt), money(ap.fee), rate, money(ap.commission)];
  });
  // Footing total: the blended effective rate keeps fee x rate = commission on the total line too.
  const effRate = totalFee ? totalComm / totalFee : 0;
  rows.push([`Total (${apps.length} application${apps.length === 1 ? '' : 's'})`, '', '', money(totalFee), effRate, money(totalComm)]);
  return { rows, totalFee: money(totalFee), totalComm: money(totalComm) };
}

/**
 * Partner commission statement: a single branded statement for one partner, for
 * the current settlement month. Foots exactly to the dashboard's partner
 * settlement (reads the same getCommissionSettlement). Tenant initials only.
 */
export function buildPartnerStatementDoc(role: Role, scope: PartnerScope, partnerId: string): BrandedExport {
  // A commission statement with a "Total commission payable" figure, previously
  // protected only by a RoleOnly wrapper on a Dashboard button.
  if (!maySeeCommission(role)) return emptyExport('Partner statement');
  /* An agency is never the payee of a partner statement: their own money is the
     agent statement. Their route partner is house plumbing, so the only thing
     this could build for them is a document naming it, headed "Payee (partner)",
     for a figure that is a structural zero. It refuses instead, rather than
     trusting that the Dashboard will never list a row that opens it. */
  if (isAgencyUser(role, scope)) return emptyExport('Partner statement');
  const st = getCommissionSettlement(role, scope);
  const ps = st.partners.find((p) => p.partner === partnerId);
  const payee = ps ? ps.partnerName : partnerName(partnerId);
  const ref = statementRef('STMT', partnerId, st.monthLabel);
  const generated = dmyhm(new Date());
  const blocks: BrandedDoc['blocks'] = [
    { kind: 'section', title: 'Commission statement' },
    {
      kind: 'keyvalue',
      items: [
        { label: 'Payee (partner)', value: payee },
        { label: 'Commission type', value: 'Partner commission' },
        { label: 'Period (month)', value: st.monthLabel },
        { label: 'Settlement date', value: dmy(st.settlementDate) },
        { label: 'Statement reference', value: ref },
        { label: 'Generated', value: generated },
        { label: 'Currency', value: 'GBP' },
      ],
    },
    { kind: 'blank' },
    { kind: 'section', title: 'Applications (net of refunds)' },
  ];
  if (!ps || !ps.apps.length) {
    blocks.push({ kind: 'keyvalue', items: [{ label: 'Payable', value: 'No partner commission accrued in the prior calendar month.' }] });
  } else {
    const { rows, totalComm } = statementRows(ps.apps);
    // Reconciliation: totalComm equals ps.commission (same per-application sum the
    // dashboard shows), so the statement foots exactly to the on-screen figure.
    blocks.push(
      { kind: 'table', columns: STATEMENT_COLS, rows },
      { kind: 'blank' },
      { kind: 'keyvalue', items: [moneyKv('Total commission payable', totalComm)] },
    );
  }
  const metaLine = `${st.monthLabel} settlement · Payee: ${payee} · Partner commission · Reference ${ref} · Generated ${generated} · GBP`;
  const doc: BrandedDoc = { reportName: 'Commission statement', metaLine, blocks };
  return { sheets: [{ name: 'Statement', doc }], filename: `opndoor-statement-${ref}.xlsx` };
}

/**
 * Agent commission statement: a single branded statement for one letting agency
 * (identified by partner + agency, so same-named agencies under different partners
 * never merge), for the current settlement month. Foots exactly to the dashboard's
 * agent settlement (reads the same getAgentCommissionSettlement). Tenant initials only.
 */
export function buildAgentStatementDoc(role: Role, scope: PartnerScope, partner: string, agency: string): BrandedExport {
  if (!maySeeCommission(role)) return emptyExport('Agent statement');
  /* The Dashboard offers this statement to whoever can see the settlement, which
     includes the agency's own manager, so it is not purely Opndoor's paperwork
     and cannot name the route partner unconditionally. On their copy the partner
     line goes and "Agent commission" is just "Commission", exactly as on the
     monthly statement below, which already made this decision. */
  const forAgency = isAgencyUser(role, scope);
  const st = getAgentCommissionSettlement(role, scope);
  // Search PAYEES, not the agency rollup: a payee may now be a group or a branch,
  // and addressing only the rollup would produce an empty statement for those.
  const ag = st.payees.find((a) => a.partner === partner && a.agency === agency);
  const payee = ag ? ag.agency : agency;
  const partnerLabel = ag ? ag.partnerName : partnerName(partner);
  // The reference carries the payee LEVEL, so an agency and a branch that share a
  // name cannot produce the same statement reference in the same month.
  const ref = statementRef('STMT-AG', `${partner} ${ag ? ag.level : 'agency'} ${agency}`, st.monthLabel);
  const generated = dmyhm(new Date());
  const blocks: BrandedDoc['blocks'] = [
    { kind: 'section', title: 'Commission statement' },
    {
      kind: 'keyvalue',
      items: [
        { label: 'Payee', value: payee },
        { label: 'Payee level', value: ag ? ag.level : 'agency' },
        ...(forAgency ? [] : [{ label: 'Partner', value: partnerLabel }]),
        { label: 'Commission type', value: forAgency ? 'Commission earned' : 'Agent commission' },
        { label: 'Period (month)', value: st.monthLabel },
        { label: 'Settlement date', value: dmy(st.settlementDate) },
        { label: 'Statement reference', value: ref },
        { label: 'Generated', value: generated },
        { label: 'Currency', value: 'GBP' },
      ],
    },
    { kind: 'blank' },
    { kind: 'section', title: 'Applications (net of refunds)' },
  ];
  if (!ag || !ag.apps.length) {
    blocks.push({ kind: 'keyvalue', items: [{ label: 'Payable', value: `No ${forAgency ? '' : 'agent '}commission accrued in the prior calendar month.` }] });
  } else {
    const { rows, totalComm } = statementRows(ag.apps);
    // Reconciliation: totalComm equals ag.commission (same per-application sum the
    // dashboard shows), so the statement foots exactly to the on-screen figure.
    blocks.push(
      { kind: 'table', columns: STATEMENT_COLS, rows },
      { kind: 'blank' },
      { kind: 'keyvalue', items: [moneyKv('Total commission payable', totalComm)] },
    );
  }
  const payeeBit = forAgency ? payee : `${payee} (${partnerLabel})`;
  const metaLine = `${st.monthLabel} settlement · Payee: ${payeeBit} · ${forAgency ? 'Commission earned' : 'Agent commission'} · Reference ${ref} · Generated ${generated} · GBP`;
  const doc: BrandedDoc = { reportName: 'Commission statement', metaLine, blocks };
  return { sheets: [{ name: 'Statement', doc }], filename: `opndoor-statement-${ref}.xlsx` };
}

/* ---------- The agency's own commission statement, for a month it chooses ----------

   buildAgentStatementDoc above is the SETTLEMENT statement: the prior calendar
   month, the month Opndoor is about to pay. This is the same money asked a
   different way — "show me March" — and it carries the detail a settlement
   total does not need and an agency reconciling its own ledger does: which
   tenancy a line belongs to, what share of it this applicant paid, and whether
   the rate is their agreement or the standard.

   Both read getCommissionStatements / getAgentCommissionSettlement, which are
   one accumulator, so the March statement an agency exports and the March
   settlement we paid are the same figure by construction rather than by
   agreement. settlement-statement.test.ts holds that. */
/* The columns, in the order the screen and the PDF declare them, each tagged
   with the dimension it can turn out to hold one single value for.

   THE TAG, AND NOT keepColumns(). The rule itself is the shared one
   (statementShape + dimensionCollapsed, from src/data/statementColumns.ts: the
   same predicate the screen reads and the same one the PDF and the CSV read).
   keepColumns is the other half of that file and belongs to the PDF: it
   redistributes WIDTHS IN POINTS so a nine-column table still reaches the right
   margin of A4. A spreadsheet column is measured in characters, and this
   template already picks a width per type, so handing it 44 points would make
   the Reference column forty-four characters wide. The screen skips keepColumns
   for the same reason and says so at its HEADS list. */
const MONTH_STATEMENT_COLS: (Column & { dim?: StatementDimension })[] = [
  { header: 'Guarantee reference', type: 'text' },
  { header: 'Tenant', type: 'text' },
  { header: 'Branch', type: 'text', dim: 'branch' },
  { header: 'Tenancy', type: 'text' },
  { header: 'Share', type: 'text' },
  { header: 'Paid date', type: 'text' },
  moneyCol('Fee charged'),
  { header: 'Rate', type: 'pct' },
  { header: 'Rate source', type: 'text', dim: 'source' },
  moneyCol('Commission'),
];

const SOURCE_WORD: Record<string, string> = {
  standard: 'Opndoor standard', agreement: 'Agreement', rate: 'Set rate',
};

/**
 * One payee's commission statement for one month.
 *
 * payeeKey addresses the payee, not a name: an agency and a branch may share a
 * name, and two agencies under different partners certainly may.
 *
 * ASYNC BECAUSE THE REFERENCE IS STORED. The number comes from the database now
 * (see storedStatementRef), so this builder has something to wait for. Its
 * callers hand the result straight to exportBranded, which was already async.
 *
 * THE FOURTH RENDERING OF THIS STATEMENT, and the one still drawing all ten
 * columns. The screen, the emailed PDF and the emailed CSV all drop a column that
 * says the same thing on every line, so an agency read nine columns on the page
 * and got ten in the spreadsheet they exported from it, one of them their own
 * branch name forty times. Same rule here now, from the same file.
 */
export async function buildCommissionStatementDoc(
  role: Role, scope: PartnerScope, monthKey: string, payeeKey: string,
): Promise<BrandedExport> {
  if (!maySeeCommission(role)) return emptyExport('Commission statement');
  const st = getCommissionStatements(role, scope, monthKey).find((x) => x.payeeKey === payeeKey);
  if (!st) return emptyExport('Commission statement');
  const ref = await storedStatementRef(st.monthKey, st.payeeKey);
  const generated = dmyhm(new Date());

  // PER PAYEE AND PER MONTH, over this statement's own lines: a group with two
  // branches keeps the column the branch under it has no use for.
  const shape = statementShape(st.lines.map((l) => ({ branch: l.branch, source: l.source })));
  const columns: Column[] = MONTH_STATEMENT_COLS
    .filter((c) => !c.dim || !dimensionCollapsed(shape, c.dim))
    // The dim tag is this file's bookkeeping and no part of the sheet.
    .map(({ header, type }) => ({ header, type }));
  const rows: TableRow[] = st.lines.map((l) => [
    l.ref,
    l.tenant,
    // The house empty glyph, for the mixed statement where some lines name a
    // branch and some cannot: that is the case the column survives for.
    ...(shape.oneBranch ? [] : [l.branch || EMPTY]),
    // A tenancy of one is not a joint tenancy and saying "1 of 1" invents one.
    l.tenancyPlace ? `Joint, ${l.tenancyPlace}` : 'Single',
    l.sharePercent == null ? '100%' : `${l.sharePercent}%`,
    dmy(l.paidAt),
    money(l.fee),
    l.rate,
    // A line frozen before the source was recorded says so, rather than being
    // labelled the standard on a guess.
    ...(shape.oneSource ? [] : [l.source ? (SOURCE_WORD[l.source] ?? l.source) : 'Not recorded']),
    money(l.commission),
  ]);

  const blocks: BrandedDoc['blocks'] = [
    {
      kind: 'keyvalue',
      /* NO PARTNER LINE. buildAgentStatementDoc names the partner because it is
         Opndoor's own settlement paperwork; this is the agency's, and on the
         agent rail the partner is house plumbing that must never appear on it.

         NO PAYEE LEVEL AND NO CURRENCY EITHER. "Payee level: agency" is our own
         word for where a rate hangs in an org tree, not something a payee reads
         their statement to find out, and the reference identifies the document
         without it. Currency is on the meta line and in the format of every
         figure below. */
      items: [
        { label: 'Payee', value: st.payeeName },
        { label: 'Period', value: st.monthLabel },
        /* WHAT THE DROPPED COLUMNS TOOK WITH THEM, said once, directly under the
           period exactly as the screen and the PDF say it. A statement that was
           all Leeds still says Leeds. */
        ...(shape.onlyBranch ? [{ label: 'Branch', value: shape.onlyBranch }] : []),
        ...(shape.onlySource ? [{ label: 'Rate source', value: SOURCE_WORD[shape.onlySource] ?? shape.onlySource }] : []),
        { label: 'Statement reference', value: ref },
        { label: 'Generated', value: generated },
        { label: 'Basis', value: 'Commission on fees PAID in the month, net of refunds' },
      ],
    },
    { kind: 'blank' },
    { kind: 'section', title: 'Applications (net of refunds)' },
  ];
  if (!st.lines.length) {
    blocks.push({ kind: 'keyvalue', items: [{ label: 'Payable', value: `No commission accrued in ${st.monthLabel}.` }] });
  } else {
    blocks.push(
      { kind: 'table', columns, rows },
      { kind: 'blank' },
      /* THE TOTAL IS A LABEL AND AN AMOUNT, under the table, as the screen and
         the PDF both state it.

         IT WAS A ROW INSIDE THE TABLE carrying a total fee and a BLENDED
         PERCENTAGE, st.total / totalFee, so that fee x rate still came to
         commission on the bottom line. That percentage is the same invention the
         commission headline dropped: it appears in no agreement, matches no line
         above it, and the moment a group rate and an agency rate sit in the same
         month it is not any party's rate at all.

         Nor could it simply be blanked in place. This template renders an empty
         cell in a money column as £0.00 and in a percentage column as 0%, so a
         total row with nothing in those two would state a fee of nothing at a
         rate of nothing. Under the table there is no row to fill. */
      { kind: 'keyvalue', items: [moneyKv(`Total commission (${st.lines.length} application${st.lines.length === 1 ? '' : 's'})`, st.total)] },
    );
  }
  const metaLine = `${st.monthLabel} · ${st.payeeName} · Commission earned · Reference ${ref} · Generated ${generated} · GBP`;
  // ONE "Commission statement" HEADING. reportName is the title under the brand
  // band; there used to be a section block of the same words directly beneath it,
  // which reads as a mistake rather than as structure.
  const doc: BrandedDoc = { reportName: 'Commission statement', metaLine, blocks };
  /* The reference names the file when there is one. There is none in a demo book
     and none when the RPC could not be reached, and "opndoor-statement--.xlsx" is
     not a filename, so the month and the payee name it instead. */
  const stamp = ref === EMPTY ? `${st.monthKey}-${st.payeeName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : ref;
  return { sheets: [{ name: 'Statement', doc }], filename: `opndoor-statement-${stamp}.xlsx` };
}

function bxIssuedCount(y: number, m0: number): number {
  const seed = y * 12 + m0;
  return 58 + ((seed * 37) % 53);
}

/** Live bordereau: real applications whose TENANCY START falls in the month,
    Deed Issued, excluding refunded. Format and columns are frozen identical to
    the synthetic version; only the row source changes. Whole opndoor book. */
// #116 The bordereau matches the "Guarantee Policy Premium Bordereau" template:
// grouped two-row headers, 18 columns A–R, Landlord Name = agency, Insurance %
// column = monthly rent × the premium rate as a £ amount (the rate lives in the
// header block), Status vocabulary = the template's ("On Cover").
export const BORDEREAU_COLS = [
  'Guarantee Reference', 'Tenant Title', 'First Name', 'Last Name', 'DOB', 'Tenant Role',
  'Property Address 1', 'Property Address 2', 'City/Town', 'County', 'Postcode', 'Landlord Name',
  'Issue Date', 'Tenancy date', 'Guarantee Expiry', 'Monthly Rent', 'Insurance %', 'Status',
];
const bxRound2 = (n: number) => Math.round(n * 100) / 100;
export interface BordereauData { rows: (string | number)[][]; issued: number; monthLabel: string; filename: string }

/** Live bordereau ROWS in the template column order. Deed-Issued, non-refunded
    guarantees commencing in the month; DOB always populated.

    INSURANCE IS 13.5% OF ONE MONTH'S RENT, ALWAYS. It is computed off the RENT
    and never off the fee. A party on a negotiated 3- or 5-week basis pays a
    different fee and the underwriter's premium does not move: the bordereau is a
    statement to the insurer about the risk, not about what we charged for it.

    ONE ROW PER DEED, AND THE ROW IS THE TENANT'S SHARE. Each tenant of a joint
    tenancy now signs their own deed guaranteeing their own share of the rent, so
    each is its own risk and its own row, and the premium is 13.5% of one month of
    THAT share. This replaces the previous rule of one row per tenancy on the
    whole rent, which was right while one deed covered the whole let.

    The two are the same money, and that is the point: the shares are apportioned
    to the penny by create_joint_referral, so a tenancy's rows sum to exactly
    13.5% of one month of its full rent. Asserted both ways in
    exports-bordereau.test.ts and bordereauBasis.test.ts. */
export function buildLiveBordereau(year: number, m0: number, insuranceRate: number): BordereauData {
  const rate = insuranceRate / 100;
  const mStart = new Date(year, m0, 1, 0, 0, 0, 0);
  const mEnd = new Date(year, m0 + 1, 0, 23, 59, 59, 999);
  const dobDmy = (iso: string | null | undefined): string => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  };
  const eligible = allFull()
    .filter((a) => a.status === 'deed' && !a.refunded && a.tenancyStart && a.tenancyStart >= mStart && a.tenancyStart <= mEnd)
    .sort((x, y) => (x.tenancyStart!.getTime() - y.tenancyStart!.getTime()) || x.ref.localeCompare(y.ref));
  /* EVERY DEED IS A ROW. The tenancy dedupe that used to live here elected one
     applicant per tenancy and dropped the rest, because one deed covered the
     whole let. Each tenant now holds their own deed over their own share, so
     each is a separate risk the underwriter is carrying and a separate row.
     Dropping a sibling would now under-report the book rather than avoid
     double-billing it. */
  const apps = eligible;
  const rows = apps.map((a): (string | number)[] => {
    const rec = findRecord(a.ref);
    const first = rec?.firstName ?? (rec?.name ? rec.name.split(/\s+/).slice(0, -1).join(' ') : '');
    const last = rec?.lastName ?? (rec?.name ? rec.name.split(/\s+/).slice(-1).join(' ') : '');
    // Deed-issued rows only reach here, so this reads the stored expiry and
    // computes one only as a fallback. Through expiryOf all the same, so the
    // rule has one implementation and the filter above cannot quietly widen and
    // start dating cover that was never issued.
    const expiry = expiryOf(a);
    const covered = a.shareAmount ?? a.rent;
    return [
      a.ref, rec?.title ?? '', first, last, dobDmy(rec?.dob), 'Tenant',
      rec?.addr1 ?? '', rec?.addr2 ?? '', rec?.city ?? '', rec?.county ?? '', rec?.postcode ?? '',
      a.agency, // Landlord Name = the agency name
      a.deedAt ? dmy(a.deedAt) : '', a.tenancyStart ? dmy(a.tenancyStart) : '', expiry ? dmy(expiry) : '',
      // THE SHARE, not the tenancy's rent: this deed guarantees this tenant's
      // part of it, and the premium follows what is guaranteed. A tenancy of one
      // has no share and the whole rent is its own, so the cell is unchanged.
      bxRound2(covered), bxRound2(covered * rate), 'On Cover',
    ];
  });
  return { rows, issued: rows.length, monthLabel: `${MONTH_NAMES[m0]} ${year}`, filename: `opndoor-bordereau-${year}-${pad(m0 + 1)}.xlsx` };
}

/**
 * Monthly underwriter bordereau (C&C format). opndoor-admin only; full tenant PII.
 * Buckets by TENANCY START DATE: tenancies commencing in month M are reported to
 * C&C by the 15th of M+1. Deed Issued only, refunded guarantees excluded (a
 * refunded guarantee carries no risk and owes no premium). Live-sourced in
 * Supabase mode; the modelled generator remains for mock/test.
 *
 * INTEGRATION: mid-period reversals - a guarantee already on a submitted month's
 * bordereau, then refunded afterwards - are handled as a CORRECTION on the
 * following month's return (the refunded guarantee simply drops out; whether the
 * correction is a removal or an explicit negative line is a convention pending
 * C&C confirmation). It is not invented here; flagged for review.
 */
function buildSyntheticBordereau(year: number, m0: number, insuranceRate: number): BordereauData {
  const rate = insuranceRate / 100;
  const N = bxIssuedCount(year, m0);
  const daysInMonth = new Date(year, m0 + 1, 0).getDate();
  const rows: (string | number)[][] = [];
  for (let i = 0; i < N; i++) {
    const tenancyDay = 1 + Math.floor((i / N) * (daysInMonth - 1));
    const tenancy = new Date(year, m0, tenancyDay);
    const issue = addDays(tenancy, -(4 + (i % 14)));
    const expiry = guaranteeExpiry(tenancy);
    const dobYear = 1990 + ((i * 5) % 16);
    const dob = new Date(dobYear, (i * 7) % 12, ((i * 11) % 27) + 1);
    const st = BX_STREETS[(i * 3) % BX_STREETS.length];
    const b = APP_BRANCHES[i % APP_BRANCHES.length];
    const refNo = 40000 + (year * 12 + m0) * 200 + i;
    const flat = BX_FLATS[i % BX_FLATS.length];
    const rent = APP_RENTS[(i * 7) % APP_RENTS.length];
    rows.push([
      `GR-${refNo}`, BX_TITLES[i % BX_TITLES.length], BX_FIRST[(i * 5) % BX_FIRST.length], BX_LAST[(i * 3) % BX_LAST.length],
      dmy(dob), 'Tenant', (flat ? `${flat}, ` : '') + st[0], '', 'London', 'Greater London', st[1],
      String(b[0]), // Landlord Name (demo agency stand-in)
      dmy(issue), dmy(tenancy), dmy(expiry), rent, bxRound2(rent * rate), 'On Cover',
    ]);
  }
  return { rows, issued: N, monthLabel: `${MONTH_NAMES[m0]} ${year}`, filename: `opndoor-bordereau-${year}-${pad(m0 + 1)}.xlsx` };
}

/** opndoor-admin-only. Builds + downloads the monthly premium bordereau as a
    grouped-header .xlsx matching the underwriter template. Returns false if not permitted. */
export async function exportBordereauFile(role: Role, year: number, m0: number, insuranceRate: number): Promise<boolean> {
  if (role !== 'superadmin') return false;
  const data = liveAvailable() ? buildLiveBordereau(year, m0, insuranceRate) : buildSyntheticBordereau(year, m0, insuranceRate);
  const { buildBordereauWorkbook, downloadXlsx } = await import('./xlsxTemplate');
  downloadXlsx(buildBordereauWorkbook(data.rows, insuranceRate, data.monthLabel), data.filename);
  return true;
}

/**
 * #86 Monthly expiry cohort. Every in-force guarantee whose EXPIRY DATE falls in
 * the chosen calendar month, soonest-first, already-expired excluded. Role-scoped
 * (Management sees only their partner; opndoor admin the whole book) and gated to
 * management + opndoor admin, like the Application export. Live-sourced in
 * Supabase mode; a modelled generator keeps the demo download non-empty.
 */
export function buildExpiriesCsv(role: Role, year: number, m0: number): { csv: string; filename: string } | null {
  if (role !== 'superadmin' && role !== 'management') return null;
  const mStart = new Date(year, m0, 1, 0, 0, 0, 0);
  const mEnd = new Date(year, m0 + 1, 0, 23, 59, 59, 999);
  const nowD = new Date();
  const today = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate());
  const daysLeft = (d: Date) => Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - today.getTime()) / 86400000);
  /* ONE ROW PER GUARANTEE. This comment used to add "which is one row per
     TENANCY, because only the lead reaches Deed Issued": true while one deed
     named every tenant, and no longer. Each tenant now signs their own deed over
     their own share, so a joint let contributes a row per tenant, each with its
     own expiry. The tenant-count column matters more than ever, not less: it is
     what tells an operator that the name in front of them is one of two. */
  const colHeader: CsvRow = ['Guarantee reference', 'Tenant name', 'Tenants on the guarantee', 'Tenancy ID', 'Property address', 'Agency', 'Branch', 'Tenancy start', 'Expiry date', 'Days remaining', 'Monthly rent (whole tenancy)', 'Annualised rent', 'Guarantor fee (whole tenancy)', 'Referrer'];

  const dataRows: CsvRow[] = [];
  if (liveAvailable()) {
    const book = scopeFull(allFull(), role, scopeFor(role));
    // The whole tenancy, from the whole book: its other tenants are not Deed
    // Issued and so are not in the filtered set at all.
    const tenancyCount = new Map<string, number>();
    const tenancyFee = new Map<string, number>();
    for (const x of book) {
      if (!x.tenancyId) continue;
      tenancyCount.set(x.tenancyId, (tenancyCount.get(x.tenancyId) ?? 0) + 1);
      tenancyFee.set(x.tenancyId, (tenancyFee.get(x.tenancyId) ?? 0) + feeBaseFor(x));
    }
    /* expiryOf, not `expiry ?? guaranteeExpiry(tenancyStart)`. The old form
       computed a date for every application in the book, including ones with no
       deed; the status filter below happened to drop them, so the invented dates
       never reached the file. Two clauses holding each other up is not a rule.
       The unissued now have no expiry to begin with. */
    const apps = book
      .map((a) => ({ a, exp: expiryOf(a) }))
      .filter(({ a, exp }) => a.status === 'deed' && !a.refunded && exp !== null && exp >= mStart && exp <= mEnd && daysLeft(exp) >= 0)
      .sort((x, y) => (x.exp!.getTime() - y.exp!.getTime()) || x.a.ref.localeCompare(y.a.ref));
    for (const { a, exp } of apps) {
      const rec = findRecord(a.ref);
      const addr = [rec?.addr1, rec?.addr2, rec?.city, rec?.postcode].filter(Boolean).join(', ');
      const n = a.tenancyId ? (tenancyCount.get(a.tenancyId) ?? 1) : 1;
      const fee = a.tenancyId ? (tenancyFee.get(a.tenancyId) ?? feeBaseFor(a)) : feeBaseFor(a);
      dataRows.push([a.ref, rec?.name ?? '', String(n), a.tenancyId ?? '', addr, a.agency, a.branch, a.tenancyStart ? dmy(a.tenancyStart) : '', dmy(exp!), String(daysLeft(exp!)), moneyText(a.rent), moneyText(a.rent * 12), moneyText(fee), a.referrer ?? '']);
    }
  } else {
    const AG = ['Bracken House Lettings', 'Meridian Residential', 'Crowngate Property'];
    const BR = ['Head office', 'City branch', 'Riverside branch'];
    const N = 6 + ((year * 12 + m0) % 5);
    const daysInMonth = new Date(year, m0 + 1, 0).getDate();
    for (let i = 0; i < N; i++) {
      const day = 1 + Math.floor((i / N) * (daysInMonth - 1));
      const exp = new Date(year, m0, day);
      if (daysLeft(exp) < 0) continue; // expired never accumulate
      const tStart = new Date(exp.getFullYear() - 1, exp.getMonth(), exp.getDate() + 1);
      const st = BX_STREETS[(i * 3) % BX_STREETS.length];
      const flat = BX_FLATS[i % BX_FLATS.length];
      const rent = APP_RENTS[(i * 7) % APP_RENTS.length];
      const tenant = `${BX_FIRST[(i * 5) % BX_FIRST.length]} ${BX_LAST[(i * 3) % BX_LAST.length]}`;
      const addr = [(flat ? `${flat}, ` : '') + st[0], 'London', st[1]].filter(Boolean).join(', ');
      dataRows.push([`GR-${41000 + (year * 12 + m0) * 50 + i}`, tenant, '1', '', addr, AG[i % AG.length], BR[i % BR.length], dmy(tStart), dmy(exp), String(daysLeft(exp)), moneyText(rent), moneyText(rent * 12), moneyText(rent), APP_REFERRERS[i % APP_REFERRERS.length]]);
    }
  }

  const rows: CsvRow[] = [];
  rows.push(['opndoor Guarantee Referral Portal - guarantees expiring']);
  rows.push(['Generated', new Date().toLocaleString('en-GB')]);
  rows.push(['Month', `${MONTH_NAMES[m0]} ${year} (by guarantee expiry date, soonest first)`]);
  // "Your partner" told an agency manager that their own book belongs to a party
  // they have never heard of. Their name, from the same book the rows came from.
  rows.push(['Scope', role === 'superadmin' ? 'All partners (opndoor whole book)' : agencyFacing(role) ? agencyScopeLabel(role) : 'Your partner']);
  rows.push(['Guarantees expiring', String(dataRows.length)]);
  rows.push(['Currency', 'GBP']);
  rows.push([]);
  rows.push(colHeader);
  for (const r of dataRows) rows.push(r);
  return { csv: toCSV(rows), filename: `opndoor-expiries-${year}-${pad(m0 + 1)}.csv` };
}
