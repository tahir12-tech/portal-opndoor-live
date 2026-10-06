/* NET FEES COUNTS WHAT IT SUMS.
 *
 * Matt, 2026-10-04: 'Reporting "Net fees": count paid referrals excluding
 * refunded ones, e.g. "across 15 paid referrals (1 refunded)".'
 *
 * THE FAULT WAS THE TWO HALVES OF ONE SENTENCE COUNTING DIFFERENT SETS.
 * "Net fees" is gross less refunds; the denominator under it was every paid
 * referral including the refunded ones. Neither number was wrong on its own,
 * which is why it survived: the sentence only misleads a reader who does the
 * division, and that is the only reason the denominator is there.
 *
 * A PART REFUND IS NOT A REFUND, on both sides. R2: a partial refund moves
 * money and leaves the guarantee standing, so it is not excluded from the
 * money and must not be excluded from the count either. That is the
 * assertion most likely to be broken by somebody "simplifying" this later.
 */
import { describe, it, expect } from 'vitest';
import { liveAggregate } from './liveAnalytics';
import { hydrateFull, type FullApp } from './applicationsService';
import { ALL_PARTNERS } from './types';
import { getPeriods } from '@/data';

// All time, so the fixture dates never have to agree with today's clock.
const agg = () => liveAggregate('superadmin', ALL_PARTNERS, getPeriods().find((p) => p.id === 'alltime')!);

const paid = (over: Partial<FullApp>): FullApp => ({
  ref: 'GR-X', partner: 'opndoor-agents', agency: 'An Agency', branch: 'An Office',
  rent: 1200, fee: 600, agentRate: 0.25, partnerRate: 0.25,
  status: 'deed', tenancyStart: new Date('2026-06-01'), deedAt: new Date('2026-06-01'),
  expiry: null, sentAt: new Date('2026-06-01'), paidAt: new Date('2026-06-05'),
  refunded: false, partiallyRefunded: false, refundedAt: null, refundedAmount: null,
  deedState: 'executed', referrer: 'A Referrer',
  ...over,
} as unknown as FullApp);

describe('the count under Net fees', () => {
  it('leaves out the fully refunded ones, as the money does', () => {
    hydrateFull([
      paid({ ref: 'GR-1' }),
      paid({ ref: 'GR-2' }),
      paid({ ref: 'GR-3', refunded: true, refundedAt: new Date('2026-06-20'), refundedAmount: 600, deedState: 'cancelled' }),
    ]);
    const a = agg();
    // Three referrals were paid in the period, and that is still true.
    expect(a.paid).toBe(3);
    // One of them got the money back, so two fees are in the net figure.
    expect(a.refundCount).toBe(1);
    expect(a.paid - a.refundCount).toBe(2);
    hydrateFull([]);
  });

  it('and keeps a PART refunded one, because its fee is still in the money', () => {
    hydrateFull([
      paid({ ref: 'GR-1' }),
      paid({ ref: 'GR-2', partiallyRefunded: true, refundedAt: new Date('2026-06-20'), refundedAmount: 10 }),
    ]);
    const a = agg();
    expect(a.refundCount).toBe(0);
    expect(a.paid - a.refundCount).toBe(2);
    hydrateFull([]);
  });

  /* THE SINGULAR, which is what theCountsReadAsEnglish exists for. One paid
     referral and one refunded is the smallest book that can produce both
     halves of the sentence, and "1 paid referrals" is the idiom this file's
     neighbour was written to stamp out. */
  it('counts down to one without breaking the English', () => {
    hydrateFull([
      paid({ ref: 'GR-1' }),
      paid({ ref: 'GR-2', refunded: true, refundedAt: new Date('2026-06-20'), refundedAmount: 600, deedState: 'cancelled' }),
    ]);
    const a = agg();
    expect(a.paid - a.refundCount).toBe(1);
    hydrateFull([]);
  });
});
