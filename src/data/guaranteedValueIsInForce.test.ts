/* WALK FIX 16. "TOTAL GUARANTEED RENT VALUE" IS THE BOOK ON COVER.
 *
 * Verbatim: "Reporting, 'Total guaranteed rent value' (£72k) is wrong. It
 * should be the total rent under guarantee: 12 months' rent for each executed
 * deed in force in the period, counting a joint tenancy once, not once per
 * tenant. Show how the current figure is calculated alongside the fix."
 *
 * HOW THE CURRENT FIGURE IS CALCULATED, which is the half of the item that is
 * reading rather than building. One line, src/data/liveAnalytics.ts:
 *
 *     if (inRange(app.deedAt, start, end)) { a.guaranteed += guaranteedAnnual(app) }
 *
 * So: twelve months of rent for every application whose deed was ISSUED
 * inside the period. Against Matt's sentence, the four clauses were in three
 * different states, and this file is one assertion per state.
 *
 *   "counting a joint tenancy once"  ALREADY TRUE, and asserted here so the
 *                                    fix cannot undo it. guaranteedAnnual
 *                                    returns the SHARE, and the shares sum to
 *                                    the rent, so a tenancy counts once.
 *   "executed"                       NOT TRUE. The test is that deedAt
 *                                    exists, which is the deed ISSUED. A deed
 *                                    out for the tenant's signature counted.
 *   "in force in the period"         NOT TRUE, and this is the fault. The
 *                                    code asked when the deed was ISSUED.
 *                                    A guarantee written last year and still
 *                                    running contributed nothing; one written
 *                                    inside the period and already over
 *                                    contributed fully. The two errors push
 *                                    the total in OPPOSITE directions, which
 *                                    is how £72k could look plausible while
 *                                    being built from the wrong set.
 *   refunded / withdrawn             NOT TESTED AT ALL by this line. The
 *                                    bordereau at least excluded refunds.
 *
 * THE RULE IS SHARED WITH THE BORDEREAU (src/data/inForce.ts), because these
 * are the same three clauses as item 8 and the two must not drift.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hydrateFull } from './applicationsService';
import { liveAggregate } from './liveAnalytics';
import { ALL_PARTNERS } from './types';
import type { FullApp } from './applicationsService';
import type { Period } from './types';

const D = (y: number, m: number, d: number) => new Date(y, m, d);

/* THE PERIOD IS MAY 2026, asked for as `lastmonth`.
   A Period is an ID, not a date pair -- periodRange switches on it -- so a
   hand-made {from, to} falls through to "all time" and every assertion here
   passes or fails for the wrong reason. Test mode's clock is fixed at
   2026-06-26, so `lastmonth` is May 2026, the same window
   settlement-bordereau.test.ts uses. */
const MAY: Period = { id: 'lastmonth', label: 'Last month' } as unknown as Period;

const app = (over: Partial<FullApp>): FullApp => ({
  ref: 'GR-GV-1', partner: 'opndoor-agents', agency: 'Regent’s Lettings',
  branch: "Regent's Park", referrer: 'R', owner: 0,
  rent: 2000, fee: 2000, agentRate: 0.25, partnerRate: 0.25,
  status: 'deed', deedState: 'executed',
  sentAt: D(2026, 3, 1), paidAt: D(2026, 3, 15),
  deedAt: D(2026, 4, 1), tenancyStart: D(2026, 4, 2), expiry: D(2027, 4, 1),
  refunded: false, partiallyRefunded: false, withdrawn: false,
  refundedAt: null, refundedAmount: null, refundAfterStart: false,
  deedSentAt: null, deedViewedAt: null, expired: false,
  ...over,
} as unknown as FullApp);

const guaranteed = () => liveAggregate('superadmin', ALL_PARTNERS, MAY).guaranteed;

beforeEach(() => hydrateFull([]));
afterEach(() => hydrateFull([]));

describe('executed, not merely issued', () => {
  it('counts twelve months for a deed the tenant has signed', () => {
    hydrateFull([app({})]);
    expect(guaranteed()).toBe(2000 * 12);
  });

  it('and nothing for one still out for signature', () => {
    hydrateFull([app({ status: 'paid', deedState: 'awaiting_tenant' })]);
    expect(guaranteed()).toBe(0);
  });
});

describe('in force in the period, not issued inside it', () => {
  /* THE HALF THAT WAS BACKWARDS, and the larger of the two errors: the book
     that is actually on cover is mostly guarantees written in earlier
     months. */
  it('counts one written earlier and still running', () => {
    hydrateFull([app({
      deedAt: D(2026, 0, 20), tenancyStart: D(2026, 0, 24), expiry: D(2027, 0, 23),
    })]);
    expect(guaranteed()).toBe(2000 * 12);
  });

  it('and not one whose cover was already over', () => {
    hydrateFull([app({
      deedAt: D(2025, 2, 20), tenancyStart: D(2025, 3, 1), expiry: D(2026, 2, 31),
    })]);
    expect(guaranteed()).toBe(0);
  });

  it('nor one whose cover has not started', () => {
    hydrateFull([app({
      deedAt: D(2026, 5, 15), tenancyStart: D(2026, 5, 20), expiry: D(2027, 5, 19),
    })]);
    expect(guaranteed()).toBe(0);
  });

  /* THE TWO ERRORS IN ONE BOOK, because separately each reads as a single
     missing row and together they show what the old figure actually was. */
  it('reports the book on cover, where the old rule reported nothing', () => {
    hydrateFull([
      app({ ref: 'GR-RUNNING', deedAt: D(2026, 0, 20), tenancyStart: D(2026, 0, 24), expiry: D(2027, 0, 23) }),
      app({ ref: 'GR-FINISHED', rent: 3000, deedAt: D(2025, 2, 20), tenancyStart: D(2025, 3, 1), expiry: D(2026, 2, 31) }),
    ]);
    /* £24,000: the running one alone. Under the OLD rule this book totalled
       ZERO -- neither deed was issued in May -- while £2,000 a month was on
       cover the whole time. That is the shape of the error, and it is why
       the old figure could be any size at all. */
    expect(guaranteed()).toBe(2000 * 12);
  });
});

describe('refunded and withdrawn', () => {
  it('a cancelled guarantee is not guaranteed rent', () => {
    hydrateFull([app({ refunded: true, refundedAt: D(2026, 4, 10), refundedAmount: 2000 })]);
    expect(guaranteed()).toBe(0);
  });

  /* R2. Money back, deed live, underwriter on risk. */
  it('but a partially refunded one still is', () => {
    hydrateFull([app({ partiallyRefunded: true, refundedAmount: 100 })]);
    expect(guaranteed()).toBe(2000 * 12);
  });

  it('and a withdrawn one is not', () => {
    hydrateFull([app({ withdrawn: true })]);
    expect(guaranteed()).toBe(0);
  });
});

describe('a joint tenancy counts once', () => {
  /* ALREADY TRUE BEFORE THIS FIX, and asserted so the fix cannot undo it.
     Dev's GR-20845 and GR-20846: £1,080 + £920 against a £2,000 tenancy. */
  it('is twelve months of the tenancy, not of each tenant', () => {
    hydrateFull([
      app({ ref: 'GR-20845', tenancyId: 't-1', rent: 2000, shareAmount: 1080 }),
      app({ ref: 'GR-20846', tenancyId: 't-1', rent: 2000, shareAmount: 920 }),
    ]);
    expect(guaranteed()).toBe(2000 * 12);
  });

  /* AND HALF A TENANCY IS HALF THE MONEY. Dev's GR-20762 is signed and its
     co-tenant GR-20763 is not. £1,200 a month is guaranteed: not the whole
     tenancy, which nobody has promised, and not nothing, which would ignore
     a signed deed. */
  it('and only the signed share when one of a pair has not signed', () => {
    hydrateFull([
      app({ ref: 'GR-20762', tenancyId: 't-2', rent: 2400, shareAmount: 1200 }),
      app({ ref: 'GR-20763', tenancyId: 't-2', rent: 2400, shareAmount: 1200, status: 'paid', deedState: 'awaiting_tenant' }),
    ]);
    expect(guaranteed()).toBe(1200 * 12);
  });
});
