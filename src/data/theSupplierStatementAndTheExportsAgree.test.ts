/* THE OTHER HALF OF THE PENNY.
 *
 * Matt, 2026-10-02, verbatim: "Store supplier commission per application
 * the same way agency commission is stored, and read it everywhere
 * (statements, exports, reporting, settlements) instead of
 * recalculating, with a test that the supplier statement and exports
 * agree to the penny."
 *
 * c7581ee made every surface READ the agency's commission instead of
 * multiplying a rate, and said plainly what it could not do:
 * "application_commission_lines carries agency, group and branch levels
 * only, so a supplier's share has no stored line to read and stays
 * fee x partner_rate at every caller." Eight callers, each rounding on
 * its own, waiting for the first supplier fee that lands on a half
 * penny -- which is exactly the shape of GR-20846.
 *
 * 20261007580000 gives it a line, apportioned across a tenancy the same
 * way the agency side is, and `supplierAmountOf` reads it.
 *
 * THE FIXTURE IS A HALF PENNY, deliberately: a supplier fee of £1,061.54
 * at 25% is 265.385. A surface that multiplies gives £265.39; the stored
 * line says £265.38. If any caller goes back to multiplying, the
 * agreement assertions below go red.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_PARTNERS } from '@/data/types';
import { getPeriods } from '@/data';
import { hydrateFull, hydrateApplications, type FullApp } from '@/data/applicationsService';
import { buildRealApplicationDoc } from '@/data/exportsService';
import {
  getCommissionSettlement, liveAggregate, livePartnerBreakdown, liveTrend,
} from '@/data/liveAnalytics';
import { supplierAmountOf, supplierLineOf, linesFor } from '@/data/commissionSplit';

const D = (s: string) => new Date(s);

/* A SUPPLIER'S JOINT TENANCY. `harbourside` holds no referencingMode in
   the mock seed, so it is supplier-shaped -- the same test
   `is_supplier_estate` makes in SQL. The two supplier lines are the
   tenancy's £576.92 apportioned, not two halves rounded on their own. */
const PAIR: FullApp[] = [
  {
    ref: 'SUP-1', rent: 2000, fee: 1246.15, partner: 'harbourside',
    agency: 'Northbank Lettings', branch: 'Shoreditch', referrer: 'A Supplier', owner: 0,
    status: 'paid', partnerRate: 0.25, agentRate: 0,
    tenancyId: 'T-S', tenancyPosition: 1, sharePercent: 54,
    sentAt: D('2026-05-01'), paidAt: D('2026-05-04'), deedAt: null, tenancyStart: D('2026-07-01'),
    expiry: null, refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null,
    commissionLines: [
      { level: 'supplier', orgId: 'p-hs', orgName: 'Harbourside Homes', rate: 0.25, amount: 311.54 },
    ],
  },
  {
    ref: 'SUP-2', rent: 2000, fee: 1061.54, partner: 'harbourside',
    agency: 'Northbank Lettings', branch: 'Shoreditch', referrer: 'A Supplier', owner: 0,
    status: 'paid', partnerRate: 0.25, agentRate: 0,
    tenancyId: 'T-S', tenancyPosition: 2, sharePercent: 46,
    sentAt: D('2026-05-01'), paidAt: D('2026-05-04'), deedAt: null, tenancyStart: D('2026-07-01'),
    expiry: null, refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null,
    // THE HALF PENNY. 1061.54 x 0.25 = 265.385.
    commissionLines: [
      { level: 'supplier', orgId: 'p-hs', orgName: 'Harbourside Homes', rate: 0.25, amount: 265.38 },
    ],
  },
] as unknown as FullApp[];

const allTime = getPeriods().find((p) => p.id === 'alltime')!;
const META = { label: 'everything', recon: '', hint: '' };

beforeAll(() => { hydrateFull(PAIR); hydrateApplications([], []); });
afterAll(() => { hydrateFull([]); hydrateApplications([], []); });

/** The Partner commission cell of the application export, by reference. */
function exportSupplierCommission(): Map<string, number> {
  const doc = buildRealApplicationDoc('superadmin', allTime, 'referred', META).sheets[0].doc;
  const table = doc.blocks.find((b) => b.kind === 'table'
    && (b.columns ?? []).some((c) => c.header === 'Partner commission'));
  const cols = (table as { columns: { header: string }[] }).columns.map((c) => c.header);
  const refAt = cols.indexOf('Guarantee reference');
  const commAt = cols.indexOf('Partner commission');
  const out = new Map<string, number>();
  for (const row of (table as { rows: unknown[][] }).rows) out.set(String(row[refAt]), Number(row[commAt]));
  return out;
}

describe('the supplier statement and the exports', () => {
  it('agree to the penny on every application', () => {
    const fromExport = exportSupplierCommission();
    // The statement's own figures, from the settlement its document is
    // built out of.
    const st = getCommissionSettlement('superadmin', ALL_PARTNERS, 'prior');
    const fromStatement = new Map<string, number>();
    for (const p of st.partners) for (const ap of p.apps) {
      fromStatement.set(ap.ref, (fromStatement.get(ap.ref) ?? 0) + ap.commission);
    }
    expect(fromStatement.size).toBe(2);
    for (const [ref, amount] of fromStatement) {
      expect(fromExport.get(ref), `${ref} disagrees between the export and the supplier statement`)
        .toBeCloseTo(amount, 2);
    }
  });

  it('and SUP-2 is £265.38 in both, not £265.39 in one', () => {
    expect(exportSupplierCommission().get('SUP-2')).toBeCloseTo(265.38, 2);
    expect(supplierAmountOf(PAIR[1])).toBeCloseTo(265.38, 2);
    // What it would have been if anything multiplied the rate out.
    expect(Math.round(1061.54 * 0.25 * 100) / 100).toBeCloseTo(265.39, 2);
  });

  it('and the tenancy sums to the commission that was apportioned', () => {
    const e = exportSupplierCommission();
    expect((e.get('SUP-1') ?? 0) + (e.get('SUP-2') ?? 0)).toBeCloseTo(576.92, 2);
  });

  /* REPORTING IS THE THIRD AND FOURTH SURFACE, and Matt named both. The
     aggregate fills the dashboard's commission tile and the summary
     export; the route table is the breakdown under it. */
  it('and reporting foots to the same figure', () => {
    expect(liveAggregate('superadmin', ALL_PARTNERS, allTime).supplierCommNet).toBeCloseTo(576.92, 2);
    const route = livePartnerBreakdown('superadmin', ALL_PARTNERS, allTime)
      .find((r) => r.partner === 'harbourside')!;
    expect(route.partnerCommNet).toBeCloseTo(576.92, 2);
  });

  it('and so does the monthly trend', () => {
    const may = liveTrend('month', 'superadmin', ALL_PARTNERS).find((r) => r.label === 'May 2026')!;
    expect(may.comm).toBeCloseTo(576.92, 0);
  });
});

/* =====================================================================
   AND THE TWO SIDES DO NOT LEAK INTO EACH OTHER.

   The supplier line lives in the same table as the agency's, so the
   risk the shape creates is that every existing agency-side reader
   starts counting the supplier's cut as agent commission. `linesFor`
   filters it out once, for all of them.
   ===================================================================== */
describe('the supplier line', () => {
  it('is readable on its own', () => {
    expect(supplierLineOf(PAIR[1])?.amount).toBe(265.38);
  });

  /* NOT AN AGENCY PAYEE. If it reached linesFor, every ranking, the
     agent settlement and the agent statement would pay the supplier's
     cut to the agency whose name happens to be on the application. */
  it('and is not one of the agency-side lines', () => {
    expect(linesFor(PAIR[1]).some((l) => l.level === 'supplier')).toBe(false);
  });

  /* A SUPPLIER APPLICATION WITH NO AGENCY SPLIT falls back to the
     historic single agency line, which is what linesFor has always done
     for a row with no frozen split -- the supplier line must not count
     as "it has a split". */
  it('and does not count as an agency split that is not there', () => {
    const lines = linesFor(PAIR[1]);
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('agency');
    expect(lines[0].rate).toBe(0);
  });

  it('and is nothing at all on our own estate', () => {
    const ours = { ...PAIR[1], partner: 'northwind', commissionLines: [] } as unknown as FullApp;
    expect(supplierAmountOf(ours)).toBe(0);
  });
});
