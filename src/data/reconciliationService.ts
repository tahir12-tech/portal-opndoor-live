/* =====================================================================
   Reconciliation service (opndoor admin only).
   The real queue of agencies/branches created on the fly by referrers
   (review_state = pending_review), each with its parent, creator, created-at,
   attached referral count, and a same/similar-name hint against confirmed
   records. "Confirm as new" promotes it to confirmed (audited). HubSpot sync runs
   on a 2-minute cron and on demand via triggerCrmSync (the Sync button);
   merge is not built yet.

   Live mode uses the reconciliation_queue / confirm_org_entity RPCs; the badge
   count is derived synchronously from the hydrated org (pending entities).
   Mock/test mode keeps an in-memory demo queue.
   ===================================================================== */
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';
import { getAgencies } from './orgService';
import { ALL_PARTNERS } from './types';

export interface ReconRow {
  /** Composite key `${type}:${entityId}` for React lists. */
  id: string;
  entityId: string;
  type: 'agency' | 'branch';
  name: string;
  parent: string | null;
  by: string;
  when: string;
  refs: number;
  /** Name of a confirmed record this looks like, or null. */
  match: string | null;
  /** True when the match is an exact (case-insensitive) same-name hit. */
  matchExact: boolean;
  /** #117 True on an agency whose auto "[Agency], Head office" branch is folded into this card. */
  foldedHeadOffice?: boolean;
}

function fmtWhen(ts: string): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Mock/demo queue (mock mode only). Illustrative pending entities.
const MOCK_QUEUE: ReconRow[] = [
  { id: 'branch:m1', entityId: 'm1', type: 'branch', name: 'Sth Kensington', parent: 'Foxglove Residential', by: 'James Okafor', when: '18/06/2026 · 14:22', refs: 1, match: 'South Kensington', matchExact: false },
  { id: 'agency:m2', entityId: 'm2', type: 'agency', name: 'Marylebone and Co.', parent: null, by: 'Aisha Khan', when: '17/06/2026 · 09:48', refs: 2, match: 'Marylebone & Co', matchExact: false },
  { id: 'branch:m3', entityId: 'm3', type: 'branch', name: 'Wandsworth', parent: 'Hartwell Estates', by: 'Marcus Lin', when: '16/06/2026 · 16:05', refs: 3, match: null, matchExact: false },
  { id: 'agency:m4', entityId: 'm4', type: 'agency', name: 'Camden Town Lettings', parent: null, by: 'Daniel Wright', when: '13/06/2026 · 10:12', refs: 1, match: null, matchExact: false },
  // #117 A single-office fly-created agency: its auto "[Agency], Head office" branch
  // folds into the agency card (confirming the agency sweeps it), so it is not a
  // separate queue item — the card notes the folded head office.
  { id: 'agency:m5', entityId: 'm5', type: 'agency', name: 'Bracken & Vale', parent: null, by: 'Priya Nair', when: '12/06/2026 · 11:30', refs: 1, match: null, matchExact: false, foldedHeadOffice: true },
];

/** The pending-review queue (admin only). Async: live RPC or the mock queue. */
export async function loadReconciliationQueue(): Promise<ReconRow[]> {
  if (SUPABASE_ENABLED) {
    const { data, error } = await sb().rpc('reconciliation_queue');
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((r: any) => ({
      id: `${r.entity_type}:${r.entity_id}`,
      entityId: r.entity_id,
      type: r.entity_type,
      name: r.name,
      parent: r.parent ?? null,
      by: r.created_by_name ?? 'A referrer',
      when: r.created_at ? fmtWhen(r.created_at) : '',
      refs: Number(r.referral_count ?? 0),
      match: r.match_name ?? null,
      matchExact: !!r.match_exact,
      foldedHeadOffice: !!r.folded_head_office,
    }));
  }
  return MOCK_QUEUE.slice();
}

/** Confirm a pending entity as a new canonical record (audited). */
export async function confirmReconEntity(type: 'agency' | 'branch', entityId: string): Promise<void> {
  if (SUPABASE_ENABLED) {
    const { error } = await sb().rpc('confirm_org_entity', { p_type: type, p_id: entityId });
    if (error) throw new Error(error.message);
    return;
  }
  const i = MOCK_QUEUE.findIndex((r) => r.entityId === entityId);
  if (i < 0) return;
  const row = MOCK_QUEUE[i];
  MOCK_QUEUE.splice(i, 1);
  // #96 Confirming an agency also sweeps its auto-created "[Agency], Head office" branch.
  if (row.type === 'agency') {
    const ho = `${row.name}, Head office`.toLowerCase();
    const bi = MOCK_QUEUE.findIndex((r) => r.type === 'branch' && r.parent === row.name && r.name.toLowerCase() === ho);
    if (bi >= 0) MOCK_QUEUE.splice(bi, 1);
  }
}

/** Trigger an on-demand CRM sync (admin only). Fire-and-forget: the edge
    function runs asynchronously; a 2-minute cron also runs it automatically.

    The RPC is trigger_crm_sync and not the older supplier-named twin, because
    an rpc() argument is a string literal that survives minification and shows up
    in a grep of dist/. The old function still exists for the cron. */
export async function triggerCrmSync(): Promise<void> {
  if (SUPABASE_ENABLED) {
    const { error } = await sb().rpc('trigger_crm_sync');
    if (error) throw new Error(error.message);
    return;
  }
  // Mock mode: no backend to call.
}

/** Pending count for the sidebar badge. Derived synchronously from the hydrated
    org in live mode (admins hydrate every agency/branch), or the demo queue. */
export function reconciliationPendingCount(): number {
  if (SUPABASE_ENABLED) {
    let n = 0;
    for (const a of getAgencies(ALL_PARTNERS)) {
      if (a.unreviewed) n += 1;
      // #117 an unreviewed agency's auto head-office folds into its card (not a separate decision).
      const ho = `${a.name}, head office`.toLowerCase();
      n += (a.branches || []).filter((b) => b.unreviewed && !(a.unreviewed && b.name.toLowerCase() === ho)).length;
    }
    return n;
  }
  return MOCK_QUEUE.length;
}


/* =====================================================================
   Direct-rail agency matches (opndoor admin only).
   A separate queue from the on-the-fly review above: these are direct-signup
   applications whose free-text agency name we matched server-side. An exact
   name match pre-fills the agency; everything else is a person's call. The
   branch is ALWAYS a person's call. Resolving points the application at a real
   branch (partner_id stays opndoor-direct, enforced in SQL); dismissing marks
   it not-in-network and leaves it on the house branch.
   ===================================================================== */
export interface MatchCandidate { agency_id: string; name: string; partner_id: string; sim: number }

export interface AgencyMatchRow {
  applicationId: string;
  guaranteeRef: string;
  tenantName: string;
  property: string;
  /** What the tenant typed, verbatim. */
  typedName: string;
  /** The one exact-match agency, or null when zero or several. */
  autoAgencyId: string | null;
  autoAgencyName: string | null;
  /** Top fuzzy candidates, logged for calibration and shown as hints. Never auto-accepted. */
  candidates: MatchCandidate[];
  when: string;
}

export interface MatchBranch { id: string; name: string; area: string | null }

export async function loadAgencyMatchQueue(): Promise<AgencyMatchRow[]> {
  if (SUPABASE_ENABLED) {
    const { data, error } = await sb().rpc('agency_match_queue');
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((r: any) => ({
      applicationId: r.application_id,
      guaranteeRef: r.guarantee_ref,
      tenantName: r.tenant_name || 'A tenant',
      property: r.property || '',
      typedName: r.typed_name || '',
      autoAgencyId: r.auto_agency_id ?? null,
      autoAgencyName: r.auto_agency_name ?? null,
      candidates: Array.isArray(r.candidates) ? r.candidates : [],
      when: r.created_at ? fmtWhen(r.created_at) : '',
    }));
  }
  return MOCK_AGENCY_MATCHES.slice();
}

export async function loadMatchBranchOptions(agencyId: string): Promise<MatchBranch[]> {
  if (SUPABASE_ENABLED) {
    const { data, error } = await sb().rpc('agency_branches_for_match', { p_agency: agencyId });
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((b: any) => ({ id: b.branch_id, name: b.name, area: b.area ?? null }));
  }
  return MOCK_MATCH_BRANCHES[agencyId] ?? [];
}

export async function resolveAgencyMatch(applicationId: string, branchId: string): Promise<void> {
  if (SUPABASE_ENABLED) {
    const { error } = await sb().rpc('resolve_agency_match', { p_application: applicationId, p_branch: branchId });
    if (error) throw new Error(error.message);
    return;
  }
  const i = MOCK_AGENCY_MATCHES.findIndex((r) => r.applicationId === applicationId);
  if (i >= 0) MOCK_AGENCY_MATCHES.splice(i, 1);
}

export async function dismissAgencyMatch(applicationId: string, note?: string): Promise<void> {
  if (SUPABASE_ENABLED) {
    const { error } = await sb().rpc('dismiss_agency_match', { p_application: applicationId, p_note: note ?? null });
    if (error) throw new Error(error.message);
    return;
  }
  const i = MOCK_AGENCY_MATCHES.findIndex((r) => r.applicationId === applicationId);
  if (i >= 0) MOCK_AGENCY_MATCHES.splice(i, 1);
}

const MOCK_AGENCY_MATCHES: AgencyMatchRow[] = [
  { applicationId: 'am1', guaranteeRef: 'GR-1000', tenantName: 'Sam Okafor', property: 'Leeds LS1 4DY',
    typedName: 'Meridian Lettings', autoAgencyId: 'ag-meridian', autoAgencyName: 'Meridian Lettings',
    candidates: [{ agency_id: 'ag-meridian', name: 'Meridian Lettings', partner_id: 'p1', sim: 1 }], when: '24/08/2026 · 12:00' },
  { applicationId: 'am2', guaranteeRef: 'GR-1001', tenantName: 'Alex Field', property: 'Sheffield S1 2HH',
    typedName: 'barnad & co', autoAgencyId: null, autoAgencyName: null,
    candidates: [{ agency_id: 'ag-barnard', name: 'Barnard & Co', partner_id: 'p1', sim: 0.62 }], when: '24/08/2026 · 11:30' },
];
const MOCK_MATCH_BRANCHES: Record<string, MatchBranch[]> = {
  'ag-meridian': [{ id: 'br-m-city', name: 'City Centre', area: 'LS1' }, { id: 'br-m-hq', name: 'Head office', area: null }],
  'ag-barnard': [{ id: 'br-b-1', name: 'Sheffield', area: 'S1' }],
};
