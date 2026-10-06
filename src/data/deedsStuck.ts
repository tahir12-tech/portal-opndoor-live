/* =====================================================================
   WHICH ORGS ACTUALLY HAVE A DEED WITH NOWHERE TO GO.

   Matt, 2026-10-03, verbatim: "Agencies list and agency page: for Opndoor's
   own agencies with no users, replace 'No one at this agency can receive the
   deed. Invite a manager or nominate a recipient.' with a neutral 'No users
   yet. Invite someone to start referring.' Only warn about deed delivery when
   there's an application at that agency whose deed has nowhere to go."

   THE WARNING WAS ABOUT A CAPABILITY, NOT A PROBLEM. `org_deed_readiness`
   answers "could a deed reach somebody here", and an agency onboarded this
   morning answers no for the most ordinary reason there is: nobody has been
   invited yet. So every new agency arrived wearing an alert icon about a
   document that does not exist, on a rail where the first referral is still
   days away -- and the one line an admin needed ("invite somebody") was the
   second half of a sentence about deeds.

   SO THE WARNING NEEDS A SECOND FACT, which is this file: is there an
   application at this org whose executed deed could not be sent. That is
   `cannot_deliver` and only that. 'failed' is NOT included: a failure means
   the deed had somewhere to go and the address bounced, which is a different
   problem with a different fix (Resend), and it is already badged on the
   application itself.

   BOTH GRAINS, because both surfaces draw the warning: the Agencies list
   renders a line per agency AND per branch, and the agency page does the
   same. An application is stuck at one branch and therefore at one agency, so
   it counts in both sets.
   ===================================================================== */
import { allFull } from './applicationsService';
import { deliveryStateOf } from './deliveryState';

export interface StuckDeeds {
  /** Agency ids with at least one executed deed that could not be sent. */
  agencies: Set<string>;
  /** Branch ids, same question one level down. */
  branches: Set<string>;
}

/**
 * The orgs holding a deed that has nowhere to go.
 *
 * READ OFF THE HYDRATED BOOK, which is already scoped by RLS to what this
 * reader may see. That is the right scope and not a limitation: an agency
 * whose stuck deed is invisible to the reader is not something to warn that
 * reader about.
 *
 * EMPTY IN MOCK MODE, where `allFull()` is empty, and that reads correctly:
 * no stuck deeds, so no deed warning, so the neutral line. The demo estate
 * has never been the thing these warnings are about.
 */
export function deedsWithNowhereToGo(): StuckDeeds {
  const agencies = new Set<string>();
  const branches = new Set<string>();
  for (const app of allFull()) {
    if (deliveryStateOf(app) !== 'cannot_deliver') continue;
    if (app.agencyId) agencies.add(String(app.agencyId));
    if (app.branchId) branches.add(String(app.branchId));
  }
  return { agencies, branches };
}

/** The neutral line for an org that simply has nobody yet. Matt's words. */
export const NO_USERS_YET = 'No users yet. Invite someone to start referring.';
