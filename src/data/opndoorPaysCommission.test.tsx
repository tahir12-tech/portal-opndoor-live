/* WALK FIX 17. OPNDOOR DOES NOT EARN COMMISSION, IT PAYS IT.
 *
 * Verbatim: "Reporting, Monthly volume trend for Opndoor admin defaults to
 * 'Commission earned' and shows £0 every month, while Commission payable
 * shows £3,232. Opndoor doesn't earn commission, it pays it. For admin, the
 * trend's options should be Opndoor's view: fees collected, commission
 * payable, referrals sent, deeds issued, defaulting to fees collected.
 * 'Commission earned' stays for agency and supplier users, where it's their
 * money. Whichever option is chosen, the trend must match the tiles on the
 * same page."
 *
 * WHY IT WAS £0 EVERY MONTH, and the reason it is a real bug rather than a
 * blank series: the trend's "commission" is `partnerComm`, the supplier's
 * cut. `liveMonths` zeroes that on a HOUSE partner because a house route's
 * partner cut is Opndoor's own margin and is owed to nobody -- which is
 * correct, and is asserted in our_margin_is_not_theirs.test.sql. So for an
 * admin looking at the house rail the series is structurally zero. The
 * money model was right; the CHART offered a reader a series that cannot
 * apply to them.
 *
 * "THE TREND MUST MATCH THE TILES ON THE SAME PAGE" is the testable half,
 * and it needs saying what it can mean. The trend is a trailing twelve
 * months by construction and the tiles follow the period picker, so they are
 * not the same window and no assertion can make them one. What must hold is
 * that each option measures the SAME QUANTITY as its tile: over one window,
 * the series sums to the aggregate. That is what these assert, with fixture
 * dates well inside both windows so the two agree on their bounds.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { Dashboard } from '@/pages/Dashboard/Dashboard';
import { hydrateFull } from './applicationsService';
import { liveAggregate, liveTrend, trendMeasuresFor } from './liveAnalytics';
import { ALL_PARTNERS } from './types';
import type { FullApp } from './applicationsService';
import type { Period } from './types';

/* Test mode's clock is fixed at 2026-06-26, so these sit inside both the
   trailing twelve months and the `last12m` period. */
const D = (y: number, m: number, d: number) => new Date(y, m, d);
const LAST12: Period = { id: 'last12m', label: 'Last 12 months' } as unknown as Period;

const app = (over: Partial<FullApp>): FullApp => ({
  ref: 'GR-P-1', partner: 'opndoor-agents', agency: 'Regent’s Lettings',
  branch: "Regent's Park", agencyId: 'ag-1', branchId: 'br-1',
  referrer: 'Tom Reeve', referrerId: 'u-tom', referrerRole: 'referrer',
  referrerSeesCommission: false, owner: 0,
  rent: 2000, fee: 2000, agentRate: 0.25, partnerRate: 0.25,
  status: 'deed', deedState: 'executed',
  sentAt: D(2026, 1, 10), paidAt: D(2026, 1, 20), deedAt: D(2026, 2, 1),
  tenancyStart: D(2026, 2, 2), expiry: D(2027, 2, 1),
  refunded: false, partiallyRefunded: false, withdrawn: false, expired: false,
  refundedAt: null, refundedAmount: null, refundAfterStart: false,
  deedSentAt: null, deedViewedAt: null,
  ...over,
} as unknown as FullApp);

/** A real supplier's referral, so "payable" has both halves in it. */
const supplier = (over: Partial<FullApp> = {}) => app({
  ref: 'GR-P-SUP', partner: 'harbourside', agency: 'Harbour Homes',
  branch: 'Quayside', ...over,
});

const BOOK = [app({}), supplier()];

beforeEach(() => hydrateFull([]));
afterEach(() => hydrateFull([]));

describe('the options an Opndoor admin is offered', () => {
  /* MATT'S FOUR, IN HIS ORDER, and "commission earned" is not among them. */
  it('are fees collected, commission payable, referrals sent and deeds issued', () => {
    expect(trendMeasuresFor('superadmin', true).map((o) => o.value))
      .toEqual(['value', 'payable', 'count', 'deeds']);
  });

  it('and the first one is the default, so the card opens on fees collected', () => {
    expect(trendMeasuresFor('superadmin', true)[0].value).toBe('value');
  });

  it('and never Commission earned, which is not Opndoor’s money', () => {
    expect(trendMeasuresFor('superadmin', true).map((o) => o.label))
      .not.toContain('Commission earned');
  });

  /* An opndoor_manager reads the same book and pays the same commission. */
  it('and an opndoor manager gets the same four', () => {
    expect(trendMeasuresFor('opndoor_manager', true).map((o) => o.value))
      .toEqual(['value', 'payable', 'count', 'deeds']);
  });
});

describe('the options a customer is offered', () => {
  /* UNCHANGED, and that is the point of the assertion: "'Commission earned'
     stays for agency and supplier users, where it's their money." */
  it('still start with Commission earned where they may see commission', () => {
    expect(trendMeasuresFor('management', true).map((o) => o.value))
      .toEqual(['commission', 'value', 'count']);
  });

  it('and drop it where they may not, as they always did', () => {
    expect(trendMeasuresFor('management', false).map((o) => o.value))
      .toEqual(['value', 'count']);
  });

  /* AND NEVER COMMISSION PAYABLE, which is Opndoor's view of what it owes
     out and would be an agency reading its own income as an expense. */
  it('and are never offered commission payable', () => {
    for (const sees of [true, false]) {
      expect(trendMeasuresFor('management', sees).map((o) => o.value)).not.toContain('payable');
      expect(trendMeasuresFor('referrer', sees).map((o) => o.value)).not.toContain('payable');
    }
  });
});

describe('whichever option is chosen, it measures what the tile measures', () => {
  const sum = (rows: { count: number; fees: number; comm: number; payable: number; deeds: number }[],
    pick: (r: typeof rows[number]) => number) => rows.reduce((n, r) => n + pick(r), 0);

  it('fees collected sums to the aggregate’s gross fees', () => {
    hydrateFull(BOOK);
    const trend = liveTrend('month', 'superadmin', ALL_PARTNERS);
    const agg = liveAggregate('superadmin', ALL_PARTNERS, LAST12);
    expect(sum(trend, (r) => r.fees)).toBeCloseTo(agg.feesGross, 6);
  });

  it('referrals sent sums to the aggregate’s sent count', () => {
    hydrateFull(BOOK);
    expect(sum(liveTrend('month', 'superadmin', ALL_PARTNERS), (r) => r.count))
      .toBe(liveAggregate('superadmin', ALL_PARTNERS, LAST12).sent);
  });

  it('deeds issued sums to the aggregate’s deed count', () => {
    hydrateFull(BOOK);
    expect(sum(liveTrend('month', 'superadmin', ALL_PARTNERS), (r) => r.deeds))
      .toBe(liveAggregate('superadmin', ALL_PARTNERS, LAST12).deed);
  });

  /* THE ONE THE ITEM IS ABOUT. The tile's headline for an admin is
     `agentCommNet + supplierCommNet`: what Opndoor owes out, to its agencies
     and to its suppliers. A house route's partner cut is Opndoor's own
     margin and is in neither. */
  it('commission payable sums to what the tile says is payable', () => {
    hydrateFull(BOOK);
    const agg = liveAggregate('superadmin', ALL_PARTNERS, LAST12);
    expect(sum(liveTrend('month', 'superadmin', ALL_PARTNERS), (r) => r.payable))
      .toBeCloseTo(agg.agentCommNet + agg.supplierCommNet, 6);
  });

  /* AND ON THE HOUSE RAIL IT IS THE WHOLE DIFFERENCE. This is Matt's
     screen reproduced: a book of agency-rail referrals, where the old
     series ("commission earned", the supplier cut) is structurally zero
     because a house route's cut is Opndoor's own margin, and the new one is
     the money actually leaving the business. Without this, an assertion
     comparing two numbers could pass on 0 === 0. */
  it('and on the house rail the old series is zero where this one is not', () => {
    hydrateFull([app({})]);
    const trend = liveTrend('month', 'superadmin', ALL_PARTNERS);
    expect(sum(trend, (r) => r.comm)).toBe(0);
    expect(sum(trend, (r) => r.payable)).toBeGreaterThan(0);
  });

  /* And a real supplier's cut IS earned commission, so that series is not
     zero everywhere -- which is why the old option was not simply dead. */
  it('while a real supplier’s referral does earn commission', () => {
    hydrateFull([supplier()]);
    expect(sum(liveTrend('month', 'superadmin', ALL_PARTNERS), (r) => r.comm)).toBeGreaterThan(0);
  });

  /* AND IT INCLUDES BOTH HALVES. An agency's cut and a supplier's are both
     money leaving the business, and a fix that summed only one would pass
     every assertion above that does not name the other. */
  it('and counts both the agency cut and the supplier cut', () => {
    hydrateFull([app({})]);
    const agencyOnly = sum(liveTrend('month', 'superadmin', ALL_PARTNERS), (r) => r.payable);
    hydrateFull(BOOK);
    const both = sum(liveTrend('month', 'superadmin', ALL_PARTNERS), (r) => r.payable);
    expect(both).toBeGreaterThan(agencyOnly);
  });

  /* A REFUNDED FEE PAYS NO COMMISSION, the same rule the tile follows. */
  it('and a refunded referral adds nothing payable', () => {
    hydrateFull([app({ refunded: true, refundedAt: D(2026, 1, 25), refundedAmount: 2000 })]);
    expect(sum(liveTrend('month', 'superadmin', ALL_PARTNERS), (r) => r.payable)).toBe(0);
  });
});

/* AND THE CARD ACTUALLY OFFERS THEM. Everything above tests the rule and
   the data. This is the wiring: without it the option list could be perfect
   and the dropdown could still say "Commission earned". */
describe('the trend card on the page', () => {
  const openReporting = async (role: string) => {
    localStorage.setItem('grp_role', role);
    const view = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <ToastProvider><SessionProvider><PageMetaProvider><Dashboard /></PageMetaProvider></SessionProvider></ToastProvider>
      </MemoryRouter>,
    );
    await waitFor(() => { if (!view.container.querySelector('select[aria-label="Measure for the trend"]')) throw new Error('no trend card'); });
    await act(async () => {});
    return view;
  };
  const measures = (v: { container: HTMLElement }) =>
    [...v.container.querySelectorAll<HTMLSelectElement>('select[aria-label="Measure for the trend"]')[0].options]
      .map((o) => o.text);

  afterEach(() => { cleanup(); localStorage.clear(); });

  it('offers an admin Opndoor’s four, opening on fees collected', async () => {
    const v = await openReporting('superadmin');
    expect(measures(v)).toEqual(['Fees collected', 'Commission payable', 'Referrals sent', 'Deeds issued']);
    expect(v.container.querySelector<HTMLSelectElement>('select[aria-label="Measure for the trend"]')!.value)
      .toBe('value');
  });

  it('and leaves a customer’s options as they were', async () => {
    const v = await openReporting('management');
    expect(measures(v)).toContain('Commission earned');
    expect(measures(v)).not.toContain('Commission payable');
  });
});
