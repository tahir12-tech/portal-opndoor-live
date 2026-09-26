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
   about one fee. It also says "one month of rent" where that one says "one
   month's rent", matching the tenant emails, because a tenant reading their
   status screen and the email about the same referral should not find two
   phrasings. Worth unifying the three one day; not worth moving approved
   agency-facing copy to do it.
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
  if (Math.abs(weeks - MONTH_WEEKS) < 0.02) return 'one month of rent';
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
