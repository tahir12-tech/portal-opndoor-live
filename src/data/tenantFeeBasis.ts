/* =====================================================================
   WHAT A TENANT'S FEE IS MEASURED AGAINST, for tenant-facing screens.

   The same arithmetic as feeBasisWeeksOf/feeBasisPhrase in
   supabase/functions/_shared/emailTemplates.ts, deliberately duplicated rather
   than imported. That file runs on Deno and its layout module reaches for
   `Deno.env`, so importing it from client code drags a server runtime into the
   browser bundle: I tried, and the build typechecked the Deno file and failed on
   `Cannot find name 'Deno'`. Two runtimes, two copies, one arithmetic, and a
   test that pins them to the same answers (src/data/tenantFeeBasis.test.ts).

   AND NOT src/data/commissionSplit.ts's feeBasisOf, which is the third
   implementation and stays where it is: that one answers "how was this SET of
   applications priced" for agency-facing screens, over FullApp rows, and returns
   a mixed/none kind those screens need. This answers one tenant's own question
   about one fee.

   ALL THREE NAME THE ONE-MONTH BASIS IDENTICALLY: "one month's rent". That is by
   ruling and it is the phrase the rest of the codebase already used in some thirty
   places. For a while this helper and the email said "one month of rent", which
   meant a tenant could read one phrasing on their status screen and another in the
   email about the same referral, and a supplier's Stripe line item changed wording
   for no reason anybody asked for. Worth collapsing the three implementations one
   day; the wording is not what was ever in question.
   ===================================================================== */

/** One month is 52/12 weeks. */
const MONTH_WEEKS = 52 / 12;

/**
 * The fee in weeks of rent, or null when it cannot be worked out.
 *
 * `rentBase` must be the rent THIS fee was a proportion of: for one tenant of a
 * joint tenancy that is their own share, not the whole tenancy's. A share of the
 * fee divided by the whole rent reports every joint tenant as being on a
 * discount, which is the error this signature exists to make hard to write.
 */
export function tenantFeeBasisWeeks(
  fee: number | null | undefined,
  rentBase: number | null | undefined,
): number | null {
  const f = Number(fee ?? 0);
  const r = Number(rentBase ?? 0);
  if (!(f > 0) || !(r > 0)) return null;
  return (f * 52) / (r * 12);
}

/**
 * The basis in the reader's words, or null when unknown.
 *
 * Null rather than a guess: every surface that prints this used to fall back to
 * "one month's rent", which was true of every fee until negotiated bases landed
 * and is now a price nobody was charged. A step named and unpriced is honest; a
 * sentence stating the commonest answer is not.
 */
export function tenantFeeBasisPhrase(weeks: number | null | undefined): string | null {
  if (weeks == null || !(weeks > 0)) return null;
  if (Math.abs(weeks - MONTH_WEEKS) < 0.02) return "one month's rent";
  const whole = Math.abs(weeks - Math.round(weeks)) < 0.02;
  const n = whole ? String(Math.round(weeks)) : weeks.toFixed(2);
  return `${n} weeks of rent`;
}

/** Both steps at once, from an application's own fee and this tenant's own share
    of the rent. The shape every caller actually wants. */
export function tenantFeeBasis(
  fee: number | null | undefined,
  rentBase: number | null | undefined,
): string | null {
  return tenantFeeBasisPhrase(tenantFeeBasisWeeks(fee, rentBase));
}
