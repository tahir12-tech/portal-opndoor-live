/* EVERY ROW FITS ITS HEADERS, FOR EVERY READER.
 *
 * Matt, 2026-10-04: as Kestrel Management the Application export showed "The
 * export could not be built". The build was throwing.
 *
 * THE COLUMN WAS CONDITIONAL AND THE CELL WAS NOT. "Refund policy anomaly" is
 * dropped for a customer, from Matt's own 2026-10-03 instruction, and the
 * cell was still pushed. So every customer's row ran ONE CELL LONGER than its
 * header, and buildBrandedSheet does
 *
 *     const col = b.columns[ci];
 *     if (col.type === 'text') ...
 *
 * which reads `type` off undefined on that last cell and throws.
 *
 * IT BROKE THE EXPORT FOR EVERY NON-OPNDOOR READER, because customerFacing is
 * `!isOpndoorStaff`: every agency level and every supplier level. Opndoor's
 * own staff keep the column, so OUR rows matched and nobody here ever saw it.
 *
 * WHY THE EXISTING TEST MISSED IT, which is the part worth fixing properly.
 * exports-agency-facing builds the same document for an agency reader and
 * walks its cells, but it zips them with
 *
 *     Object.fromEntries(heads.map((h, i) => [h, r[i]]))
 *
 * and a surplus cell has no header to pair with, so it is silently dropped.
 * A test that reads a table by header name can never see a column count
 * disagree. This one counts.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { BASIS_META, getPeriods } from '@/data';
import { buildRealApplicationDoc } from '@/data/exportsService';
import { buildBrandedWorkbook } from '@/data/xlsxTemplate';
import type { Role } from '@/data/types';

const D = (s: string) => new Date(s);
const allTime = getPeriods().find((p) => p.id === 'alltime')!;
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

/* ONE OF THEM REFUNDED AFTER THE START, because that is the cell the broken
   column belonged to: a fixture where it is always blank would still have
   been one cell too many, but a reader checking the fixture would not see
   why it mattered. */
const BOOK: FullApp[] = [
  app({ ref: 'GR-1', status: 'deed', sentAt: D('2026-05-01'), paidAt: D('2026-05-04'),
        deedAt: D('2026-05-06'), tenancyStart: D('2026-06-01'), expiry: D('2027-05-31') }),
  app({ ref: 'GR-2', status: 'paid', sentAt: D('2026-05-02'), paidAt: D('2026-05-05'),
        tenancyStart: D('2026-06-01'), refunded: true, refundedAt: D('2026-06-10'),
        refundedAmount: 2400, refundAfterStart: true }),
  /* OWNED BY THE READER, so the Negotiator and supplier Referrer level has
     rows at all. scopeFull narrows a referrer to `owner === 1`, so a fixture
     of other people's referrals gives them an empty table and an empty table
     cannot have a column mismatch: that level would have been in the list
     and testing nothing. Found by checking the test fails without the fix
     and counting which cases failed. */
  app({ ref: 'GR-3', status: 'deed', owner: 1, sentAt: D('2026-05-03'),
        paidAt: D('2026-05-06'), deedAt: D('2026-05-08'),
        tenancyStart: D('2026-06-01'), expiry: D('2027-05-31') }),
];

/* EVERY LEVEL MATT NAMED, and the two that decide the branch are the agency
   and supplier ones: customerFacing is `!isOpndoorStaff`, so they take the
   path that was broken and the opndoor ones take the path that was not. */
const READERS: { label: string; role: Role }[] = [
  { label: 'opndoor admin', role: 'superadmin' },
  { label: 'opndoor manager', role: 'opndoor_manager' },
  { label: 'agency or supplier management', role: 'management' },
  { label: 'agency Negotiator or supplier Referrer', role: 'referrer' },
];

const BASES = ['referred', 'paid', 'deed', 'activity'] as const;

describe('every application export row fits its headers', () => {
  beforeEach(() => hydrateFull(BOOK));
  afterAll(() => hydrateFull([]));

  for (const { label, role } of READERS) {
    for (const basis of BASES) {
      it(`${label}, on the ${basis} basis`, () => {
        const doc = buildRealApplicationDoc(role, allTime, basis, BASIS_META[basis]);
        const table = doc.sheets[0].doc.blocks.find((b) => b.kind === 'table');
        if (!table) return; // a reader with no table has nothing to mismatch
        const want = table.columns!.length;
        table.rows!.forEach((r, i) => {
          expect(r.length, `${label}/${basis} row ${i} has ${r.length} cells for ${want} headers`).toBe(want);
        });
      });
    }
  }

  /* AND THE WORKBOOK ACTUALLY BUILDS, which is the failure as the reader met
     it. The length assertions above say WHY; this says the button works.
     Without it a future mismatch in a different block would pass them all. */
  for (const { label, role } of READERS) {
    it(`and the workbook builds for ${label}`, () => {
      const doc = buildRealApplicationDoc(role, allTime, 'referred', BASIS_META.referred);
      expect(() => buildBrandedWorkbook(doc.sheets)).not.toThrow();
    });
  }
});
