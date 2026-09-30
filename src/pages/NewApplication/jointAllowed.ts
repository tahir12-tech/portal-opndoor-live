/* MAY THIS REFERRAL COVER MORE THAN ONE TENANT?
 *
 * Walk fix 26. One function because the answer is needed in TWO places that
 * must never disagree: the "Add another tenant" button, and the effect that
 * DROPS tenants already typed when the origin turns out not to be able to
 * carry them.
 *
 * THEY DISAGREED, AND THAT IS WHY THIS EXISTS. Before the fix both read
 * `estate`, which is false for a supplier, and they were consistent.
 * Opening the supplier route by changing only the button would have left
 * the effect still saying no -- so the moment the rail probe settled it
 * would have silently wiped the tenants an admin had just added, on the one
 * path the fix exists to open. Two predicates for one question is how that
 * happens; one predicate is how it cannot.
 *
 * WHAT IT DECIDES, and the two halves are different questions:
 *
 *   supplier   Settled the moment the admin names the supplier. Nothing to
 *              wait for: they have just told us the route. Batch 16
 *              reverses Q-06 item H's "single tenant (no Add another
 *              tenant)" here.
 *   otherwise  Depends on the BRANCH, so it waits for the estate probe.
 *              An agency a supplier introduced is the case where the route
 *              and the branch can disagree, which is why this cannot be
 *              answered from the route alone.
 *
 * THE DIRECT RAIL NEVER REACHES THIS. It has no staff referrer and no
 * Referred by choice; the server refuses it outright (20261006970000).
 */
export interface JointInputs {
  /** The admin's Referred by answer. Empty for a non-admin's form. */
  referredBy: '' | 'supplier' | 'agency';
  /** The supplier chosen, where one was. */
  routeSupplier: string;
  /** Has the estate probe answered about the chosen branch? */
  railState: 'none' | 'loading' | 'ready';
  /** Is that branch one of our own agencies? */
  estate: boolean;
}

export function mayAddAnotherTenant(i: JointInputs): boolean {
  if (i.referredBy === 'supplier') return !!i.routeSupplier;
  return i.railState === 'ready' && i.estate;
}
