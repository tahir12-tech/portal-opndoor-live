/* =====================================================================
   WOULD A DEED UNDER THIS AGENCY HAVE NOWHERE TO GO?

   Matt, 2026-10-01, twice. First about the supplier Overview: "don't show
   'No agent contact' on an agency when its branches have contacts; only
   warn where a branch would actually have nowhere to send the deed."
   Then about the supplier user's Agencies page: "Apply the same rule as
   the admin supplier Overview everywhere this warning appears: only warn
   on a branch that genuinely has nowhere to send the deed, on that
   branch."

   The second message is the first one again, which is why this file
   exists. The Overview was fixed in place and the Agencies page kept its
   own copy, so the same question had two answers:

     the Overview   asks the union of the branches
     the Agencies   asked the agency NODE, so an agency that keeps its
       page         contacts on its branches -- the normal arrangement,
                    and the one inheritance exists to support -- cried
                    "No agent contact. A deed cannot be issued" with a
                    working email printed under every branch

   Measured on dev, which is what Matt was looking at: Kestrel Lettings
   holds no contact of its own and both of its branches hold one, so the
   agency row warned and neither branch did.

   A warning that is wrong whenever the data is organised the usual way
   is a warning people learn to scroll past, which costs the ones that
   are real.
   ===================================================================== */
/* =====================================================================
   AND THEN THE QUESTION CHANGED, 2026-10-02.

   Matt corrected the rule the warning was built on:

     "Supplier side (agencies in a supplier's estate): an agency email is
      required at creation and is the default for all its branches; a
      branch's own email, if set, overrides it for that branch. Signed
      deeds go there.
      Opndoor's own agencies (like Regent): no email required. Signed
      deeds go to whoever sent the referral (plus the people already
      ticked to receive them, as now) ... For supplier-estate agencies
      with no agency email, show a clear warning on the supplier's
      Agencies tab and list them on Reconciliation so Opndoor can add
      one. No warnings for Opndoor's own agencies without an email."

   So there are now TWO questions where there was one, and the old one is
   no longer the one to put on a screen:

     "could a deed reach anybody"      still true, still asked by
                                       `branchCanReceiveDeed`, and now
                                       only part of the answer
     "has this agency got a DEFAULT"   the one that earns a warning, and
                                       only in a supplier's estate

   WHY IT IS THE AGENCY ADDRESS AND NOT THE UNION OF THE BRANCHES. Under
   the corrected rule the agency email is what every branch inherits, so
   an agency without one has no default, and the next office added under
   it inherits nothing. Kestrel Lettings on dev is exactly that: no
   agency contact, a mailbox on each of its two branches. It is reported
   now, where the older rule deliberately said nothing about it -- not
   because that rule was wrong, but because the subject moved from "is
   anything stranded today" to "is the default missing".

   AND NOTHING AT ALL FOR OUR OWN ESTATE. A deed there goes to the
   referrer and the ticked people; a mailbox is an addition, and "leave
   it blank and nothing is missing" is the instruction. Warning about it
   would be warning about a field nobody has to fill in.
   ===================================================================== */
import { effectivePrimary } from './orgService';
import { partyIsSupplier } from './capabilities';
import type { Agency, Branch } from './types';

/** Can an executed deed for this branch reach somebody? Its own contact,
    or the agency's, which every branch inherits. */
export function branchCanReceiveDeed(agency: Agency, branch: Branch): boolean {
  return !!effectivePrimary(agency, branch).contact;
}

export type AgencyContactState =
  /** Nothing to say. Our own estate always, and a supplier's agency that
      has its agency-level address. */
  | { kind: 'quiet' }
  /** The agency holds one, and every branch inherits it. */
  | { kind: 'own' }
  /** A supplier's agency with no agency-level address. `bare` counts the
      branches that have nothing of their own either, which is the sharp
      end of it and may be zero. */
  | { kind: 'needs-email'; bare: number; branches: number };

/**
 * What an AGENCY row should say about deed contacts.
 *
 * ASKS THE ESTATE FIRST, because since 2026-10-02 the answer for our own
 * agencies is "nothing": a deed there goes to the referrer and the ticked
 * people, and an address is an optional extra.
 */
export function agencyContactState(agency: Agency): AgencyContactState {
  if (!partyIsSupplier(agency.partner ?? '')) return { kind: 'quiet' };
  if (effectivePrimary(agency, null).contact) return { kind: 'own' };
  const branches = agency.branches ?? [];
  const bare = branches.filter((b) => !branchCanReceiveDeed(agency, b));
  return { kind: 'needs-email', bare: bare.length, branches: branches.length };
}

/**
 * Does this agency need an agency-level email that it has not got?
 *
 * The warning's own predicate, separate from the state above so the page
 * banner and the row cannot disagree about who is counted.
 */
export function agencyNeedsEmail(agency: Agency): boolean {
  return agencyContactState(agency).kind === 'needs-email';
}

/** Every agency across these that needs an agency-level email.
 *
 * PLACEHOLDERS EXCLUDED, to match `supplier_agencies_without_an_email`,
 * which the Reconciliation tab reads. The house rails each carry an
 * "Unattached" agency so an application's NOT NULL agency_id resolves,
 * and none of them is a supplier estate today -- but the two counts have
 * to be able to disagree only when the data does, not when a future house
 * route is added under a partner that is. */
export function agenciesNeedingAnEmail(agencies: Agency[]): Agency[] {
  return agencies.filter((a) => !a.isPlaceholder && agencyNeedsEmail(a));
}

/**
 * Every branch across these agencies with nowhere to send a deed.
 *
 * The page-level warning and the row-level one are the same question asked
 * of different scopes, so they are the same function: a banner that counts
 * branches the rows below do not mark is the fault this file is about.
 *
 * STILL THE OLD QUESTION, and still the right one for a BRANCH: a branch
 * in a supplier's estate with neither its own address nor the agency's is
 * genuinely stranded. Callers pass the supplier estates only; on ours
 * there is nothing to strand.
 */
export function branchesWithNoDeedContact(
  agencies: Agency[],
): { agency: string; branch: string }[] {
  return agencies.flatMap((a) => (a.branches ?? [])
    .filter((b) => !branchCanReceiveDeed(a, b))
    .map((b) => ({ agency: a.name, branch: b.name })));
}
