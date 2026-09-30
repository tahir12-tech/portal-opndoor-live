/* WALK FIX 18, AND THE TWO OTHER FACES OF THE SAME CAUSE.
 *
 * Item 18, verbatim: "Reporting, the referrer list shows 'Direct signup' as a
 * Negotiator. A direct signup isn't a person or a referrer; it shouldn't
 * appear there."
 *
 * THE QUEUE NOTE ALREADY SAID THESE ARE ONE THING, and the note is right:
 * rule 5 is that direct-rail business is never the matched agency's.
 *
 *   B1  direct-rail rows counted into agency and branch counters
 *   B2  direct applications becoming an invented agency payee
 *   18  the same invented party in the referrer list, wearing a level
 *
 * Fixing 18 alone would leave a referrer list that is right beside two
 * numbers that are not.
 *
 * WHY THE EXISTING GUARD DID NOT CATCH IT, measured on dev rather than
 * guessed. `keyOf` already drops a row with no referrer -- `if
 * (!app.referrer) return null` -- and the comment above it says exactly why.
 * But dev's ten direct applications have `referrer_id` NULL and
 * `referrer_name` = 'Direct signup', and hydrate reads
 * `referrer_name ?? joined.full_name ?? '(unknown)'`. So the DISPLAY NAME is
 * always truthy and the guard never fires. The guard was asked about a label
 * when the question is about a person.
 *
 * AND `referrerRole` IS NOT THE ANSWER EITHER, which is the trap in the
 * obvious fix. It comes from the embedded users row, and RLS can withhold
 * that row from a reader who can still see the application: dev has 17
 * agency applications whose referrer_name is NULL but whose referrer_id is
 * real. Keying on the role would drop those -- real referrals by real people
 * -- while fixing the direct ones. The question is whether there IS a
 * referrer, which is the ID and nothing else.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hydrateFull } from './applicationsService';
import { liveAggregate, liveVolume } from './liveAnalytics';
import { ALL_PARTNERS } from './types';
import type { FullApp } from './applicationsService';
import type { Period } from './types';

const D = (y: number, m: number, d: number) => new Date(y, m, d);
const ALLTIME: Period = { id: 'alltime', label: 'All time' } as unknown as Period;

const app = (over: Partial<FullApp>): FullApp => ({
  ref: 'GR-D-1', partner: 'opndoor-agents', agency: 'Regent’s Lettings',
  branch: "Regent's Park", agencyId: 'ag-1', branchId: 'br-1',
  referrer: 'Tom Reeve', referrerId: 'u-tom', referrerRole: 'referrer',
  referrerSeesCommission: false, owner: 0,
  rent: 2000, fee: 2000, agentRate: 0.25, partnerRate: 0.25,
  status: 'deed', deedState: 'executed',
  sentAt: D(2026, 3, 1), paidAt: D(2026, 3, 15), deedAt: D(2026, 4, 1),
  tenancyStart: D(2026, 4, 2), expiry: D(2027, 4, 1),
  refunded: false, partiallyRefunded: false, withdrawn: false, expired: false,
  refundedAt: null, refundedAmount: null, refundAfterStart: false,
  deedSentAt: null, deedViewedAt: null,
  ...over,
} as unknown as FullApp);

/** A direct signup exactly as dev stores one: no referrer id, and a label. */
const direct = (over: Partial<FullApp> = {}): FullApp => app({
  ref: 'GR-DIRECT-1', partner: 'opndoor-direct',
  referrer: 'Direct signup', referrerId: null, referrerRole: null,
  ...over,
});

const referrerNames = () =>
  liveVolume('superadmin', ALL_PARTNERS, ALLTIME).referrers.map((r) => r.name);

beforeEach(() => hydrateFull([]));
afterEach(() => hydrateFull([]));

describe('item 18: a direct signup is not a referrer', () => {
  /* THE DEFECT, AS REPORTED. */
  it('does not appear in the referrer list', () => {
    hydrateFull([direct()]);
    expect(referrerNames()).toEqual([]);
  });

  it('and does not displace the real referrers beside it', () => {
    hydrateFull([app({}), direct()]);
    expect(referrerNames()).toEqual(['Tom Reeve']);
  });

  /* THE TRAP IN THE OBVIOUS FIX. Dev has 17 applications with a real
     referrer_id whose referrer_name is NULL, and whose embedded users row a
     reader may not be allowed to see. Keying on the name or on the role
     drops those -- real referrals by real people -- while fixing the direct
     ones. The id is the only honest signal. */
  it('while a real referral whose name we could not read still counts', () => {
    hydrateFull([app({ ref: 'GR-NONAME', referrer: '(unknown)', referrerId: 'u-real', referrerRole: null })]);
    expect(referrerNames()).toEqual(['(unknown)']);
  });

  /* INVERTED BY Q3, 2026-09-30, AND THE CONCERN BEHIND IT KEPT.

     This used to assert the opposite -- that a direct application still
     showed under agencies and branches, on the reasoning that "it is
     somebody's business: it shows under its own party, not nobody's".
     Matt has answered the question that was open when that was written:
     "Direct signups never appear in Volume by branch, Volume by agency or
     any agency chart (no 'Unattached' row)."

     THE REASON IT SAID SO IS STILL RIGHT, and is now asserted where it
     belongs. The worry was that dropping the direct rail from the
     referrer ranking would drop it from the BOOK. It must not, and it
     does not: the money surfaces count it, it has its own panel on Home,
     and only the AGENCY-shaped charts refuse it. So the second assertion
     below is the one that was really being protected all along, and the
     first now says what the charts do. */
  it('and a direct signup is on no agency chart, which is Q3', () => {
    hydrateFull([direct()]);
    const v = liveVolume('superadmin', ALL_PARTNERS, ALLTIME);
    expect(v.referrers).toEqual([]);
    expect(v.agencies).toEqual([]);
    expect(v.branches).toEqual([]);
  });

  it('while still being in the book, which is what those charts are not', () => {
    hydrateFull([direct()]);
    const all = liveAggregate('superadmin', ALL_PARTNERS, ALLTIME);
    // Whatever the charts do, Opndoor's own business is still counted.
    expect(all.sent + all.paid).toBeGreaterThan(0);
  });
});
