/* AN OPNDOOR MANAGER READS THE BOOK, AND SEES NO COMMISSION.
 *
 * Matt, 2026-09-30: "Also fix the blank Reporting page for opndoor_manager."
 *
 * Found while building walk fix 20, and recorded there rather than fixed
 * because it was not in the queue. It is now.
 *
 * WHAT IT IS. `paymentMetrics.scopeFull` narrows the application set every
 * live figure is built from, and it ends with a POSITIVE allowlist:
 *
 *     if (role === 'referrer') set = set.filter(...)
 *     else if (role !== 'superadmin' && role !== 'management') set = []
 *
 * The comment above it says why it is positive: "an unrecognised role
 * reaching it with no filter handed over the whole partner book. A role not
 * named here gets nothing." That is the right default and it is not the
 * bug. The bug is that `opndoor_manager` was added by `20260922090000`,
 * months after this line, and nobody came back to it -- so Opndoor's own
 * operations staff are treated as an unrecognised role and every figure on
 * their Reporting page reads zero.
 *
 * WHICH DIRECTION IT FAILS IN MATTERS, and it is the safe one: they are
 * shown too LITTLE, never too much. That is why this is a usability defect
 * and not a leak, and why it was safe to leave recorded overnight.
 *
 * WHAT THE PRODUCT INTENDS, quoted from src/App.tsx's own route comment:
 * "opndoor_manager is Opndoor ops staff: it reads the whole book like an
 * admin (its RLS read arms mirror superadmin) but cannot create referrals
 * or reach the sensitive-settings routes below."
 *
 * SO THE FIX IS NOT "TREAT THEM AS AN ADMIN". Reading the book and seeing
 * the money are two different permissions, and `maySeeCommission` already
 * answers the second with a flat no for this role. Both halves are asserted
 * here, because a fix that widened the allowlist by adding them to a
 * maySeeCommission list instead would pass the first half and hand them
 * every commission figure on the estate.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hydrateFull } from './applicationsService';
import { liveAggregate, liveByCustomer, liveTrend, liveVolume, trendMeasuresFor } from './liveAnalytics';
import { scopeFull } from './paymentMetrics';
import { ALL_PARTNERS, maySeeCommission } from './types';
import type { FullApp } from './applicationsService';
import type { Period } from './types';

const D = (y: number, m: number, d: number) => new Date(y, m, d);
const LAST12: Period = { id: 'last12m', label: 'Last 12 months' } as unknown as Period;

const app = (over: Partial<FullApp>): FullApp => ({
  ref: 'GR-OM-1', partner: 'opndoor-agents', agency: 'Regent’s Lettings',
  branch: "Regent's Park", agencyId: 'ag-1', branchId: 'br-1',
  referrer: 'Tom Reeve', referrerId: 'u-tom', referrerRole: 'referrer',
  referrerSeesCommission: false,
  /* owner: 0 deliberately. An opndoor_manager owns nothing: if the fix were
     made by treating them as a referrer -- filtering to `owner === 1` --
     they would still see nothing, and this fixture is what catches that. */
  owner: 0,
  rent: 2000, fee: 2000, agentRate: 0.25, partnerRate: 0.25,
  status: 'deed', deedState: 'executed',
  sentAt: D(2026, 3, 10), paidAt: D(2026, 3, 20), deedAt: D(2026, 4, 1),
  tenancyStart: D(2026, 4, 2), expiry: D(2027, 4, 1),
  refunded: false, partiallyRefunded: false, withdrawn: false, expired: false,
  refundedAt: null, refundedAmount: null, refundAfterStart: false,
  deedSentAt: null, deedViewedAt: null,
  ...over,
} as unknown as FullApp);

const BOOK = [
  app({ ref: 'GR-AG' }),
  app({ ref: 'GR-SUP', partner: 'harbourside', agency: 'Harbourside Homes' }),
];

beforeEach(() => hydrateFull(BOOK));
afterEach(() => hydrateFull([]));

describe('the scoped set, which every live figure is built from', () => {
  /* THE DEFECT, AT ITS SOURCE. */
  it('is not empty for an opndoor manager', () => {
    expect(scopeFull(BOOK, 'opndoor_manager', ALL_PARTNERS).length).toBe(2);
  });

  it('and is the whole estate, as the route comment says it should be', () => {
    const asManager = scopeFull(BOOK, 'opndoor_manager', ALL_PARTNERS).map((a) => a.ref).sort();
    const asAdmin = scopeFull(BOOK, 'superadmin', ALL_PARTNERS).map((a) => a.ref).sort();
    expect(asManager).toEqual(asAdmin);
  });

  /* THE ALLOWLIST IS STILL POSITIVE, which is the property the comment
     above it exists to protect: a role nobody has named gets nothing, so
     adding a role later cannot accidentally hand it the book. Asserted so
     that "fix the blank page" is not done by deleting the allowlist. */
  it('while a role nobody has named still gets nothing', () => {
    expect(scopeFull(BOOK, 'developer' as never, ALL_PARTNERS)).toEqual([]);
    expect(scopeFull(BOOK, 'nonsense' as never, ALL_PARTNERS)).toEqual([]);
  });
});

describe('what an opndoor manager then sees on Reporting', () => {
  it('the volumes, rather than zeros', () => {
    const a = liveAggregate('opndoor_manager', ALL_PARTNERS, LAST12);
    expect(a.sent).toBe(2);
    expect(a.feesGross).toBe(4000);
    expect(a.deed).toBe(2);
  });

  it('and every customer in the estate-wide table', () => {
    expect(liveByCustomer('opndoor_manager', ALL_PARTNERS, LAST12).map((r) => r.name).sort())
      .toEqual(['Harbourside Homes', 'Regent’s Lettings']);
  });

  it('and the volume charts', () => {
    const v = liveVolume('opndoor_manager', ALL_PARTNERS, LAST12);
    expect(v.agencies.length).toBeGreaterThan(0);
    expect(v.referrers.length).toBeGreaterThan(0);
  });
});

describe('but not the money, which is a different permission', () => {
  /* READING THE BOOK AND SEEING WHAT IT EARNS ARE TWO PERMISSIONS, and the
     second is already answered: maySeeCommission is a flat no for this
     role. These assertions exist because a fix that widened the wrong
     allowlist -- adding opndoor_manager to maySeeCommission rather than to
     scopeFull -- would satisfy every assertion above and hand Opndoor's ops
     staff every commission figure on the estate. */
  it('maySeeCommission still refuses them', () => {
    expect(maySeeCommission('opndoor_manager')).toBe(false);
  });

  it('so the aggregate carries no commission, only volume', () => {
    const a = liveAggregate('opndoor_manager', ALL_PARTNERS, LAST12);
    expect(a.agentCommNet).toBe(0);
    expect(a.partnerCommNet).toBe(0);
    expect(a.supplierCommNet).toBe(0);
    // And the volume beside it is real, so this is not zero-because-empty.
    expect(a.feesGross).toBe(4000);
  });

  it('and the per-customer table carries no payable figure', () => {
    for (const r of liveByCustomer('opndoor_manager', ALL_PARTNERS, LAST12)) {
      expect(r.payable, r.name).toBe(0);
      expect(r.sent, r.name).toBeGreaterThan(0);
    }
  });

  /* THE ONE THE WIDENING WOKE UP.
     `trendMeasuresFor` has named `opndoor_manager` since it was written and
     offered them "Commission payable" as a trend measure. It never mattered,
     because the trend card sat behind a RoleOnly allowlist that omitted the
     role, so the dropdown was never drawn. Fixing the blank page draws the
     card -- which is how a dormant over-grant becomes a live one, and why
     "widen nine allowlists" is a change that has to be searched for tenth
     things rather than just applied.

     It was not cosmetic. `liveMonths` guarded `comm` with maySeeCommission
     and did not guard `payable` at all, so the figures behind the option
     were real. Both halves are asserted: the option is not offered, and the
     number behind it is not computed. */
  it('the trend does not offer them Opndoor’s commission payable', () => {
    const labels = trendMeasuresFor('opndoor_manager', false).map((m) => m.label);
    expect(labels).not.toContain('Commission payable');
    expect(labels).not.toContain('Commission earned');
    // And they still get the volume measures, so this is a narrowing and
    // not the dropdown disappearing.
    expect(labels).toEqual(['Fees collected', 'Referrals sent', 'Deeds issued']);
  });

  it('and would find nothing behind it if it were reached another way', () => {
    for (const row of liveTrend('month', 'opndoor_manager', ALL_PARTNERS)) {
      expect(row.payable, row.label).toBe(0);
      expect(row.comm, row.label).toBe(0);
    }
  });

  /* AND THE ADMIN STILL HAS BOTH, so the gate narrowed the reader it was
     aimed at and not the measure itself. */
  it('while an admin keeps the measure and the figures behind it', () => {
    expect(trendMeasuresFor('superadmin', true).map((m) => m.label)).toContain('Commission payable');
    expect(liveTrend('month', 'superadmin', ALL_PARTNERS).some((r) => r.payable > 0)).toBe(true);
  });
});
