/* Locks the LIVE analytics maths (the smoke suite otherwise only exercises the
   synthetic mock path, since SUPABASE_ENABLED is false in test mode). We hydrate
   a known FullApp set and assert the aggregate, league and volume figures. The
   period window uses the fixed demo "now" (2026-06-26) in test mode. */
import { afterAll, describe, expect, it } from 'vitest';
import { ALL_PARTNERS } from '@/data/types';
import { getPeriods, getRatesFor } from '@/data';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { liveAggregate, liveLeague } from '@/data/liveAnalytics';

const D = (s: string) => new Date(s);
function app(o: Partial<FullApp> & Pick<FullApp, 'ref' | 'rent' | 'status'>): FullApp {
  const rates = getRatesFor(o.partner ?? 'northwind'); // snapshot = the partner's rate at creation
  return {
    partner: 'northwind', partnerRate: rates.partner, agentRate: rates.agent,
    agency: 'Foxglove', branch: 'South Kensington', referrer: 'Priya', owner: 0,
    sentAt: null, paidAt: null, deedAt: null, tenancyStart: null, expiry: null,
    refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null, ...o,
  };
}

// All dates inside the all-time window [2024-09-01 .. 2026-06-26].
const APPS: FullApp[] = [
  /* WALK FIX 16 gave A a tenancy start and an expiry. Guaranteed value is
     the book IN FORCE now, so a guarantee with no cover dates is not in
     force at any moment and contributes nothing -- which is right, and left
     this fixture asserting 12,000 from a row that never said when its cover
     ran. The dates are the ones its deed implies. */
  app({ ref: 'A', rent: 1000, status: 'deed', owner: 1, agency: 'Foxglove', branch: 'South Kensington', referrer: 'Priya', sentAt: D('2026-01-10'), paidAt: D('2026-01-12'), deedAt: D('2026-01-15'), deedState: 'executed', tenancyStart: D('2026-01-20'), expiry: D('2027-01-19') }),
  app({ ref: 'B', rent: 2000, status: 'paid', owner: 0, agency: 'Foxglove', branch: 'Chelsea', referrer: 'James', sentAt: D('2026-02-01'), paidAt: D('2026-02-03'), deedState: 'awaiting_tenant', deedSentAt: D('2026-02-03') }),
  app({ ref: 'C', rent: 1500, status: 'paid', owner: 0, agency: 'Marylebone', branch: 'Marylebone', referrer: 'Sophie', sentAt: D('2026-03-01'), paidAt: D('2026-03-05'), refunded: true, refundedAt: D('2026-03-10'), refundedAmount: 1500 }),
  app({ ref: 'D', rent: 1800, status: 'sent', owner: 1, agency: 'Foxglove', branch: 'South Kensington', referrer: 'Priya', sentAt: D('2026-06-01') }),
];

hydrateFull(APPS);
afterAll(() => hydrateFull([]));

const allTime = getPeriods().find((p) => p.id === 'alltime')!;
const rates = getRatesFor('northwind');

describe('liveAggregate (event-in-period, net of refunds)', () => {
  const a = liveAggregate('superadmin', ALL_PARTNERS, allTime);
  it('counts each funnel stage by its own event date', () => {
    expect(a.sent).toBe(4);
    expect(a.paid).toBe(3); // A, B, C paid in window
    expect(a.deed).toBe(1); // A
  });
  it('sums fees gross/net and refunds', () => {
    expect(a.feesGross).toBe(4500);
    expect(a.refundCount).toBe(1);
    expect(a.refundValue).toBe(1500);
    expect(a.feesNet).toBe(3000);
  });
  /* WALK FIX 16: in force DURING the period, not issued inside it. A's
     cover runs from 20 Jan 2026 to 19 Jan 2027 and the all-time window ends
     at the demo clock, so it is on cover and counts; B is out for
     signature, C was refunded, D has no deed. */
  it('guaranteed value = annualised rent over the deeds in force in the period', () => {
    expect(a.guaranteed).toBe(12000); // 1000 * 12
  });
  it('commission is net of refunds, per-partner rates', () => {
    expect(a.agentCommNet).toBeCloseTo(3000 * rates.agent, 6);
  });
  /* THE AGENT RAIL HAS NO PARTNER. Northwind is the estate — one of OUR
     agencies' partner, not a supplier above them — so there is nobody to pass a
     cut to. applications.partner_rate is populated on these rows all the same
     (resolve_rates fills it whichever rail a referral arrives on), and
     multiplying by it used to invent a payable nobody owes. Zeroed at the row,
     so the dashboard, the league and every export agree. */
  it('an estate partner earns no partner commission, at any rate it holds', () => {
    expect(rates.partner).toBeGreaterThan(0); // the rate is there to be ignored
    expect(a.partnerCommNet).toBe(0);
    expect(a.partnerCommExcl).toBe(0);
  });
  it('and says so, so the screen can drop the line rather than print a zero', () => {
    expect(a.noPartnerCut).toBe(true);
  });
  it('operational metrics (current state)', () => {
    expect(a.stuckSent).toBe(1); // D
    expect(a.stuckPaid).toBe(1); // B (C is refunded, excluded)
    expect(a.awaiting).toBe(1); // B
    expect(a.awaitingAged).toBe(1); // B sent > 7 days before now
    expect(a.avgRent).toBeCloseTo(6300 / 4, 6);
  });
});

describe('liveLeague', () => {
  it('groups agencies by fees, with net commission columns', () => {
    const rows = liveLeague('agency', 'superadmin', ALL_PARTNERS, '', allTime);
    expect(rows.map((r) => r.name)).toEqual(['Foxglove', 'Marylebone']);
    const fox = rows[0];
    expect(fox.refs).toBe(3); // A, B, D sent in window
    expect(fox.paid).toBe(2); // A, B
    expect(fox.deed).toBe(1); // A
    expect(fox.fees).toBe(3000); // A(1000) + B(2000)
    expect(fox.agentComm).toBeCloseTo(3000 * rates.agent, 6); // Foxglove has no refunds
    expect(fox.partnerComm).toBe(0); // the estate: no supplier above these agencies
    const mar = rows[1];
    expect(mar.fees).toBe(1500);
    expect(mar.agentComm).toBeCloseTo(0, 6); // 1500 paid - 1500 refunded = 0 net
  });

  it('a referrer sees only their own applications', () => {
    const rows = liveLeague('referrer', 'referrer', ALL_PARTNERS, '', allTime);
    // Owner===1 apps are A and D, both referrer "Priya" -> one row, refs=2
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('Priya');
    expect(rows[0].refs).toBe(2);
    expect(rows[0].paid).toBe(1); // only A paid
  });
});
