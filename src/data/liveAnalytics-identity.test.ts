/* Locks two review fixes in the live analytics:
   1. Entities that share a display name but are distinct (a branch name reused
      across agencies, or an agency name reused across partners) must NOT merge.
   2. The 12-month trend carries real per-application net commission. */
import { afterAll, describe, expect, it } from 'vitest';
import { ALL_PARTNERS } from '@/data/types';
import { getPeriods, getRatesFor } from '@/data';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { liveLeague, liveTrend } from '@/data/liveAnalytics';

const D = (s: string) => new Date(s);
function app(o: Partial<FullApp> & Pick<FullApp, 'ref' | 'rent' | 'partner' | 'agency' | 'branch'>): FullApp {
  const rates = getRatesFor(o.partner); // snapshot = the partner's rate at creation
  return {
    partnerRate: rates.partner, agentRate: rates.agent,
    referrer: 'R', owner: 0, status: 'paid',
    sentAt: D('2026-02-01'), paidAt: D('2026-02-03'), deedAt: null, tenancyStart: null, expiry: null,
    refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null, ...o,
  };
}

// Two branches both called "City" under different agencies/partners; two agencies
// both called "Prime" under different partners.
const APPS: FullApp[] = [
  app({ ref: 'X', rent: 1000, partner: 'northwind', agency: 'Alpha Lettings', branch: 'City' }),
  app({ ref: 'Y', rent: 2000, partner: 'harbourside', agency: 'Beta Homes', branch: 'City' }),
  app({ ref: 'P', rent: 1500, partner: 'northwind', agency: 'Prime', branch: 'North' }),
  app({ ref: 'Q', rent: 2500, partner: 'harbourside', agency: 'Prime', branch: 'South' }),
];

hydrateFull(APPS);
afterAll(() => hydrateFull([]));
const allTime = getPeriods().find((p) => p.id === 'alltime')!;

/* THE NAMES THEMSELVES NOW DISAMBIGUATE TOO, 2026-10-02. Matt: an
   agency or branch from a supplier's estate is labelled with its
   supplier wherever it sits beside one of ours. `harbourside` holds no
   referencingMode in the mock seed, so it is supplier-shaped and its
   agencies read "(via Harbourside Homes)".

   THE GUARANTEE THIS FILE IS ABOUT IS UNCHANGED and is now true twice
   over: the two entities are still two rows with their own figures,
   keyed on the partner, AND a reader can tell them apart without
   reading the subtitle. The assertions below are widened to say both,
   rather than loosened to accommodate the label. */
describe('distinct entities sharing a name are not merged', () => {
  it('two "City" branches under different agencies stay separate', () => {
    const rows = liveLeague('branch', 'superadmin', ALL_PARTNERS, '', allTime).filter((r) => r.name === 'City');
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.fees).sort((a, b) => a - b)).toEqual([1000, 2000]);
    // each row's sub disambiguates by its agency, and names the supplier
    // behind it where there is one
    expect(rows.map((r) => r.sub).sort()).toEqual(['Alpha Lettings', 'Beta Homes (via Harbourside Homes)']);
  });

  it('two "Prime" agencies under different partners stay separate', () => {
    const rows = liveLeague('agency', 'superadmin', ALL_PARTNERS, '', allTime)
      .filter((r) => r.name.startsWith('Prime'));
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.fees).sort((a, b) => a - b)).toEqual([1500, 2500]);
  });

  it('and the supplier estate one says whose it is', () => {
    const rows = liveLeague('agency', 'superadmin', ALL_PARTNERS, '', allTime)
      .filter((r) => r.name.startsWith('Prime'));
    expect(rows.map((r) => r.name).sort()).toEqual(['Prime', 'Prime (via Harbourside Homes)']);
  });
});

describe('trend carries real per-application net commission', () => {
  it('by-month commission is sum of rent * that partner rate', () => {
    const rows = liveTrend('month', 'superadmin', ALL_PARTNERS);
    const feb = rows.find((r) => r.label === 'Feb 2026')!;
    expect(feb.count).toBe(4); // all four sent in Feb
    // commission is real per-partner, not fees * a single scope rate
    const expected =
      1000 * getRatesFor('northwind').partner + 2000 * getRatesFor('harbourside').partner +
      1500 * getRatesFor('northwind').partner + 2500 * getRatesFor('harbourside').partner;
    expect(feb.comm).toBeCloseTo(Math.round(expected), 0);
  });
});
