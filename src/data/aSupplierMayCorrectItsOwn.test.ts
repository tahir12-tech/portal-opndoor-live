/* WHO MAY CORRECT AN AGENCY'S OWN DETAILS, ON THE SCREEN.
 *
 * Matt: "Supplier Management (not Referrers) can edit their own agencies'
 * and offices' name, address and email, from the agency's Overview ...
 * Opndoor admins can edit them too."
 *
 * THERE WAS NO WAY TO EDIT ANY OF THE THREE. Every set_agency_* function on
 * dev changed a SETTING -- group, level, rates, referencing mode, share
 * deal -- and an agency created with a typo stayed that way. Most of them
 * are created by a Referrer filling in a referral form, which is where
 * typos come from.
 *
 * THE SERVER AND THE SCREEN AGREE RATHER THAN ONE COVERING FOR THE OTHER:
 * set_agency_details refuses a Referrer too, and the pgTAP file asserts
 * that. This is the button.
 */
import { describe, it, expect } from 'vitest';
import { mayEditOwnEstateOrg } from './capabilities';
import { ALL_PARTNERS } from './types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('who gets the Edit button', () => {
  it("a supplier's Management, on their own estate", () => {
    expect(mayEditOwnEstateOrg('management', 'harbourside')).toBe(true);
  });

  /* THE CLAUSE THAT NEEDS SAYING. A Referrer adds most of these agencies
     from the referral form; creating one is not the right to rename it. */
  it('and not a Referrer, who is usually the one who added it', () => {
    expect(mayEditOwnEstateOrg('referrer', 'harbourside')).toBe(false);
  });

  it('nor a Developer', () => {
    expect(mayEditOwnEstateOrg('developer', 'harbourside')).toBe(false);
  });

  it('an opndoor admin, anywhere', () => {
    expect(mayEditOwnEstateOrg('superadmin', ALL_PARTNERS)).toBe(true);
    expect(mayEditOwnEstateOrg('superadmin', 'harbourside')).toBe(true);
  });

  /* NOT ON OUR OWN ESTATE, for the reason admin_add_agency refuses a
     Manager there: the house partner is shared, so "their own agencies"
     would be every agency Opndoor has onboarded and a Manager renaming one
     would be renaming a stranger's. */
  it('but a Manager on our own rail may not, because the estate is shared', () => {
    expect(mayEditOwnEstateOrg('management', 'opndoor-agents')).toBe(false);
  });
});

describe('the dialog', () => {
  const SRC = readFileSync(resolve(process.cwd(), 'src/pages/Agencies/EditOrgDetails.tsx'), 'utf8');

  it('edits the three fields Matt named, through both RPCs', () => {
    /* ONE DIALOG FOR BOTH LEVELS, because the three fields and the three
       rules are the same; what differs is which RPC answers and what a
       cleared email means. Two dialogs would be two places for the
       confirmation wording to drift. */
    expect(SRC).toContain('setAgencyDetails(target.id, name, address, email)');
    expect(SRC).toContain('setBranchDetails(target.id, name, address, email)');
  });

  /* THE CONFIRMATION IS FOR THE EMAIL ALONE, because it is the only one of
     the three that changes where a legal document goes. */
  it('confirms an email change, naming where deeds will go', () => {
    expect(SRC).toContain('if (emailChanged && !confirming)');
    expect(SRC).toContain('will go to ${email.trim()} from now on');
  });

  it('and says what clearing an office email means, rather than just doing it', () => {
    expect(SRC).toContain("will go to the agency's address instead");
  });

  /* THE DUPLICATE CHECK IS THE SERVER'S. A client copy would be a third
     opinion on a question the database settles, and it would have to know
     that an agency name is unique within a PARTNER and an office name
     within its AGENCY. */
  it('leaves the duplicate check to the server and shows its words', () => {
    expect(SRC).not.toContain('already exists');
    expect(SRC).toContain('e instanceof Error ? e.message');
  });
});
