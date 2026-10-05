/* =====================================================================
   WHO A CUSTOMER IS TOLD SENT A REFERRAL.

   Matt (cq), 2026-10-04: "Referrals an Opndoor admin made on a
   customer's behalf still show the admin's name ('Nicholas Dwyer') in
   that customer's referrer lists, charts and exports; show 'opndoor
   (on your behalf)' in every customer view."

   HIS WORDING, NOT A VARIATION OF IT, and in one place because the
   same label has to appear on a list, a chart, three exports and the
   application page. (bm) is the cautionary tale: the same sweep done
   surface by surface, with the ones it could not see left behind.

   LOWERCASE "opndoor", as everywhere else in this product's copy.

   THE MASK IS APPLIED AT HYDRATE, where the name is made, not here:
   see src/lib/hydrate.ts. This module is the word.
   ===================================================================== */

/** What a customer sees in place of the member of opndoor staff who sent it. */
export const OPNDOOR_ON_YOUR_BEHALF = 'opndoor (on your behalf)';

/** Is this the label rather than a person? Lists that group or sort by
    referrer ask, so the one synthetic entry can be treated as such. */
export function isOpndoorOnYourBehalf(name: string | null | undefined): boolean {
  return name === OPNDOOR_ON_YOUR_BEHALF;
}
