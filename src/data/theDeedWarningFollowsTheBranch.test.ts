/* THE DEED WARNING FOLLOWS THE BRANCH, EVERYWHERE IT APPEARS.
 *
 * Matt, 2026-10-01: "The 'No agent contact. A deed cannot be issued...'
 * warning still shows on the supplier user's Agencies page (signed in as
 * joe@bloggs.com, Kestrel Management) even though both Kestrel branches
 * have contacts. Apply the same rule as the admin supplier Overview
 * everywhere this warning appears: only warn on a branch that genuinely
 * has nowhere to send the deed, on that branch."
 *
 * THE SAME MESSAGE HE SENT ABOUT THE OVERVIEW, a day earlier, which is
 * why the rule now lives in one file. The Overview was fixed in place and
 * the Agencies page kept its own copy, so the agency ROW there went on
 * asking the BRANCH question: "does this node hold a contact". An agency
 * that keeps its contacts on its branches answers no, and the row cried
 * "No agent contact. A deed cannot be issued" above two branches each
 * printing a working address.
 *
 * The fixture is Kestrel as dev actually holds it: no contact on the
 * agency, one on each branch.
 */
import { describe, expect, it } from 'vitest';
import { agencyContactState, branchCanReceiveDeed, branchesWithNoDeedContact } from './deedContact';
import type { Agency, AgentContact } from './types';

const contact = (email: string): AgentContact =>
  ({ name: '', email, isPrimary: true } as unknown as AgentContact);

const agency = (o: Partial<Agency>): Agency => ({
  name: 'Kestrel Lettings', partner: 'kestrel-lettings', branches: [], contacts: [],
  referrals: 0, id: 'ag-1',
  ...o,
} as unknown as Agency);

const KESTREL = agency({
  contacts: [],
  branches: [
    { name: 'Kestrel Central', contacts: [contact('kestrel.central@kestrel.invalid')] },
    { name: 'Kestrel Riverside', contacts: [contact('kestrel.riverside@kestrel.invalid')] },
  ] as never,
});

describe('the agency row', () => {
  /* THE REPORTED BUG. */
  it('says nothing is wrong when every branch has its own contact', () => {
    expect(agencyContactState(KESTREL)).toEqual({ kind: 'per-branch' });
  });

  it('and warns, with a count, when some branch has none', () => {
    const half = agency({
      contacts: [],
      branches: [
        { name: 'Kestrel Central', contacts: [contact('kestrel.central@kestrel.invalid')] },
        { name: 'Kestrel Riverside', contacts: [] },
      ] as never,
    });
    expect(agencyContactState(half)).toEqual({ kind: 'bare', bare: 1, branches: 2 });
  });

  it('and shows its own contact when it holds one, which every branch inherits', () => {
    const own = agency({ contacts: [contact('head.office@kestrel.invalid')], branches: [
      { name: 'Kestrel Central', contacts: [] },
    ] as never });
    expect(agencyContactState(own)).toEqual({ kind: 'own' });
    expect(branchCanReceiveDeed(own, own.branches[0])).toBe(true);
  });

  /* NO BRANCHES AND NO CONTACT is the one case where the agency row IS the
     whole answer: there is nothing underneath to cover it. */
  it('and warns on an agency with no contact and nothing underneath', () => {
    expect(agencyContactState(agency({ contacts: [], branches: [] as never }))).toEqual({ kind: 'none' });
  });
});

describe('the page banner counts the same branches the rows mark', () => {
  it('counts none for Kestrel', () => {
    expect(branchesWithNoDeedContact([KESTREL])).toEqual([]);
  });

  it('and names the branch, not the agency, when one is bare', () => {
    const half = agency({
      contacts: [],
      branches: [
        { name: 'Kestrel Central', contacts: [contact('c@kestrel.invalid')] },
        { name: 'Kestrel Riverside', contacts: [] },
      ] as never,
    });
    expect(branchesWithNoDeedContact([half]))
      .toEqual([{ agency: 'Kestrel Lettings', branch: 'Kestrel Riverside' }]);
  });
});
