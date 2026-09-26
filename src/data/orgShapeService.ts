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
  /** Did the server actually answer?

      THE REASON THIS FIELD EXISTS. Everything below is a claim about the viewer,
      and the only witness to any of it is one RPC. When that RPC failed, this
      module used to hand back FULL_PICKER, which does not mean "we do not know",
      it means "you are a supplier, here is a search box and a create option".
      So a single failed call promoted an agency user to the supplier form and
      offered them an agency search and an agency they could invent, on our own
      estate, where SQL refuses both. "We could not tell" and "you are a
      supplier" are different facts and must not share a representation. */
  resolved: boolean;
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
  resolved: true,
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

/** WE DO NOT KNOW YET, or we asked and could not be told.

    Offers nothing, collapses nothing, and claims nothing about the viewer:
    mayAddAgency is false and refersOwnStock is false, so no caller reading
    either can conclude anything it would act on. A form holding this shape
    should ask again and say it is working, which is what AgentBranchPicker
    does. It must NOT fall through to FULL_PICKER: see `resolved` above. */
export const UNRESOLVED: OrgShape = { ...FULL_PICKER, resolved: false, mayAddAgency: false };

/**
 * What the referral form should ask.
 *
 * @param partnerId An opndoor admin viewing one partner. Ignored by the server
 *                  for everybody else, so it is a filter and never a way in.
 */
export async function loadOrgShape(partnerId?: string | null): Promise<OrgShape> {
  // Mock mode has no server to ask, and the mock seed is a supplier estate, so
  // this is a real answer here rather than a failure.
  if (!SUPABASE_ENABLED) return FULL_PICKER;

  const { data, error } = await sb().rpc('my_org_shape', { p_partner: partnerId ?? null });
  // AN ERROR IS NOT AN ANSWER. The call can fail for reasons that have nothing
  // to do with who the viewer is: a token that has just expired, a request that
  // raced a refresh, a network blip, or the function's own AAL2 refusal. Saying
  // "supplier" to any of those is how an agency user got the admin picker.
  if (error) return UNRESOLVED;
  // No row IS a real answer: an admin with no partner selected reaches every
  // partner, so nothing can collapse.
  if (!data || !data.length) return FULL_PICKER;

  const r = data[0] as Record<string, unknown>;
  return {
    resolved: true,
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

/* ---------------------------------------------------------------------------
   THE TWO QUESTIONS THE FORM ASKS OF A SHAPE, as predicates rather than as
   fields read directly, so that every surface answers them the same way and so
   that neither can be answered "yes" by a shape that knows nothing.

   Both are POSITIVE: they require resolved. Reading `!refersOwnStock` inline is
   the bug this file exists to stop, because an unresolved shape satisfies it.
   --------------------------------------------------------------------------- */

/** One of OUR agencies, on the agent rail, referring its own stock. */
export function ownStockViewer(shape: OrgShape): boolean {
  return shape.resolved && shape.refersOwnStock;
}

/** May this viewer invent an agency while filing a referral? A supplier, yes:
    their agency set is open and an agent they have not sent us before must not
    stop the form. One of ours, never: agencies_insert and
    create_referral_target both refuse it in SQL. */
export function mayInventAgency(shape: OrgShape): boolean {
  return shape.resolved && !shape.refersOwnStock && shape.mayAddAgency;
}

/** May this viewer invent an office? The same question one level down, and the
    same answer, for the reasons in 20261004160000. */
export function mayInventBranch(shape: OrgShape): boolean {
  return shape.resolved && !shape.refersOwnStock;
}

/** What the section is called, for the person reading it.

    A supplier is telling us whose property this is. An agent is telling us
    which of their own offices it is. Those are different questions and the
    heading should not pretend otherwise. */
export function orgSectionCopy(shape: OrgShape): { title: string; sub: string } {
  // Before anything is known, the section cannot ask its question yet and must
  // not ask the SUPPLIER's one as a placeholder.
  if (!shape.resolved) {
    return { title: 'Your office', sub: 'Working out which office this referral is against.' };
  }
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
