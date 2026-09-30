/* WALK FIX 21. THE LINE UNDER A REFERRER'S NAME SAYS WHERE THEY WORK.
 *
 * Verbatim: "Reporting, Volume by referrer: the line under each name shows
 * their level (Negotiator, Director), which is irrelevant. Show where they
 * work instead, depending on who's looking: Opndoor admin sees agency and
 * branch; an agency with more than one branch sees the branch; a
 * single-branch agency sees just the name, nothing underneath. Same rule
 * anywhere else referrers are listed (League, exports)."
 *
 * THREE READERS, THREE ANSWERS, and the rule is about the READER and not
 * about the person: the same referrer's line differs depending on who has
 * the page open. That is why it is a function of both and not a field.
 *
 * WHERE "WHERE THEY WORK" COMES FROM. The application's own agency and
 * branch, which is where the referral was made. A person's home office is
 * the same thing for every referral they make from it, and the reporting
 * rail has the application in hand and not the person. Stated because the
 * two can differ -- somebody moved office last month has referrals from
 * both -- and the honest answer for that case is below.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { whereTheyWork } from './whereTheyWork';
import { hydrateFull, type FullApp } from './applicationsService';
import { liveVolume } from './liveAnalytics';
import { ALL_PARTNERS, type Period } from './types';

describe('an Opndoor admin, who is looking across every agency', () => {
  it('sees the agency and the branch', () => {
    expect(whereTheyWork({ reader: 'opndoor', agencies: ['Regent’s Lettings'], branches: ["Regent's Park"] }))
      .toBe("Regent’s Lettings, Regent's Park");
  });

  /* An admin's list spans agencies, so the agency is the half that
     disambiguates and it is never dropped. */
  it('and keeps the agency even where the branch is the only one', () => {
    expect(whereTheyWork({ reader: 'opndoor', agencies: ['Kestrel Lettings'], branches: ['Head office'] }))
      .toBe('Kestrel Lettings, Head office');
  });
});

describe('an agency with more than one branch', () => {
  it('sees the branch, because the agency is the same on every row', () => {
    expect(whereTheyWork({ reader: 'multi-branch', agencies: ['Regent’s Lettings'], branches: ["Regent's Park"] }))
      .toBe("Regent's Park");
  });
});

describe('a single-branch agency', () => {
  /* "Just the name, nothing underneath." Every row would say the same
     thing, which is the definition of a line worth removing -- and it is
     the same reasoning that took the level off in the first place. */
  it('sees nothing underneath the name', () => {
    expect(whereTheyWork({ reader: 'one-branch', agencies: ['Kestrel Lettings'], branches: ['Head office'] }))
      .toBe('');
  });
});

describe('somebody whose referrals come from more than one place', () => {
  /* THE CASE THE ROW DATA CANNOT ANSWER, and it is answered by saying so
     rather than by picking one. A person who moved office has referrals
     from both, and printing either would state as a fact something that is
     half wrong; printing both is the truth and is short. */
  it('is shown both branches rather than an arbitrary one', () => {
    expect(whereTheyWork({
      reader: 'multi-branch', agencies: ['Regent’s Lettings'],
      branches: ["Regent's Park", 'Camden'],
    })).toBe("Camden, Regent's Park");
  });

  it('and both agencies, for an admin', () => {
    expect(whereTheyWork({
      reader: 'opndoor', agencies: ['Foxglove Residential', 'Regent’s Lettings'],
      branches: ['Chelsea'],
    })).toBe('Foxglove Residential, Regent’s Lettings, Chelsea');
  });
});

describe('missing data', () => {
  /* A blank line is better than a comma with nothing either side of it. */
  it('says nothing rather than punctuation', () => {
    expect(whereTheyWork({ reader: 'opndoor', agencies: [], branches: [] })).toBe('');
    expect(whereTheyWork({ reader: 'opndoor', agencies: [''], branches: [''] })).toBe('');
  });

  it('and drops the half it has not got', () => {
    expect(whereTheyWork({ reader: 'opndoor', agencies: ['Regent’s Lettings'], branches: [] }))
      .toBe('Regent’s Lettings');
  });
});

/* AND THE LIST ACTUALLY SAYS IT. Everything above tests the rule; this tests
   that the referrer chart asks it. Without this the helper could be perfect
   and the line could still read "Negotiator", which is the defect. */
describe('the referrer list itself', () => {
  const D = (y: number, m: number, d: number) => new Date(y, m, d);
  const ALLTIME = { id: 'alltime', label: 'All time' } as unknown as Period;
  const app = (over: Partial<FullApp>): FullApp => ({
    ref: 'GR-W-1', partner: 'opndoor-agents', agency: 'Regent’s Lettings',
    branch: "Regent's Park", agencyId: 'ag-1', branchId: 'br-1',
    referrer: 'Tom Reeve', referrerId: 'u-tom', referrerRole: 'referrer',
    referrerSeesCommission: false, owner: 0,
    rent: 2000, fee: 2000, agentRate: 0.25, partnerRate: 0.25,
    status: 'sent', sentAt: D(2026, 3, 1), paidAt: null, deedAt: null,
    tenancyStart: null, expiry: null,
    refunded: false, partiallyRefunded: false, withdrawn: false, expired: false,
    refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null,
    ...over,
  } as unknown as FullApp);

  afterEach(() => hydrateFull([]));

  it('says where they work, not what level they are', () => {
    hydrateFull([app({})]);
    const [row] = liveVolume('superadmin', ALL_PARTNERS, ALLTIME).referrers;
    expect(row.sub).toBe("Regent’s Lettings, Regent's Park");
    expect(row.sub).not.toMatch(/Negotiator|Director|Manager/);
  });

  /* A single-office agency reading its own list: every row would say the
     same thing, so there is no line. */
  it('and nothing at all for a single-office agency reading its own', () => {
    hydrateFull([app({})]);
    const [row] = liveVolume('management', 'opndoor-agents', ALLTIME).referrers;
    expect(row.sub).toBe('');
  });

  it('and the office alone once that agency has two', () => {
    hydrateFull([app({}), app({ ref: 'GR-W-2', branch: 'Camden', branchId: 'br-2', referrer: 'Ada Bell', referrerId: 'u-ada' })]);
    const rows = liveVolume('management', 'opndoor-agents', ALLTIME).referrers;
    expect(rows.map((r) => r.sub).sort()).toEqual(['Camden', "Regent's Park"]);
  });
});
