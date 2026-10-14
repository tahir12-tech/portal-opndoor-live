/* =====================================================================
   WHAT A FEE WAS A BASIS OF, IN THE WORDS THAT WERE AGREED.

   Matt, 2026-10-12, two findings that are one fault:

     "Reporting's Net fees caption says 'one month's rent each'. Wrong for
      Regent and Brithive. Make it true for any fee basis."

     "The payment panel showed '£1.16 · 5.03 weeks of rent' on a £2 rent
      joint test with a 5-week deal. Show the agreed weeks, not a figure
      back-calculated from the rounded pence."

   BOTH SURFACES WERE DIVIDING MONEY BY MONEY. Two helpers, written weeks
   apart, each recovered the basis with (fee * 52) / (rent * 12) -- and a fee
   is rounded to the penny and a joint share is rounded again, so the quotient
   is only approximately the basis. At £2 rent the error is enormous: a
   five-week deal charges a half-share £1.16 against a £1.00 base, and 5.03
   comes out. At a real rent the same arithmetic lands close enough to hide,
   which is why it survived.

   THE BASIS IS NOT A RATIO. It is a number somebody agreed, and every
   application has carried it frozen since 20260928100000:
   `fee_basis_weeks`, with `fee_basis_unit` beside it since a band could be
   written in months. Read it, and the answer is exact and needs no tolerance.

   WHY ONE MODULE RATHER THAN A HELPER IN EITHER. feeBasisOf lives in
   commissionSplit.ts and feeLabels in applicationsService.ts, and
   commissionSplit already imports a TYPE from applicationsService, so a value
   import the other way would close a cycle. A third file costs nothing and is
   the only place either of them now says this.
   ===================================================================== */
import { plural } from '@/lib/plural';

/** One month expressed in weeks. 52/12 = 4.3333..., stored as 4.35. */
export const WEEKS_IN_A_MONTH = 52 / 12;

/** The two snapshot columns, as the client hydrates them. */
export interface FeeBasisSnapshot {
  /** The agreed QUANTITY, whose unit is the field below. The name is the
      column's, which predates months being expressible. */
  feeBasisWeeks?: number | null;
  /** 'weeks' or 'months'. Null or absent reads as weeks, which is what every
      row written before 20261008000000 holds. */
  feeBasisUnit?: 'weeks' | 'months' | null;
}

/** 5.00 -> 5, 4.35 -> 4.35. A basis is a number people said out loud. */
const tidy = (n: number): number => Number(n.toFixed(2));

/**
 * The agreed basis as a phrase, from the snapshot alone.
 *
 * Null where there is no snapshot, and the caller then falls back to the old
 * arithmetic rather than printing nothing: rows created before the columns
 * existed are still on the books.
 */
export function agreedBasisPhrase(r: FeeBasisSnapshot): string | null {
  const qty = r.feeBasisWeeks;
  if (qty == null || !Number.isFinite(qty) || qty <= 0) return null;
  const n = tidy(qty);
  if ((r.feeBasisUnit ?? 'weeks') === 'months') {
    return n === 1 ? "one month's rent" : `${n} ${plural(n, 'month')} of rent`;
  }
  /* STANDARD TERMS SAY "ONE MONTH'S RENT", because that is the agreement and
     "4.35 weeks of rent" is the same thing said in the column's units. The
     tolerance is for 4.35 against 52/12 and nothing else: it is a stored
     constant compared with a computed one, not a rounded fee. */
  if (Math.abs(n - WEEKS_IN_A_MONTH) < 0.02) return "one month's rent";
  return `${n} ${plural(n, 'week')} of rent`;
}

/**
 * The basis recovered from the money, which is what both surfaces used to do.
 *
 * Kept, and kept only as a fallback, for a row with no snapshot. Both halves
 * of the ratio must be the same person's: the share scales the denominator,
 * or one tenant of a 50/50 pair on a five-week deal reads 2.5 weeks.
 */
export function basisFromMoney(fee: number, base: number): string {
  if (!(base > 0) || !(fee > 0)) return '';
  if (Math.abs(fee - base) < 0.005) return "one month's rent";
  const w = tidy((fee * 52) / (base * 12));
  return `${w} ${plural(w, 'week')} of rent`;
}
