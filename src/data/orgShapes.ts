/* =====================================================================
   Creating org shapes: ONE set of primitives, used by every path.

   There are three ways an org gets onto the platform, and historically each grew
   its own code: the Add agency modal, the "grow" actions on a detail page, and
   re-parenting an agency into a group. They must produce IDENTICAL data — an
   agency created as part of a group and an agency created independently and then
   re-parented have to be indistinguishable afterwards — so they are all built
   from the same three calls here and nothing composes them privately.

   ROLLBACK. The org is created in the database and the first invite is an edge
   function, so the two cannot share a transaction. Instead the invite is sent
   last and, if it fails, everything this call created is removed again — so a
   half-made group with an uninvited director never survives a failure.
   ===================================================================== */
import { createAgencyWithBranch, createBranchLive, createAgencyGroup, deleteOrgShape, findAgency, setNodeRate } from './orgService';
import { inviteUser } from './usersService';
import { AGENCY_LEVELS } from './types';

export interface BranchSpec { name: string; area?: string }
export interface AgencySpec {
  name: string;
  /** Empty is allowed: a skeleton agency whose manager adds branches on first login. */
  branches: BranchSpec[];
  agentRate?: number | null;
  /** REQUIRED since 2026-10-02. Matt: "A contact email is required when any
      agency or branch is created, in any estate, so one always exists."
      Every office under the agency inherits it, so the offices in
      `branches` do not each carry one: see admin_add_branch, which refuses
      an office only when its agency has nothing to fall back on. */
  contactEmail: string;
  contactName?: string;
  contactPhone?: string;
}
export interface InviteSpec {
  email: string;
  firstName?: string;
  lastName?: string;
  /** Which node the invitee is placed at. 'group' needs a group to exist. */
  level: 'group' | 'agency' | 'branch';
  /** Index into `agencies` for an agency/branch-level invite. */
  agencyIndex?: number;
}
export interface ShapeResult {
  groupId?: string;
  agencyIds: string[];
  branchIds: string[];
}

/** What a shape created, so a failure can be undone precisely. */
async function rollback(made: ShapeResult): Promise<void> {
  try { await deleteOrgShape(made.agencyIds, made.groupId); } catch { /* surfaced by the original error */ }
}

/**
 * Create a whole shape, then send the optional first invite.
 *
 * `groupName` present  -> a group is created and every agency is parented to it.
 * `groupId` present    -> agencies join that EXISTING group (the same
 *                         re-parenting the grow path uses; there is no second
 *                         attachment mechanism).
 * neither              -> one independent agency.
 */
export async function createOrgShape(input: {
  partner: string;
  groupName?: string;
  groupId?: string;
  groupRate?: number | null;
  agencies: AgencySpec[];
  invite?: InviteSpec;
}): Promise<ShapeResult> {
  const made: ShapeResult = { agencyIds: [], branchIds: [] };
  try {
    if (input.groupId) {
      made.groupId = input.groupId;
    } else if (input.groupName?.trim()) {
      const g = await createAgencyGroup(input.partner, input.groupName.trim());
      // Only a group this call created may be removed on failure.
      made.groupId = g.id;
      // A group rate is its OWN additive line under the new model, set through
      // the same guarded RPC the rate editor uses (50% rule included).
      if (input.groupRate != null) await setNodeRate('group', g.id, input.groupRate);
    }

    for (const spec of input.agencies) {
      const first = spec.branches[0];
      const { agencyId, branchId } = await createAgencyWithBranch({
        agencyName: spec.name.trim(),
        branchName: first?.name?.trim() || undefined,
        branchArea: first?.area?.trim() || undefined,
        partnerRate: null,
        agentRate: spec.agentRate ?? null,
        groupId: made.groupId,
        contactEmail: spec.contactEmail,
        contactName: spec.contactName,
        contactPhone: spec.contactPhone,
      });
      if (agencyId) made.agencyIds.push(agencyId);
      if (branchId) made.branchIds.push(branchId);

      // Remaining branches go through the SAME call the grow path uses, so a
      // multi-branch agency made here is identical to one grown branch by branch.
      const agency = findAgency(spec.name.trim());
      for (const b of spec.branches.slice(1)) {
        if (!agency) break;
        await createBranchLive(agency, { name: b.name.trim(), area: b.area?.trim() || undefined });
      }
    }

    if (input.invite?.email?.trim()) {
      const inv = input.invite;
      const idx = inv.agencyIndex ?? 0;
      const scopeTarget = inv.level === 'group' ? made.groupId : made.agencyIds[idx];
      if (!scopeTarget) throw new Error('There is nothing to place that invitation against.');
      /* THE FIRST PERSON ON A NEW ORG IS ITS DIRECTOR. Round 5, M11.
         This sent `role: 'management'` and no commission bit, and Director and
         Manager are the same role differing only by that bit, so the dialog's
         own "Group director" option created a Manager.

         It is not only the label being wrong. A Manager may not see commission,
         and granting a level requires holding it (assert_may_grant_level), so a
         newly created agency whose only person is a Manager has nobody who can
         see what it earns and nobody who can promote anyone to it. The org
         arrives unable to staff itself and needs Opndoor to unstick it.

         The pair comes off AGENCY_LEVELS rather than being written here, so
         this cannot drift from the Team and Users dialogs. */
      const director = AGENCY_LEVELS.find((l) => l.level === 'Director')!;
      await inviteUser({
        firstName: inv.firstName?.trim() ?? '',
        lastName: inv.lastName?.trim() ?? '',
        email: inv.email.trim(),
        role: director.role,
        seesCommission: director.seesCommission,
        partner: input.partner,
        scopeKind: inv.level === 'branch' ? 'branch' : inv.level,
        scopeTarget,
      });
    }
    return made;
  } catch (e) {
    // Everything this call created goes away again, including on a refused
    // position grant inside invite-user.
    await rollback({ ...made, groupId: input.groupId ? undefined : made.groupId });
    throw e;
  }
}

/** The levels an invite can be placed at, given the shape being created. Offering
    "group director" while creating an independent agency is offering a position
    that does not exist. */
export function inviteLevelsFor(shape: 'independent' | 'group' | 'join'): InviteSpec['level'][] {
  return shape === 'independent' ? ['agency'] : ['group', 'agency'];
}
