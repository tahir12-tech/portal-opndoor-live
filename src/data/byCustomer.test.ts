/* ONE ROW PER CUSTOMER. Walk fix 20, and the half of 15 that Matt answered.
 *
 * 20: "Reporting for Opndoor admin should show volume broken down by
 * partner: every supplier and every agency, side by side (referrals sent,
 * fees collected, deeds issued, commission payable). Suppliers are
 * currently left out of the breakdowns entirely (Kestrel appears nowhere)."
 *
 * 15, answered as NM-F: "What he wants is to see the reports for each
 * customer: each supplier and each agency." Matt's answer: "yes to both
 * halves. The per-customer Reporting tab is Opndoor-only; agencies and
 * suppliers keep their own Reporting page as it is."
 *
 * WHY KESTREL APPEARS NOWHERE, which is the fault under the fault. The
 * existing breakdown groups by `app.partner`, and on the AGENCY rail every
 * agency of ours is carried by one house partner, `opndoor-agents`. So that
 * table has one row for the whole agency estate and one per supplier -- and
 * `livePartnerBreakdown` is gated on `maySeeCommission` and returns nothing
 * at all to a reader without it. "Per partner" was never "per customer",
 * and on the agency rail the partner is a ROUTE.
 *
 * THE CUSTOMER IS THE ORIGIN, which is the thing origin.ts exists to name:
 * the agency on the agency rail, the supplier on the supplier rail. Same
 * predicate the Applications list and Reporting's own scope narrowing use,
 * so the table cannot disagree with either about who exists.
 *
 * AND THE MEASURES ARE OPNDOOR'S FOUR, the same four as walk fix 17's trend:
 * referrals sent, fees collected, deeds issued, commission payable. Not
 * "commission earned", which on the house rail is Opndoor's own margin and
 * is structurally zero.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hydrateFull } from './applicationsService';
import { liveByCustomer } from './liveAnalytics';
import { ALL_PARTNERS } from './types';
import type { FullApp } from './applicationsService';
import type { Period } from './types';

const D = (y: number, m: number, d: number) => new Date(y, m, d);
const LAST12: Period = { id: 'last12m', label: 'Last 12 months' } as unknown as Period;

const app = (over: Partial<FullApp>): FullApp => ({
  ref: 'GR-C-1', partner: 'opndoor-agents', agency: 'Regent’s Lettings',
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

/* `harbourside` and not `kestrel-lettings`: the mock partner store is what
   names a supplier, and a slug it has never heard of falls back to itself,
   so the assertion would be about the fixture rather than the code. */
const SUPPLIER = { partner: 'harbourside', agency: 'Harbourside Homes' };
const SUPPLIER_NAME = 'Harbourside Homes';

const rows = () => liveByCustomer('superadmin', ALL_PARTNERS, LAST12);
const names = () => rows().map((r) => r.name);

beforeEach(() => hydrateFull([]));
afterEach(() => hydrateFull([]));

describe('who gets a row', () => {
  /* THE DEFECT, AS REPORTED: "Kestrel appears nowhere." */
  it('a supplier gets its own row, named as the reader knows it', () => {
    hydrateFull([app({ ...SUPPLIER })]);
    expect(names()).toEqual([SUPPLIER_NAME]);
  });

  /* AND THE AGENCY RAIL IS NOT ONE ROW. Grouping by `partner` gave the whole
     estate a single row called "Opndoor Agents" -- a company that does not
     exist outside our own schema. */
  it('and every agency gets its own, rather than the house partner getting one', () => {
    hydrateFull([
      app({ ref: 'A', agency: 'Regent’s Lettings' }),
      app({ ref: 'B', agency: 'Foxglove Residential' }),
    ]);
    expect(names().sort()).toEqual(['Foxglove Residential', 'Regent’s Lettings']);
    expect(names()).not.toContain('Opndoor Agents');
  });

  it('and the two sit side by side, which is what the item asks for', () => {
    hydrateFull([
      app({ ref: 'A', agency: 'Regent’s Lettings' }),
      app({ ref: 'K', ...SUPPLIER }),
    ]);
    expect(names().sort()).toEqual([SUPPLIER_NAME, 'Regent’s Lettings']);
  });

  /* EACH ROW SAYS WHICH KIND IT IS, because "Regent's Lettings" and
     "Kestrel Lettings" are both just names until something says which rail
     each is on. Same distinction origin.ts draws for the list column. */
  it('and each row says whether it is an agency or a supplier', () => {
    hydrateFull([
      app({ ref: 'A', agency: 'Regent’s Lettings' }),
      app({ ref: 'K', ...SUPPLIER }),
    ]);
    const byName = Object.fromEntries(rows().map((r) => [r.name, r.kind]));
    expect(byName['Regent’s Lettings']).toBe('agency');
    expect(byName[SUPPLIER_NAME]).toBe('supplier');
  });

  /* A DIRECT SIGNUP IS NOT A CUSTOMER. It is Opndoor's own business and has
     no agency or supplier behind it; a row for it would be Opndoor
     appearing in its own customer list. */
  it('and the direct rail is not a customer', () => {
    hydrateFull([
      app({ ref: 'A', agency: 'Regent’s Lettings' }),
      app({ ref: 'D', partner: 'opndoor-direct', agency: '', referrer: 'Direct signup', referrerId: null }),
    ]);
    expect(names()).toEqual(['Regent’s Lettings']);
  });
});

describe('Opndoor’s four measures', () => {
  it('counts referrals sent', () => {
    hydrateFull([app({ ref: 'A' }), app({ ref: 'B' })]);
    expect(rows()[0].sent).toBe(2);
  });

  it('sums the fees collected', () => {
    hydrateFull([app({ ref: 'A' }), app({ ref: 'B' })]);
    expect(rows()[0].fees).toBe(4000);
  });

  it('counts the deeds issued', () => {
    hydrateFull([app({ ref: 'A' }), app({ ref: 'B', deedAt: null, status: 'paid', deedState: null })]);
    expect(rows()[0].deeds).toBe(1);
  });

  /* COMMISSION PAYABLE, not earned. Walk fix 17's distinction, and it is the
     same one here: what Opndoor owes out is the agency's cut plus a real
     supplier's, never a house route's, which is Opndoor's own margin. */
  it('and what Opndoor owes out, which is not the same as what it earns', () => {
    hydrateFull([app({})]);
    expect(rows()[0].payable).toBeCloseTo(2000 * 0.25, 6);
  });

  it('and a supplier’s row carries both its own cut and the agency cut', () => {
    hydrateFull([app({ ...SUPPLIER })]);
    expect(rows()[0].payable).toBeCloseTo(2000 * 0.25 + 2000 * 0.25, 6);
  });

  it('and a refunded referral pays no commission', () => {
    hydrateFull([app({ refunded: true, refundedAt: D(2026, 1, 25), refundedAmount: 2000 })]);
    expect(rows()[0].payable).toBe(0);
  });
});

describe('the order, and what a reader does with it', () => {
  /* BIGGEST FIRST. The page's job is "how is each customer doing", and a
     table sorted by name makes that a reading exercise. Fees, then
     referrals, then name -- the same order the league already uses, so two
     tables of the same customers do not disagree about who is top. */
  it('is biggest first by fees, then by referrals, then by name', () => {
    hydrateFull([
      app({ ref: 'S', agency: 'Small Agency', rent: 500, fee: 500 }),
      app({ ref: 'B', agency: 'Big Agency', rent: 5000, fee: 5000 }),
      app({ ref: 'M', agency: 'Mid Agency', rent: 2000, fee: 2000 }),
    ]);
    expect(names()).toEqual(['Big Agency', 'Mid Agency', 'Small Agency']);
  });
});

describe('who may read it', () => {
  /* COMMISSION PAYABLE IS A COMMISSION FIGURE, so the rule that governs
     every other one governs this. A reader who may not see commission gets
     the volume and a zero, not a table with a hole in it -- the same shape
     liveAggregate uses, and for the same reason: a figure that was never
     computed cannot leak. */
  /* owner: 1 so a referrer's own scoping lets the row through at all --
     otherwise this would pass for the wrong reason, on an empty table. */
  it('a reader who may not see commission still gets the volumes', () => {
    hydrateFull([app({ owner: 1 })]);
    const r = liveByCustomer('referrer', ALL_PARTNERS, LAST12);
    expect(r[0]?.sent).toBe(1);
    expect(r[0]?.fees).toBe(2000);
  });

  it('but no commission figure at all', () => {
    hydrateFull([app({ owner: 1 })]);
    const r = liveByCustomer('referrer', ALL_PARTNERS, LAST12);
    expect(r.length, 'the row was scoped away, so this proves nothing').toBe(1);
    expect(r[0].payable).toBe(0);
  });
});
