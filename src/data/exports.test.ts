/* Verifies the branded xlsx pipeline actually produces valid workbooks
   (the route smoke test never triggers an export). Run with `npm run smoke`. */
import { afterAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx-js-style';
import { ALL_PARTNERS, buildApplicationDoc, buildLeagueDoc, buildPerformanceDoc, getSelectedPeriod } from '@/data';
import { buildCommissionStatementDoc } from '@/data/exportsService';
import { getCommissionStatements } from '@/data/liveAnalytics';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { buildBrandedWorkbook } from '@/data/xlsxTemplate';

function xlsxBytes(sheets: Parameters<typeof buildBrandedWorkbook>[0]): Uint8Array {
  const wb = buildBrandedWorkbook(sheets);
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
}
// A .xlsx is a zip, so it starts with the "PK" signature.
function isXlsx(u8: Uint8Array): boolean {
  return u8.length > 500 && u8[0] === 0x50 && u8[1] === 0x4b;
}

const period = getSelectedPeriod();

describe('branded xlsx exports', () => {
  it('performance workbook is a valid branded xlsx', () => {
    const built = buildPerformanceDoc('superadmin', period);
    expect(built.filename).toMatch(/^opndoor-performance-.*\.xlsx$/);
    expect(isXlsx(xlsxBytes(built.sheets))).toBe(true);
    // header band carries the wordmark
    const wb = buildBrandedWorkbook(built.sheets);
    expect(wb.Sheets.Performance.A1?.v).toBe('opndoor');
  });

  it('application workbook honours the basis and the referrer gate', () => {
    expect(buildApplicationDoc('referrer', period, 'referred')).toBeNull();
    const built = buildApplicationDoc('management', period, 'activity');
    expect(built).not.toBeNull();
    expect(built!.filename).toContain('activity');
    expect(isXlsx(xlsxBytes(built!.sheets))).toBe(true);
  });

  it('league workbook has three branded sheets', () => {
    const built = buildLeagueDoc('superadmin', ALL_PARTNERS, '', period);
    expect(built.sheets.map((s) => s.name)).toEqual(['Agencies', 'Branches', 'Referrers']);
    const wb = buildBrandedWorkbook(built.sheets);
    expect(wb.SheetNames).toEqual(['Agencies', 'Branches', 'Referrers']);
    expect(isXlsx(xlsxBytes(built.sheets))).toBe(true);
  });

  it('league export honours the selected league tab', () => {
    const built = buildLeagueDoc('superadmin', ALL_PARTNERS, '', period, 'branch');
    expect(built.sheets.map((s) => s.name)).toEqual(['Branches']);
    expect(built.sheets[0].doc.blocks[0].kind).toBe('table');
    expect(built.sheets[0].doc.reportName).toContain('Branches');
  });
});

/* ---------------------------------------------------------------------------
   THE MONTH STATEMENT'S SHAPE.

   This is the document the Export button on the statement panel downloads, and
   it was the fourth rendering of a statement the screen, the PDF and the CSV
   already agreed on. It drew all ten columns where they draw nine, headed itself
   "Commission statement" twice, and footed with a blended percentage that
   appears in no agreement.
   --------------------------------------------------------------------------- */
const D = (s: string) => new Date(s);
const AGENCY_LINE = [{ level: 'agency' as const, orgId: 'ag-r', orgName: "Regent's Lettings", rate: 0.25, source: 'agreement' as const }];

function stApp(o: Partial<FullApp> & Pick<FullApp, 'ref'>): FullApp {
  return {
    status: 'deed', partner: 'northwind', partnerRate: 0.25, agentRate: 0.25,
    agency: "Regent's Lettings", agencyId: 'ag-r', branch: "Regent's Park", branchId: 'br-rp',
    referrer: 'Rosa', owner: 0,
    rent: 2400, fee: 1661.54, feeBasisWeeks: 3, commissionLines: AGENCY_LINE,
    sentAt: D('2026-03-02'), paidAt: D('2026-03-05'), deedAt: D('2026-03-08'),
    tenancyStart: D('2026-04-01'), expiry: D('2027-03-31'),
    refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null,
    withdrawn: false, withdrawnReason: null, withdrawnNote: null, expired: false,
    ...o,
  } as FullApp;
}

/** The March statement for the one payee in the hydrated book. */
async function marchStatement() {
  const st = getCommissionStatements('management', 'northwind', '2026-03')[0];
  expect(st, 'the book has a March statement').toBeTruthy();
  const built = await buildCommissionStatementDoc('management', 'northwind', st.monthKey, st.payeeKey);
  const blocks = built.sheets[0].doc.blocks as {
    kind: string; title?: string; items?: { label: string; value: string | number }[];
    columns?: { header: string }[]; rows?: (string | number)[][];
  }[];
  return { built, blocks, doc: built.sheets[0].doc };
}

describe('the commission statement an agency exports for a month', () => {
  afterAll(() => hydrateFull([]));

  it('heads the block with the payee, the period, the stored reference and the basis, and nothing else', async () => {
    hydrateFull([stApp({ ref: 'GR-M1' }), stApp({ ref: 'GR-M2', paidAt: D('2026-03-19') })]);
    const { blocks, doc } = await marchStatement();
    const head = blocks.find((b) => b.kind === 'keyvalue')!;
    expect(head.items!.map((i) => i.label)).toEqual([
      'Payee', 'Period',
      // One branch and one rate source across both lines, so both columns
      // collapse and their single value moves up here.
      'Branch', 'Rate source',
      'Statement reference', 'Generated', 'Basis',
    ]);
    // "Payee level: agency" is our word for where a rate hangs, not a fact the
    // payee reads their statement for; currency is on the meta line.
    expect(head.items!.map((i) => i.label)).not.toContain('Payee level');
    expect(head.items!.map((i) => i.label)).not.toContain('Currency');
    // ONE heading. The title under the brand band used to be repeated as a
    // section directly beneath itself.
    expect(doc.reportName).toBe('Commission statement');
    expect(blocks.filter((b) => b.kind === 'section' && b.title === 'Commission statement')).toHaveLength(0);
  });

  it('drops the columns that say the same thing on every line, as the screen and the PDF do', async () => {
    hydrateFull([stApp({ ref: 'GR-M1' }), stApp({ ref: 'GR-M2', paidAt: D('2026-03-19') })]);
    const { blocks } = await marchStatement();
    const table = blocks.find((b) => b.kind === 'table')!;
    const heads = table.columns!.map((c) => c.header);
    expect(heads).not.toContain('Branch');
    expect(heads).not.toContain('Rate source');
    expect(heads).toHaveLength(8);
    // The row still lines up with the header it lost two columns from.
    for (const r of table.rows!) expect(r).toHaveLength(8);
  });

  it('keeps the Branch column the moment two branches paid', async () => {
    hydrateFull([stApp({ ref: 'GR-M1' }), stApp({ ref: 'GR-M2', branch: 'Marylebone', branchId: 'br-my', paidAt: D('2026-03-19') })]);
    const { blocks } = await marchStatement();
    const table = blocks.find((b) => b.kind === 'table')!;
    expect(table.columns!.map((c) => c.header)).toContain('Branch');
    const head = blocks.find((b) => b.kind === 'keyvalue')!;
    // ...and it is not also asserted once in the header, which would be the
    // portal naming one of the two branches for the whole statement.
    expect(head.items!.map((i) => i.label)).not.toContain('Branch');
  });

  it('totals with a label and an amount, and no blended percentage', async () => {
    hydrateFull([stApp({ ref: 'GR-M1' }), stApp({ ref: 'GR-M2', paidAt: D('2026-03-19') })]);
    const { blocks } = await marchStatement();
    const table = blocks.find((b) => b.kind === 'table')!;
    // The total is no longer a row inside the table: a blank cell in a money
    // column renders as £0.00 and in a rate column as 0%.
    expect(table.rows!.every((r) => !String(r[0]).startsWith('Total'))).toBe(true);
    const total = blocks.filter((b) => b.kind === 'keyvalue').at(-1)!.items![0];
    expect(total.label).toBe('Total commission (2 applications)');
    expect(total.value).toBe(Math.round(1661.54 * 0.25 * 2 * 100) / 100);
  });

  it('is still a valid branded xlsx', async () => {
    hydrateFull([stApp({ ref: 'GR-M1' })]);
    const { built } = await marchStatement();
    expect(built.filename).toMatch(/^opndoor-statement-.*\.xlsx$/);
    expect(isXlsx(xlsxBytes(built.sheets))).toBe(true);
  });
});
