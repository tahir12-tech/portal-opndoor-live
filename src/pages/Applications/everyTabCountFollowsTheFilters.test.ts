/* EVERY TAB COUNT FOLLOWS THE CURRENT FILTERS.
 *
 * Matt, 2026-10-02: "Applications from Home's 'View all Direct'
 * (Origin: Direct): there is only one direct application, and 'All'
 * correctly shows 1, but In progress shows 8, Fee unpaid 4 and Expired
 * 1. Those tabs are counting non-direct applications."
 *
 * =====================================================================
 * MEASURED ON DEV FIRST, AND THE PREMISE DOES NOT HOLD
 * =====================================================================
 *
 * Every application on dev, by partner and status:
 *
 *   opndoor-direct    1 deed, 8 draft, 1 expired
 *   opndoor-agents    5 deed, 14 paid, 2 sent, 7 expired
 *   kestrel-lettings  1 paid, 1 sent
 *
 * So under Origin: Direct the three numbers he saw are 8 DIRECT drafts,
 * 4 of those drafts unpaid, and 1 DIRECT expired referral. Not one of
 * them is another rail's row. The counts already follow the filter, and
 * this file is what says so: the fixture below holds direct and agency
 * rows in every bucket, and each count is asserted to narrow.
 *
 * WHAT IS ACTUALLY WRONG IS THE WORD "All". It is the operational
 * funnel -- sent + paid + deed -- and draft, awaiting decision,
 * declined, withdrawn and expired each `return` before it is reached.
 * That is deliberate and is why "Showing X of Y" uses the active tab's
 * own count. But it means a reader looking at "All 1" beside "In
 * progress 8" is reading two numbers that cannot both be a total, and
 * concludes the smaller one is being filtered and the larger one is
 * not.
 *
 * SO THE NUMBERS ARE RIGHT AND THE LABEL IS WRONG, which is a different
 * fix from the one asked for and is Matt's to choose: rename the tab to
 * what it counts, or make All mean all and give the funnel its own. It
 * is in docs/QUEUE.md under "For Matt in the morning". This file pins
 * the half that is not in question, so that whichever he picks cannot
 * quietly take the filtering with it.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { countByStatus, getApplications, hydrateApplications, ALL_PARTNERS } from '@/data';
import type { ApplicationSummary } from '@/data';

const row = (
  ref: string, partner: string, status: ApplicationSummary['status'], extra: Partial<ApplicationSummary> = {},
): ApplicationSummary => ({
  ref, tenant: `Tenant ${ref}`, prop: '1 Example Road, N1 1AA', branch: 'Main', agency: 'ZZZ Agency',
  ben: '', rent: 1500, status, date: '2026-05-10', owner: 0, partner, referrer: null,
  ...extra,
} as unknown as ApplicationSummary);

/* THE SHAPE OF DEV, in miniature: a direct rail that is mostly drafts
   and an agency rail that is mostly live, so a count that ignored the
   origin would be visibly larger rather than coincidentally equal. */
const BOOK: ApplicationSummary[] = [
  row('GR-D-DEED', 'opndoor-direct', 'deed'),
  row('GR-D-DR1', 'opndoor-direct', 'draft', { registered: true, feePaid: false } as never),
  row('GR-D-DR2', 'opndoor-direct', 'draft', { registered: false, feePaid: false } as never),
  row('GR-D-EXP', 'opndoor-direct', 'expired'),

  row('GR-A-SENT', 'opndoor-agents', 'sent'),
  row('GR-A-PAID', 'opndoor-agents', 'paid'),
  row('GR-A-DEED', 'opndoor-agents', 'deed'),
  row('GR-A-DR1', 'opndoor-agents', 'draft', { registered: true, feePaid: false } as never),
  row('GR-A-DR2', 'opndoor-agents', 'draft', { registered: true, feePaid: false } as never),
  row('GR-A-DR3', 'opndoor-agents', 'draft', { registered: true, feePaid: false } as never),
  row('GR-A-EXP1', 'opndoor-agents', 'expired'),
  row('GR-A-EXP2', 'opndoor-agents', 'expired'),
];

const opts = { role: 'superadmin' as const, scope: ALL_PARTNERS as string };

beforeEach(() => { hydrateApplications(BOOK, []); });
afterEach(() => { hydrateApplications([], []); });

describe('with no origin chosen', () => {
  it('every bucket counts the whole book', () => {
    const c = countByStatus(opts);
    expect(c.all).toBe(4);      // sent + paid + deed, across both rails
    expect(c.draft).toBe(5);
    expect(c.feeUnpaid).toBe(5);
    expect(c.expired).toBe(3);
  });
});

describe('with Origin: Direct, which is what Home’s link sets', () => {
  const direct = { ...opts, origin: 'direct' };

  /* THE THREE NUMBERS MATT READ, each asserted to be the direct rail's
     own and not the book's. Against a reader that ignored the origin
     these would be 5, 5 and 3. */
  it('In progress counts only the direct drafts', () => {
    expect(countByStatus(direct).draft).toBe(2);
  });

  it('Fee unpaid counts only the direct drafts that have not paid', () => {
    expect(countByStatus(direct).feeUnpaid).toBe(2);
  });

  it('Expired counts only the direct expired referrals', () => {
    expect(countByStatus(direct).expired).toBe(1);
  });

  it('and All counts the direct funnel, which is the one live row', () => {
    expect(countByStatus(direct).all).toBe(1);
  });

  /* AND THE ROWS AGREE WITH THE TABS, which is the property underneath
     all of the above: a tab whose count the list cannot produce sends
     the reader to an empty table under a number. */
  it('and each tab’s rows are the rows its count counted', () => {
    const c = countByStatus(direct);
    expect(getApplications({ ...direct, status: 'draft' })).toHaveLength(c.draft);
    expect(getApplications({ ...direct, status: 'expired' })).toHaveLength(c.expired);
    expect(getApplications({ ...direct, status: 'fee-unpaid' })).toHaveLength(c.feeUnpaid);
  });
});

describe('and the same is true of the other filters', () => {
  /* ORIGIN IS ONE OF FIVE. Matt's rule on 2026-10-01 was "every status
     tab count follows the current filters (origin, period, branch,
     referrer, search)", and the one that had been missed then was the
     search. These two keep the other two honest. */
  it('the search narrows every bucket, not just the rows', () => {
    const c = countByStatus({ ...opts, q: 'GR-D-DR1' });
    expect(c.draft).toBe(1);
    expect(c.expired).toBe(0);
  });

  it('and so does the branch', () => {
    hydrateApplications([
      ...BOOK,
      row('GR-A-OTHER', 'opndoor-agents', 'draft', { branch: 'Other' } as never),
    ], []);
    expect(countByStatus({ ...opts, branch: 'Other' }).draft).toBe(1);
  });
});
