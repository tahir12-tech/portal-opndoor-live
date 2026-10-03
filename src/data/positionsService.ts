/* =====================================================================
   Positions: who covers what.

   The model and the policies went in inert, because nothing could create a
   scope row. This is what makes the hierarchy do something.

   EVERY CALL IS AN RPC, and every RPC decides for itself who may call it. The
   screen hides what somebody cannot do, but hiding is not the rule: a branch
   manager who calls set_user_scope directly is refused by SQL, not by a missing
   button. See 20260813070000.
   ===================================================================== */
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';

export type ScopeKind = 'group' | 'agency' | 'branch';

export interface Position {
  id: string;
  kind: ScopeKind;
  targetId: string;
  targetName: string;
}

/* THE WORDS FOR EACH LEVEL WENT WITH describePosition on 2026-10-02.
   They were the "Group: " / "Agency: " / "Branch: " prefix and its plural,
   and the Office column no longer names the level: it says the office, or
   "Whole agency", or "Whole group". OFFICE_MANY below is what is left of
   the plural. The schema's own words -- group, agency, branch -- are still
   `ScopeKind` and still what every screen compares against. */
const LEVELS: ScopeKind[] = ['group', 'agency', 'branch'];

/* =====================================================================
   THE OFFICE COLUMN SAYS WHERE SOMEBODY IS, AND NOTHING ELSE.

   Matt, 2026-10-02, verbatim: "Office column on every people screen:
   show the branch name for someone positioned at a branch, and 'Whole
   agency' for someone positioned at the agency (or 'Whole group' at a
   group level). Same wording on the agency Team page and the admin
   views."

   WHAT IT REPLACES, AND WHY THE OLD ONE IS GONE RATHER THAN KEPT.
   `describePosition` filled this column on Team and /users, and it
   answered TWO questions in one string:

     where they are     "Agency: Regent's Lettings", "Branch: Camden"
     what they see      "Everything" for an opndoor admin, "Own
                        referrals" for anybody with no position,
                        DEVELOPER_SEES for a Developer

   The second group is not an office. It was in an Office column because
   until 2026-10-02 there was nowhere else to put it, and it is why an
   opndoor admin once read "Own referrals" in a column about desks. Those
   answers now belong to `agencySees` and `supplierSees` below, in a
   column called Sees, and this function keeps only the first question.
   Two functions, two columns, one subject each -- which is also why
   `describePosition` is deleted rather than left beside this one: the
   next person to change the Office wording would have found both and
   had to guess.

   NO POSITION MEANS NO OFFICE, so the cell is empty and PeopleTable
   drops the column when no row fills it. That is the right answer for
   opndoor's own staff and for a supplier's, who hold no position at all:
   `partner_id` IS the company boundary on that rail.

   THE PREFIX IS GONE WITH IT. "Agency: Regent's Lettings" named the
   level because the name alone could not say whether it meant the whole
   agency or an office inside it. "Whole agency" says it in the words
   Matt chose, and it no longer matters whether the reader is on a
   single-agency Team page or an estate-wide admin one -- which is what
   `showLevel` existed to decide, and why it is gone too.
   ===================================================================== */

/** The Office cell for ONE position. */
export function officeOf(kind: ScopeKind, branchName?: string | null): string {
  if (kind === 'group') return 'Whole group';
  if (kind === 'agency') return 'Whole agency';
  return (branchName ?? '').trim();
}

/** How several of them read. An office is a BRANCH in the schema and an
    office on every screen, and this column is the one place the two words
    meet, so the plural follows the column. */
const OFFICE_MANY: Record<ScopeKind, string> = { group: 'groups', agency: 'agencies', branch: 'offices' };

/**
 * The Office cell for whatever positions a person holds.
 *
 * HIGHEST LEVEL WINS, as it always did: somebody positioned at a group
 * and at a branch inside it is covered by the group, and the narrower
 * position adds nothing. Several at the same level are counted rather
 * than listed, because a cell that grows with the estate stops being a
 * cell.
 */
export function officeLabel(positions: Position[]): string {
  if (!positions.length) return '';
  for (const kind of LEVELS) {
    const at = positions.filter((p) => p.kind === kind);
    if (!at.length) continue;
    if (at.length > 1) return `${at.length} ${OFFICE_MANY[kind]}`;
    return officeOf(kind, at[0].targetName);
  }
  return '';
}

/** What a Developer sees, in one place: the supplier's people list and the
    estate-wide one both print it, and two lists wording one role two ways is
    how "-" and "Own referrals" came to mean the same thing. */
export const DEVELOPER_SEES = 'Dev Centre and API (no commission)';

/* =====================================================================
   WHAT A PERSON SEES, ON EITHER RAIL, IN A CELL'S WORTH OF WORDS.

   Matt, 2026-10-02: the agency People tab gets the shared table's "Sees"
   column, which the supplier tab has had since 2026-10-01.

   BOTH RAILS' SENTENCES LIVE HERE, together, because the supplier's were
   written in PartnerHome and the agency's would otherwise have been
   written in AgencyHome: two files deciding separately what "sees
   everything" is called is exactly how "-" and "Own referrals" came to
   mean the same thing (see DEVELOPER_SEES above).

   IT IS THE REFERRAL BOOK THEY ARE ABOUT, not the people list: what the
   applications policy admits. On our estate that is
   app_may_reach_application_org, which narrows management to
   app_scoped_agencies and a referrer to their own rows:

     a branch position    reaches the AGENCY the branch belongs to, so a
                          branch manager sees the whole agency and not
                          just their office -- the office is a placement,
                          not a permission
     a group position     reaches every agency in the group
     a referrer           reaches referrer_id = auth.uid() and nothing
                          else, whatever they are positioned at

   WHICH IS WHY IT IS NOT THE OFFICE COLUMN SAID TWICE. Office answers
   where somebody sits; this answers what they can open. For a Negotiator
   at a two-office agency the two cells disagree, and that disagreement is
   the information.

   COMMISSION IS NOT IN IT. Director and Manager differ by commission and
   by nothing else, and the Level column already says which they are;
   AGENCY_LEVELS carries the long sentence for the invite dialog.
   ===================================================================== */

/** What a person on OUR estate sees, given their role and the level they
    are positioned at. */
/** The clause a Developer's line ends with, and now a Manager's. Matt,
    2026-10-03: "for a Manager, 'Sees' should read 'The whole agency (no
    commission)', matching how the Developer row says it." One constant,
    because two roles wording the same limitation two ways is what
    DEVELOPER_SEES itself was created to stop. */
const NO_COMMISSION = ' (no commission)';

export function agencySees(
  role: string,
  kind: ScopeKind | null | undefined,
  /* THE LEVEL, WHICH ROLE ALONE CANNOT GIVE. A Director and a Manager are
     both `management`; `sees_commission` is the only thing between them,
     which is the whole of the level ladder on our estate. Optional, so a
     caller that does not know reads as it always did -- a Director -- and
     the two people lists that DO know pass it. */
  seesCommission?: boolean,
): string {
  if (role === 'superadmin' || role === 'opndoor_manager') return 'Everything';
  if (role === 'developer') return DEVELOPER_SEES;
  if (role === 'referrer') return 'Own referrals';
  if (role !== 'management') return '-';
  /* AND MANAGEMENT WITH NO POSITION REACHES NOTHING ON THIS RAIL, which is
     the one answer worth being careful about: app_may_reach_application_org
     has no partner-wide arm on our estate, so an unpositioned caller gets
     zero rows, and a constraint trigger refuses the row in the first place.
     Saying "The whole agency" for a position that does not exist would be
     the old defect in its newest costume -- a cell that over-states reach
     reads as working while telling an agency somebody sees more than they
     do. The dash is "none of the above", as it is for a role off the
     ladder. */
  if (!kind) return '-';
  const reach = kind === 'group' ? 'Every agency in the group' : 'The whole agency';
  /* AND WHAT THEY DO NOT SEE, on the same line. A Manager reaches exactly
     as far as a Director across the agency and is refused the commission
     figures, and a cell that says only "The whole agency" leaves an agency
     reading its own team list unable to tell the two levels apart --
     which is the question that list is for. `seesCommission === false`
     and not `!seesCommission`: undefined means the caller does not know,
     and guessing "no commission" would understate a Director. */
  return seesCommission === false ? `${reach}${NO_COMMISSION}` : reach;
}

/** And on a supplier's rail, where there are no positions: partner_id IS
    the company boundary, so management sees the supplier's whole book.
    Moved here from PartnerHome on 2026-10-02 to sit beside its twin. */
export function supplierSees(role: string): string {
  return role === 'management' ? 'Everything'
    : role === 'referrer' ? 'Own referrals'
      : role === 'developer' ? DEVELOPER_SEES
        : '-';
}

/** How many levels of the ladder a set of positions actually spans. The Team
    page uses it to decide whether naming the level tells the reader anything. */
export function levelsSpanned(positions: Position[]): number {
  return LEVELS.filter((k) => positions.some((p) => p.kind === k)).length;
}

/**
 * Whether the signed-in person may grant positions.
 *
 * Mirrors the SQL: an opndoor admin, or a manager who is either partner-wide
 * (no position of their own, which is what management has always meant) or
 * holds a group or agency position. A branch manager may not.
 */
export function mayGrantPositions(role: string, own: Position[]): boolean {
  if (role === 'superadmin') return true;
  if (role !== 'management') return false;
  if (!own.length) return true;
  return own.some((p) => p.kind === 'group' || p.kind === 'agency');
}

/* =====================================================================
   WHO RECEIVES THE MONTHLY COMMISSION STATEMENT.

   The tick lives on the person (users.receives_commission_statements) and can
   only move through set_receives_commission_statements. A trigger refuses a
   direct UPDATE, and that is not belt-and-braces: users_mgmt_update lets any
   management user write any users row inside their own partner, and on the
   agent rail every independently onboarded agency shares the one house
   partner, so "inside my partner" is a competitor's manager too. See
   20261005140000.
   ===================================================================== */

/** The label, written once. Both screens import it so they cannot drift. */
export const COMMISSION_STATEMENT_LABEL = 'Receives commission statements';

/** The tickbox's own words, in one place so the People tab, the branch view
    and Team cannot describe the same setting differently. */
export const NOTIFY_LABEL = 'Receives notifications';
/** Said once above the column rather than in every row's title attribute. */
export const NOTIFY_NOTE =
  'The person who sent a referral always receives its notifications. Tick anyone else who should be copied: they are copied on every referral within the position they already hold.';

/** The one line of explanation, likewise written once.

    Deliberately NOT "statements for this party": the ladder is read upwards
    only, so a ticked person receives the statement for the level they sit at
    and every level below it, and on an admin screen showing group, agency and
    branch people in one table that difference is the whole of the rule. */
export const COMMISSION_STATEMENT_NOTE =
  'Monthly commission statements are emailed to everyone with this on. Each person gets the statement for where they sit and everything below it.';

const MOCK_TICKS = new Map<string, boolean>();

/**
 * The tick for a set of people, keyed by user id (every id present, false when
 * unknown). One query, not one per row: the admin People tab lists an entire
 * group and a request per person would be a request per person.
 *
 * Read off the column rather than added to hydrate's users query on purpose:
 * hydrate feeds ManagedUser, which is cached and shared by every screen in the
 * portal, and a boolean that only two screens read does not earn a place in it.
 */
export async function getCommissionStatementTicks(userIds: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const id of userIds) out[id] = false;
  if (!userIds.length) return out;
  if (!SUPABASE_ENABLED) {
    for (const id of userIds) out[id] = MOCK_TICKS.get(id) ?? false;
    return out;
  }
  const { data, error } = await sb()
    .from('users')
    .select('id, receives_commission_statements')
    .in('id', userIds);
  if (error) throw new Error(error.message);
  (data ?? []).forEach((r: Record<string, unknown>) => {
    out[String(r.id)] = !!r.receives_commission_statements;
  });
  return out;
}

/** In mock mode the notification ticks live here, like the commission ones. */
const MOCK_NOTIFY = new Map<string, boolean>();

/**
 * Who is copied on a referral's notifications, for a page of people.
 *
 * The same shape as the commission tick above and for the same reasons: one
 * request for the page, read off the column rather than added to hydrate's
 * users query, because a boolean two screens read does not earn a place in the
 * cached ManagedUser every screen shares.
 */
export async function getNotificationTicks(userIds: string[]): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const id of userIds) out[id] = false;
  if (!userIds.length) return out;
  if (!SUPABASE_ENABLED) {
    for (const id of userIds) out[id] = MOCK_NOTIFY.get(id) ?? false;
    return out;
  }
  const { data, error } = await sb().from('users').select('id, receives_notifications').in('id', userIds);
  if (error) throw new Error(error.message);
  (data ?? []).forEach((r: Record<string, unknown>) => { out[String(r.id)] = !!r.receives_notifications; });
  return out;
}

/**
 * Copy this person on the notifications for referrals within their position,
 * or stop.
 *
 * Returns what the RPC settled on rather than what we asked for, and surfaces
 * a refusal as the sentence SQL raised: the rule is
 * set_receives_notifications, and a paraphrase here would be a second copy of
 * it that can be wrong. Unlike the commission tick, an agency's own Directors
 * and Managers may set this for people at or below their position, so the
 * refusal is something a customer can actually see.
 */
export async function setReceivesNotifications(userId: string, on: boolean): Promise<boolean> {
  if (!SUPABASE_ENABLED) { MOCK_NOTIFY.set(userId, on); return on; }
  const { data, error } = await sb().rpc('set_receives_notifications', { p_user: userId, p_on: on });
  if (error) throw new Error(error.message);
  return data == null ? on : !!data;
}

/**
 * Turn one person's monthly commission statement on or off.
 *
 * Returns the value the RPC settled on, NOT the value we asked for: the screen
 * then shows the row rather than its own optimism. Refusals come back as the
 * sentence SQL raised, and callers must show that sentence as it is; the rule
 * lives there, and a paraphrase here would be a second copy of it that can be
 * wrong.
 */
export async function setReceivesCommissionStatements(userId: string, on: boolean): Promise<boolean> {
  if (!SUPABASE_ENABLED) { MOCK_TICKS.set(userId, on); return on; }
  const { data, error } = await sb().rpc('set_receives_commission_statements', { p_user: userId, p_on: on });
  if (error) throw new Error(error.message);
  return data == null ? on : !!data;
}

/** The org tree flattened to the two edges the containment question needs. */
export interface OrgEdges {
  /** branch id -> the agency it belongs to. */
  agencyOfBranch: Map<string, string>;
  /** agency id -> the group above it. Absent when the agency sits under none. */
  groupOfAgency: Map<string, string>;
}

/** The most senior level anybody in a set of positions actually holds, or null
    for a set with no positions in it at all. Used to find the party's top
    position: the group where there is a group, else the agency, else the
    branch. */
export function topLevelHeld(positions: Position[]): ScopeKind | null {
  for (const kind of LEVELS) if (positions.some((p) => p.kind === kind)) return kind;
  return null;
}

/** Does one of the caller's positions wholly contain this one of the target's? */
function dominates(caller: Position, target: { kind: ScopeKind; targetId: string }, tree: OrgEdges): boolean {
  if (caller.kind === 'group') {
    if (target.kind === 'group') return target.targetId === caller.targetId;
    const agency = target.kind === 'agency' ? target.targetId : tree.agencyOfBranch.get(target.targetId);
    return !!agency && tree.groupOfAgency.get(agency) === caller.targetId;
  }
  if (caller.kind === 'agency') {
    if (target.kind === 'agency') return target.targetId === caller.targetId;
    // A group sits ABOVE an agency, so an agency never contains one. This is the
    // line that stops an agency manager switching off the group director.
    return target.kind === 'branch' && tree.agencyOfBranch.get(target.targetId) === caller.targetId;
  }
  return target.kind === 'branch' && target.targetId === caller.targetId;
}

/**
 * Whether the signed-in person may change this person's commission-statement
 * tick, mirroring set_receives_commission_statements.
 *
 * WHY NOT mayGrantPositions, WHICH IS THE SAME SHAPE OF QUESTION. It answers a
 * different one, and both differences matter here:
 *
 *   - It is about the CALLER alone ("am I senior enough to hand out positions
 *     at all"), and says nothing about who the position is being handed to.
 *     This question is about a pair. SQL asks for CONTAINMENT: every branch the
 *     target reaches must be a branch the caller reaches. app_user_in_scope,
 *     which answers overlap, would let an agency manager switch off the
 *     director above them, and overlap is exactly what mayGrantPositions would
 *     amount to if it were reused here.
 *   - It returns true for a partner-wide manager holding no position. SQL
 *     requires app_has_scope(), so that same person is refused. Showing them a
 *     switch SQL will refuse is the thing this function exists to avoid.
 *
 * Narrower than SQL in one place, deliberately: where a group holds exactly one
 * agency, that agency's branches ARE the group's, so SQL's containment test
 * passes and the agency manager may change the group director. This says no,
 * because the tree it is given is the caller's own reach and a group that looks
 * like one agency from down here may hold others the caller cannot see. Erring
 * this way hides a control that would have worked; erring the other way offers
 * one that fails with a refusal.
 */
export function mayChangeCommissionTick(input: {
  role: string;
  own: Position[];
  target: Position[];
  /** A negotiator holds no scope row, so their only location is the branch they
      were invited into. Without this they are unreachable rather than protected. */
  targetHomeBranchId?: string | null;
  tree: OrgEdges;
}): boolean {
  const { role, own, target, targetHomeBranchId, tree } = input;
  if (role === 'superadmin') return true;
  if (role !== 'management') return false;
  if (!own.length) return false;

  const claims: { kind: ScopeKind; targetId: string }[] = target.map((p) => ({ kind: p.kind, targetId: p.targetId }));
  if (!claims.length && targetHomeBranchId) claims.push({ kind: 'branch', targetId: targetHomeBranchId });
  // Nowhere at all is not "anywhere": commission_statement_party returns null
  // for this person and the RPC refuses with "not attached to a group, agency
  // or branch", so there is nothing to offer.
  if (!claims.length) return false;

  return claims.every((c) => own.some((o) => dominates(o, c, tree)));
}

const MOCK = new Map<string, Position[]>();

export async function getPositions(userId: string): Promise<Position[]> {
  if (!SUPABASE_ENABLED) return MOCK.get(userId) ?? [];
  const { data, error } = await sb()
    .from('user_scopes')
    .select('id, kind, group_id, agency_id, branch_id, agency_groups(name), agencies(name), branches(name)')
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => {
    const kind = r.kind as ScopeKind;
    // PostgREST returns an embedded row or null; it is never an array here
    // because all three are to-one relationships.
    const emb = (v: unknown) => (v && typeof v === 'object' ? (v as { name?: string }).name : undefined);
    return {
      id: String(r.id),
      kind,
      targetId: String(r.group_id ?? r.agency_id ?? r.branch_id ?? ''),
      targetName:
        emb(r.agency_groups) ?? emb(r.agencies) ?? emb(r.branches) ?? 'Unknown',
    };
  });
}

/**
 * Positions for many users in one query — the reverse of getPositions, so a
 * group/brand/branch page can show "who covers what" without a request per user.
 * Returns a map keyed by user id (every requested id present, [] when none).
 */
export async function getPositionsForUsers(userIds: string[]): Promise<Record<string, Position[]>> {
  const out: Record<string, Position[]> = {};
  for (const id of userIds) out[id] = [];
  if (!userIds.length) return out;
  if (!SUPABASE_ENABLED) {
    for (const id of userIds) out[id] = MOCK.get(id) ?? [];
    return out;
  }
  const { data, error } = await sb()
    .from('user_scopes')
    .select('id, user_id, kind, group_id, agency_id, branch_id, agency_groups(name), agencies(name), branches(name)')
    .in('user_id', userIds);
  if (error) throw new Error(error.message);
  const emb = (v: unknown) => (v && typeof v === 'object' ? (v as { name?: string }).name : undefined);
  (data ?? []).forEach((r: Record<string, unknown>) => {
    const uid = String(r.user_id);
    if (!out[uid]) out[uid] = [];
    out[uid].push({
      id: String(r.id),
      kind: r.kind as ScopeKind,
      targetId: String(r.group_id ?? r.agency_id ?? r.branch_id ?? ''),
      targetName: emb(r.agency_groups) ?? emb(r.agencies) ?? emb(r.branches) ?? 'Unknown',
    });
  });
  return out;
}

export async function addPosition(userId: string, kind: ScopeKind, targetId: string, targetName: string): Promise<void> {
  if (!SUPABASE_ENABLED) {
    const list = MOCK.get(userId) ?? [];
    if (!list.some((p) => p.kind === kind && p.targetId === targetId)) {
      MOCK.set(userId, [...list, { id: `mock-${Date.now()}`, kind, targetId, targetName }]);
    }
    return;
  }
  const { error } = await sb().rpc('set_user_scope', { p_user: userId, p_kind: kind, p_target: targetId });
  if (error) throw new Error(error.message);
}

/* WHERE SOMEBODY SITS, which had no caller at all. Round 6, M12.
   20261006310000 made users.home_branch_id writable only through
   set_home_branch (the column trigger refuses everything else), and round 4's
   H3 then granted EXECUTE on it to authenticated because nothing could turn
   the one key. But no screen ever called it: the only writer in the whole
   product is create_invited_user, at invite time. So a negotiator invited to
   the wrong office stayed there, and home_branch_id is read by
   commission_statement_party, agency_weekly_climber, list_managed_users and
   my_org_shape -- it is where they sit, not a label.

   The RPC checks both ends of the move and the ladder, so this is a thin
   pass-through and the screen does not restate the rule. */
export async function setHomeBranch(userId: string, branchId: string | null): Promise<void> {
  if (!SUPABASE_ENABLED) {
    const u = MOCK_HOME.get(userId);
    void u;
    MOCK_HOME.set(userId, branchId);
    return;
  }
  const { error } = await sb().rpc('set_home_branch', { p_user: userId, p_branch: branchId });
  if (error) throw new Error(error.message);
}

/** Mock-mode home branches, so the modal behaves without a database. */
const MOCK_HOME = new Map<string, string | null>();
export function mockHomeBranch(userId: string): string | null | undefined {
  return MOCK_HOME.get(userId);
}

export async function removePosition(userId: string, positionId: string): Promise<void> {
  if (!SUPABASE_ENABLED) {
    MOCK.set(userId, (MOCK.get(userId) ?? []).filter((p) => p.id !== positionId));
    return;
  }
  // Deleting is a plain delete: user_scopes' own policy decides what the caller
  // can see, and you cannot delete a row you cannot select.
  const { error } = await sb().from('user_scopes').delete().eq('id', positionId);
  if (error) throw new Error(error.message);
}

/** Nominated deed recipients for a set of branches: branchId -> userId. The agent
    rail resolves the deed to this user first (else the branch/agency/group manager). */
export async function getDeedRecipients(branchIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!SUPABASE_ENABLED || !branchIds.length) return out;
  const { data, error } = await sb().from('branch_deed_recipient').select('branch_id, user_id').in('branch_id', branchIds);
  if (error) throw new Error(error.message);
  (data ?? []).forEach((r: Record<string, unknown>) => { out[String(r.branch_id)] = String(r.user_id); });
  return out;
}

/** Nominate a user as the deed recipient for a branch (agent rail). */
export async function nominateDeedRecipient(branchId: string, userId: string): Promise<void> {
  if (!SUPABASE_ENABLED) return;
  const { error } = await sb().rpc('set_branch_deed_recipient', { p_branch: branchId, p_user: userId });
  if (error) throw new Error(error.message);
}

/** Clear a branch's nominated deed recipient (falls back to the manager chain). */
export async function clearDeedRecipient(branchId: string): Promise<void> {
  if (!SUPABASE_ENABLED) return;
  const { error } = await sb().rpc('clear_branch_deed_recipient', { p_branch: branchId });
  if (error) throw new Error(error.message);
}

/** Whether each agency/branch can receive a deed from its own people. */
export interface DeedReadiness {
  /** agency id -> somebody at or under this agency can receive a deed. */
  agencies: Map<string, boolean>;
  /** branch id -> the ladder resolves for this branch specifically. */
  branches: Map<string, boolean>;
}

/** Agent-rail deed readiness for every agency and branch the caller can see, in ONE
    call (org_deed_readiness). The Agencies list must work at thousands of rows, so the
    people ladder — nominated recipient, else branch/agency/group manager — is resolved
    server-side and set-based rather than recomputed per row here.

    Only ACTIVE people count: a pending invitee has not accepted and cannot receive
    anything, so they do not clear the warning.

    Supplier-introduced orgs are absent from the result by design; a missing agency
    means "not agent rail, or not visible", and the caller keeps the agent_contacts
    warning for those. Returns null in mock mode, which reads the same way. */
export async function getOrgDeedReadiness(): Promise<DeedReadiness | null> {
  if (!SUPABASE_ENABLED) return null;
  const { data, error } = await sb().rpc('org_deed_readiness');
  if (error) throw new Error(error.message);
  const agencies = new Map<string, boolean>();
  const branches = new Map<string, boolean>();
  for (const r of (data ?? []) as Array<{ agency_id: string; branch_id: string | null; ready: boolean }>) {
    if (r.branch_id) branches.set(String(r.branch_id), !!r.ready);
    else agencies.set(String(r.agency_id), !!r.ready);
  }
  return { agencies, branches };
}

/** Records that somebody works at an agency. The bootstrap for cross-route reach. */
export async function attachToAgency(userId: string, agencyId: string): Promise<void> {
  if (!SUPABASE_ENABLED) return;
  const { error } = await sb().rpc('attach_user_to_agency', { p_user: userId, p_agency: agencyId });
  if (error) throw new Error(error.message);
}
