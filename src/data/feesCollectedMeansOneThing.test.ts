/* =====================================================================
   (cg) "FEES COLLECTED" MEANS ONE THING.

   Matt: "'Fees collected' means the same everywhere: on agency/supplier
   Reporting tabs and the Agencies list, show fees net of refunds (or
   label gross as 'before refunds'). Regent shows GBP 21,447.75 on its
   Reporting tab and GBP 15k on the Agencies list."

   BOTH FIGURES WERE RIGHT, which is why neither looked wrong on its
   own. Measured on dev over Regent's book before changing anything:

       paid-or-deed fees   21,447.75
       refunds              6,228.46
       net                 15,219.29

   His two numbers to the penny. One name, two measures.

   AND THE SUBTRACTION WAS WRITTEN FOUR TIMES, differently:

       the dashboard tile      full and partial refunds
       the League groups       full only
       the customers table     none
       the monthly trend       none

   So the defect is not a wrong figure anywhere, it is four
   implementations of one sentence. refundTaken is the sentence.
   ===================================================================== */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { refundTaken } from '@/data/commissionSplit';
import { liveByCustomer, liveLeague, liveAggregate, liveMonths, livePartnerBreakdown } from '@/data/liveAnalytics';
import { ALL_PARTNERS, getPeriods } from '@/data';

const D = (s: string) => new Date(s);
const allTime = getPeriods().find((p) => p.id === 'alltime')!;
const LINE = [{ level: 'agency' as const, orgId: 'ag-r', orgName: "Regent's Lettings", rate: 0.25, source: 'agreement' as const }];

function app(o: Partial<FullApp> & Pick<FullApp, 'ref' | 'status'>): FullApp {
  return {
    partner: 'northwind', partnerRate: 0.25, agentRate: 0.25,
    agency: "Regent's Lettings", agencyId: 'ag-r', branch: "Regent's Park", branchId: 'br-rp',
    referrer: 'Rosa', owner: 0,
    rent: 2400, fee: 1000, feeBasisWeeks: 4.35, commissionLines: LINE,
    sentAt: D('2026-05-01'), paidAt: D('2026-05-04'), deedAt: null,
    tenancyStart: null, expiry: null,
    refunded: false, partiallyRefunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null, ...o,
  } as FullApp;
}

describe('what came back out of a fee', () => {
  it('is nothing on a fee that stayed', () => {
    expect(refundTaken(app({ ref: 'A', status: 'paid' }))).toBe(0);
  });

  /* A FULL REFUND MAY FALL BACK TO THE WHOLE FEE, because that is what
     went back when no amount was recorded. */
  it('is the whole fee on a full refund with no amount recorded', () => {
    expect(refundTaken(app({ ref: 'B', status: 'paid', refunded: true }))).toBe(1000);
  });

  it('and the recorded amount where there is one', () => {
    expect(refundTaken(app({ ref: 'C', status: 'paid', refunded: true, refundedAmount: 400 }))).toBe(400);
  });

  /* A PARTIAL ONE NEVER MAY. R2: the deed stands, the underwriter is on
     risk, and falling back to the fee would turn a GBP 10 refund into a
     GBP 1,000 one. */
  it('is the amount only on a partial refund, never the fee', () => {
    expect(refundTaken(app({ ref: 'D', status: 'paid', partiallyRefunded: true, refundedAmount: 10 }))).toBe(10);
    expect(refundTaken(app({ ref: 'E', status: 'paid', partiallyRefunded: true }))).toBe(0);
  });
});

/* HIS OWN SHAPE: one let paid, one refunded in full, one partly refunded.
   21,447.75 and 15,219.29 are the same relationship at a smaller scale. */
const BOOK: FullApp[] = [
  app({ ref: 'GR-KEPT', status: 'deed', deedAt: D('2026-05-06') }),
  app({ ref: 'GR-BACK', status: 'paid', refunded: true, refundedAt: D('2026-05-20'), refundedAmount: 1000 }),
  app({ ref: 'GR-PART', status: 'paid', partiallyRefunded: true, refundedAt: D('2026-05-21'), refundedAmount: 250 }),
];

beforeEach(() => hydrateFull(BOOK));
afterAll(() => hydrateFull([]));

describe('every surface that says "Fees collected"', () => {
  const expected = 3000 - 1000 - 250; // 1750

  it('the Reporting tab’s customers table', () => {
    const rows = liveByCustomer('superadmin', ALL_PARTNERS, allTime);
    expect(rows.reduce((s, r) => s + r.fees, 0)).toBe(expected);
  });

  /* THE BOARD WAS THE ONE THAT KNEW ABOUT A FULL REFUND AND NOT A PARTIAL
     ONE, so it could show more collected than the tile above it. */
  it('the League boards', () => {
    const rows = liveLeague('agency', 'superadmin', ALL_PARTNERS, '', allTime);
    expect(rows.reduce((s, r) => s + r.fees, 0)).toBe(expected);
  });

  it('the monthly trend', () => {
    expect(liveMonths('superadmin', ALL_PARTNERS).reduce((s, m) => s + m.fees, 0)).toBe(expected);
  });

  /* THE PARTNER BREAKDOWN, which is the FIFTH place the subtraction was
     written and was found by reading the file again after the other four
     were fixed. Its refund column knew about a full refund and not a
     partial one, so money that went back was missing from a column
     headed Refunds. */
  it('the per-partner breakdown\u2019s refund column', () => {
    const rows = livePartnerBreakdown('superadmin', ALL_PARTNERS, allTime);
    expect(rows.reduce((s, r) => s + r.refundValue, 0)).toBe(1250);
    expect(rows.reduce((s, r) => s + (r.feesGross - r.refundValue), 0)).toBe(expected);
  });

  /* AND THE TILE, which was already right and is the figure the others are
     being brought into line with. Asserted so the one that was correct
     cannot drift either. */
  it('and the dashboard tile they all have to agree with', () => {
    const a = liveAggregate('superadmin', ALL_PARTNERS, allTime);
    expect(a.feesNet).toBe(expected);
    expect(a.feesGross).toBe(3000);
    expect(a.feesGross - a.refundValue).toBe(a.feesNet);
  });
});
