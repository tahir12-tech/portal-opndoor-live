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
import { useConfirm } from '@/components/ui/ConfirmModal';
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
        row.matchedBy === 'email'
          ? <AutoMatchItem key={row.applicationId} row={row} />
          : <MatchItem key={row.applicationId} row={row} onDone={after} />
      ))}
      <div className={`empty${!loading && rows.length === 0 ? ' is-shown' : ''}`}>
        No tenant is waiting to be linked to their letting agent.
      </div>
    </div>
  );
}

/* An email auto-match: the contact email was exact and carried a branch, so it set
   the agency and the branch itself, pinned to the direct route. Read-only, shown so
   the tab records that it happened and how. */
function AutoMatchItem({ row }: { row: AgencyMatchRow }) {
  return (
    <div className="rqitem">
      <span className="rqitem__ic rqitem__ic--agency"><Icon name="building" /></span>
      <div className="rqitem__main">
        <div className="rqitem__top">
          <span className="rqitem__name">Tenant typed “{row.typedName}”</span>
          <span className="tag tag--admin">Email match</span>
        </div>
        <div className="rqitem__meta">
          {row.guaranteeRef} · {row.tenantName}{row.property ? ` · ${row.property}` : ''} · {row.when}
        </div>
        {/* TWO DIFFERENT MATCHES, TWO DIFFERENT LABELS. This block is an
            email match, already linked; the one further down is a name
            match awaiting a person. Both said "Matched", which told a
            reader nothing about why one needed them and the other did
            not. */}
        <div className="match">
          <span className="match__lbl">Email matches</span>
          <span className="match__txt">
            The agent&rsquo;s email address matches <b>{row.autoAgencyName}</b>
            {row.resolvedBranchName ? <> · <b>{row.resolvedBranchName}</b></> : null}, so this was linked
            automatically and needs nothing from you.
          </span>
        </div>
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
  const { ask, confirmEl } = useConfirm();

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

  /* WALK FIX 23. BOTH OF THESE USED TO RUN ON THE CLICK.
     Matt: "'Set branch' and 'Not in network' act immediately. Both need a
     confirmation box first, saying in plain English what will happen."

     Both are one-way from this screen: on success the row leaves the
     queue, so there is no undo and no second chance to read what
     happened. The sentences are built from the row rather than written as
     constants, because a confirmation that does not name the record is
     the same click with a step in front of it. */
  const chosenBranchName = branches.find((b) => b.id === branchId)?.name ?? '';

  async function doResolve() {
    setBusy(true);
    try {
      await resolveAgencyMatch(row.applicationId, branchId);
      toast(`${row.guaranteeRef} placed under ${chosenAgencyName}.`, 'ok');
      await onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not set the branch.', 'error');
      setBusy(false);
      throw e;
    }
  }

  async function doDismiss() {
    setBusy(true);
    try {
      await dismissAgencyMatch(row.applicationId);
      toast(`${row.guaranteeRef} stays with Opndoor direct. ${row.typedName} is on the Not in network list.`, 'ok');
      await onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not dismiss.', 'error');
      setBusy(false);
      throw e;
    }
  }

  function askResolve() {
    if (!branchId || busy) return;
    ask({
      title: <>Link this tenant&rsquo;s agent to {chosenAgencyName}, {chosenBranchName}?</>,
      body: (
        <>
          The tenant typed &ldquo;{row.typedName}&rdquo;. This application will be recorded
          against the <b>{chosenBranchName}</b> office of <b>{chosenAgencyName}</b>. It stays an
          Opndoor direct referral and the commission does not move.
        </>
      ),
      confirmLabel: 'Link to this office',
      run: doResolve,
    });
  }

  function askDismiss() {
    if (busy) return;
    ask({
      title: <>We do not work with {row.typedName}?</>,
      body: (
        <>
          This tenant stays with Opndoor direct. <b>{row.typedName}</b> goes on the
          Not in network list, with the agent contact the tenant gave, for someone to add to
          HubSpot by hand.
        </>
      ),
      confirmLabel: 'We do not work with them',
      danger: true,
      run: doDismiss,
    });
  }

  return (
    <div className="rqitem" style={busy ? { opacity: 0.5 } : undefined}>
      {confirmEl}
      <span className="rqitem__ic rqitem__ic--agency"><Icon name="building" /></span>
      <div className="rqitem__main">
        <div className="rqitem__top">
          <span className="rqitem__name">Tenant typed “{row.typedName}”</span>
          {row.autoAgencyId
            ? <span className="tag tag--admin">Name matches</span>
            : <span className="tag">No exact match</span>}
        </div>
        <div className="rqitem__meta">
          {row.guaranteeRef} · {row.tenantName}{row.property ? ` · ${row.property}` : ''} · {row.when}
        </div>

        {row.autoAgencyId ? (
          <div className="match">
            {/* The BADGE above already says "Name matches". This label says
                what the reader has to DO about it, so the row does not
                print the same two words twice. */}
            <span className="match__lbl">Choose an office</span>
            <span className="match__txt">The name the tenant typed matches <b>{row.autoAgencyName}</b> exactly. Choose which of their offices to record it against.</span>
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
        <Button variant="ghost" size="sm" disabled={busy} onClick={askDismiss}>
          Not in network
        </Button>
        <Button variant="primary" size="sm" disabled={busy || !branchId} onClick={askResolve}>
          <Icon name="check" strokeWidth={2.2} /> Set branch
        </Button>
      </div>
    </div>
  );
}
