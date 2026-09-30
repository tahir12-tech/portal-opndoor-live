/* =====================================================================
   WHAT IS UNDER GUARANTEE, AND WHEN.

   Walk fixes 8 and 16, which are the same three clauses said twice:

     8.  "only guarantees with an executed deed, in force during the period,
          and not refunded or withdrawn"
     16. "12 months' rent for each executed deed in force in the period,
          counting a joint tenancy once, not once per tenant"

   ONE HELPER, BECAUSE THE TWO READERS MUST AGREE. One is the underwriter's
   bordereau and the other is the headline "Total guaranteed rent value" on
   Reporting. Written twice they would eventually disagree about which
   guarantees exist, and an insurer's document disagreeing with our own
   reporting is worse than either being wrong alone.

   =========================================================================
   WHAT THE TWO WERE ASKING BEFORE, AND WHY THE TOTAL LOOKED PLAUSIBLE
   =========================================================================

   The bordereau filtered on `status === 'deed' && !refunded && tenancyStart
   inside the month`. The tile filtered on `deedAt inside the period`. So:

     EXECUTED    Neither asked. Both accept a deed that has been ISSUED and
                 is still out for the tenant's signature. That is not a
                 guarantee: nobody has promised anything yet. Dev has two of
                 them right now (GR-20761, GR-20763).

     IN FORCE    Neither asked. Both asked when the cover was WRITTEN. A
                 guarantee written last year and still running counted in
                 neither; one written inside the period and already over
                 counted fully in both. The two errors move the total in
                 OPPOSITE directions, which is exactly how a figure can be
                 built from the wrong set and still look about right.

     WITHDRAWN   Neither asked.
     REFUNDED    The bordereau asked. The tile did not.

   =========================================================================
   AND A PARTIAL REFUND IS NOT A REFUND
   =========================================================================

   R2. `refunded` means the guarantee is CANCELLED. `partiallyRefunded` means
   some money went back and the deed is live and the underwriter is on risk.
   Only the first excludes. Dropping a partially refunded row would
   under-report the book to the insurer, which is the one direction an
   underwriter's document must never be wrong in.
   ===================================================================== */
import { guaranteeExpiry } from './applicationsService';
import type { DeedState } from './types';

/** The fields the rule reads. Deliberately structural rather than FullApp,
 *  so the bordereau, the reporting rail and the tests can ask the same
 *  question of whatever row shape each of them holds. */
export interface InForceRow {
  deedState?: DeedState | null;
  tenancyStart: Date | null;
  /** The stored guarantee expiry, or null where it was never written back. */
  expiry?: Date | null;
  refunded: boolean;
  /** R2. Money back, guarantee intact. Not a reason to exclude. */
  partiallyRefunded?: boolean;
  withdrawn: boolean;
  rent: number;
  /** This tenant's share of a joint tenancy's rent, apportioned to the penny
   *  at creation. Null for a tenancy of one. */
  shareAmount?: number | null;
}

/**
 * When this guarantee's cover ends.
 *
 * The stored expiry, else a year less a day from the tenancy start. ONE
 * implementation, shared with the bordereau's own Guarantee Expiry column,
 * so the filter cannot quietly start dating cover differently from the
 * document it is filtering.
 */
export function coverEnds(a: Pick<InForceRow, 'expiry' | 'tenancyStart'>): Date | null {
  if (a.expiry) return a.expiry;
  return a.tenancyStart ? guaranteeExpiry(a.tenancyStart) : null;
}

/**
 * Was this guarantee in force at any point during [start, end]?
 *
 * BOTH BOUNDARIES INCLUSIVE: a guarantee in force for one day of the period
 * was in force during the period. That is what an underwriter is being told
 * about, and it is what "in force in the period" says.
 *
 * NO TENANCY START MEANS NO COVER, not unbounded cover. A missing date must
 * narrow rather than widen: the alternative is a row of unknown dates
 * reported to the insurer as live business.
 */
export function inForceDuring(a: InForceRow, start: Date, end: Date): boolean {
  if (a.deedState !== 'executed') return false;
  if (a.refunded || a.withdrawn) return false;
  if (!a.tenancyStart) return false;
  const ends = coverEnds(a);
  if (!ends) return false;
  return a.tenancyStart.getTime() <= end.getTime() && ends.getTime() >= start.getTime();
}

/**
 * Twelve months of the rent under guarantee across a book, for a period.
 *
 * MATT'S "COUNTING A JOINT TENANCY ONCE" FALLS OUT OF THE SHARE. Each tenant
 * of a joint tenancy signs their own deed over their own SHARE, and
 * create_joint_referral apportions the shares to the penny, so summing the
 * shares of a tenancy's executed deeds is twelve months of that tenancy's
 * rent exactly once. There is deliberately no dedupe by tenancy id: a dedupe
 * would have to pick one row and take the WHOLE rent from it, which is right
 * only when every sibling has signed.
 *
 * And that is the case worth stating. Where one tenant of a pair has signed
 * and the other has not, this reports half the rent, because half the rent
 * is what is guaranteed. Not the whole tenancy, which nobody has promised,
 * and not nothing, which ignores a signed deed.
 */
export function guaranteedInForce(book: InForceRow[], start: Date, end: Date): number {
  let total = 0;
  for (const a of book) {
    if (!inForceDuring(a, start, end)) continue;
    const covered = a.shareAmount != null && a.shareAmount > 0 ? a.shareAmount : a.rent;
    total += covered * 12;
  }
  return total;
}
