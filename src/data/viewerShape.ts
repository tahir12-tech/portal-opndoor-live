/* =====================================================================
   WHAT DOES THIS VIEWER HAVE MORE THAN ONE OF?

   Four separate walk findings turned out to be one rule:

     Reporting     "Volume by agency" over one agency is a single bar under a
                   header already naming it, and "Volume by branch" over one
                   branch is the same chart again.
     League        the Agencies and Branches boards rank a population of one.
     Applications  an Agency column, a Branch column and a Route filter that
                   every row answers identically.
     Team          an "Across the agency" section and a branch card, where the
                   agency IS the branch and both hold the same three people.
     New referral  a "Your office" section asking which of one office.

   Every one of them is the portal showing an ESTATE to somebody who has a
   SHOP. The dimension is real for Opndoor looking across a book and empty for
   the customer inside it, and a control that offers one choice is not a choice,
   it is a thing to read past.

   So the question is asked once, here, and answered from the same scoped book
   every figure on those screens is computed from. Counted over the WHOLE book
   rather than the selected period, so a quiet month never makes a column
   appear and disappear; and over the book rather than the org tables, because
   the book is what the screens actually render and cannot disagree with.

   IT IS NOT A PERMISSION. Nothing here decides what a user may see — RLS does
   that, and has already narrowed the book before this counts it. This decides
   only whether saying it twice is worth the room.
   ===================================================================== */
import type { PartnerScope, Role } from './types';
import { ALL_PARTNERS } from './types';
import { allFull } from './applicationsService';
import { scopeFull } from './paymentMetrics';
import { getPartner } from './partnersService';

export interface ViewerShape {
  /** Distinct agencies anywhere in the viewer's book. */
  agencies: number;
  /** Distinct branches anywhere in the viewer's book. */
  branches: number;
  /** Distinct referrers. People are the one dimension a shop still has several
      of, which is why the Referrer column and board survive everywhere. */
  referrers: number;
  /** Distinct route partners. One means the Route column says the same word on
      every row; an agency user is always one. */
  routes: number;
  /** True when the viewer is inside a single agency: the estate columns go. */
  oneAgency: boolean;
  oneBranch: boolean;
  oneRoute: boolean;
}

/**
 * Measure the viewer's book.
 *
 * An EMPTY book answers one of everything, deliberately. A brand-new agency has
 * nothing to count, and the honest reading of "you have no second branch" is
 * the same as "you have one": do not offer the choice. The alternative — an
 * empty book answering zero and so failing every `> 1` test — happens to give
 * the same answer, but by accident rather than on purpose, and would flip the
 * moment somebody wrote `!== 1`.
 */
export function viewerShape(role: Role, scope: PartnerScope): ViewerShape {
  const set = scopeFull(allFull(), role, scope);
  const agencies = new Set<string>();
  const branches = new Set<string>();
  const referrers = new Set<string>();
  const routes = new Set<string>();
  for (const app of set) {
    if (app.agency) agencies.add(app.agencyId || app.agency);
    if (app.branch) branches.add(app.branchId || `${app.agency}/${app.branch}`);
    if (app.referrer) referrers.add(app.referrer);
    if (app.partner) routes.add(app.partner);
  }
  return {
    agencies: agencies.size,
    branches: branches.size,
    referrers: referrers.size,
    routes: routes.size,
    oneAgency: agencies.size <= 1,
    oneBranch: branches.size <= 1,
    // An admin on "all partners" is looking across rails whatever this month's
    // book happens to contain, so the Route column stays for them regardless.
    oneRoute: scope !== ALL_PARTNERS && routes.size <= 1,
  };
}

/**
 * Is this viewer a CUSTOMER of ours looking at their own shop, rather than
 * Opndoor or a supplier looking across a book?
 *
 * Distinct from isAgencyUser in capabilities.ts, which asks what KIND of party
 * they belong to in order to decide which screens exist. This asks how much of
 * one they can see, in order to decide how much of a screen to draw. Regent's
 * manager is both; an Opndoor admin filtered to one agency is only the second,
 * and gets the same collapsed columns, because the screen is answering the same
 * question either way.
 */
export function insideOneAgency(role: Role, scope: PartnerScope): boolean {
  if (role === 'superadmin' && scope === ALL_PARTNERS) return false;
  return viewerShape(role, scope).oneAgency;
}

/** The route partner in scope, for a viewer who has exactly one. Null for an
    admin across partners. Never used to NAME the partner: house routes must not
    surface (see channel.ts), only to ask questions about the rail. */
export function soleRoute(scope: PartnerScope): string | null {
  if (scope === ALL_PARTNERS) return null;
  return getPartner(scope)?.id ?? null;
}
