/* ROUND 6, THE LAST OF THE EIGHT LOWS. SIGNING OUT LEFT THE BOOK BEHIND.
 *
 * Recorded as: "localStorage working copies survive sign-out."
 *
 * WHAT IS ACTUALLY LEFT, and it is not an abstraction. `grp_org_v3` is the
 * whole agencies-and-branches working copy INCLUDING agent contacts --
 * names, email addresses and phone numbers of people at every agency the
 * signed-out user could reach. `grp_partners_v2` carries every partner's
 * commission rates. Both sat in localStorage after sign-out, on whatever
 * machine that was, readable by the next person to open the browser
 * console and by the next user of a shared device.
 *
 * WHAT SIGN-OUT DID CLEAR tells you this was an oversight rather than a
 * decision: it already resets the partner scope, the shared selection and
 * the recents, and removes the session-alive marker and Supabase's own
 * token. Somebody thought about what the next seat would inherit. They
 * thought about the PREFERENCES and not about the DATA.
 *
 * TWO HALVES, AND THE SECOND IS THE ONE THAT IS EASY TO MISS. Removing the
 * key is not enough on its own: the services hold the same rows in module
 * memory and only re-read localStorage at import time, so a sign-out
 * followed by a sign-in in the SAME tab hands the new user the previous
 * user's book out of RAM. So the in-memory copies are emptied too.
 *
 * WHAT IS DELIBERATELY NOT CLEARED, and the reason is in the comment on
 * CLEAR_ON_SIGNOUT: `grp_period` is a display preference with nobody's
 * data in it, and `grp_help_v9` is admin-authored shared content. The help
 * cache is the one genuine judgement here -- it can hold uploaded PDFs as
 * data URLs -- and it is Q5 for Matt rather than a call I have made.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KEYS, CLEAR_ON_SIGNOUT } from './storage';
import { forgetTheSignedOutUser } from './forgetTheSignedOutUser';
import { getAgencies, hydrateOrg } from './orgService';
import { ALL_PARTNERS } from './types';
import { ORG_SEED } from './mock/org';

const seeded = () => ORG_SEED.map((a) => ({ ...a }));

beforeEach(() => { localStorage.clear(); hydrateOrg(seeded()); });
afterEach(() => { localStorage.clear(); hydrateOrg(seeded()); });

describe('the list of what a sign-out has to remove', () => {
  /* NAMED, so adding a tenth key is a decision somebody makes rather than
     one they forget. A key that holds another party's data and is not on
     this list is the defect all over again. */
  it('names the two working copies that carry other parties’ data', () => {
    expect(CLEAR_ON_SIGNOUT).toContain(KEYS.org);
    expect(CLEAR_ON_SIGNOUT).toContain(KEYS.partners);
  });

  /* THE ROLE LENS TOO. `grp_role` is what the demo switcher writes, and in
     mock mode it is the whole of who you are: leaving it means the next
     person to open the tab is whoever the last one was pretending to be. */
  it('and the role lens', () => {
    expect(CLEAR_ON_SIGNOUT).toContain(KEYS.role);
  });

  /* AND NOT THE THINGS THAT ARE NOBODY'S. A sign-out that wipes a period
     preference is a sign-out that annoys people into not signing out. */
  it('and leaves a display preference alone, because it is nobody’s data', () => {
    expect(CLEAR_ON_SIGNOUT).not.toContain(KEYS.period);
  });
});

describe('clearing the working copies', () => {
  it('removes the org book from storage', () => {
    localStorage.setItem(KEYS.org, JSON.stringify([{ name: 'Regent', contacts: [{ email: 'a@b.test' }] }]));
    forgetTheSignedOutUser();
    expect(localStorage.getItem(KEYS.org)).toBeNull();
  });

  it('and the partner rates', () => {
    localStorage.setItem(KEYS.partners, JSON.stringify([{ slug: 'x', agent_rate: 0.25 }]));
    forgetTheSignedOutUser();
    expect(localStorage.getItem(KEYS.partners)).toBeNull();
  });

  /* THE HALF THAT IS EASY TO MISS. The services read localStorage once, at
     import. Remove the key and the rows are still in module memory, so a
     sign-out and a sign-in in the SAME TAB hands the new user the previous
     user's agencies -- with their contacts on them. */
  it('and empties the in-memory copy, not just the key', () => {
    expect(getAgencies(ALL_PARTNERS).length).toBeGreaterThan(0);
    forgetTheSignedOutUser();
    expect(getAgencies(ALL_PARTNERS)).toEqual([]);
  });

  /* AND IT DOES NOT THROW WHERE STORAGE IS REFUSED. A private window or
     blocked site data makes every localStorage call throw, and a sign-out
     that throws is a sign-out that does not complete. */
  it('and survives storage being unavailable, because a sign-out must finish', () => {
    const real = Storage.prototype.removeItem;
    Storage.prototype.removeItem = () => { throw new Error('denied'); };
    try {
      expect(() => forgetTheSignedOutUser()).not.toThrow();
    } finally {
      Storage.prototype.removeItem = real;
    }
  });
});
