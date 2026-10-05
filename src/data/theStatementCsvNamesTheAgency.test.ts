/* =====================================================================
   (bs) THE "EXPORT ALL" COMMISSION STATEMENT CSV.

   Matt: "Admin 'Export all' commission statement CSV: month as 'October
   2026' (not 'Oct-26', which Excel produces from a date; write it as
   text); tenancy as 'Joint (2)' on every row, including supplier ones;
   add an Agency column so supplier rows show the agency (Test Lettings
   asda) as well as the office."

   HIS DIAGNOSIS IS THE FIX FOR THE FIRST ONE. The cell was not wrong in
   the file: "October 2026" is what was written, and Excel parses it as a
   date on open and renders it in its own format. No format string can
   prevent that, so the value has to be one Excel will not take for a
   date.

   THE SECOND IS THE SHAPE OF (ba) AGAIN: a field computed on one rail
   and left thin on the other. The supplier lines said "Joint" with no
   count -- and said it for a tenancy of ONE, because they asked whether
   a tenancy row existed rather than whether anybody else was on it.
   ===================================================================== */
import { afterAll, describe, expect, it } from 'vitest';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { buildAllStatementsCsv } from '@/data/exportsService';
import { ALL_PARTNERS } from '@/data/types';

const D = (s: string) => new Date(s);
const SUPPLIER_LINES = [
  { level: 'supplier' as const, orgId: null, orgName: 'Harbourside Homes', rate: 0.2, source: 'standard' as const },
  { level: 'agency' as const, orgId: 'ag-h', orgName: 'Harbour Agency', rate: 0.1, source: 'standard' as const },
];

function app(o: Partial<FullApp> & Pick<FullApp, 'ref' | 'status'>): FullApp {
  return {
    partner: 'harbourside', partnerRate: 0.2, agentRate: 0.1,
    agency: 'Harbour Agency', agencyId: 'ag-h', branch: 'Harbour Quay', referrer: 'Rosa', owner: 0,
    rent: 2400, fee: 1200, feeBasisWeeks: 5, commissionLines: SUPPLIER_LINES,
    sentAt: D('2026-10-01'), paidAt: D('2026-10-04'), deedAt: D('2026-10-06'),
    tenancyStart: null, expiry: null,
    refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: 'executed', deedSentAt: null, deedViewedAt: null, ...o,
  };
}

/* TWO ON ONE TENANCY, AND ONE ALONE. The pair is what "Joint (2)" has to
   say on a supplier row; the single is what must NOT say it, which is
   the half the old code got wrong by asking only whether a tenancy row
   existed. */
hydrateFull([
  app({ ref: 'GR-J1', status: 'deed', tenancyId: 'T9', tenancyPosition: 1, sharePercent: 50 }),
  app({ ref: 'GR-J2', status: 'deed', tenancyId: 'T9', tenancyPosition: 2, sharePercent: 50 }),
  app({ ref: 'GR-SOLO', status: 'deed', tenancyId: 'T10', tenancyPosition: 1 }),
]);
afterAll(() => hydrateFull([]));

const csv = () => buildAllStatementsCsv('superadmin', ALL_PARTNERS, '2026-10');
/** The file as rows of cells, unquoted. */
function cells(): string[][] {
  const out = csv();
  expect(out, 'the month has statements to export').toBeTruthy();
  return out!.csv.split('\r\n').map((line) => (line.match(/"(?:[^"]|"")*"/g) ?? []).map((c) => c.slice(1, -1).replace(/""/g, '"')));
}
const header = () => cells()[0];
const rowFor = (ref: string) => cells().find((r) => r.includes(ref))!;

describe('(bs)(1) the month', () => {
  it('is written so Excel cannot turn it into a date', () => {
    const month = rowFor('GR-J1')[header().indexOf('Month')];
    expect(month).toBe('="October 2026"');
  });

  /* THE WORDS ARE STILL HIS, inside the quotes: the point is the cell
     reads "October 2026" when it is opened, not that it reads something
     else that survives. */
  it('and still says October 2026 once a spreadsheet has read it', () => {
    const month = rowFor('GR-J1')[header().indexOf('Month')];
    expect(month).toContain('October 2026');
    expect(month).not.toContain('Oct-26');
  });
});

describe('(bs)(2) the tenancy, on a supplier row', () => {
  it('says Joint and how many', () => {
    expect(rowFor('GR-J1')[header().indexOf('Tenancy')]).toBe('Joint (2)');
    expect(rowFor('GR-J2')[header().indexOf('Tenancy')]).toBe('Joint (2)');
  });

  /* A TENANCY ROW IS NOT A JOINT TENANCY, which is what the supplier side
     assumed: a solo let can carry one, and every one of them read
     "Joint". */
  it('and says Single where there is nobody else on the tenancy', () => {
    expect(rowFor('GR-SOLO')[header().indexOf('Tenancy')]).toBe('Single');
  });
});

describe('(bs)(3) the Agency column', () => {
  it('is there, beside the office rather than instead of it', () => {
    expect(header()).toContain('Agency');
    expect(header()).toContain('Branch');
    expect(header().indexOf('Agency')).toBeLessThan(header().indexOf('Branch'));
  });

  it('and names the agency on a supplier row', () => {
    const r = rowFor('GR-J1');
    expect(r[header().indexOf('Agency')]).toBe('Harbour Agency');
    expect(r[header().indexOf('Branch')]).toBe('Harbour Quay');
  });
});
