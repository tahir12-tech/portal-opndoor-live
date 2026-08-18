/* Locks #44: opndoor internal staff (role = superadmin) never appear in referrer
   performance rankings (League Referrers, dashboard volume-by-referrer, and the
   by-referrer trend), while their applications remain fully real in every other
   grouping (here, the agency total).

   Also locks the second exclusion, added with the direct rail: an application
   NOBODY referred. applications.referrer_id became nullable (20260812090000)
   because a direct signup has no referrer, and without the exclusion those rows
   would rank as a referrer called "(unknown)" whose volume grows every time the
   direct rail is used. Same rule, same place, same reason: excluded from
   referrer performance, real everywhere else. */
import { afterAll, describe, expect, it } from 'vitest';
import { ALL_PARTNERS } from '@/data/types';
import { getPeriods } from '@/data';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { liveLeague, liveVolume, liveTrend } from '@/data/liveAnalytics';

const D = (s: string) => new Date(s);
function app(o: Partial<FullApp> & Pick<FullApp, 'ref' | 'rent' | 'partner' | 'agency' | 'branch' | 'referrer'>): FullApp {
  return {
    partnerRate: 0.25, agentRate: 0.1, owner: 0, status: 'paid', referrerRole: null,
    sentAt: D('2026-02-01'), paidAt: D('2026-02-03'), deedAt: null, tenancyStart: null, expiry: null,
    refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null, ...o,
  };
}

const APPS: FullApp[] = [
  app({ ref: 'A', rent: 1000, partner: 'northwind', agency: 'Foxglove', branch: 'SK', referrer: 'Priya', referrerRole: 'referrer' }),
  app({ ref: 'B', rent: 2000, partner: 'northwind', agency: 'Foxglove', branch: 'SK', referrer: 'Maya', referrerRole: 'superadmin' }),
  // A direct signup: no referrer at all, and no role either.
  app({ ref: 'C', rent: 1500, partner: 'northwind', agency: 'Foxglove', branch: 'SK', referrer: '', referrerRole: null }),
];
hydrateFull(APPS);
afterAll(() => hydrateFull([]));
const allTime = getPeriods().find((p) => p.id === 'alltime')!;

describe('opndoor admins excluded from referrer rankings, real everywhere else', () => {
  it('referrer league omits the admin-referred app; the agency total still counts it', () => {
    const refs = liveLeague('referrer', 'superadmin', ALL_PARTNERS, '', allTime);
    expect(refs.map((r) => r.name)).toEqual(['Priya']); // Maya (superadmin) and the unreferred app excluded
    const fox = liveLeague('agency', 'superadmin', ALL_PARTNERS, '', allTime).find((r) => r.name === 'Foxglove')!;
    expect(fox.refs).toBe(3);   // all three applications counted at agency level
    expect(fox.fees).toBe(4500); // 1000 + 2000 + 1500, admin and direct apps included
  });

  it('volume-by-referrer and the by-referrer trend also omit the admin', () => {
    expect(liveVolume('superadmin', ALL_PARTNERS, allTime).referrers.map((r) => r.name)).toEqual(['Priya']);
    expect(liveTrend('referrer', 'superadmin', ALL_PARTNERS).map((r) => r.label)).toEqual(['Priya']);
  });
});
