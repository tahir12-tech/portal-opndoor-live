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
import { effectivePrimary } from './orgService';
import type { Agency, Branch } from './types';

/** Can an executed deed for this branch reach somebody? Its own contact,
    or the agency's, which every branch inherits. */
export function branchCanReceiveDeed(agency: Agency, branch: Branch): boolean {
  return !!effectivePrimary(agency, branch).contact;
}

export type AgencyContactState =
  /** The agency holds one, and every branch inherits it. */
  | { kind: 'own' }
  /** No agency contact, and every branch has its own. Say nothing. */
  | { kind: 'per-branch' }
  /** No agency contact and some branch has none either: warn, and count. */
  | { kind: 'bare'; bare: number; branches: number }
  /** No contact and no branches underneath to cover it. */
  | { kind: 'none' };

/**
 * What an AGENCY row should say about deed contacts.
 *
 * The question is "would any deed under this agency have nowhere to go",
 * which is the union of the branches, not the agency node on its own.
 */
export function agencyContactState(agency: Agency): AgencyContactState {
  if (effectivePrimary(agency, null).contact) return { kind: 'own' };
  const branches = agency.branches ?? [];
  if (branches.length === 0) return { kind: 'none' };
  const bare = branches.filter((b) => !branchCanReceiveDeed(agency, b));
  if (bare.length === 0) return { kind: 'per-branch' };
  return { kind: 'bare', bare: bare.length, branches: branches.length };
}

/**
 * Every branch across these agencies with nowhere to send a deed.
 *
 * The page-level warning and the row-level one are the same question asked
 * of different scopes, so they are the same function: a banner that counts
 * branches the rows below do not mark is the fault this file is about.
 */
export function branchesWithNoDeedContact(
  agencies: Agency[],
): { agency: string; branch: string }[] {
  return agencies.flatMap((a) => (a.branches ?? [])
    .filter((b) => !branchCanReceiveDeed(a, b))
    .map((b) => ({ agency: a.name, branch: b.name })));
}
