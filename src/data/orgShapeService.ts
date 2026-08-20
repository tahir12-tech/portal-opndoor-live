/* =====================================================================
   The shape of the org tree the signed-in person can actually reach.

   WHY THIS EXISTS. A small independent with one office should not be shown a
   brand list containing one brand and a branch list containing one branch. A
   national group with several brands should be. Those are the same rule at two
   points: ask only about a level that has a choice in it.

   DEPTH IS DERIVED, OWNERSHIP IS CONFIGURED. Nothing anywhere declares how many
   levels a partner has. The server counts what is reachable. What IS recorded
   is whether the partner owns its stock, because that cannot be counted:

     an AGENT refers into its own properties, so its agency set is CLOSED. One
     agency means one agency, and asking is asking somebody to confirm a fact
     about themselves.

     a SUPPLIER refers on behalf of agencies it does not own, so its agency set
     is OPEN. Having dealt with one agency so far says nothing about the next
     referral. Its agency step never collapses and always offers a new one.

   THE RULE LIVES IN SQL (my_org_shape, 20260814040000) and is read here rather
   than reimplemented, so the two cannot drift.
   ===================================================================== */
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';

export interface OrgShape {
  refersOwnStock: boolean;
  agencyCount: number;
  branchCount: number;
  /** Do not ask which agency: there is one and it is theirs. */
  collapseAgency: boolean;
  /** Do not ask which branch: there is one. */
  collapseBranch: boolean;
  /** Offer "create a new agency" at referral time. Suppliers only. */
  mayAddAgency: boolean;
  onlyAgencyId: string | null;
  onlyAgencyName: string | null;
  onlyBranchId: string | null;
  onlyBranchName: string | null;
}

/** An agent whose org has not been set up yet.

    This has to be its own state and not a quiet fall-through to the supplier
    picker. An agent cannot create an agency here by design, so falling through
    leaves a search box with nothing in it, no way to add anything and no
    explanation. Worse, if it fell all the way through to the supplier picker,
    a referrer would invent a misspelled duplicate of their own employer and it
    would reach review with real money attached to it. */
export function orgNotSetUp(shape: OrgShape): boolean {
  return shape.refersOwnStock && shape.branchCount === 0;
}

/** The supplier shape, and what every caller falls back to.

    Deliberately the SAFE default rather than the convenient one: it asks for an
    agency and allows a new one, which is what the portal has always done. A
    failed lookup must never silently collapse a step, because collapsing files
    the referral against whatever happened to be first. */
export const FULL_PICKER: OrgShape = {
  refersOwnStock: false,
  agencyCount: 0,
  branchCount: 0,
  collapseAgency: false,
  collapseBranch: false,
  mayAddAgency: true,
  onlyAgencyId: null,
  onlyAgencyName: null,
  onlyBranchId: null,
  onlyBranchName: null,
};

/**
 * What the referral form should ask.
 *
 * @param partnerId An opndoor admin viewing one partner. Ignored by the server
 *                  for everybody else, so it is a filter and never a way in.
 */
export async function loadOrgShape(partnerId?: string | null): Promise<OrgShape> {
  if (!SUPABASE_ENABLED) return FULL_PICKER;

  const { data, error } = await sb().rpc('my_org_shape', { p_partner: partnerId ?? null });
  // No row is a real answer: an admin with no partner selected reaches every
  // partner, so nothing can collapse.
  if (error || !data || !data.length) return FULL_PICKER;

  const r = data[0] as Record<string, unknown>;
  return {
    refersOwnStock: Boolean(r.refers_own_stock),
    agencyCount: Number(r.agency_count ?? 0),
    branchCount: Number(r.branch_count ?? 0),
    collapseAgency: Boolean(r.collapse_agency),
    collapseBranch: Boolean(r.collapse_branch),
    mayAddAgency: Boolean(r.may_add_agency),
    onlyAgencyId: (r.only_agency_id as string) ?? null,
    onlyAgencyName: (r.only_agency_name as string) ?? null,
    onlyBranchId: (r.only_branch_id as string) ?? null,
    onlyBranchName: (r.only_branch_name as string) ?? null,
  };
}

/** What the section is called, for the person reading it.

    A supplier is telling us whose property this is. An agent is telling us
    which of their own offices it is. Those are different questions and the
    heading should not pretend otherwise. */
export function orgSectionCopy(shape: OrgShape): { title: string; sub: string } {
  if (!shape.refersOwnStock) {
    return {
      title: 'Agency and branch',
      sub: 'Which agency is letting this property, and which branch. You can add either on the fly.',
    };
  }
  if (orgNotSetUp(shape)) {
    return { title: 'Your branches', sub: 'No branches are set up for your account yet.' };
  }
  if (shape.collapseAgency && shape.collapseBranch) {
    return { title: 'Your office', sub: 'This referral is against your only office.' };
  }
  if (shape.collapseAgency) {
    return { title: 'Your branch', sub: 'Which of your branches is letting this property.' };
  }
  return { title: 'Brand and branch', sub: 'Which of your brands is letting this property, and which branch.' };
}
