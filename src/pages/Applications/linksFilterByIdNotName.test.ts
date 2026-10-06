/* A LINK INTO APPLICATIONS NAMES AN ID, NOT A NAME.
 *
 * Matt, 2026-10-02: "Every link from an agency or branch to
 * Applications filters by name (e.g. ?agency=Frost Partnership), so
 * with two Frosts in different estates it can show the other one's
 * applications. Links must filter by the agency's or branch's id,
 * everywhere."
 *
 * The last piece of separate estates that was left as a known gap:
 * `agencies.partner_id` has always made two estates two rows, and the
 * links kept addressing them by the one thing the two rows share.
 *
 * WHAT AN ID BUYS, given that an application summary carries its agency
 * as a STRING and not an id: the id resolves to the pair the list can
 * filter on -- the name AND the estate -- and the estate is applied as
 * the origin, because `agency:<estate>:<name>` is already the selection
 * that means exactly that. So the filter narrows by both.
 *
 * THE NAME STILL WORKS, deliberately. Links live in saved bookmarks and
 * in pasted messages, and a parameter that silently selects nothing is
 * worse than one that selects a little too much.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { hydrateOrg, agencyRefById, branchRefById, uniqueAgencyIdByName, uniqueBranchIdByName } from '@/data/orgService';
import type { Agency } from '@/data/types';

/* THE TWO FROSTS, which is the case the whole change is about. */
const AGENCIES = [
  { id: 'ag-ours', partner: 'opndoor-agents', name: 'Frost Partnership', users: 0, referrals: 0,
    guaranteed: '£0', fees: 0,
    branches: [{ id: 'b-ours', name: 'Frost Mayfair', referrals: 0, guaranteed: '£0' }] },
  { id: 'ag-theirs', partner: 'kestrel-lettings', name: 'Frost Partnership', users: 0, referrals: 0,
    guaranteed: '£0', fees: 0,
    branches: [{ id: 'b-theirs', name: 'Frost Mayfair', referrals: 0, guaranteed: '£0' }] },
  { id: 'ag-alone', partner: 'opndoor-agents', name: "Regent's Lettings", users: 0, referrals: 0,
    guaranteed: '£0', fees: 0,
    branches: [{ id: 'b-alone', name: "Regent's Park", referrals: 0, guaranteed: '£0' }] },
] as unknown as Agency[];

beforeEach(() => hydrateOrg(AGENCIES));
afterEach(() => hydrateOrg([]));

describe('an id resolves to a name AND an estate', () => {
  it('for an agency, which is what tells the two Frosts apart', () => {
    expect(agencyRefById('ag-ours')).toEqual({ name: 'Frost Partnership', partner: 'opndoor-agents' });
    expect(agencyRefById('ag-theirs')).toEqual({ name: 'Frost Partnership', partner: 'kestrel-lettings' });
  });

  /* AND A BRANCH ID KNOWS ITS AGENCY, which a `?branch=` never did: it
     had to be looked up by name, and a branch name is ambiguous across
     estates in exactly the way this change is about. */
  it('and for a branch, with the agency it belongs to', () => {
    expect(branchRefById('b-theirs'))
      .toEqual({ name: 'Frost Mayfair', agency: 'Frost Partnership', partner: 'kestrel-lettings' });
  });

  it('and nothing for an id that is not there', () => {
    expect(agencyRefById('nope')).toBeNull();
    expect(branchRefById('nope')).toBeNull();
  });
});

describe('a name resolves only when it is not ambiguous', () => {
  /* THE LEAGUE'S CASE. A league row is an aggregate built from
     application summaries, which carry their agency as a string, so
     there is no id in the data that board is made of. Looking one up
     by name is the best available, and it must REFUSE where the name
     is two agencies rather than pick the first -- which would be the
     bug with a new coat on. */
  it('so Frost Partnership resolves to nothing, because it is two agencies', () => {
    expect(uniqueAgencyIdByName('Frost Partnership')).toBeNull();
    expect(uniqueBranchIdByName('Frost Mayfair')).toBeNull();
  });

  it('while a name that is one agency resolves to it', () => {
    expect(uniqueAgencyIdByName("Regent's Lettings")).toBe('ag-alone');
    expect(uniqueBranchIdByName("Regent's Park")).toBe('b-alone');
  });
});

describe('every link that can carry an id does', () => {
  const read = (p: string) => readFileSync(p, 'utf8');

  it('the Agencies screen, for an agency and for a branch', () => {
    const s = read('src/pages/OrgManagement/OrgManagement.tsx');
    expect(s).toContain('`/applications?agencyId=${encodeURIComponent(a.id)}`');
    expect(s).toContain('`/applications?branchId=${encodeURIComponent(b.id)}`');
  });

  it('the supplier’s Agencies tab, which is where the collision lives', () => {
    expect(read('src/pages/PartnerManagement/PartnerHome.tsx'))
      .toContain('`/applications?branchId=${encodeURIComponent(b.id)}`');
  });

  it('and the agency’s own page', () => {
    expect(read('src/pages/Agencies/AgencyHome.tsx'))
      .toContain('`/applications?agencyId=${encodeURIComponent(a.id)}`');
  });

  it('and the League, where the row has to be resolved first', () => {
    const s = read('src/pages/League/League.tsx');
    expect(s).toContain('uniqueAgencyIdByName(r.name)');
    expect(s).toContain('uniqueBranchIdByName(r.name)');
  });

  /* AND APPLICATIONS READS THEM, which is the half that makes the other
     half worth anything. */
  it('and Applications turns an id into an estate-pinned filter', () => {
    const s = read('src/pages/Applications/Applications.tsx');
    expect(s).toContain("params.get('agencyId')");
    expect(s).toContain("params.get('branchId')");
    expect(s).toContain('`agency:${byId.partner}:${');
  });
});
