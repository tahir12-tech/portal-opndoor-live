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
