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
 * SO THE NUMBERS WERE RIGHT AND THE LABEL WAS WRONG, which was a
 * different fix from the one asked for. Matt chose the wider of the two
 * the same day: "the 'All' tab counts and shows every application in the
 * current filters, including In progress, Fee unpaid and Expired, so
 * 'All' equals the sum of the other tabs. 'Showing X of Y' counts the
 * same set." The cases below are unchanged except for the two that said
 * All was the funnel; the filtering they pin is what must survive it.
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
    /* ALL IS EVERY ROW, since Matt's answer of 2026-10-02 to the
       question this file raised: "the 'All' tab counts and shows every
       application in the current filters ... so 'All' equals the sum of
       the other tabs." It was 4 here, the funnel. */
    expect(c.all).toBe(BOOK.length);
    expect(c.draft).toBe(5);
    expect(c.feeUnpaid).toBe(5);
    expect(c.expired).toBe(3);
  });

  /* AND THE SUM HOLDS, over the tabs that are siblings rather than
     subsets. Invited and feeUnpaid sit inside draft, refunded and
     awaiting inside paid, and the delivery counts inside deed, so they
     are left out of the addition exactly as the reader leaves them out
     when adding up what is on screen. */
  it('and All is the sum of the exclusive tabs', () => {
    const c = countByStatus(opts);
    expect(c.draft + c.referencing + c.declined + c.sent + c.paid + c.deed + c.withdrawn + c.expired)
      .toBe(c.all);
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

  it('and All counts every direct row, which is the whole point of the word', () => {
    const c = countByStatus(direct);
    expect(c.all).toBe(4);  // 1 deed + 2 drafts + 1 expired
    expect(c.draft + c.expired + c.deed).toBe(c.all);
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

  /* INCLUDING ALL, which is the half the counts alone would not catch:
     "the 'All' tab COUNTS AND SHOWS every application in the current
     filters". A count that moved without the list moving would put a
     number above rows that are not there. */
  it('and All shows every direct row, not only counts them', () => {
    const rows = getApplications({ ...direct, status: 'all' });
    expect(rows).toHaveLength(countByStatus(direct).all);
    const refs = rows.map((r) => r.ref);
    expect(refs).toContain('GR-D-DR1');   // In progress
    expect(refs).toContain('GR-D-EXP');   // Expired
    expect(refs).toContain('GR-D-DEED');  // and the live one
    expect(refs).not.toContain('GR-A-DR1');
  });

  /* AND CHOOSING A TAB STILL NARROWS. The change let draft and terminal
     rows through on 'all'; it must not have let them through on Paid,
     which is the way a one-line relaxation usually goes wrong. */
  it('while choosing Paid still shows only paid rows', () => {
    const paid = getApplications({ ...opts, status: 'paid' }).map((r) => r.ref);
    expect(paid).toEqual(['GR-A-PAID']);
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
