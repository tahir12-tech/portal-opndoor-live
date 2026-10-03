/* =====================================================================
   WHO MAY ADD AN AGENCY, AND WHERE THE CONTROL IS.

   Matt, 2026-10-03: "Supplier users who can refer (Management and Referrers)
   can add an agency or office for their own supplier while sending a referral
   ... Supplier Management can also add and edit agencies and offices from
   their Agencies page; show an 'Add agency' button there to match the page's
   own text ... Opndoor's own agencies are unchanged: their users can't add
   agencies or offices."

   THREE RULES IN ONE INSTRUCTION, and they are not the same rule:

     the ESTATE    a supplier's book takes additions from its own people;
                   ours does not, because `opndoor-agents` is ONE partner
                   shared by every agency we onboard, so adding there is
                   making a sibling and not adding to your own book.
     the AGENCIES  Management only. Housekeeping.
       PAGE
     WHILE         Management and Referrers both, which is wider, because the
       REFERRING   referral form is where a referrer meets a new office and
                   the alternative is an abandoned referral.

   WRITTEN AS THREE PREDICATES rather than one with flags, so that a screen
   asks the question it actually has. The server (20261007840000) admits both
   levels for both doors: a referrer reaching the RPC is not a breach, it is
   the referral path, so the Agencies page restriction is a SCREEN decision
   and is tested as one.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { ALL_PARTNERS } from '@/data';
import { mayAddOwnEstateAgency, mayAddWhileReferring, ownEstateTakesAdditions } from './capabilities';

/* THE MOCK SEED'S OWN PARTNERS, read off it rather than invented: northwind is
   kind 'agency', harbourside and meridian are kind 'supplier'. partyIsSupplier
   reads the partner's own kind, so a slug that is not in the store answers
   "not a supplier" and a test written on an invented slug would pass for the
   wrong reason. */
const SUPPLIER = 'harbourside';
const OTHER_SUPPLIER = 'meridian';
const AGENCY_PARTNER = 'northwind';
const HOUSE = 'opndoor-agents';
const DIRECT = 'opndoor-direct';

describe('whose estate takes additions from its own people', () => {
  it('a supplier’s does', () => {
    expect(ownEstateTakesAdditions(SUPPLIER)).toBe(true);
    expect(ownEstateTakesAdditions(OTHER_SUPPLIER)).toBe(true);
  });

  /* THE HALF THAT DID NOT CHANGE, and the reason the button on the Agencies
     page could not simply be opened up to management. */
  it('ours does not, on the house partner or an agency party', () => {
    expect(ownEstateTakesAdditions(HOUSE)).toBe(false);
    expect(ownEstateTakesAdditions(AGENCY_PARTNER)).toBe(false);
  });

  it('the direct rail is not a party with an estate', () => {
    expect(ownEstateTakesAdditions(DIRECT)).toBe(false);
  });

  // No estate has been chosen, so there is nothing to add to. An admin reaches
  // the button by being an admin, not by this.
  it('answers no for all partners', () => {
    expect(ownEstateTakesAdditions(ALL_PARTNERS)).toBe(false);
  });
});

describe('the Add agency button on the Agencies page', () => {
  it('is Management’s on a supplier’s own page', () => {
    expect(mayAddOwnEstateAgency('management', SUPPLIER)).toBe(true);
  });

  /* NOT A REFERRER'S. Matt names Management for this screen and gives the
     referrer the control on the referral form instead. */
  it('is not a referrer’s, or a developer’s', () => {
    expect(mayAddOwnEstateAgency('referrer', SUPPLIER)).toBe(false);
    expect(mayAddOwnEstateAgency('developer', SUPPLIER)).toBe(false);
  });

  /* THE REGRESSION THIS GUARDS. The button used to be `role === 'superadmin'`
     with the reason written on it: the RPC refused anyone else. Widening it to
     `role === 'management'` would have put it in front of every agency
     Director in the product, where SQL still refuses what it leads to. */
  it('is still nobody’s on our own estate', () => {
    expect(mayAddOwnEstateAgency('management', HOUSE)).toBe(false);
    expect(mayAddOwnEstateAgency('management', AGENCY_PARTNER)).toBe(false);
    expect(mayAddOwnEstateAgency('referrer', HOUSE)).toBe(false);
  });

  it('stays an admin’s everywhere', () => {
    expect(mayAddOwnEstateAgency('superadmin', ALL_PARTNERS)).toBe(true);
    expect(mayAddOwnEstateAgency('superadmin', HOUSE)).toBe(true);
    expect(mayAddOwnEstateAgency('superadmin', SUPPLIER)).toBe(true);
  });
});

describe('adding one while referring', () => {
  it('is for both levels that can refer', () => {
    expect(mayAddWhileReferring('management', SUPPLIER)).toBe(true);
    expect(mayAddWhileReferring('referrer', SUPPLIER)).toBe(true);
  });

  // A developer cannot send a referral, so there is nothing to add one for.
  it('is not for a developer', () => {
    expect(mayAddWhileReferring('developer', SUPPLIER)).toBe(false);
  });

  it('is not for one of our own agency’s people', () => {
    expect(mayAddWhileReferring('management', HOUSE)).toBe(false);
    expect(mayAddWhileReferring('referrer', HOUSE)).toBe(false);
    expect(mayAddWhileReferring('referrer', AGENCY_PARTNER)).toBe(false);
  });

  /* AN ADMIN ANSWERS FALSE ON PURPOSE, which is the one answer here that
     looks wrong and is not. The admin form has its own create-on-the-fly row
     with a partner picker in it: that is the admin product and Matt's
     instruction is about the supplier's own users. A true here would have
     replaced the admin's flow with a dialog that has no partner picker, so
     the referral would land under whatever scope was ambient. */
  it('is not for an admin, who keeps the type-ahead’s own create row', () => {
    expect(mayAddWhileReferring('superadmin', SUPPLIER)).toBe(false);
    expect(mayAddWhileReferring('superadmin', ALL_PARTNERS)).toBe(false);
  });
});
