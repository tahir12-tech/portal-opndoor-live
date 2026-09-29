/* =====================================================================
   WHAT TO CALL A PERSON, ON ANY SCREEN, ON EITHER RAIL.

   Q-06 item G is "three agency levels ... Same three names on admin screens".
   The three names already exist (AGENCY_LEVELS in types.ts) and Team and the
   agency People tab already use them. The admin /users screen does not: it
   still shows the internal role words, Management and Referrer, which nobody
   at an agency holds.

   THE TRAP THIS EXISTS TO AVOID, and it is the reason this is a module rather
   than a third copy of one line. The two existing copies are

     Team.tsx:91        agencyLevelOf(u.role, u.seesCommission) ?? 'Developer'
     AgencyHome.tsx     the same expression again

   and both are correct BECAUSE those two screens only ever list people on the
   agency estate. /users does not: it lists supplier-rail people beside estate
   people, with scope ALL_PARTNERS. Copying that expression onto /users would
   call a supplier's manager a "Director" -- a level that does not exist on
   that rail, describing a capability they do not have. Decision D11 is
   explicit that the supplier rail has no Director/Manager split.

   So the rule is not "role plus commission bit". It is "which rail is this
   person on, and then what do we call them there".
   ===================================================================== */
import { isHousePartner } from './channel';
import { agencyLevelOf, type Role } from './types';

export interface LabelledPerson {
  role: Role;
  seesCommission?: boolean;
  /** The partner slug. On the agency estate this is the house partner, which
      is why it is the rail test and not a company test. */
  partner?: string | null;
}

/** The pill class for a level, so the colour follows the word. */
export const LEVEL_PILL: Record<string, string> = {
  Director: 'role-tag--dir',
  Manager: 'role-tag--mgr',
  Negotiator: 'role-tag--ref',
  Developer: 'role-tag--dev',
};

/**
 * What this person is called, in the words the reader's own screens use.
 *
 * Four arms, in this order and for this reason:
 *
 *   1. Opndoor's own staff hold no agency level at all, and agencyLevelOf
 *      answers null for them. They keep their own names.
 *   2. A developer is integration staff at a supplier; the level ladder does
 *      not describe them.
 *   3. ON THE AGENCY ESTATE, the three level names.
 *   4. ON THE SUPPLIER RAIL, the role's own word. There is no Director here
 *      to distinguish a Manager from (D11), so calling a supplier's
 *      management "Director" would name a distinction that does not exist.
 */
export function personLevelLabel(u: LabelledPerson): string {
  if (u.role === 'superadmin') return 'opndoor admin';
  if (u.role === 'opndoor_manager') return 'opndoor manager';
  if (u.role === 'developer') return 'Developer';
  if (isHousePartner(u.partner ?? '')) {
    return agencyLevelOf(u.role, u.seesCommission === true) ?? 'Developer';
  }
  return u.role === 'management' ? 'Management' : 'Referrer';
}

/** Is this person on the agency estate, and therefore described by a level? */
export function holdsAgencyLevel(u: LabelledPerson): boolean {
  return isHousePartner(u.partner ?? '')
    && (u.role === 'management' || u.role === 'referrer');
}
