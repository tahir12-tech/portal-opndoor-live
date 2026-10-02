/* =====================================================================
   Reconciliation (opndoor admin only, enforced by the route guard).
   The real queue of agencies/branches created on the fly by referrers
   (review_state = pending_review), each with its parent, creator, created-at,
   attached referral count, and a same/similar-name hint against confirmed
   records. "Confirm as new" promotes it to a confirmed canonical record
   (audited). The Sync button pushes confirmed records to the CRM on demand (a
   2-minute cron also runs the sync). Merge is not built yet (disabled).
   ===================================================================== */
import { useCallback, useEffect, useRef, useState } from 'react';
import { confirmReconEntity, loadReconciliationQueue, loadAgencyMatchQueue, loadNotInNetworkAgencies, loadRefundQuestions, loadSupplierAgenciesWithoutAnEmail, triggerCrmSync, reconciliationLandingTab, reconciliationTotals, NO_RECONCILIATION_WORK, type ReconRow, type ReconciliationTotals } from '@/data';
import { AgencyMatchQueue } from './AgencyMatchQueue';
import { NotInNetwork } from './NotInNetwork';
import { NoAgencyEmail } from './NoAgencyEmail';
import { RefundQuestions } from './RefundQuestions';
import { useSearchParams } from 'react-router-dom';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import '@/components/ui/opbar.css';
import './Reconciliation.css';
import { plural } from '@/lib/plural';

type Filter = 'all' | 'agency' | 'branch' | 'dupes' | 'matches' | 'notinnetwork' | 'refunds' | 'noemail';

export function Reconciliation() {
  usePageMeta('reconcile', 'Reconciliation', ['Home', 'opndoor', 'Reconciliation']);
  const toast = useToast();
  const { refresh: refreshData } = useSession();
  const [queue, setQueue] = useState<ReconRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [params] = useSearchParams();
  /* ?tab= lets Home's cards land on the queue they are counting. Home's
     "Agency matches" card counts the Direct matches tab and used to link at the
     page, which opens on All: the reader arrived at a number they had just
     clicked and a list that does not contain it. */
  const [filter, setFilter] = useState<Filter>(() => {
    const t = params.get('tab');
    /* A WHITELIST OF LITERALS, so a new tab has to be named here to be
       deep-linkable. Miss it and the page opens on All: the reader arrives
       at a number they just clicked and a list that does not contain it,
       which is the exact defect the comment above records. */
    return t === 'agency' || t === 'branch' || t === 'dupes' || t === 'matches' || t === 'notinnetwork'
      || t === 'refunds' || t === 'noemail' ? t : 'all';
  });
  const [totals, setTotals] = useState<ReconciliationTotals>(NO_RECONCILIATION_WORK);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const reload = useCallback(async () => {
    try {
      /* THE COUNTS THE TAB STRIP SHOWS, loaded together. A loader added here
         without a mock-mode branch rejects the whole Promise.all in test
         mode and takes the other counts down with it, so the not-in-network
         reader has one -- see reconciliationService. */
      const [q, matches, notIn, refunds, noEmail] = await Promise.all([
        loadReconciliationQueue(), loadAgencyMatchQueue(), loadNotInNetworkAgencies(),
        loadRefundQuestions(), loadSupplierAgenciesWithoutAnEmail(),
      ]);
      setQueue(q);
      /* THE COUNTS COME FROM THE SHARED FUNCTION, not from five
         `.length`s here. Matt, 2026-10-02: the All tab, the tiles, Home
         and the sidebar all state this page's total, and they were
         three different subsets. The matches count in particular was
         `matches.length` here and needs-review-only on Home, so the two
         disagreed about one queue. */
      setTotals(reconciliationTotals({ review: q, matches, refunds, noEmail, notInNetwork: notIn }));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not load the reconciliation queue.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void reload(); }, [reload]);

  const dupes = queue.filter((i) => i.match).length;
  const newOnes = queue.length - dupes;
  const agencyCount = queue.filter((i) => i.type === 'agency').length;
  const branchCount = queue.filter((i) => i.type === 'branch').length;

  const tabs: { id: Filter; label: string; count: number }[] = [
    /* AND THE SUBSET TABS ARE NOT IN IT. Agencies, Branches and "Might
       already exist" below are slices of the review queue, so adding
       them would count every new record three times. */
    { id: 'all', label: 'All', count: totals.all },
    { id: 'agency', label: 'Agencies', count: agencyCount },
    { id: 'branch', label: 'Branches', count: branchCount },
    { id: 'dupes', label: 'Might already exist', count: dupes },
    /* The LABEL changes and the id does NOT. Home links here with
       ?tab=matches and the whitelist keys on that literal, so renaming
       the id would break a link from another page. */
    { id: 'matches', label: 'Agents named by tenants', count: totals.matches },
    /* ABOVE "Not in network" because it IS work, and money: a refund on
       commission already sent is waiting on a decision only a person can
       make, and nothing moves until they make it. */
    { id: 'refunds', label: 'Refunds on sent statements', count: totals.refunds },
    /* AFTER the refunds, which are money waiting on a decision, and BEFORE
       "Not in network", which is the only tab that is not work. This one is
       work: open the agency and add a contact. Matt, 2026-10-02: "list them
       on Reconciliation so Opndoor can add one." */
    { id: 'noemail', label: 'Supplier agencies with no email', count: totals.noEmail },
    /* NM-N. Last, because it is the only tab that is not WORK: nothing on
       it can be actioned here, it is a list to retype into HubSpot. */
    { id: 'notinnetwork', label: 'Not in network', count: totals.notInNetwork },
  ];

  /* OPEN ON A TAB THAT HAS WORK. This was written when "All" counted the
     review queue alone, so a page whose only outstanding work was a direct
     match opened on an empty list under a heading saying there was nothing
     to do. All holds everything now, so the rule it needs is Matt's:
     "opens on whichever tab has items (or All)" -- the one tab when there
     is exactly one, and All when there are several, because All is where
     they can be seen together.

     `reconciliationLandingTab` decides, shared with Home's link so the two
     cannot send a reader to different places. Applied ONCE, on the first
     load that produces counts, and never again: re-deciding on every
     render would drag the reader off a tab they had chosen the moment they
     cleared its last row. */
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || loading) return;
    landed.current = true;
    // Only when the reader did not ask for a tab.
    if (params.get('tab')) return;
    const land = reconciliationLandingTab(totals);
    if (land !== 'all') setFilter(land as Filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, params]);

  const passes = (item: ReconRow) => (filter === 'all' ? true : filter === 'dupes' ? !!item.match : item.type === filter);
  const visible = queue.filter(passes);

  async function confirm(item: ReconRow) {
    if (busyId) return;
    setBusyId(item.id);
    try {
      await confirmReconEntity(item.type, item.entityId);
      // #118/#119: nudge an immediate HubSpot sync (fire-and-forget) so the confirmed
      // org appears in HubSpot within seconds; the 2-minute cron remains the backstop.
      void triggerCrmSync().catch(() => {});
      await refreshData(); // re-hydrate so the sidebar pending badge decrements
      toast(`"${item.name}" is now a confirmed ${item.type}. Sending it to HubSpot.`);
      await reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not confirm the record.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function syncNow() {
    if (syncing) return;
    setSyncing(true);
    try {
      await triggerCrmSync();
      toast('CRM sync started. Confirmed records update within about 2 minutes.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not start the CRM sync.', 'error');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="rec-eyebrow"><span className="opx">opndoor</span> · internal admin</div>
          <h1 className="page-head__title" style={{ marginTop: 10 }}>Reconciliation</h1>
          {/* WALK FIX 22a. This said "created on the fly by referrers", "new
              canonical records" and ended with a sentence about a later
              release. Between them they described our schema, our plumbing
              and our roadmap, and never once said what a person is looking
              at or why. */}
          <p className="page-head__sub">Direct tenants tell us who their letting agent is, and referrers can add an agency or branch as they go. Both land here so someone checks them before they become a record we work from. Confirmed agencies and branches go to HubSpot within a couple of minutes, or press Sync now.</p>
        </div>
        <div className="page-head__actions">
          <Button variant="ghost" size="sm" disabled={syncing} onClick={syncNow} title="Send confirmed agencies and branches to HubSpot now. This also runs by itself every couple of minutes."><Icon name="refresh" /> {syncing ? 'Sending…' : 'Sync now'}</Button>
        </div>
      </div>

      <div className="card opbar">
        <Icon name="shield" />
        <span>Visible to <b>opndoor admins</b> only. Supplier and agency users never see this reconciliation view.</span>
      </div>

      {/* THE TILES COUNT WHAT IS ACTUALLY WAITING. Matt, same instruction.
          The first said "Awaiting review" and counted the review queue
          alone, so on dev it read 0 above a tab strip holding three rows
          of work. It is the page's total now, and the two beside it say
          out loud that they are of the new records, because a part that
          does not add up to the whole beside it is the "two numbers that
          cannot both be a total" Matt named on Applications. */}
      <div className="qstat">
        <div className="qstat__card">
          <div className="qstat__n">{totals.all}</div>
          <div className="qstat__l">Waiting</div>
          <div className="qstat__s">everything on this page</div>
        </div>
        <div className="qstat__card">
          <div className="qstat__n" style={{ color: 'var(--warn)' }}>{dupes}</div>
          <div className="qstat__l">Possible duplicates</div>
          <div className="qstat__s">of the {queue.length} new {plural(queue.length, 'record')}</div>
        </div>
        <div className="qstat__card">
          <div className="qstat__n" style={{ color: 'var(--heliotrope-deep)' }}>{newOnes}</div>
          <div className="qstat__l">Nothing similar found</div>
          <div className="qstat__s">of the {queue.length} new {plural(queue.length, 'record')}</div>
        </div>
      </div>

      <div className="rtabs">
        {tabs.map((t) => (
          <button key={t.id} className={`rtab${filter === t.id ? ' is-active' : ''}`} onClick={() => setFilter(t.id)}>
            {t.label} <span className="rtab__c">{t.count}</span>
          </button>
        ))}
      </div>

      {filter === 'matches' ? (
        <AgencyMatchQueue onChanged={reload} />
      ) : filter === 'notinnetwork' ? (
        <NotInNetwork />
      ) : filter === 'refunds' ? (
        <RefundQuestions onChanged={reload} />
      ) : filter === 'noemail' ? (
        <NoAgencyEmail onChanged={reload} />
      ) : (
      <div className="rq">
        {visible.map((item) => {
          const parent = item.type === 'branch' ? <>Under <b>{item.parent}</b> · </> : null;
          return (
            <div className="rqitem" key={item.id} style={busyId === item.id ? { opacity: 0.5 } : undefined}>
              <span className={`rqitem__ic ${item.type === 'agency' ? 'rqitem__ic--agency' : 'rqitem__ic--branch'}`}>
                <Icon name={item.type === 'agency' ? 'building' : 'home'} />
              </span>
              <div className="rqitem__main">
                <div className="rqitem__top">
                  <span className="rqitem__name">{item.name}</span>
                  {item.type === 'agency' ? <span className="tag tag--admin">New agency</span> : <span className="tag">New branch</span>}
                </div>
                <div className="rqitem__meta">{parent}created by <b>{item.by}</b> · {item.when} · {item.refs} {plural(item.refs, 'referral')} attached</div>
                {item.foldedHeadOffice && (
                  <div className="rqitem__meta" style={{ color: 'var(--ink-mute)' }}>Includes its “Head office” branch. Confirming the agency confirms both.</div>
                )}

                {item.match ? (
                  <div className="match">
                    <span className="match__lbl">{item.matchExact ? 'Same name already exists' : 'Might be the same'}</span>
                    <span className="match__txt">There is already a <b>{item.match}</b>{item.matchExact ? ', spelled exactly the same' : ', spelled similarly'}</span>
                  </div>
                ) : (
                  <div className="match match--none">
                    <span className="match__lbl">Nothing similar found</span>
                    <span className="match__txt">Nothing similar is on file. Probably genuinely new.</span>
                  </div>
                )}
              </div>

              <div className="rqitem__actions">
                {/* THE "Merge into..." BUTTON IS GONE. It had been permanently
                    disabled with "coming in a later release", which is the
                    same promise Matt quoted from the page text, in another
                    form. A control that can never be pressed is not a
                    feature; it is a roadmap item taking up space on a
                    screen somebody is trying to work. It comes back when
                    merging does. */}
                <Button variant="primary" size="sm" disabled={busyId === item.id} onClick={() => confirm(item)}>
                  <Icon name="check" strokeWidth={2.2} /> Confirm as new
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* AND ON "ALL", EVERY OTHER TAB'S ITEMS, UNDER THEIR OWN HEADINGS.
          Matt, 2026-10-02: "The 'All' tab must include every item from
          every tab." It showed the review queue alone, so on dev it said
          "Nothing to check" with two agencies needing an email and one
          not in network a click away.

          THE SECTIONS ARE THE SAME COMPONENTS the tabs render, not a
          second rendering of the same rows: one list of agencies without
          an email, read in two places, cannot disagree with itself.

          AND ONLY WHERE THERE IS SOMETHING. A heading over an empty
          section is the "Nothing to check" problem again, four times. */}
      {filter === 'all' && (
        <>
          {totals.matches > 0 && (
            <><h2 className="rec-sec">Agents named by tenants</h2><AgencyMatchQueue onChanged={reload} /></>
          )}
          {totals.refunds > 0 && (
            <><h2 className="rec-sec">Refunds on sent statements</h2><RefundQuestions onChanged={reload} /></>
          )}
          {totals.noEmail > 0 && (
            <><h2 className="rec-sec">Supplier agencies with no email</h2><NoAgencyEmail onChanged={reload} /></>
          )}
          {totals.notInNetwork > 0 && (
            <><h2 className="rec-sec">Not in network</h2><NotInNetwork /></>
          )}
        </>
      )}

      {/* THE EMPTY STATE NOW SPEAKS FOR WHAT THE TAB SHOWS. It said
          "nothing to check" whenever the REVIEW QUEUE was empty, which on
          All is a flat contradiction of the sections above it. On All it
          waits until the whole page is empty; on the three slices of the
          review queue it still speaks for that queue, which is all they
          show. */}
      {filter === 'all' ? (
        <div className={`empty${!loading && totals.all === 0 ? ' is-shown' : ''}`}>Nothing to check. Every agency and branch on file has been confirmed, and nothing else is waiting.</div>
      ) : filter !== 'matches' && filter !== 'notinnetwork' && filter !== 'refunds' && filter !== 'noemail' ? (
        <div className={`empty${!loading && queue.length === 0 ? ' is-shown' : ''}`}>Nothing to check. Every agency and branch on file has been confirmed.</div>
      ) : null}
    </>
  );
}
