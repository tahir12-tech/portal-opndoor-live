/* WALK FIX 8. WHAT THE UNDERWRITER IS TOLD ABOUT.
 *
 * Verbatim: "The bordereau export includes every application. It should
 * include only guarantees with an executed deed, in force during the period,
 * and not refunded or withdrawn."
 *
 * The rule itself is in src/data/inForce.ts and tested in inForce.test.ts.
 * This file is the bordereau ASKING it, because the defect was never in the
 * rule: it was that the export asked a different, narrower question and got
 * a different set.
 *
 * WHAT IT ASKED BEFORE:  status === 'deed' && !refunded
 *                        && tenancy start inside the month
 *
 * Three of Matt's four clauses were missing, and the fourth was asked about
 * the wrong thing:
 *
 *   executed   `status === 'deed'` is the deed ISSUED. Dev has two
 *              applications right now whose deed is out for the tenant's
 *              signature; neither is a guarantee, and both were being
 *              reported to the insurer as cover.
 *   in force   the export asked when the cover was WRITTEN. A guarantee
 *              written in September and running until next September was
 *              absent from every bordereau after September's.
 *   withdrawn  not asked.
 *
 * WHY THE DIRECTION MATTERS MORE THAN THE SIZE. Two of these over-report the
 * book to the insurer and one under-reports it. An underwriter's document
 * that overstates cover is a claim we cannot make good; one that understates
 * it is a claim they can decline. The fix is not "closer to right", it is
 * the set Matt described.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hydrateFull } from './applicationsService';
import { buildLiveBordereau } from './exportsService';
import type { FullApp } from './applicationsService';

const D = (y: number, m: number, d: number) => new Date(y, m, d);
/** October 2026 is the month every assertion asks for. */
const OCT = [2026, 9] as const;

const app = (over: Partial<FullApp>): FullApp => ({
  ref: 'GR-IF-1', partner: 'opndoor-agents', agency: 'Regent’s Lettings',
  branch: "Regent's Park", rent: 2000, fee: 2000, agentRate: 0.25, partnerRate: 0.25,
  status: 'deed', deedState: 'executed',
  tenancyStart: D(2026, 9, 2), deedAt: D(2026, 9, 1), expiry: D(2027, 9, 1),
  refunded: false, partiallyRefunded: false, withdrawn: false,
  ...over,
} as unknown as FullApp);

const refs = () => buildLiveBordereau(OCT[0], OCT[1], 13.5).rows.map((r) => r[0]);

beforeEach(() => hydrateFull([]));
afterEach(() => hydrateFull([]));

describe('only an executed deed', () => {
  it('reports one the tenant has signed', () => {
    hydrateFull([app({})]);
    expect(refs()).toEqual(['GR-IF-1']);
  });

  /* THE ROWS DEV HAS TODAY: GR-20761 and GR-20763, Paid, deed out for
     signature. Reported to the underwriter as cover, which they are not. */
  it('and not one still out for the tenant to sign', () => {
    hydrateFull([app({ ref: 'GR-UNSIGNED', status: 'paid', deedState: 'awaiting_tenant' })]);
    expect(refs()).toEqual([]);
  });

  /* THE SAME ROW WITH status 'deed', which is the one that isolates the
     clause. The assertion above passes for a filter that only ever tested
     `status === 'deed'`, because a deed out for signature is Paid; this one
     does not, and it is the shape a status that ran ahead of its deed state
     would produce. */
  it('and not an issued deed whose state says nobody has signed it', () => {
    hydrateFull([app({ ref: 'GR-ISSUED-ONLY', status: 'deed', deedState: 'awaiting_tenant' })]);
    expect(refs()).toEqual([]);
  });

  it('nor one that was declined or voided', () => {
    hydrateFull([
      app({ ref: 'GR-DECLINED', deedState: 'declined' }),
      app({ ref: 'GR-VOIDED', deedState: 'voided' }),
    ]);
    expect(refs()).toEqual([]);
  });
});

describe('in force DURING the month, not written inside it', () => {
  /* THE CLAUSE THAT CHANGES THE DOCUMENT'S MEANING. Dev's GR-20621 starts on
     24 September and runs to 23 September next year. It appeared on
     September's bordereau alone, and was invisible on every month it was
     actually on cover. */
  it('reports a guarantee that began earlier and is still running', () => {
    hydrateFull([app({
      ref: 'GR-SEPT', tenancyStart: D(2026, 8, 24), deedAt: D(2026, 8, 23), expiry: D(2027, 8, 23),
    })]);
    expect(refs()).toEqual(['GR-SEPT']);
  });

  it('and does not report one that had already expired', () => {
    hydrateFull([app({
      ref: 'GR-OVER', tenancyStart: D(2025, 5, 1), deedAt: D(2025, 4, 28), expiry: D(2026, 4, 31),
    })]);
    expect(refs()).toEqual([]);
  });

  it('nor one whose cover has not started yet', () => {
    hydrateFull([app({
      ref: 'GR-NOV', tenancyStart: D(2026, 10, 20), deedAt: D(2026, 10, 19), expiry: D(2027, 10, 19),
    })]);
    expect(refs()).toEqual([]);
  });
});

describe('not refunded or withdrawn', () => {
  it('drops a refunded guarantee, which is cancelled', () => {
    hydrateFull([app({ ref: 'GR-REFUNDED', refunded: true })]);
    expect(refs()).toEqual([]);
  });

  /* R2, AND THE ONE DIRECTION THIS DOCUMENT MUST NOT BE WRONG IN. Some money
     went back; the deed is live and the underwriter is on risk. Dropping it
     would under-report the book to the insurer. */
  it('but keeps a PARTIALLY refunded one, which is still on cover', () => {
    hydrateFull([app({ ref: 'GR-PARTIAL', partiallyRefunded: true, refundedAmount: 100 })]);
    expect(refs()).toEqual(['GR-PARTIAL']);
  });

  it('and drops a withdrawn one', () => {
    hydrateFull([app({ ref: 'GR-WITHDRAWN', withdrawn: true })]);
    expect(refs()).toEqual([]);
  });
});

describe('the whole book at once', () => {
  /* Every clause in one call, because each assertion above passes on its own
     for a filter that implements only that clause. */
  it('reports exactly the guarantees in force, out of a mixed book', () => {
    hydrateFull([
      app({ ref: 'GR-IN-1' }),
      app({ ref: 'GR-IN-2', tenancyStart: D(2026, 8, 24), deedAt: D(2026, 8, 23), expiry: D(2027, 8, 23) }),
      app({ ref: 'GR-OUT-UNSIGNED', status: 'paid', deedState: 'awaiting_tenant' }),
      app({ ref: 'GR-OUT-EXPIRED', tenancyStart: D(2025, 5, 1), expiry: D(2026, 4, 31) }),
      app({ ref: 'GR-OUT-FUTURE', tenancyStart: D(2026, 10, 20), expiry: D(2027, 10, 19) }),
      app({ ref: 'GR-OUT-REFUNDED', refunded: true }),
      app({ ref: 'GR-OUT-WITHDRAWN', withdrawn: true }),
    ]);
    expect(refs().sort()).toEqual(['GR-IN-1', 'GR-IN-2']);
  });

  /* AND A JOINT TENANCY IS STILL ONE ROW PER DEED, which is not the same
     rule as item 16's "count the tenancy once" and must not be confused with
     it: each tenant's deed is a separate risk the insurer carries, so each is
     a row, and the premium on each is 13.5% of that tenant's share. The two
     rules agree because the shares sum to the rent. */
  it('and a joint tenancy is one row per signed deed, each on its own share', () => {
    hydrateFull([
      app({ ref: 'GR-J1', tenancyId: 't-1', rent: 2000, shareAmount: 1080 }),
      app({ ref: 'GR-J2', tenancyId: 't-1', rent: 2000, shareAmount: 920 }),
    ]);
    const rows = buildLiveBordereau(OCT[0], OCT[1], 13.5).rows;
    expect(rows.map((r) => r[0]).sort()).toEqual(['GR-J1', 'GR-J2']);
    // Column P is Monthly Rent, and it is the share, not the tenancy's rent.
    expect(rows.map((r) => r[15]).sort()).toEqual([1080, 920]);
  });
});
