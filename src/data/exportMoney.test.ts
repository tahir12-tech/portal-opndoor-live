/* EVERY MONEY FIGURE IN AN EXPORT COMES FROM ONE FORMATTER.
 *
 * Reported: the monthly trend showed September as £4,431.00 where every other
 * surface showed £4,430.77. Nothing was formatting wrong. liveMonths() rounds its
 * fees to whole pounds, which is right for the dashboard trend tile it was
 * written for and wrong the moment the same row is printed into a column of
 * pence, so the one table that rounded disagreed by 23p with the year it
 * summarises.
 *
 * A test that checked the trend alone would pass while the next table drifted, so
 * this one walks EVERY document exportsService generates, finds every cell in a
 * money-typed column and every money-typed key/value line, and holds each of them
 * to the penny. The specific September figure is asserted too, at the bottom,
 * because a rule is easier to keep when the case that broke it is written down.
 *
 * WHAT COUNTS AS PASSING, per money cell:
 *   a number with no more than two decimals (no whole-pound rounding upstream,
 *   and no sub-penny dust either: a cell reading 2769.2299999999996 is a defect),
 *   or, in the text columns that have to be able to stay empty, a blank, the
 *   house hyphen, or £x,xxx.xx exactly.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { BASIS_META, getPeriods } from '@/data';
import { getCommissionStatements } from '@/data/liveAnalytics';
import {
  buildAgentStatementDoc, buildApplicationDoc, buildCommissionStatementDoc, buildExpiriesCsv,
  buildLeagueDoc, buildLivePerformanceDoc, buildPartnerStatementDoc, buildPerformanceDoc,
  buildRealApplicationDoc, type BrandedExport,
  buildAllStatementsCsv, buildSyntheticBordereau, buildLiveBordereau, BORDEREAU_COLS,
} from '@/data/exportsService';

const D = (s: string) => new Date(s);
const allTime = getPeriods().find((p) => p.id === 'alltime')!;

/* 'northwind' is opndoor_referenced in the mock partner seed, which is what makes
   isAgencyUser true for a management user pinned to it: one of OUR agencies, on
   the agent rail. Same pair of readers as exports-agency-facing.test.ts, because
   the two documents differ in their columns and both carry money. */
const AGENCY_ROLE = 'management' as const;
const ADMIN_ROLE = 'superadmin' as const;

const LINES = [{ level: 'agency' as const, orgId: 'ag-r', orgName: "Regent's Lettings", rate: 0.25, source: 'agreement' as const }];

function app(o: Partial<FullApp> & Pick<FullApp, 'ref' | 'status'>): FullApp {
  return {
    partner: 'northwind', partnerRate: 0.25, agentRate: 0.25,
    agency: "Regent's Lettings", agencyId: 'ag-r', branch: "Regent's Park", branchId: 'br-rp',
    referrer: 'Rosa', owner: 0,
    rent: 2400, fee: 2400, feeBasisWeeks: 5, commissionLines: LINES,
    sentAt: null, paidAt: null, deedAt: null, tenancyStart: null, expiry: null,
    refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null,
    withdrawn: false, withdrawnReason: null, withdrawnNote: null, expired: false,
    ...o,
  };
}

/* THE REPORTED MONTH, to the penny. £3,840 a month on a five-week basis is
   £4,430.77 for the tenancy (3840 x 12 / 52 x 5), apportioned to the penny across
   three tenants. Nothing in this book comes to a whole number of pounds, on
   purpose: a figure that rounds to itself proves nothing. */
const SEP_SHARES = [1476.92, 1476.92, 1476.93];
const SEPTEMBER = 4430.77;

const BOOK: FullApp[] = [
  ...SEP_SHARES.map((share, i) => app({
    ref: `GR-S${i + 1}`, status: 'deed', rent: 3840, fee: share,
    sharePercent: Number((100 / 3).toFixed(2)), shareAmount: 1280,
    tenancyId: 'T-SEP', tenancyPosition: i + 1,
    sentAt: D('2025-09-02'), paidAt: D('2025-09-05'), deedAt: D('2025-09-08'),
    tenancyStart: D('2025-10-01'), expiry: D('2026-09-30'),
  })),
  /* May 2026 is the settlement month: the exports date themselves from a fixed
     26 June 2026 in test mode and a settlement covers the prior calendar month.
     Without a row in it the settlement blocks say "nothing accrued" and carry no
     money to check. £2,400 on three weeks is £1,661.54. */
  app({ ref: 'GR-A1', status: 'deed', rent: 2400, fee: 1661.54, feeBasisWeeks: 3,
    branch: 'Marylebone', branchId: 'br-my',
    sentAt: D('2026-05-06'), paidAt: D('2026-05-10'), deedAt: D('2026-05-12'),
    tenancyStart: D('2026-06-01'), expiry: D('2027-05-31') }),
  // A refund, to the penny, in the Refund amount TEXT column.
  app({ ref: 'GR-R1', status: 'paid', rent: 2400, fee: 1384.61,
    sentAt: D('2026-05-02'), paidAt: D('2026-05-05'),
    refunded: true, refundedAt: D('2026-05-20'), refundedAmount: 1384.61 }),
];

/* ---- walking a built document ---- */

type Block = {
  kind: string;
  items?: { label: string; value: string | number; type?: string }[];
  columns?: { header: string; type: string }[];
  rows?: (string | number)[][];
};
const blocksOf = (built: BrandedExport): { sheet: string; block: Block }[] =>
  built.sheets.flatMap((s) => (s.doc.blocks as Block[]).map((block) => ({ sheet: s.name, block })));

/** £1,234.56 and nothing else. A whole-pound "£1,235" fails, as does "£1,234.5". */
const PENCE_TEXT = /^£-?\d{1,3}(,\d{3})*\.\d{2}$/;

/** Text columns that hold an AMOUNT. They are text so the cell can stay empty
    (a numeric cell renders '' as £0.00 and would claim a refund of nothing was
    issued), which does not excuse them from the pence rule when they do hold
    one. */
const MONEY_TEXT_HEADERS = ['Refund amount'];

function expectPence(value: string | number | undefined, where: string): void {
  if (typeof value === 'number') {
    expect(Number.isFinite(value), `${where} is not a finite number: ${value}`).toBe(true);
    // Two decimals at most. Whole pounds pass this on purpose: 4431 IS a valid
    // pence value, which is why the September figure is asserted by name below.
    const dust = Math.abs(value * 100 - Math.round(value * 100));
    expect(dust < 1e-9, `${where} carries sub-penny dust: ${value}`).toBe(true);
    return;
  }
  const s = String(value ?? '');
  expect(s === '' || s === '-' || PENCE_TEXT.test(s), `${where} is not a money value: "${s}"`).toBe(true);
}

/** Every money cell of one document, held to the penny. Returns how many it
    found, so a document that quietly stopped carrying money cannot pass by
    having none. */
function expectMoneyCells(built: BrandedExport, where: string): number {
  let seen = 0;
  for (const { sheet, block } of blocksOf(built)) {
    for (const it of block.items ?? []) {
      if (it.type !== 'money2') continue;
      seen += 1;
      expectPence(it.value, `${where} / ${sheet} / "${it.label}"`);
    }
    const cols = block.columns ?? [];
    // 'money' is the template's WHOLE-POUND format. A table of figures may not
    // use it at all: that is the other half of the same rule.
    for (const c of cols) {
      expect(c.type, `${where} / ${sheet} / "${c.header}" is a whole-pound money column`).not.toBe('money');
    }
    const moneyAt = cols
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.type === 'money2' || MONEY_TEXT_HEADERS.includes(c.header));
    for (const row of block.rows ?? []) {
      for (const { c, i } of moneyAt) {
        seen += 1;
        expectPence(row[i], `${where} / ${sheet} / "${c.header}" row ${String(row[0])}`);
      }
    }
  }
  return seen;
}

/** The trend table's row for one month label, from a live performance export. */
function trendRow(built: BrandedExport, label: string): (string | number)[] {
  const table = blocksOf(built)
    .map(({ block }) => block)
    .find((b) => b.kind === 'table' && (b.columns ?? [])[0]?.header === 'Month' && (b.columns ?? []).some((c) => /Fees collected/.test(c.header)));
  return (table?.rows ?? []).find((r) => r[0] === label) ?? [];
}

beforeAll(() => hydrateFull(BOOK));
afterAll(() => hydrateFull([]));

describe('every money cell in every export is a penny figure', () => {
  it('the performance exports, live and demo, for both readers', () => {
    for (const [where, built] of [
      ['live performance (agency)', buildLivePerformanceDoc(AGENCY_ROLE, allTime)],
      ['live performance (admin)', buildLivePerformanceDoc(ADMIN_ROLE, allTime)],
      ['demo performance (agency)', buildPerformanceDoc(AGENCY_ROLE, allTime)],
      ['demo performance (admin)', buildPerformanceDoc(ADMIN_ROLE, allTime)],
    ] as [string, BrandedExport][]) {
      expect(expectMoneyCells(built, where), `${where} carried no money at all`).toBeGreaterThan(0);
    }
  });

  it('the application exports, every basis and both readers', () => {
    for (const [where, built] of [
      ['live applications (agency)', buildRealApplicationDoc(AGENCY_ROLE, allTime, 'referred', BASIS_META.referred)],
      ['live applications (admin)', buildRealApplicationDoc(ADMIN_ROLE, allTime, 'activity', BASIS_META.activity)],
      ['live applications (paid basis)', buildRealApplicationDoc(ADMIN_ROLE, allTime, 'paid', BASIS_META.paid)],
      ['demo applications', buildApplicationDoc(ADMIN_ROLE, allTime, 'referred')!],
    ] as [string, BrandedExport][]) {
      expect(expectMoneyCells(built, where), `${where} carried no money at all`).toBeGreaterThan(0);
    }
  });

  it('the league workbooks, all three boards', () => {
    for (const [where, built] of [
      ['league (agency)', buildLeagueDoc(AGENCY_ROLE, 'northwind', '', allTime)],
      ['league (admin)', buildLeagueDoc(ADMIN_ROLE, 'all', '', allTime)],
    ] as [string, BrandedExport][]) {
      expect(expectMoneyCells(built, where), `${where} carried no money at all`).toBeGreaterThan(0);
    }
  });

  it('the settlement statements, partner and agent', async () => {
    // Both are money documents end to end: every figure on them is a cell this
    // rule covers.
    expectMoneyCells(await buildPartnerStatementDoc(ADMIN_ROLE, 'all', 'northwind'), 'partner statement');
    const agent = await buildAgentStatementDoc(AGENCY_ROLE, 'northwind', 'northwind', "Regent's Lettings");
    expect(expectMoneyCells(agent, 'agent statement'), 'agent statement carried no money').toBeGreaterThan(0);
  });

  it("the month statement an agency exports from its own Reporting page", async () => {
    const statements = getCommissionStatements(AGENCY_ROLE, 'northwind', '2025-09');
    expect(statements.length, 'no statement to walk').toBeGreaterThan(0);
    for (const st of statements) {
      const built = await buildCommissionStatementDoc(AGENCY_ROLE, 'northwind', st.monthKey, st.payeeKey);
      expect(expectMoneyCells(built, `month statement ${st.payeeName}`), 'statement carried no money').toBeGreaterThan(0);
    }
  });

  /* THE TWO THE WALK MISSED. Both were outside the loop above: the
     all-statements CSV, and the bordereau -- which is the one document that
     leaves the building for an underwriter and the one that carried its own
     second rounder until it was deleted. A money lint that skips the file
     the money lint was raised about is not a lint. */
  it('the all-statements CSV', () => {
    // The same month and scope the statement walk above uses, so the two
    // documents are built over the identical book.
    const out = buildAllStatementsCsv(AGENCY_ROLE, 'northwind', '2025-09');
    const rows = (out?.csv ?? '').split(/\r?\n/).map((l) => l.split('","').map((c) => c.replace(/^"|"$/g, '')));
    const head = rows[0];
    expect(head, 'the CSV has a header').toBeTruthy();
    /* NUMERIC CELLS, not "£" text: this file writes money through money(),
       which returns a number so the spreadsheet can sum it. So the assertion
       is the numeric one -- already exact to the penny -- rather than the
       string one used for the text exports above. */
    const moneyAt = head.map((h, i) => ({ h, i })).filter(({ h }) => /fee charged|commission/i.test(h));
    expect(moneyAt.length, 'the CSV states a fee and a commission').toBe(2);
    let seen = 0;
    for (const r of rows.slice(1)) {
      if (r.length !== head.length) continue;
      for (const { h, i } of moneyAt) {
        const v = Number(r[i]);
        if (!Number.isFinite(v)) continue;
        seen += 1;
        expect(Math.round(v * 100) / 100, `all-statements CSV / "${h}"`).toBe(v);
      }
    }
    expect(seen, 'the all-statements CSV carried no money at all').toBeGreaterThan(0);
  });

  it.each([
    ['synthetic', () => buildSyntheticBordereau(2026, 8, 0.05)],
    /* THE LIVE ONE TOO. exportBordereauFile picks between the two on
       liveAvailable(), which vitest can never satisfy, so this is the only
       way to reach it -- and it is the builder that carried the second
       rounder. Walking only the synthetic one would have checked the half
       that was never wrong. */
    ['live', () => buildLiveBordereau(2026, 8, 0.05)],
  ])('the underwriter bordereau (%s), whose money cells are numbers rather than text', (_which, build) => {
    const bx = build();
    const head = BORDEREAU_COLS;
    const moneyAt = head.map((h, i) => ({ h, i })).filter(({ h }) => /rent|premium|amount/i.test(h));
    expect(moneyAt.length, 'the bordereau states rent').toBeGreaterThan(0);
    for (const r of bx.rows) {
      for (const { h, i } of moneyAt) {
        const v = r[i];
        if (typeof v !== 'number') continue;
        /* A NUMERIC CELL IS PENCE IF ROUNDING IT TO 2dp CHANGES NOTHING.
           The defect this whole file exists for was a figure rounded to the
           POUND, and 4431 survives that test while 4430.77 does not -- so
           the assertion is that the value is already exact to the penny,
           which a pound-rounded figure also satisfies. What it catches is
           the other half: floating-point dust like 2769.2299999999996,
           which is what summing apportioned shares reintroduces. */
        expect(Math.round(v * 100) / 100, `bordereau / "${h}"`).toBe(v);
      }
    }
  });

  it('the expiries CSV, whose money columns are text', () => {
    const out = buildExpiriesCsv(ADMIN_ROLE, 2027, 5)!;
    const rows = out.csv.split('\r\n').map((l) => l.split('","').map((c) => c.replace(/^"|"$/g, '')));
    const head = rows.find((r) => r[0] === 'Guarantee reference')!;
    const moneyAt = head.map((h, i) => ({ h, i })).filter(({ h }) => /rent|fee/i.test(h));
    expect(moneyAt.length, 'the expiries file states rent and fee').toBe(3);
    for (const r of rows.slice(rows.indexOf(head) + 1)) {
      if (r.length !== head.length) continue; // the header block above the table
      for (const { h, i } of moneyAt) expectPence(r[i], `expiries CSV / "${h}" / ${r[0]}`);
    }
  });
});

describe('the monthly trend states what was actually collected', () => {
  it('is the penny sum, not the rounded pound that started this', () => {
    // £4,430.77 across three tenants of one September let. It printed £4,431.00.
    const row = trendRow(buildLivePerformanceDoc(ADMIN_ROLE, allTime), 'Sep 2025');
    expect(row[0]).toBe('Sep 2025');
    expect(row[2]).toBe(SEPTEMBER);
    expect(row[2]).not.toBe(Math.round(SEPTEMBER));
  });

  it('agrees with the summary block above it, which is the point', () => {
    /* The trend is the only place these fees were re-summed, so the check that
       matters is that it still comes to the same total as the figure every other
       surface reads. One month is one row; the year is the column. */
    const built = buildLivePerformanceDoc(ADMIN_ROLE, allTime);
    const rows = blocksOf(built)
      .map(({ block }) => block)
      .find((b) => b.kind === 'table' && (b.columns ?? [])[0]?.header === 'Month')?.rows ?? [];
    const trendTotal = rows.reduce((s, r) => s + Number(r[2]), 0);
    const gross = blocksOf(built)
      .flatMap(({ block }) => block.items ?? [])
      // "Guarantee fees" since 2026-10-02: the SUMMARY labels were reworded,
      // while the CSV column headings a partner's code reads were not.
      .find((i) => i.label === 'Guarantee fees collected (gross)')!;
    // The trailing twelve months hold this whole book, so the two are the same
    // money. Compared to the penny, which is the only comparison worth making.
    expect(Math.round(trendTotal * 100) / 100).toBe(Math.round(Number(gross.value) * 100) / 100);
  });
});
