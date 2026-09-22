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

/** What a person covers, in words, for a table cell. */
export function describePosition(positions: Position[]): string {
  if (!positions.length) return 'Own referrals';
  const group = positions.filter((p) => p.kind === 'group');
  if (group.length) return group.length === 1 ? `Group: ${group[0].targetName}` : `${group.length} groups`;
  const agency = positions.filter((p) => p.kind === 'agency');
  if (agency.length) return agency.length === 1 ? `Brand: ${agency[0].targetName}` : `${agency.length} brands`;
  const branch = positions.filter((p) => p.kind === 'branch');
  if (branch.length === 1) return `Branch: ${branch[0].targetName}`;
  return `${branch.length} branches`;
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

/** Records that somebody works at an agency. The bootstrap for cross-route reach. */
export async function attachToAgency(userId: string, agencyId: string): Promise<void> {
  if (!SUPABASE_ENABLED) return;
  const { error } = await sb().rpc('attach_user_to_agency', { p_user: userId, p_agency: agencyId });
  if (error) throw new Error(error.message);
}
