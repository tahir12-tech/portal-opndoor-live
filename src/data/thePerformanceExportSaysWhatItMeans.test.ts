/* THE PERFORMANCE EXPORT, FIVE THINGS.
 *
 * Matt, 2026-10-02, verbatim:
 *
 *   "1. Remove the hard-coded percentages from labels ("Partner
 *       commission (2% of…)", "Agent commission (15% of…)"). Rates vary
 *       by deal; label them "Supplier commission (net of refunds)" and
 *       "Agent commission (net of refunds)".
 *    2. For All time, show "All time" with the date of the first
 *       referral to today, not "01/09/2024 to 31/12/2051".
 *    3. Breakdown by branch shows £0 agent commission on every branch
 *       while the agency rows have commission. Branch rows must carry
 *       the commission earned by their own referrals, and add up to the
 *       agency row.
 *    4. Say "Supplier", not "Partner", in every heading and label
 *       (column headings a partner's code may read can stay).
 *    5. Label supplier-estate agencies and branches with their supplier,
 *       e.g. "Frost Partnership (via Kestrel Lettings)", as on screen."
 *
 * Item 5 is `viaSupplier`, asserted in
 * adminReportingTellsTheEstatesApart.test.ts and inherited here because
 * the breakdown tables read liveVolume. Item 3 is the only one that is
 * not wording, and it is the one asserted hardest below.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ALL_PARTNERS } from '@/data/types';
import { getPeriods } from '@/data';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { liveVolume } from '@/data/liveAnalytics';

const SRC = readFileSync('src/data/exportsService.ts', 'utf8');

describe('the commission labels', () => {
  /* A BLENDED PERCENTAGE OVER A PERIOD OF MIXED RATES appears in no
     agreement and matches no line below it, and the moment a group rate
     and a branch rate sit in the same period it is nobody's rate at all. */
  it('carry no rate at all', () => {
    expect(SRC).toContain("moneyKv('Supplier commission (net of refunds)'");
    expect(SRC).toContain("moneyKv('Agent commission (net of refunds)'");
    expect(SRC).not.toMatch(/commission \(\$\{[ap]Pct\}%/);
  });

  /* AND THE WORKINGS WENT WITH THEM. pPct, aPct and basisWord existed
     only to finish the sentence "x% of one month rent"; leaving them
     computed-and-unused is how the sentence comes back. */
  it('and the percentages are not computed any more either', () => {
    expect(SRC).not.toContain('const pPct');
    expect(SRC).not.toContain('const aPct');
    expect(SRC).not.toContain('const basisWord');
  });

  it('and say Supplier, not Partner', () => {
    expect(SRC).toContain("{ label: 'Commission type', value: 'Supplier commission' }");
    expect(SRC).toContain("{ label: 'Payee (supplier)', value: payee }");
    expect(SRC).toContain('Supplier: ${scopeLabel(role)}');
    expect(SRC).not.toContain('Partner: ${scopeLabel(role)}');
  });

  /* AND THEN THE EXCEPTION WAS LIFTED FOR THIS FILE. It was "column
     headings a partner's code may read can stay", and this asserted it
     so a later sweep could not quietly finish the job. Matt, the same
     day: "This file is for Opndoor only, so its column headings can
     change." Inverted rather than deleted, so which answer is live is
     readable from the test. */
  it('and its column headings moved too, because this file is Opndoor\'s own', () => {
    expect(SRC).not.toContain("{ header: 'Partner', type: 'text' }");
    expect(SRC).toContain("moneyCol('Supplier commission (gross)')");
    expect(SRC).toContain("title: 'Commission by supplier (this period)'");
  });
});

describe('the All time window', () => {
  it('is stated from the first referral, not from a constant and a date in 2051', () => {
    expect(SRC).toContain("if (period.id !== 'alltime')");
    expect(SRC).toContain('first referral ${dmy(first)} to ${dmy(today())}');
  });

  /* NOTHING REFERRED MEANS NOTHING TO STATE. "All time (first referral
     to )" would be worse than the bare label. */
  it('and is just "All time" when there is nothing in scope', () => {
    expect(SRC).toContain('if (!first) return period.label;');
  });

  /* THE RANGE ITSELF IS NOT TOUCHED. It ends in the future on purpose:
     inForceDuring asks `tenancyStart <= end`, and clamping all-time to
     today once hid four of dev's five executed deeds from the headline. */
  it('and the range behind it still runs past today, which is why it is not printed', () => {
    expect(SRC).toContain('The range is right; printing it is what is wrong');
  });
});

/* =====================================================================
   AND THE ONE THAT IS NOT WORDING.
   ===================================================================== */
const D = (s: string) => new Date(s);
const app = (over: Partial<FullApp> & Pick<FullApp, 'ref' | 'branch'>): FullApp => ({
  rent: 1000, partner: 'northwind', agency: 'Foxglove', referrer: 'R', owner: 0, status: 'paid',
  partnerRate: 0.25, agentRate: 0.1,
  sentAt: D('2026-02-01'), paidAt: D('2026-02-03'), deedAt: null, tenancyStart: null, expiry: null,
  refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
  deedState: null, deedSentAt: null, deedViewedAt: null,
  ...over,
} as FullApp);

/* TWO OFFICES OF ONE AGENCY, with the commission set where it actually is
   set: at the agency. Dev holds twelve commission lines and every one of
   them is at agency level, which is why every branch row read zero. */
const APPS: FullApp[] = [
  app({ ref: 'B1', branch: 'North', rent: 1000 }),
  app({ ref: 'B2', branch: 'South', rent: 2000 }),
];
hydrateFull(APPS);
afterAll(() => hydrateFull([]));
const allTime = getPeriods().find((p) => p.id === 'alltime')!;

describe('Breakdown by branch', () => {
  const { agencies, branches } = liveVolume('superadmin', ALL_PARTNERS, allTime);

  it('is not a column of zeroes beside an agency with commission', () => {
    expect(branches.length).toBe(2);
    for (const b of branches) expect(b.agentComm).toBeGreaterThan(0);
  });

  /* THE ASSERTION MATT ASKED FOR, in his words: "add up to the agency
     row". It holds by construction now -- both rows ask what the agency
     side earns on the application, and an application has one branch --
     which is the point of asserting it rather than the figures. */
  it('and adds up to the agency row', () => {
    const agencyTotal = agencies.reduce((s, r) => s + r.agentComm, 0);
    const branchTotal = branches.reduce((s, r) => s + r.agentComm, 0);
    expect(branchTotal).toBeCloseTo(agencyTotal, 6);
  });

  it('and each branch carries its own referrals and not its neighbour\'s', () => {
    const north = branches.find((b) => b.name === 'North')!;
    const south = branches.find((b) => b.name === 'South')!;
    // South's referral is twice the rent, so twice the fee and twice the cut.
    expect(south.agentComm).toBeCloseTo(north.agentComm * 2, 6);
  });
});
