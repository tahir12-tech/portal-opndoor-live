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

/* =====================================================================
   WHAT A ROW CARRIES SO THE ANSWER CAN CHANGE WITHOUT RE-HYDRATING.

   Matt, 2026-10-05: "View as: yes, mask it. View as shows exactly what
   the customer sees, including 'opndoor (on your behalf)'."

   THE MASK IS APPLIED ONCE, AT HYDRATE, and View as neither re-hydrates
   nor changes the role -- it changes the SCOPE. So a row has to keep
   both answers: who actually sent it, and whether that person is one of
   ours. Then the displayed `referrer` can be recomputed the moment the
   reader starts or stops looking through a customer's eyes.

   THE SAME SHAPE SessionContext ALREADY USES for commission
   visibility: module state the View-as effect swaps, with a cleanup
   that puts it back. The alternative is asking the question again at
   each of the eight surfaces that print a referrer, which is what (cq)
   exists to avoid. */
export interface ReferrerFacts {
  /** The person, always: the snapshot on the application or their name. */
  referrerReal?: string | null;
  /** True when that person is opndoor's own staff. */
  referrerIsOpndoor?: boolean;
}

/** What a reader should be shown, given whether they read as a customer. */
export function referrerShownTo(r: ReferrerFacts, asCustomer: boolean): string | null {
  return asCustomer && r.referrerIsOpndoor === true
    ? OPNDOOR_ON_YOUR_BEHALF
    : (r.referrerReal ?? null);
}
