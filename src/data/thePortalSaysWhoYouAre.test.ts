/* WALK FIX 3. THE LOGO SAYS WHICH PORTAL YOU ARE IN, SO IT MUST BE RIGHT.
 *
 * Matt, walking dev: "The logo label reads 'SUPPLIER PORTAL' when signed in
 * as Opndoor admin. It should say 'Admin' for Opndoor staff."
 *
 * WHY IT SAID THAT. The label was a straight either/or -- agency, else
 * supplier -- and `isAgencyUser` is false for an Opndoor admin, so they fell
 * through to the other side of a two-way choice that never had a third
 * branch for the people who actually run the place.
 *
 * It is a small thing that reads badly: the one person who can see every
 * supplier in the product is told they are inside one.
 *
 * WHY THIS IS A FUNCTION rather than a ternary in the JSX. The same question
 * is asked of a reader in two different situations -- signed in as
 * themselves, and an admin using View as to look at a customer -- and the
 * answers differ. A ternary in the markup cannot be tested and had already
 * grown one comment longer than itself.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { ALL_PARTNERS } from './types';
import { hydratePartners } from './partnersService';
import { portalLabel } from './capabilities';

/* partyIsAgency asks the PARTNER's referencing mode, so the two parties have
   to exist for the question to mean anything: the house route every agency
   sits on is opndoor_referenced, a real supplier is not. */
beforeEach(() => {
  hydratePartners([
    { id: 'opndoor-agents', name: 'Opndoor Agents', referencingMode: 'opndoor_referenced' },
    { id: 'kestrel-lettings', name: 'Kestrel Lettings', referencingMode: 'pre_referenced_open' },
  ] as never[]);
});

describe('Opndoor staff', () => {
  it('are in the Admin portal, not a supplier of their own', () => {
    expect(portalLabel('superadmin', ALL_PARTNERS)).toBe('Admin');
  });

  it('and so is an opndoor manager', () => {
    expect(portalLabel('opndoor_manager', ALL_PARTNERS)).toBe('Admin');
  });

  /* VIEW AS. An admin looking at a customer is still an admin, and the logo
     is chrome rather than content: it says who YOU are, and the scope picker
     beside it already says who you are looking at. Changing the wordmark
     under View as would make an admin think they had signed in as somebody
     else. */
  it('and stay Admin while using View as to look at a customer', () => {
    expect(portalLabel('superadmin', 'kestrel-lettings')).toBe('Admin');
  });
});

describe('everybody else is unchanged', () => {
  it('an agency director is in the Agency portal', () => {
    expect(portalLabel('management', 'opndoor-agents')).toBe('Agency');
  });

  it('an agency negotiator likewise', () => {
    expect(portalLabel('referrer', 'opndoor-agents')).toBe('Agency');
  });

  /* THE ONE THE EXISTING SUITE ALREADY GUARDS: a supplier's own staff are
     told Supplier and never Partner. */
  it("and a supplier's own manager is in the Supplier portal", () => {
    expect(portalLabel('management', 'kestrel-lettings')).toBe('Supplier');
  });
});
