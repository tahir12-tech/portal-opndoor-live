/* =====================================================================
   The applicant's share of the rent, as a percentage and as an amount.

   BOTH ARE STORED, NEITHER IS DERIVED AT READ TIME. The percentage is the
   commercial fact, agreed between the tenants. The amount is what the
   eligibility check is assessed against. Recomputing either later, against a
   rent that has since been corrected, would silently restate the basis of a
   decision that has already been made.

   So the form derives one from the other AS YOU TYPE, and then both are sent.
   These are the two directions, in one place, because two implementations of
   "what is 40% of £1,450" is how the stored pair ends up disagreeing by a penny
   and nobody can say which is right.
   ===================================================================== */

/** Round to pence. Money arithmetic in floating point otherwise leaks thirds. */
function pence(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A percentage, to three decimals, which is what the column holds. */
function pct(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function amountFromPercent(rent: number, percent: number): number | null {
  if (!Number.isFinite(rent) || !Number.isFinite(percent)) return null;
  if (rent < 0 || percent < 0 || percent > 100) return null;
  return pence((rent * percent) / 100);
}

export function percentFromAmount(rent: number, amount: number): number | null {
  if (!Number.isFinite(rent) || !Number.isFinite(amount)) return null;
  // A zero rent has no percentage rather than an infinite one. This is reachable:
  // the rent field is empty while somebody is still typing.
  if (rent <= 0 || amount < 0) return null;
  return pct((amount / rent) * 100);
}

/**
 * What to show when neither has been touched.
 *
 * 100%, because the common case by a distance is one applicant responsible for
 * the whole rent, and a sole tenant should not have to say so. A joint tenancy
 * is the case that types something.
 */
export const DEFAULT_SHARE_PERCENT = 100;

/** Whether a share is worth warning about, without blocking. */
export function shareWarning(rent: number, percent: number, amount: number): string | null {
  if (!Number.isFinite(rent) || rent <= 0) return null;
  if (percent > 100) return 'A share cannot be more than the whole rent.';
  // A rounding gap of a penny or two is arithmetic, not a mistake.
  const implied = amountFromPercent(rent, percent);
  if (implied !== null && Math.abs(implied - amount) > 0.02) {
    return 'The percentage and the amount do not agree. Change either and the other follows.';
  }
  if (percent === 0) {
    return 'A zero share is allowed: on a joint tenancy somebody else may carry the whole rent.';
  }
  return null;
}
