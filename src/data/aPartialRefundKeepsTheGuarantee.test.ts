/* R2, THE CLIENT HALF. A PARTIAL REFUND MOVES MONEY, NOT THE GUARANTEE.
 *
 * The database half is fixed in 20261006830000: `apply_stripe_refund` no
 * longer flips `payment_state` to 'refunded' whatever the amount, and a
 * partial refund now lands as 'partially_refunded'. This file is the other
 * half of the same defect: what the screens and the exports then do with it.
 *
 * MEASURED ON DEV before the fix: a GBP 10 refund against a GBP 1,246.15 fee
 * removed the agency's entire GBP 311.54 commission line, and the payee list
 * went from 5 lines / GBP 1,601.54 to 4 / GBP 1,290.00.
 *
 * TWO DIRECTIONS, and the whole point is that they differ:
 *
 *   "is this guarantee cancelled?"   -> NO. It stays on the bordereau, the
 *                                       underwriter is still on risk, and the
 *                                       agency keeps its commission.
 *   "how much did we actually keep?" -> the fee, LESS what went back.
 *
 * Get the first wrong and an enforceable guarantee vanishes off the
 * underwriter return. Get the second wrong and the fee total overstates what
 * Opndoor holds. A single boolean cannot answer both, which is exactly how
 * one word came to wipe a commission line.
 *
 * NOT DECIDED HERE, and deliberately: whether commission should be PRO-RATED
 * down by a partial refund. Today it stays on the whole fee, which is the
 * status quo for any application that was not refunded. That is a commercial
 * decision, it is nobody's to take but Matt's, and it is recorded as NM-I.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALL_PARTNERS } from '@/data/types';
import { getPeriods } from '@/data';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { liveAggregate } from '@/data/liveAnalytics';
import { buildLiveBordereau } from '@/data/exportsService';

const RENT = 1246.15;
const FEE = 1246.15;
const start = new Date('2026-06-01');

/** The measured application, as it sits after ten pounds came back. */
const partiallyRefunded = (): FullApp => ({
  ref: 'GR-PART-1', partner: 'opndoor-agents', agency: "Regent's Lettings", branch: "Regent's Park",
  rent: RENT, fee: FEE, agentRate: 0.25, partnerRate: 0.25,
  status: 'deed', tenancyStart: start, deedAt: start, expiry: null,
  sentAt: start, paidAt: start,
  // THE POINT. Not cancelled; ten pounds lighter.
  refunded: false, partiallyRefunded: true, refundedAt: new Date('2026-06-10'), refundedAmount: 10,
  deedState: 'executed',
} as unknown as FullApp);

/** The same application, fully refunded, as the control. */
const fullyRefunded = (): FullApp => ({
  ...partiallyRefunded(), ref: 'GR-FULL-1',
  refunded: true, partiallyRefunded: false, refundedAmount: FEE,
} as unknown as FullApp);

beforeEach(() => hydrateFull([]));
afterEach(() => hydrateFull([]));

describe('the guarantee is still in force', () => {
  /* THE UNDERWRITER ONE. A partially refunded deed is still executed and
     still enforceable, so dropping it off the return understates the risk
     Opndoor has actually placed. */
  it('stays on the bordereau, because the deed is still executed', () => {
    hydrateFull([partiallyRefunded()]);
    const { rows, issued } = buildLiveBordereau(2026, 5, 13.5);
    expect(issued).toBe(1);
    expect(rows).toHaveLength(1);
  });

  it('while a FULLY refunded one is correctly off it', () => {
    hydrateFull([fullyRefunded()]);
    const { rows } = buildLiveBordereau(2026, 5, 13.5);
    expect(rows).toHaveLength(0);
  });

  /* THE AGENCY ONE, and the measured symptom. Losing the whole commission
     line over ten pounds is the defect in one sentence. */
  it('earns its commission, which a partial refund does not cancel', () => {
    hydrateFull([partiallyRefunded()]);
    const a = liveAggregate('superadmin', ALL_PARTNERS, getPeriods().find((p) => p.id === 'alltime')!);
    expect(a.agentCommExcl).toBe(0);
    expect(a.partnerCommExcl).toBe(0);
    expect(a.agentCommNet).toBeGreaterThan(0);
  });

  it('while a FULLY refunded one correctly earns none', () => {
    hydrateFull([fullyRefunded()]);
    const a = liveAggregate('superadmin', ALL_PARTNERS, getPeriods().find((p) => p.id === 'alltime')!);
    expect(a.agentCommNet).toBe(0);
    expect(a.agentCommExcl).toBeGreaterThan(0);
  });
});

describe('but the money that went back is not money kept', () => {
  /* THE OTHER DIRECTION. If the state alone were used and the amount ignored,
     the fee total would claim Opndoor still holds the ten pounds. */
  it('counts the ten pounds as refunded, not as fees collected', () => {
    hydrateFull([partiallyRefunded()]);
    const a = liveAggregate('superadmin', ALL_PARTNERS, getPeriods().find((p) => p.id === 'alltime')!);
    expect(a.refundValue).toBe(10);
    expect(a.feesGross).toBe(FEE);
    expect(a.feesNet).toBeCloseTo(FEE - 10, 2);
  });

  it('and a full refund still takes the whole fee back out', () => {
    hydrateFull([fullyRefunded()]);
    const a = liveAggregate('superadmin', ALL_PARTNERS, getPeriods().find((p) => p.id === 'alltime')!);
    expect(a.refundValue).toBe(FEE);
    expect(a.feesNet).toBe(0);
  });
});
