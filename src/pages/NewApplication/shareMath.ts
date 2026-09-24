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

/* =====================================================================
   MORE THAN ONE TENANT.

   The FEE apportionment is not here: it is public.apportion in SQL, and the
   form asks the server for it (referral_fee_preview) rather than computing a
   second version that agrees until a rounding case pulls them apart. What IS
   here is the default SPLIT OF THE RENT the agent starts from, which is a form
   default rather than a money rule.
   ===================================================================== */

/**
 * Equal shares for n tenants, to three decimals, summing to exactly 100.
 *
 * The last tenant takes the rounding, the same way the last applicant takes it
 * on the fee, so three tenants are 33.333 / 33.333 / 33.334 and not three
 * thirds that add up to 99.999 and trip the validator on a form nobody typed
 * a number into.
 */
export function equalSharePercents(n: number): number[] {
  if (!Number.isFinite(n) || n < 1) return [];
  const each = Math.floor((100 / n) * 1000) / 1000;
  const out = Array.from({ length: n }, () => each);
  out[n - 1] = pct(100 - each * (n - 1));
  return out;
}

/** What the shares add up to, to three decimals. */
export function shareTotal(percents: number[]): number {
  return pct(percents.reduce((s, p) => s + (Number.isFinite(p) ? p : 0), 0));
}

/**
 * Why the shares are not acceptable yet, naming the gap. Null when they are.
 *
 * The gap is named because "shares must total 100%" leaves the agent doing the
 * subtraction on a form that already knows the answer.
 */
export function shareSumError(percents: number[]): string | null {
  const total = shareTotal(percents);
  if (Math.abs(total - 100) <= 0.01) return null;
  const gap = pct(Math.abs(100 - total));
  return total < 100
    ? `The shares total ${total}%. Add ${gap}% more.`
    : `The shares total ${total}%. Take off ${gap}%.`;
}

/** The index of the first tenant whose email repeats one above them, or -1. */
export function duplicateEmailIndex(emails: string[]): number {
  const seen = new Set<string>();
  for (let i = 0; i < emails.length; i++) {
    const e = emails[i].trim().toLowerCase();
    if (!e) continue;
    if (seen.has(e)) return i;
    seen.add(e);
  }
  return -1;
}
