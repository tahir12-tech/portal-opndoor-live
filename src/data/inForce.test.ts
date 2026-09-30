/* WHAT IS UNDER GUARANTEE, AND WHEN. Walk fixes 8 and 16.
 *
 * Item 8: "The bordereau export includes every application. It should include
 * only guarantees with an executed deed, in force during the period, and not
 * refunded or withdrawn."
 *
 * Item 16: "'Total guaranteed rent value' (£72k) is wrong. It should be the
 * total rent under guarantee: 12 months' rent for each executed deed in force
 * in the period, counting a joint tenancy once, not once per tenant."
 *
 * ONE HELPER FOR BOTH, and that is the point of the file existing rather than
 * two filters written twice. "Executed", "in force during the period" and
 * "not refunded or withdrawn" are the same three clauses in both sentences,
 * and the two readers are an underwriter-facing document and a headline
 * reporting tile. Two implementations of one rule would eventually disagree,
 * and disagreeing there is worse than either being wrong on its own.
 *
 * WHAT EACH CLAUSE WAS DOING BEFORE
 *
 *   executed          Neither asked. The bordereau tested `status === 'deed'`
 *                     and the tile tested `deedAt` present, which is the deed
 *                     ISSUED. An issued deed the tenant has not signed is not
 *                     a guarantee; `deedState === 'executed'` is.
 *   in force          Neither asked. The bordereau tested tenancy start INSIDE
 *                     the month; the tile tested deed issued inside it. A
 *                     guarantee written last year and still running counted in
 *                     neither, and one written inside the period and already
 *                     over counted fully in both. The two errors push the
 *                     total in opposite directions, which is how a wrong
 *                     figure can still look plausible.
 *   not withdrawn     Neither asked.
 *   not refunded      The bordereau asked. The tile did not.
 *
 * AND A PARTIAL REFUND IS NOT A REFUND. R2: `refunded` means the guarantee is
 * cancelled; `partiallyRefunded` means some money went back and the deed is
 * still live and the underwriter still on risk. Only the first excludes.
 */
import { describe, expect, it } from 'vitest';
import { guaranteedInForce, inForceDuring, type InForceRow } from './inForce';

const D = (s: string) => new Date(`${s}T12:00:00Z`);
/** October 2026, the period every assertion below is asked about. */
const OCT: [Date, Date] = [D('2026-10-01'), D('2026-10-31')];

const row = (over: Partial<InForceRow> = {}): InForceRow => ({
  deedState: 'executed',
  tenancyStart: D('2026-10-02'),
  expiry: D('2027-10-01'),
  refunded: false,
  partiallyRefunded: false,
  withdrawn: false,
  rent: 1800,
  shareAmount: null,
  ...over,
});

describe('an executed deed, and only an executed deed', () => {
  it('counts when the tenant has signed', () => {
    expect(inForceDuring(row(), ...OCT)).toBe(true);
  });

  /* THE CASE DEV ACTUALLY HAS. GR-20761 and GR-20763 are Paid with the deed
     out for signature. They are not guarantees yet and must not be reported
     to the underwriter as cover. */
  it('and not while it is still out for signature', () => {
    expect(inForceDuring(row({ deedState: 'awaiting_tenant' }), ...OCT)).toBe(false);
  });

  it('nor when it was declined, voided or errored', () => {
    for (const s of ['declined', 'voided', 'error'] as const) {
      expect(inForceDuring(row({ deedState: s }), ...OCT), s).toBe(false);
    }
  });

  it('nor when there is no deed at all', () => {
    expect(inForceDuring(row({ deedState: null }), ...OCT)).toBe(false);
  });
});

describe('in force DURING the period, not written inside it', () => {
  /* THE HALF THE OLD RULE GOT BACKWARDS, and the reason the old total could
     look plausible: it dropped the running book and kept the finished one. */
  it('counts a guarantee that started before the period and is still running', () => {
    expect(inForceDuring(
      row({ tenancyStart: D('2026-09-24'), expiry: D('2027-09-23') }), ...OCT,
    )).toBe(true);
  });

  it('and does NOT count one that had already expired before it began', () => {
    expect(inForceDuring(
      row({ tenancyStart: D('2025-06-01'), expiry: D('2026-05-31') }), ...OCT,
    )).toBe(false);
  });

  it('nor one whose cover starts after the period ends', () => {
    expect(inForceDuring(
      row({ tenancyStart: D('2026-11-20'), expiry: D('2027-11-19') }), ...OCT,
    )).toBe(false);
  });

  /* THE TWO BOUNDARIES, both inclusive: a guarantee in force for one day of
     the period was in force during the period. */
  it('counts one that starts on the last day of the period', () => {
    expect(inForceDuring(
      row({ tenancyStart: D('2026-10-31'), expiry: D('2027-10-30') }), ...OCT,
    )).toBe(true);
  });

  it('and one that expires on the first day of it', () => {
    expect(inForceDuring(
      row({ tenancyStart: D('2025-10-01'), expiry: D('2026-10-01') }), ...OCT,
    )).toBe(true);
  });

  /* A deed whose expiry was never written back. The rule has one
     implementation -- a year less a day from the tenancy start -- so the
     filter cannot quietly start dating cover differently from the bordereau's
     own Guarantee Expiry column. */
  it('and falls back to a year from the tenancy start when no expiry was stored', () => {
    expect(inForceDuring(
      row({ tenancyStart: D('2026-09-24'), expiry: null }), ...OCT,
    )).toBe(true);
    expect(inForceDuring(
      row({ tenancyStart: D('2025-06-01'), expiry: null }), ...OCT,
    )).toBe(false);
  });

  it('and counts nothing at all with no tenancy start, rather than everything', () => {
    expect(inForceDuring(row({ tenancyStart: null, expiry: null }), ...OCT)).toBe(false);
  });
});

describe('refunded and withdrawn', () => {
  it('a refunded guarantee is cancelled and does not count', () => {
    expect(inForceDuring(row({ refunded: true }), ...OCT)).toBe(false);
  });

  /* R2. THE DISTINCTION THAT ONE BOOLEAN USED TO SWALLOW. Some money went
     back, the deed is live, the underwriter is on risk. Dropping it would
     under-report the book to the insurer. */
  it('but a PARTIALLY refunded one is still on cover and still counts', () => {
    expect(inForceDuring(row({ partiallyRefunded: true }), ...OCT)).toBe(true);
  });

  it('and a withdrawn one does not count', () => {
    expect(inForceDuring(row({ withdrawn: true }), ...OCT)).toBe(false);
  });
});

describe('the money: twelve months, and a joint tenancy once', () => {
  it('is twelve months of the rent for a tenancy of one', () => {
    expect(guaranteedInForce([row({ rent: 1800 })], ...OCT)).toBe(1800 * 12);
  });

  /* MATT'S CLAUSE, AND HOW IT IS SATISFIED. "Counting a joint tenancy once,
     not once per tenant." Each tenant signs their own deed over their own
     SHARE, and the shares are apportioned to the penny, so summing the
     shares of a tenancy's deeds is the tenancy's rent exactly once. Dev's
     GR-20845 and GR-20846 are that pair: £1,080 + £920 against £2,000. */
  it('and twelve months of the tenancy ONCE when both tenants have signed', () => {
    const joint = [
      row({ rent: 2000, shareAmount: 1080, tenancyStart: D('2026-10-02'), expiry: D('2027-10-01') }),
      row({ rent: 2000, shareAmount: 920, tenancyStart: D('2026-10-02'), expiry: D('2027-10-01') }),
    ];
    expect(guaranteedInForce(joint, ...OCT)).toBe(2000 * 12);
  });

  /* AND HALF A TENANCY IS HALF THE MONEY, which is the honest answer rather
     than a rounding of it either way. Dev's GR-20762 is executed and its
     sibling GR-20763 is still awaiting the tenant: £1,200 a month is
     guaranteed, not £2,400 and not nothing. */
  it('and only the signed share when one tenant of a pair has not signed', () => {
    const half = [
      row({ rent: 2400, shareAmount: 1200 }),
      row({ rent: 2400, shareAmount: 1200, deedState: 'awaiting_tenant' }),
    ];
    expect(guaranteedInForce(half, ...OCT)).toBe(1200 * 12);
  });

  it('and nothing for a book with nothing in force', () => {
    expect(guaranteedInForce([row({ withdrawn: true }), row({ refunded: true })], ...OCT)).toBe(0);
  });
});
