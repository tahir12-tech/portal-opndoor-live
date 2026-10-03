/* =====================================================================
   THE SENTENCE ON THE AGENCY PAGE.

   Matt, 2026-10-03: "the agency page should say 'N open referrals from people
   who have left; deeds will go to [who]'."

   THE WORDS ARE THE DELIVERABLE HERE, which is why they are tested apart from
   the page: the ladder that decides WHO is SQL and is proved in
   a_departed_referrers_referral_still_has_somebody.test.sql; what is left is
   whether the line reads as English for one, for two, for several, and for the
   case Matt's sentence cannot express -- nobody left at all.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { departedReferralsLine } from './positionsService';

describe('the departed-referrer line', () => {
  it('agrees its plural on one', () => {
    expect(departedReferralsLine({ count: 1, goesTo: ['Rosa Vance'] }))
      .toBe('1 open referral from people who have left; deeds will go to Rosa Vance.');
  });

  it('and on more than one', () => {
    expect(departedReferralsLine({ count: 4, goesTo: ['Rosa Vance'] }))
      .toBe('4 open referrals from people who have left; deeds will go to Rosa Vance.');
  });

  /* "and" BEFORE THE LAST, not a trailing comma. Three Directors is Regent's
     real shape on dev (Joe Joe, Rosa Vance, Wayne Kelly), so this is the
     sentence the page will actually print. */
  it('joins several names with an and', () => {
    expect(departedReferralsLine({ count: 2, goesTo: ['Joe Joe', 'Rosa Vance', 'Wayne Kelly'] }))
      .toBe('2 open referrals from people who have left; deeds will go to Joe Joe, Rosa Vance and Wayne Kelly.');
  });

  it('and two with an and alone', () => {
    expect(departedReferralsLine({ count: 1, goesTo: ['Joe Joe', 'Rosa Vance'] }))
      .toBe('1 open referral from people who have left; deeds will go to Joe Joe and Rosa Vance.');
  });

  /* THE CASE MATT'S SENTENCE CANNOT SAY. Every rung of the ladder can be
     empty at once -- an agency whose referrer AND whose management have all
     left -- and the template would then trail off after "go to". It is also
     the one state here that is a problem rather than a reassurance, so it
     says what to do about it. */
  it('names the problem when there is nobody left to send to', () => {
    expect(departedReferralsLine({ count: 3, goesTo: [] }))
      .toBe('3 open referrals from people who have left. There is nobody left at this agency to send the deeds to. Tell opndoor.');
  });

  // No em dash anywhere in it, which noEmDashesInCustomerText checks across
  // the product; asserted here too because this string is assembled rather
  // than written out, so a scan of the source would not see the result.
  it('contains no em dash', () => {
    const every = [
      departedReferralsLine({ count: 1, goesTo: ['A'] }),
      departedReferralsLine({ count: 2, goesTo: ['A', 'B'] }),
      departedReferralsLine({ count: 2, goesTo: [] }),
    ].join(' ');
    expect(every).not.toMatch(/—|–/);
  });
});
