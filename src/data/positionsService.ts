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

/** The words for each level. GROUP / AGENCY / BRANCH, which is what the schema
    calls them and what the admin screens call them. "Brand" was a fourth name
    for the agency level, used here and nowhere else, and on a customer's own
    screen it read as a marketing term for the company they work for. */
const LEVEL_ONE: Record<ScopeKind, string> = { group: 'Group', agency: 'Agency', branch: 'Branch' };
const LEVEL_MANY: Record<ScopeKind, string> = { group: 'groups', agency: 'agencies', branch: 'branches' };
const LEVELS: ScopeKind[] = ['group', 'agency', 'branch'];

/**
 * What a person covers, in words, for a table cell.
 *
 * `showLevel` names the level as well as the target — "Agency: Regent's
 * Lettings". Worth the words on an admin screen, which shows an estate with
 * groups above agencies above branches and where the level is the information.
 * Noise on a single-agency customer's Team page, where every position is the
 * same level and the prefix only repeats it: there it reads "Regent's Lettings".
 */
export function describePosition(positions: Position[], showLevel = true): string {
  if (!positions.length) return 'Own referrals';
  for (const kind of LEVELS) {
    const at = positions.filter((p) => p.kind === kind);
    if (!at.length) continue;
    if (at.length > 1) return `${at.length} ${LEVEL_MANY[kind]}`;
    return showLevel ? `${LEVEL_ONE[kind]}: ${at[0].targetName}` : at[0].targetName;
  }
  return 'Own referrals';
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
