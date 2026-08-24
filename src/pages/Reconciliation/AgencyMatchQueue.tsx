/* =====================================================================
   Direct-rail agency matches (opndoor admin only).

   A direct-signup tenant typed a letting agency name; we matched it to the
   network server-side, invisibly. An EXACT name match pre-selects the agency.
   Everything else is a person's call, and the BRANCH is always a person's call,
   whatever the agency outcome. Resolving points the application at a real
   branch; the route (opndoor-direct) is pinned in SQL and does not move.
   ===================================================================== */
import { useCallback, useEffect, useState } from 'react';
import {
  loadAgencyMatchQueue, loadMatchBranchOptions, resolveAgencyMatch, dismissAgencyMatch,
  type AgencyMatchRow, type MatchBranch,
} from '@/data';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';

export function AgencyMatchQueue({ onChanged }: { onChanged?: () => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<AgencyMatchRow[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try { setRows(await loadAgencyMatchQueue()); }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not load the agency matches.', 'error'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { void reload(); }, [reload]);

  const after = async () => { await reload(); onChanged?.(); };

  return (
    <div className="rq">
      {rows.map((row) => (
        <MatchItem key={row.applicationId} row={row} onDone={after} />
      ))}
      <div className={`empty${!loading && rows.length === 0 ? ' is-shown' : ''}`}>
        No direct applications waiting on an agency. The queue is clear.
      </div>
    </div>
  );
}

function MatchItem({ row, onDone }: { row: AgencyMatchRow; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // Which agency the admin is placing this under. Defaults to the exact match.
  const [agencyId, setAgencyId] = useState<string | null>(row.autoAgencyId);
  const [branches, setBranches] = useState<MatchBranch[]>([]);
  const [branchId, setBranchId] = useState<string>('');

  const chosenAgencyName =
    agencyId === row.autoAgencyId ? row.autoAgencyName
      : row.candidates.find((c) => c.agency_id === agencyId)?.name ?? null;

  // Load the chosen agency's branches whenever it changes. The branch is never
  // guessed; the admin always picks from the real list.
  useEffect(() => {
    let live = true;
    setBranchId('');
    if (!agencyId) { setBranches([]); return; }
    void loadMatchBranchOptions(agencyId)
      .then((b) => { if (live) setBranches(b); })
      .catch((e) => toast(e instanceof Error ? e.message : 'Could not load branches.', 'error'));
    return () => { live = false; };
  }, [agencyId, toast]);

  async function confirm() {
    if (!branchId || busy) return;
    setBusy(true);
    try {
      await resolveAgencyMatch(row.applicationId, branchId);
      toast(`${row.guaranteeRef} placed under ${chosenAgencyName}.`, 'ok');
      await onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not set the branch.', 'error');
      setBusy(false);
    }
  }

  async function dismiss() {
    if (busy) return;
    setBusy(true);
    try {
      await dismissAgencyMatch(row.applicationId);
      toast(`${row.guaranteeRef} left on the direct house branch.`, 'ok');
      await onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not dismiss.', 'error');
      setBusy(false);
    }
  }

  return (
    <div className="rqitem" style={busy ? { opacity: 0.5 } : undefined}>
      <span className="rqitem__ic rqitem__ic--agency"><Icon name="building" /></span>
      <div className="rqitem__main">
        <div className="rqitem__top">
          <span className="rqitem__name">Tenant typed “{row.typedName}”</span>
          {row.autoAgencyId
            ? <span className="tag tag--admin">Exact match</span>
            : <span className="tag">No exact match</span>}
        </div>
        <div className="rqitem__meta">
          {row.guaranteeRef} · {row.tenantName}{row.property ? ` · ${row.property}` : ''} · {row.when}
        </div>

        {row.autoAgencyId ? (
          <div className="match">
            <span className="match__lbl">Matched</span>
            <span className="match__txt">Exact name match to <b>{row.autoAgencyName}</b>. Pick the branch.</span>
          </div>
        ) : row.candidates.length ? (
          <div className="match match--none">
            <span className="match__lbl">Closest names</span>
            <span className="match__txt">
              {row.candidates.slice(0, 3).map((c, i) => (
                <span key={c.agency_id}>
                  {i > 0 ? ', ' : ''}
                  <button type="button" className="linkish"
                    style={{ background: 'none', border: 0, padding: 0, font: 'inherit', textDecoration: 'underline', cursor: 'pointer', color: agencyId === c.agency_id ? 'var(--heliotrope-deep)' : 'inherit' }}
                    onClick={() => setAgencyId(c.agency_id)}>
                    {c.name}
                  </button>
                  {` (${Math.round(c.sim * 100)}%)`}
                </span>
              ))}
              . None auto-accepted; choose one or dismiss.
            </span>
          </div>
        ) : (
          <div className="match match--none">
            <span className="match__lbl">No candidates</span>
            <span className="match__txt">Nothing in the network resembles this name.</span>
          </div>
        )}

        {agencyId && (
          <div className="rqitem__meta" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>Branch of <b>{chosenAgencyName}</b>:</span>
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)}
              aria-label="Branch" disabled={busy || !branches.length}>
              <option value="">{branches.length ? 'Choose a branch…' : 'No branches on this agency'}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}{b.area ? ` · ${b.area}` : ''}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="rqitem__actions">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void dismiss()}>
          Not in network
        </Button>
        <Button variant="primary" size="sm" disabled={busy || !branchId} onClick={() => void confirm()}>
          <Icon name="check" strokeWidth={2.2} /> Set branch
        </Button>
      </div>
    </div>
  );
}
