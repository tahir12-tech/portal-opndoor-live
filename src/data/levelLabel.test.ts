/* THE LEVEL NAMES ARE A FACT ABOUT THE RAIL, NOT ABOUT THE ROLE.
 *
 * Q-06 item G. The trap it walks into: /users lists supplier-rail people
 * beside estate people, and the two existing copies of the label expression
 * (Team.tsx, AgencyHome.tsx) are correct only because those screens list the
 * estate alone. Copying the expression to /users would call a supplier's
 * manager a Director, which is a level that does not exist on that rail --
 * decision D11 says the supplier rail has no Director/Manager split at all.
 */
import { describe, expect, it } from 'vitest';
import { personLevelLabel, holdsAgencyLevel } from './levelLabel';

const HOUSE = 'opndoor-agents';
const SUPPLIER = 'harbourside';

describe('somebody on the agency estate', () => {
  it('is a Director when they may see commission', () => {
    expect(personLevelLabel({ role: 'management', seesCommission: true, partner: HOUSE })).toBe('Director');
  });
  it('a Manager when they may not', () => {
    expect(personLevelLabel({ role: 'management', seesCommission: false, partner: HOUSE })).toBe('Manager');
  });
  it('and a Negotiator when they refer', () => {
    expect(personLevelLabel({ role: 'referrer', seesCommission: false, partner: HOUSE })).toBe('Negotiator');
  });
  it('and holds a level, which is what makes Change level the right control', () => {
    expect(holdsAgencyLevel({ role: 'management', partner: HOUSE })).toBe(true);
  });
});

describe('somebody on the supplier rail', () => {
  /* THE ASSERTION THIS FILE EXISTS FOR. Same role, same commission bit, a
     different rail, and therefore a different word. */
  it('is never called a Director, because that level does not exist there', () => {
    expect(personLevelLabel({ role: 'management', seesCommission: true, partner: SUPPLIER })).toBe('Management');
  });
  it('nor a Manager, for the same reason', () => {
    expect(personLevelLabel({ role: 'management', seesCommission: false, partner: SUPPLIER })).toBe('Management');
  });
  it('nor a Negotiator', () => {
    expect(personLevelLabel({ role: 'referrer', seesCommission: false, partner: SUPPLIER })).toBe('Referrer');
  });
  it('and holds no level, so the screen must not offer to change one', () => {
    expect(holdsAgencyLevel({ role: 'management', partner: SUPPLIER })).toBe(false);
  });
});

describe("opndoor's own people", () => {
  it('keep their own names, because they hold no agency level', () => {
    expect(personLevelLabel({ role: 'superadmin', partner: null })).toBe('opndoor admin');
    expect(personLevelLabel({ role: 'opndoor_manager', partner: null })).toBe('opndoor manager');
  });
  it('and a developer is a developer on either rail', () => {
    expect(personLevelLabel({ role: 'developer', partner: SUPPLIER })).toBe('Developer');
    expect(personLevelLabel({ role: 'developer', partner: HOUSE })).toBe('Developer');
  });
});
