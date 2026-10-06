/* THE LEVEL ABOVE A REFERRER IS NAMED IN THEIR OWN ESTATE'S WORDS.
 *
 * Matt, 2026-10-04 (ss): 'Referrer Reporting note: for supplier referrers say
 * "You are viewing your own referrals only. Management sees all of
 * [supplier]'s referrals." (Directors and Managers is agency wording.)'
 *
 * THE FOURTH SITE TODAY with the same cause: the Commission tab, the FAQs and
 * the notifications dialog all had the agency ladder in supplier copy before
 * this one. The ladders are different SHAPES, not different words for one
 * shape -- an agency has two levels above a Negotiator and a supplier has one
 * -- so a find-and-replace was never going to be the fix, and four separately
 * corrected strings would have been a fifth waiting to happen.
 */
import { describe, it, expect } from 'vitest';
import { whoSeesEverything } from './capabilities';
import { ALL_PARTNERS } from './types';

describe('whoSeesEverything', () => {
  it('names both agency levels, because an agency reader knows which is which', () => {
    expect(whoSeesEverything('opndoor-agents')).toBe('Directors and Managers see the whole agency');
  });

  /* OPNDOOR'S OWN READER IS NOT ON A SUPPLIER LADDER. ALL_PARTNERS is the
     whole-estate scope and partyIsSupplier answers false for it, so the
     sentence must not invent a supplier's management for an admin. */
  it('does not put a supplier ladder in front of an opndoor reader', () => {
    expect(whoSeesEverything(ALL_PARTNERS)).toBe('Directors and Managers see the whole agency');
  });

  /* THE SUPPLIER IS NAMED, and that is the point rather than a flourish:
     "Management" alone is ambiguous to somebody who also deals with opndoor.
     It is Kestrel's management, not ours. */
  it('names the supplier, so Management cannot be read as opndoor', () => {
    // A supplier from the mock book, so the test does not depend on dev.
    const s = whoSeesEverything('harbourside');
    expect(s).toContain('Management sees all of');
    expect(s).not.toContain('Director');
    expect(s).not.toContain('agency');
  });

  /* AN UNRESOLVED PARTNER GETS THE AGENCY SENTENCE, and that follows from
     partyIsSupplier rather than being chosen here: it answers false for a
     partner it cannot resolve, deliberately ("unknown reads as unknown"),
     because the alternative made every unhydrated row a supplier. The agency
     ladder is also the overwhelming majority of readers, so an unresolved
     scope lands on the likelier of the two rather than on nothing. */
  it('falls back to the agency sentence for a partner it cannot resolve', () => {
    expect(whoSeesEverything('not-a-real-partner-slug'))
      .toBe('Directors and Managers see the whole agency');
  });
});
