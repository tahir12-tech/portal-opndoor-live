/* Locks the new commission-reporting maths: the per-partner breakdown must
   reconcile to the blended summary totals, and the agent settlement must
   aggregate at agency level, prior calendar month, net of refunds. Test mode's
   fixed "now" is 2026-06-26, so the prior settlement month is May 2026. */
import { afterAll, describe, expect, it } from 'vitest';
import { ALL_PARTNERS } from '@/data/types';
import { getPeriods, getRatesFor } from '@/data';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { liveAggregate, livePartnerBreakdown, getAgentCommissionSettlement } from '@/data/liveAnalytics';

const D = (s: string) => new Date(s);
function app(o: Partial<FullApp> & Pick<FullApp, 'ref' | 'rent' | 'status' | 'partner'>): FullApp {
  const rates = getRatesFor(o.partner); // snapshot = the partner's rate at creation
  return {
    partnerRate: rates.partner, agentRate: rates.agent,
    agency: 'Foxglove', branch: 'South Kensington', referrer: 'Priya', owner: 0,
    sentAt: null, paidAt: null, deedAt: null, tenancyStart: null, expiry: null,
    refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null, ...o,
  };
}

// Two partners; a refund; some paid in the prior month (May 2026) for settlement.
const APPS: FullApp[] = [
  app({ ref: 'R1', partner: 'northwind', agency: 'Foxglove', rent: 1000, status: 'paid', paidAt: D('2026-05-04') }),
  app({ ref: 'R2', partner: 'northwind', agency: 'Marylebone & Co', rent: 2000, status: 'paid', paidAt: D('2026-05-20') }),
  app({ ref: 'R3', partner: 'northwind', agency: 'Foxglove', rent: 1500, status: 'paid', paidAt: D('2026-05-10'), refunded: true, refundedAt: D('2026-05-12'), refundedAmount: 1500 }),
  app({ ref: 'Z1', partner: 'harbourside', agency: 'Northbank Lettings', rent: 3000, status: 'paid', paidAt: D('2026-04-15') }),
];

hydrateFull(APPS);
afterAll(() => hydrateFull([]));

const allTime = getPeriods().find((p) => p.id === 'alltime')!;

describe('livePartnerBreakdown reconciles to the blended summary', () => {
  const rows = livePartnerBreakdown('superadmin', ALL_PARTNERS, allTime);
  const agg = liveAggregate('superadmin', ALL_PARTNERS, allTime);

  it('net partner + agent commission sum to liveAggregate totals', () => {
    const sumPartnerNet = rows.reduce((s, r) => s + r.partnerCommNet, 0);
    const sumAgentNet = rows.reduce((s, r) => s + r.agentCommNet, 0);
    expect(sumPartnerNet).toBeCloseTo(agg.partnerCommNet, 6);
    expect(sumAgentNet).toBeCloseTo(agg.agentCommNet, 6);
  });

  /* BY ROUTE SINCE 2026-10-02, not by partner. Matt: "Harbour Lets is an
     agency, so it belongs in 'Agency referral', not listed as its own
     route. Only real suppliers appear as routes." `northwind` is this
     fixture's estate -- opndoor_referenced, not a house slug -- so it is
     the same shape as Harbour Lets and folds into the agency rail.
     Harbourside, which holds no referencingMode, is supplier-shaped and
     keeps a route of its own.

     THE FIGURES ARE UNCHANGED, which is the point: the rows are grouped
     differently and every total is the same, and the assertion above
     this one (every row sums to liveAggregate) is what proves it. */
  it('gross includes the refunded fee; net excludes it (per route)', () => {
    const rm = rows.find((r) => r.partner === 'opndoor-agents')!;
    const rr = getRatesFor('northwind');
    // R1 + R2 + R3(refunded) gross = 4500; net excludes R3 = 3000.
    expect(rm.partnerName).toBe('Agency referral');
    expect(rm.feesGross).toBe(4500);
    expect(rm.agentCommNet).toBeCloseTo(3000 * rr.agent, 6);
  });

  it('and an agency-shaped partner is not a route of its own', () => {
    expect(rows.find((r) => r.partner === 'northwind')).toBeUndefined();
    expect(rows.filter((r) => r.partnerName === 'Agency referral')).toHaveLength(1);
  });

  /* THE TWO RAILS, SIDE BY SIDE, in one fixture, which is the only way to tell
     "partner commission is suppressed" from "partner commission is broken".
     Northwind is the estate: our agencies, no supplier above them, so nothing is
     payable to a partner however large partner_rate is on the row. Harbourside
     hands us finished referrals and is paid exactly as it always was. */
  it('the estate earns no partner commission and the supplier still does', () => {
    const estate = rows.find((r) => r.partner === 'opndoor-agents')!;
    const supplier = rows.find((r) => r.partner === 'harbourside')!;
    expect(getRatesFor('northwind').partner).toBeGreaterThan(0);
    expect(estate.partnerCommGross).toBe(0);
    expect(estate.partnerCommNet).toBe(0);
    expect(supplier.partnerCommNet).toBeCloseTo(3000 * getRatesFor('harbourside').partner, 6);
  });
});

describe('getAgentCommissionSettlement (prior month, agency level, net)', () => {
  const st = getAgentCommissionSettlement('superadmin', ALL_PARTNERS);

  it('settles May 2026 and aggregates by agency, excluding refunds and other months', () => {
    expect(st.monthLabel).toBe('May 2026');
    // Only Northwind Property R1 (Foxglove) and R2 (Marylebone & Co) qualify: R3 refunded,
    // Z1 paid in April. So two agencies, no Foxglove double-count of R3.
    const agencies = st.agencies.map((a) => a.agency).sort();
    expect(agencies).toEqual(['Foxglove', 'Marylebone & Co']);
    const rr = getRatesFor('northwind');
    const fox = st.agencies.find((a) => a.agency === 'Foxglove')!;
    expect(fox.commission).toBeCloseTo(1000 * rr.agent, 6); // R1 only (R3 refunded)
    expect(fox.apps).toHaveLength(1);
  });
});
