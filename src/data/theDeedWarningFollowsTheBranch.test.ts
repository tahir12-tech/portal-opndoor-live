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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agenciesNeedingAnEmail, agencyContactState, agencyNeedsEmail, branchCanReceiveDeed, branchesWithNoDeedContact } from './deedContact';
import { hydratePartners } from './partnersService';
import type { Agency, AgentContact, Partner } from './types';

/* =====================================================================
   THE ESTATE IS NOW A STATED FACT, 2026-10-02.

   This file used to hydrate no partners at all and still get the right
   answers, because `partyIsSupplier` was "not an agency" and an
   unresolved partner fell through to supplier. That default is gone: a
   partner Opndoor has not loaded is a partner whose kind is unknown, and
   unknown is not an answer. So the two estates this file contrasts have
   to be on the books for it to contrast them -- which is a better
   fixture anyway, since the thing under test is precisely "which estate
   is this agency in".
   ===================================================================== */
const PARTNERS = [
  { id: 'kestrel-lettings', name: 'Kestrel Lettings', kind: 'supplier' },
  { id: 'opndoor-agents', name: 'Opndoor Agents', kind: 'agency', isHouse: true },
].map((p) => ({ ...p, status: 'active', since: '2026-01-01', weight: 1, users: 0, apps: 0,
  partnerRate: 0.25, agentRate: 0.1, primary: false })) as unknown as Partner[];

beforeEach(() => { hydratePartners(PARTNERS); });
afterEach(() => { hydratePartners([]); });

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

/* =====================================================================
   AND THE SUBJECT CHANGED, 2026-10-02.

   Matt corrected the rule this file was written against: "Supplier side
   (agencies in a supplier's estate): an agency email is required at
   creation and is the default for all its branches ... For
   supplier-estate agencies with no agency email, show a clear warning on
   the supplier's Agencies tab and list them on Reconciliation so Opndoor
   can add one. No warnings for Opndoor's own agencies without an email."

   So the agency row no longer asks "is any deed stranded"; it asks "has
   this agency got the default", and only in a supplier's estate. Kestrel
   -- the shape the original bug was reported on -- is now REPORTED,
   because it has no agency address and the next office added under it
   would inherit nothing. That is not the old bug coming back: the old
   warning said "a deed cannot be issued", which was untrue of Kestrel,
   and the new one says "no agency email", which is true and is the thing
   to fix. The assertion below says which of those it is.

   The BRANCH question is unchanged, and so is the banner that counts
   branches: a branch with nothing anywhere is still stranded.
   ===================================================================== */
describe('the agency row, in a supplier’s estate', () => {
  /* THE SHAPE THE ORIGINAL BUG WAS REPORTED ON. Reported now, and for a
     different reason, with a different sentence: nothing is stranded
     (bare: 0) and the default is missing. */
  it('asks for the agency email when every branch has its own', () => {
    expect(agencyContactState(KESTREL)).toEqual({ kind: 'needs-email', bare: 0, branches: 2 });
  });

  it('and counts the branches that are genuinely stranded', () => {
    const half = agency({
      contacts: [],
      branches: [
        { name: 'Kestrel Central', contacts: [contact('kestrel.central@kestrel.invalid')] },
        { name: 'Kestrel Riverside', contacts: [] },
      ] as never,
    });
    expect(agencyContactState(half)).toEqual({ kind: 'needs-email', bare: 1, branches: 2 });
  });

  it('and says nothing once the agency holds one, which every branch inherits', () => {
    const own = agency({ contacts: [contact('head.office@kestrel.invalid')], branches: [
      { name: 'Kestrel Central', contacts: [] },
    ] as never });
    expect(agencyContactState(own)).toEqual({ kind: 'own' });
    expect(branchCanReceiveDeed(own, own.branches[0])).toBe(true);
  });

  it('and asks for one on an agency with no contact and no branches either', () => {
    expect(agencyContactState(agency({ contacts: [], branches: [] as never })))
      .toEqual({ kind: 'needs-email', bare: 0, branches: 0 });
  });
});

describe('the agency row, on Opndoor’s own estate', () => {
  /* "No warnings for Opndoor's own agencies without an email." A deed
     there goes to whoever sent the referral and the people ticked for it;
     an address is an addition, and warning about a field nobody has to
     fill in is how a warning stops being read. */
  const ours = (o: Partial<Agency>) => agency({ partner: 'opndoor-agents', name: "Regent's Lettings", ...o });

  it('says nothing about an agency with no contact anywhere', () => {
    const regent = ours({ contacts: [], branches: [{ name: "Regent's Park", contacts: [] }] as never });
    expect(agencyContactState(regent)).toEqual({ kind: 'quiet' });
    expect(agencyNeedsEmail(regent)).toBe(false);
  });

  it('and nothing about one that has set one either, because it is optional', () => {
    const withOne = ours({ contacts: [contact('lettings@regent.invalid')], branches: [] as never });
    expect(agencyContactState(withOne)).toEqual({ kind: 'quiet' });
  });

  /* AND THE LIST THE BANNER AND RECONCILIATION BOTH READ holds only the
     supplier's. One predicate, so the two surfaces cannot disagree about
     who is counted. */
  it('so the list to fix holds the supplier’s agencies and none of ours', () => {
    const regent = ours({ contacts: [], branches: [] as never });
    expect(agenciesNeedingAnEmail([KESTREL, regent]).map((a) => a.name))
      .toEqual(['Kestrel Lettings']);
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
