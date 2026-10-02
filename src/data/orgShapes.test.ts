/* The creation flow and the grow path must produce IDENTICAL data.

   There are two ways to end up with an agency inside a group: create the group
   and the agency together (the Add agency flow), or create the agency
   independently and grow it into a group later (the detail page's grow actions).
   Those used to be separate code, and separate code drifts — an agency made one
   way ended up subtly different from one made the other, which is exactly the
   kind of difference nobody notices until settlement disagrees.

   Both now compose the same primitives, so this asserts the end states match. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hydrateOrg, hydrateGroups, getAgencies, getGroups, createAgencyWithBranch, createAgencyGroup, setAgencyGroup, createBranchLive, findAgency } from './orgService';
import { createOrgShape } from './orgShapes';
import { ALL_PARTNERS } from './types';

const HOUSE = 'opndoor-agents';

/** The comparable shape of an org: what it is, not which ids it happened to get. */
function shapeOf(agencyName: string) {
  const a = findAgency(agencyName);
  if (!a) return null;
  const group = getGroups(ALL_PARTNERS).find((g) => g.id === a.groupId);
  return {
    agency: a.name,
    partner: a.partner,
    agentRate: a.agentRate ?? null,
    groupName: group?.name ?? null,
    branches: (a.branches ?? []).map((b) => b.name).sort(),
  };
}

beforeEach(() => { hydrateGroups([]); hydrateOrg([]); });
afterEach(() => { hydrateGroups([]); hydrateOrg([]); });

describe('the creation flow and the grow path agree', () => {
  it('an agency created inside a group matches one grown into a group', async () => {
    // ROUTE A — the Add agency flow: group and agency in one pass.
    await createOrgShape({
      partner: HOUSE,
      groupName: 'Harbour Group',
      agencies: [{ name: 'Alpha Lettings', agentRate: 0.12, contactEmail: 'alpha@agency.test', branches: [{ name: 'Alpha Central' }, { name: 'Alpha West' }] }],
    });
    const viaFlow = shapeOf('Alpha Lettings');

    // ROUTE B — the grow path: independent agency, then a group above it.
    const { agencyId } = await createAgencyWithBranch({
      agencyName: 'Beta Lettings', branchName: 'Beta Central', agentRate: 0.12, partnerRate: null,
      contactEmail: 'beta@agency.test',
    });
    const beta = findAgency('Beta Lettings')!;
    await createBranchLive(beta, { name: 'Beta West' });
    const g = await createAgencyGroup(HOUSE, 'Harbour Group Two');
    await setAgencyGroup(agencyId, g.id);
    const viaGrow = shapeOf('Beta Lettings');

    // Same shape in every respect but the names chosen: same partner, same rate,
    // parented to a group either way, same number of branches.
    expect(viaFlow).not.toBeNull();
    expect(viaGrow).not.toBeNull();
    const norm = (x: NonNullable<typeof viaFlow>) => ({ ...x, agency: 'X', groupName: 'G', branches: x.branches.length });
    expect(norm(viaFlow!)).toEqual(norm(viaGrow!));
    expect(viaFlow!.branches).toEqual(['Alpha Central', 'Alpha West']);
    expect(viaGrow!.branches).toEqual(['Beta Central', 'Beta West']);
  });

  it('an agency joining an EXISTING group lands where re-parenting would put it', async () => {
    const g = await createAgencyGroup(HOUSE, 'Existing Group');
    await createOrgShape({ partner: HOUSE, groupId: g.id, agencies: [{ name: 'Joiner Lettings', contactEmail: 'joiner@agency.test', branches: [{ name: 'Joiner Central' }] }] });
    const joined = shapeOf('Joiner Lettings');

    // Re-parenting the long way round must reach the same place.
    const { agencyId } = await createAgencyWithBranch({ agencyName: 'Mover Lettings', branchName: 'Mover Central', contactEmail: 'mover@agency.test' });
    await setAgencyGroup(agencyId, g.id);
    const moved = shapeOf('Mover Lettings');

    expect(joined!.groupName).toBe('Existing Group');
    expect(moved!.groupName).toBe('Existing Group');
    expect({ ...joined!, agency: 'X', branches: joined!.branches.length })
      .toEqual({ ...moved!, agency: 'X', branches: moved!.branches.length });
  });

  it('a skeleton agency is created with no branches at all', async () => {
    await createOrgShape({
      partner: HOUSE,
      groupName: 'Skeleton Group',
      agencies: [
        { name: 'Has Branch', contactEmail: 'has@agency.test', branches: [{ name: 'Only Branch' }] },
        { name: 'No Branch Yet', contactEmail: 'none@agency.test', branches: [] },
      ],
    });
    expect(shapeOf('No Branch Yet')!.branches).toEqual([]);
    expect(shapeOf('No Branch Yet')!.groupName).toBe('Skeleton Group');
    // ...and it does not disturb its sibling.
    expect(shapeOf('Has Branch')!.branches).toEqual(['Only Branch']);
  });

  it('an independent agency has no group above it', async () => {
    await createOrgShape({ partner: HOUSE, agencies: [{ name: 'Solo Lettings', contactEmail: 'solo@agency.test', branches: [{ name: 'Solo Central' }] }] });
    expect(shapeOf('Solo Lettings')!.groupName).toBeNull();
    expect(getAgencies(ALL_PARTNERS).filter((a) => a.name === 'Solo Lettings')).toHaveLength(1);
  });
});
