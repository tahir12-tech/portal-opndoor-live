/* WHO REFERRED THIS TENANT, IN THE ORDER THE TENANT KNOWS THEM.
 *
 * Matt (bi): 'Tenant-facing pages and emails for supplier referrals: name
 * the letting agency first and the supplier as the route, e.g. "Test
 * Lettings asda has referred you, through Kestrel Lettings, for opndoor's
 * professional guarantor service". Agency referrals (no supplier) just name
 * the agency, as now.'
 *
 * =============================================================================
 * THE TENANT HAS NEVER HEARD OF THE SUPPLIER
 * =============================================================================
 *
 * They dealt with Test Lettings asda. Kestrel is plumbing. The payment page
 * said "You've been referred via Kestrel Lettings", which asks somebody to
 * recognise a company they have no relationship with, at the moment they are
 * being asked for a month's rent.
 *
 * AND THE SUPPLIER STILL HAS TO APPEAR, which is why this is not simply a
 * swap: the agency may not be able to answer a question about the guarantee,
 * and "through Kestrel Lettings" says what Kestrel is -- the route -- rather
 * than pretending they are not there.
 *
 * =============================================================================
 * WHY THIS EXISTS AS A FUNCTION AND NOT AS FOUR STRINGS
 * =============================================================================
 *
 * Matt named four surfaces: the payment page, the payment email, the receipt
 * and the signed-deed email. Each composes its own sentence today, which is
 * how the supplier and agency rails came to read differently in six separate
 * places over the last day. One phrase, built once.
 *
 * ITS TWIN LIVES IN supabase/functions/_shared/referralIntro.ts, because the
 * client and the Deno functions are separate module trees and neither can
 * import the other. That is a real duplication and the thing that keeps it
 * honest is a test that asserts the two produce identical output for the
 * same inputs -- not a comment asking the next person to remember.
 */

export interface ReferralParties {
  /** The letting agency the tenant actually dealt with. */
  agencyName?: string | null;
  /** The supplier whose route it came in on, where there is one. Null on an
      agency referral, which is most of the book. */
  supplierName?: string | null;
}

/**
 * "Test Lettings asda has referred you, through Kestrel Lettings," or
 * "Test Lettings asda has referred you," or null where we can name nobody.
 *
 * NULL RATHER THAN A HEDGE. A tenant on the direct rail referred themselves,
 * and an application whose agency we cannot resolve should say nothing about
 * who referred it rather than "your letting agent has referred you" to
 * somebody who has not got one. The caller falls back to its own wording.
 */
export function referredByPhrase(p: ReferralParties): string | null {
  const agency = (p.agencyName ?? '').trim();
  const supplier = (p.supplierName ?? '').trim();
  if (!agency) {
    /* NO AGENCY BUT A SUPPLIER is the shape a supplier's own referral takes
       before its agency is confirmed. Naming the supplier alone is right
       here: it is the only party we can name, and it IS who referred them. */
    return supplier ? `${supplier} has referred you` : null;
  }
  // The agency never equals the supplier in practice, but a supplier that
  // also runs its own branded agency would read "X has referred you, through
  // X", which is worse than saying it once.
  if (supplier && supplier.toLowerCase() !== agency.toLowerCase()) {
    return `${agency} has referred you, through ${supplier},`;
  }
  return `${agency} has referred you`;
}

/** The whole opening sentence, which is the phrase plus what it is for. */
export function referralIntro(p: ReferralParties & { propertyAddr?: string | null }): string | null {
  const who = referredByPhrase(p);
  if (!who) return null;
  const where = (p.propertyAddr ?? '').trim();
  return `${who} for opndoor's professional guarantor service${where ? `, for your tenancy at ${where}` : ''}.`;
}
