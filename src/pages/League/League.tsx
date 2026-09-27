/* =====================================================================
   League tables — the full ranked lists behind the dashboard breakdowns.

   Management / opndoor admin: tabs for Agencies, Branches and Referrers;
   sortable, searchable, paged, with a partner filter for opndoor admin.

   Referrers (#79): a single own-partner Referrers board (no Agencies/Branches
   tabs, no export), showing positions and referral counts. Fees collected are
   shown only when their partner's setting is "Full"; commission is never shown.
   The per-partner setting (Full / Rankings only / Private, #88) is edited by
   opndoor admin in Manage partner; Management edits it here for their own partner
   (they cannot reach the admin-only Manage partner screen), and admin sees it
   read-only here.

   Director / Manager: both are role 'management' and both read these tables in
   full. A Manager is the level WITHOUT sees_commission, so the two commission
   columns come off their boards and the commission workbook behind Export is
   refused them. Nothing else narrows: the ranking is by referrals and fees
   collected, which is the book they run, so the board still tells them who is
   performing. See COMMISSION_COLS below and RoleOnly's header note.

   Data comes from getLeague / getReferrerLeague (the service). Sorting,
   searching and paging are presentation concerns handled here.
   ===================================================================== */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ALL_PARTNERS, buildLeagueDoc, exportBranded, fmtBig, getAgencies, getLeague, getPartners, getPeriods, partnerName,
  getReferrerLeague, maySeeCommission,
  type LeagueRow, type LeagueScope, type LeagueView, type ReferrerBoard, type Period,
} from '@/data';
import { getPositions, type Position } from '@/data/positionsService';
import { liveScopeShape } from '@/data/liveAnalytics';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card, CardFoot } from '@/components/ui/Card';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { RoleOnly } from '@/components/ui/RoleOnly';
import { PartnerSelect, PeriodSelect } from '@/components/ui/Select';
import './League.css';

const PAGE = 15;
type SortKey = keyof Pick<LeagueRow, 'name' | 'refs' | 'fees' | 'paid' | 'deed' | 'sp' | 'conv' | 'partnerComm' | 'agentComm'>;
type Col = [SortKey, string, boolean]; // [key, label, sortable]

const COLS: Record<LeagueView, Col[]> = {
  agency: [['name', 'Agency', false], ['refs', 'Referrals', true], ['fees', 'Fees collected', true], ['paid', 'Paid', true], ['deed', 'Deeds', true], ['sp', 'Sent to Paid', true], ['conv', 'Sent to Deed', true], ['partnerComm', 'Partner comm.', true], ['agentComm', 'Agent comm.', true]],
  /* A BRANCH generates fees; it only EARNS commission when it holds a rate of its
     own, because under the additive model the agency (or group) is the payee
     otherwise. So the branch board leads on fees generated, and the commission
     column shows a dash wherever the branch is not itself a payee — rather than
     repeating its agency's earnings against every branch name. */
  branch: [['name', 'Branch', false], ['refs', 'Referrals', true], ['fees', 'Fees generated', true], ['paid', 'Paid', true], ['deed', 'Deeds', true], ['sp', 'Sent to Paid', true], ['conv', 'Sent to Deed', true], ['partnerComm', 'Partner comm.', true], ['agentComm', 'Own commission', true]],
  referrer: [['name', 'Referrer', false], ['refs', 'Referrals', true], ['fees', 'Fees collected', true], ['paid', 'Paid', true], ['deed', 'Deeds', true], ['sp', 'Sent to Paid', true], ['conv', 'Sent to Deed', true]],
};

/* THE TWO COLUMNS A MANAGER MAY NOT HAVE, and why only these two.
   Each states what somebody EARNS out of the fees sitting beside it: partnerComm
   is the partner's cut, agentComm the agency's (or the branch's own, where it
   holds a rate). Divide either by the fees column on the same row and you have
   the rate itself, which is the figure the four rate routes were gated to keep
   back in 20261005170000, so leaving these on screen made that gating pointless.

   WHAT WAS VISIBLE BEFORE: a Manager opened Agencies or Branches and read Partner
   comm. and Agent comm. down every row, for their whole agency and every branch
   in it, and could sort the book by either. The service hands those figures to
   any management role (getLeague applies the rates itself), so nothing upstream
   was going to stop it.

   NOTHING ELSE COMES OFF. Referrals, fees collected, Paid, Deeds and the two
   conversion chips are volume and the price the tenants were charged: a Manager
   sees every one of those referrals individually already, and gating them would
   take away the league they are there to read. Referrers are not in this
   population at all, they get ReferrerLeagueView. */
const COMMISSION_COLS = new Set<SortKey>(['partnerComm', 'agentComm']);

const TABS: { id: LeagueView; label: string }[] = [
  { id: 'agency', label: 'Agencies' },
  { id: 'branch', label: 'Branches' },
  { id: 'referrer', label: 'Referrers' },
];


function ConvChip({ cv }: { cv: number }) {
  const cls = cv >= 0.7 ? '' : cv >= 0.6 ? 'mid' : 'low';
  return (
    <span className="conv-chip">
      <span className={`conv-dot ${cls}`} />
      {Math.round(cv * 100)}%
    </span>
  );
}

function cellFor(col: SortKey, r: LeagueRow, view?: LeagueView) {
  switch (col) {
    case 'refs': return r.refs.toLocaleString('en-GB');
    case 'fees': return fmtBig(r.fees);
    case 'deed': return r.deed.toLocaleString('en-GB');
    case 'paid': return r.paid.toLocaleString('en-GB');
    case 'sp': return <ConvChip cv={r.sp} />;
    case 'conv': return <ConvChip cv={r.conv} />;
    case 'partnerComm': return fmtBig(r.partnerComm);
    case 'agentComm':
      // On the branch board an empty figure means "this branch holds no rate of
      // its own", which is a different statement from "it earned nothing".
      if (view === 'branch' && !r.agentComm) return <span className="soft">-</span>;
      return fmtBig(r.agentComm);
    default: return r.name;
  }
}

export function League() {
  const { role } = useSession();
  // Referrers get a restricted own-partner board; everyone else the full tables.
  return role === 'referrer' ? <ReferrerLeagueView /> : <FullLeagueView />;
}

// #5 The League always opens on This calendar month (all roles), independent of
// the dashboard's period selection, then the user can change it locally.
function useLeaguePeriod(): [Period, (id: string) => void] {
  const periods = getPeriods();
  const [period, setPeriodState] = useState<Period>(() => periods.find((p) => p.id === 'thismonth') ?? periods[0]);
  return [period, (id: string) => setPeriodState(periods.find((p) => p.id === id) ?? periods[0])];
}

// #5/#107 Week-over-week rank movement (▲n up / ▼n down / – held / new = no prior
// standing, e.g. new entrant or no 7-day comparison yet). Rendered explicitly, never
// blank.
function Movement({ m }: { m: number | null }) {
  if (m == null) return <span className="lt-move lt-move--new" title="New, or no comparison 7 days ago">new</span>;
  if (m === 0) return <span className="lt-move lt-move--flat" title="No change">–</span>;
  const up = m > 0;
  return <span className={`lt-move ${up ? 'lt-move--up' : 'lt-move--down'}`} title={`${up ? 'Up' : 'Down'} ${Math.abs(m)} since last week`}>{up ? '▲' : '▼'}{Math.abs(m)}</span>;
}

// The viewer's own branch set and a label for it, derived from their position(s).
// A group scope (or no position) is already the whole company, so it gets no
// narrower view and no toggle; an agency scope is "my brand"; branch scope(s) are
// "my branch(es)". The branch set is expanded from the hydrated org tree, which is
// itself scoped to the viewer, so it never reaches beyond what they may see.
function scopeFromPositions(positions: Position[]): { branchIds: string[]; label: string; hasToggle: boolean } {
  const branchScopes = positions.filter((p) => p.kind === 'branch');
  const agencyScopes = positions.filter((p) => p.kind === 'agency');
  const ids = new Set<string>();
  branchScopes.forEach((p) => { if (p.targetId) ids.add(p.targetId); });
  if (agencyScopes.length) {
    const agencies = getAgencies(ALL_PARTNERS);
    agencyScopes.forEach((p) => {
      const ag = agencies.find((a) => a.id === p.targetId);
      (ag?.branches ?? []).forEach((b) => { if (b.id) ids.add(b.id); });
    });
  }
  const label = agencyScopes.length ? 'My agency' : branchScopes.length > 1 ? 'My branches' : 'My branch';
  return { branchIds: [...ids], label, hasToggle: (agencyScopes.length > 0 || branchScopes.length > 0) && ids.size > 0 };
  // NOTE: hasToggle answers "does this person hold a narrower position"; the
  // caller ANDs it with whether the wider view is actually wider (more than one
  // branch in the book), because two identical tables behind a switch is worse
  // than one table.
}

// The my-scope / whole-company switch. Shown only where both views apply.
function ScopeToggle({ scope, setScope, mineLabel }: { scope: LeagueScope; setScope: (s: LeagueScope) => void; mineLabel: string }) {
  return (
    <div className="lt-scope" role="group" aria-label="League scope">
      <Button size="sm" variant={scope === 'mine' ? 'dark' : 'ghost'} onClick={() => setScope('mine')}>{mineLabel}</Button>
      <Button size="sm" variant={scope === 'company' ? 'dark' : 'ghost'} onClick={() => setScope('company')}>Whole company</Button>
    </div>
  );
}

// ---- Referrer view (#79): own-partner board, positions + counts (+ fees when Full). ----
function ReferrerLeagueView() {
  usePageMeta('league', 'League table', ['Home', 'League table']);
  const [period, setPeriod] = useLeaguePeriod();
  /* A negotiator sees their branch's league and their company's, and the toggle
     between them is only worth drawing when the two differ. At a single-office
     agency, which is most of them, "my branch" and "whole company" are the same
     table, so the control offered a choice with one answer and switching it
     appeared to do nothing.

     Same predicate as the full view below (liveScopeShape), so the two cannot
     disagree about how many branches the reader has. */
  const { role, partnerScope } = useSession();
  const shape = useMemo(() => liveScopeShape(role, partnerScope), [role, partnerScope]);
  const [scope, setScope] = useState<LeagueScope>('mine');
  const [board, setBoard] = useState<ReferrerBoard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getReferrerLeague(period, scope)
      .then((b) => { if (alive) { setBoard(b); setLoading(false); } })
      .catch(() => { if (alive) { setBoard({ mode: 'full', rows: [] }); setLoading(false); } });
    return () => { alive = false; };
  }, [period, scope]);

  const mode = board?.mode ?? 'full';
  const rows = board?.rows ?? [];
  const showFees = mode === 'full' || mode === 'private';
  const showMovement = rows.some((r) => r.movement != null);
  const own = rows.find((r) => r.self) ?? rows[0];

  return (
    <>
      <div className="backbar" style={{ marginBottom: 16 }}>
        <Button variant="quiet" size="sm" to="/dashboard"><Icon name="arrowLeft" /> Back to dashboard</Button>
      </div>

      <div className="page-head">
        <div>
          <Eyebrow>Performance · {period.label} · {scope === 'mine' ? 'My branch' : 'Whole company'}</Eyebrow>
          <h1 className="page-head__title" style={{ marginTop: 10 }}>Referrer leaderboard</h1>
          <p className="page-head__sub">
            {mode === 'private'
              ? 'Your own referral performance for the selected period.'
              : scope === 'mine'
                ? 'How you rank among referrers at your branch, by referrals sent in the selected period.'
                : 'How you rank among referrers across your whole company, by referrals sent in the selected period.'}
          </p>
        </div>
        <div className="page-head__actions">
          {shape.branches > 1 && <ScopeToggle scope={scope} setScope={setScope} mineLabel="My branch" />}
          <PeriodSelect ariaLabel="League time period" value={period.id} onChange={setPeriod} options={getPeriods().map((p) => ({ value: p.id, label: p.label }))} />
        </div>
      </div>

      <Card>
        {loading ? (
          <div className="lt-empty is-shown">Loading…</div>
        ) : mode === 'private' ? (
          <div className="rl-own">
            <div className="rl-own__stat"><span className="rl-own__n">{(own?.refs ?? 0).toLocaleString('en-GB')}</span><span className="rl-own__l">Referrals sent</span></div>
            {showFees && <div className="rl-own__stat"><span className="rl-own__n">{fmtBig(own?.fees ?? 0)}</span><span className="rl-own__l">Fees collected</span></div>}
            <p className="rl-note">The referrer leaderboard is private here, so only your own performance is shown.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="dt">
              <thead>
                <tr>
                  <th className="num" style={{ width: 44 }}>#</th>
                  {/* THE 7d COLUMN NEEDS TWO PERIODS TO BE A COMPARISON.
                      Movement is the rank difference against the same table seven
                      days ago, and it is null when there is no prior standing. On a
                      board whose first week this is, EVERY row is null, so the
                      column was a header over a full column of the word "new": it
                      says nothing and takes the width of something that does. It
                      appears once at least one row has a comparison to make. */}
                  {showMovement && <th style={{ width: 56 }} title="Movement since the same table 7 days ago">7d</th>}
                  <th>Referrer</th>
                  <th className="num">Referrals</th>
                  {showFees && <th className="num">Fees collected</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.name}-${i}`} className={r.self ? 'is-self' : ''}>
                    <td className="num"><span className={`rank${i < 3 ? ' top' : ''}`}>{i + 1}</span></td>
                    {showMovement && <td><Movement m={r.movement} /></td>}
                    <td><div className="lt-name">{r.name}{r.self && <span className="lt-partner">You</span>}</div></td>
                    <td className="num">{r.refs.toLocaleString('en-GB')}</td>
                    {showFees && <td className="num">{fmtBig(r.fees)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <div className="lt-empty is-shown">No referrals in this period yet.</div>}
          </div>
        )}
        {!loading && mode === 'rankings' && rows.length > 0 && (
          <CardFoot><span className="pager__info">Fees are hidden on this leaderboard.</span></CardFoot>
        )}
      </Card>
    </>
  );
}

// ---- Full view (management / opndoor admin): unchanged tables + the #79 setting. ----
function FullLeagueView() {
  usePageMeta('league', 'League tables', ['Home', 'League tables']);
  const { role, partnerScope, currentUserId } = useSession();
  const [period, setPeriod] = useLeaguePeriod();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  // The viewer's position in the org, which decides whether the league narrows to
  // their brand/branches and what the "mine" toggle is called. A group director or
  // a scope-less/opndoor admin has no narrower view (the whole company is theirs),
  // so no toggle appears for them.
  const [positions, setPositions] = useState<Position[]>([]);
  useEffect(() => {
    if (!currentUserId) { setPositions([]); return; }
    let alive = true;
    getPositions(currentUserId).then((p) => { if (alive) setPositions(p); }).catch(() => { if (alive) setPositions([]); });
    return () => { alive = false; };
  }, [currentUserId]);
  const myScope = useMemo(() => scopeFromPositions(positions), [positions]);
  const [scope, setScope] = useState<LeagueScope>('mine');

  // WHICH BOARDS THERE ARE TO RANK. A board over a population of one is a
  // single row under a header that already names it, so the Agencies tab drops
  // out for a single-agency viewer and the Branches tab for a single-branch one.
  // Referrers always stays: people are the one thing every scope has several of,
  // and it is the board an agency actually reads. Applies to an admin too, the
  // moment the partner selector narrows them to one agency.
  const shape = useMemo(() => liveScopeShape(role, partnerScope), [role, partnerScope]);
  const tabs = useMemo(() => TABS.filter((t) =>
    t.id === 'referrer'
    || (t.id === 'agency' && shape.agencies > 1)
    || (t.id === 'branch' && shape.branches > 1)), [shape]);

  const askedView = (params.get('view') as LeagueView) || 'agency';
  // Fall back to a tab that exists rather than rendering an empty board: a
  // ?view=agency link followed by a single-agency manager lands on Referrers.
  const initialView = tabs.some((t) => t.id === askedView) ? askedView : (tabs[tabs.length - 1]?.id ?? 'referrer');
  const [view, setView] = useState<LeagueView>(COLS[initialView] ? initialView : 'referrer');
  useEffect(() => {
    if (!tabs.some((t) => t.id === view)) setView(tabs[tabs.length - 1]?.id ?? 'referrer');
  }, [tabs, view]);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('fees');
  const [dir, setDir] = useState<-1 | 1>(-1);
  const [page, setPage] = useState(0);
  const [partner, setPartner] = useState(() => (partnerScope === ALL_PARTNERS ? '' : partnerScope));
  // Infer the ref type from the runtime value to avoid a missing-type error when
  // the PartnerScope type isn't available on the server build.
  const prevScope = useRef(partnerScope);

  useEffect(() => {
    if (partnerScope !== prevScope.current) {
      if (partner === prevScope.current) {
        setPartner(partnerScope === ALL_PARTNERS ? '' : partnerScope);
      }
      prevScope.current = partnerScope;
    }
  }, [partnerScope, partner]);

  // #114 Referrer-leaderboard visibility is set ONLY in Manage partner (the single
  // lever); the in-page control has been removed from the League screen.

  // A Director keeps both commission columns; a Manager reads the same board with
  // them dropped. Filtered here rather than in COLS so the board definitions above
  // stay the one description of each table, and so the header row and every body
  // row are built from the same list: they already map over `cols` together, which
  // is what keeps a hidden column from leaving a stray cell behind.
  const showComm = maySeeCommission(role);
  const cols = showComm ? COLS[view] : COLS[view].filter(([key]) => !COMMISSION_COLS.has(key));
  const activePartner = partnerScope === ALL_PARTNERS ? partner : partnerScope;
  const showPartner = partnerScope === ALL_PARTNERS && !partner;
  // "My brand / branches" narrows every tab to the viewer's own branch set; "Whole
  // company" (or no position) leaves it partner-wide as before.
  const branchIds = myScope.hasToggle && scope === 'mine' ? myScope.branchIds : undefined;
  const all = getLeague(view, { role, scope: ALL_PARTNERS, partner: activePartner, period, branchIds });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? all.filter((r) => `${r.name} ${r.sub}`.toLowerCase().includes(needle)) : all.slice();
    list.sort((a, b) => {
      const av = a[sort];
      const bv = b[sort];
      if (sort === 'name') return dir * (av < bv ? -1 : av > bv ? 1 : 0);
      return dir * ((av as number) - (bv as number));
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, q, sort, dir]);

  /* THE 7d COLUMN NEEDS TWO PERIODS TO BE A COMPARISON. Movement is the rank
     difference against the same table seven days ago and is null with no prior
     standing, so on a board's first week every row reads "new" and the column is a
     header over nothing. Computed off the UNFILTERED set: keying it to `filtered`
     would make the column appear and disappear as somebody searched or paged,
     which is worse than either state. */
  const showMovement = all.some((r) => r.movement != null);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const safePage = Math.min(page, pages - 1);
  const start = safePage * PAGE;
  const pageRows = filtered.slice(start, start + PAGE);

  function changeView(next: LeagueView) {
    setView(next);
    setPage(0);
    setSort('fees');
    setDir(-1);
  }
  function toggleSort(col: SortKey) {
    if (sort === col) setDir((d) => (d === 1 ? -1 : 1));
    else {
      setSort(col);
      setDir(col === 'name' ? 1 : -1);
    }
    setPage(0);
  }

  return (
    <>
      <div className="backbar" style={{ marginBottom: 16 }}>
        <Button variant="quiet" size="sm" to="/dashboard"><Icon name="arrowLeft" /> Back to dashboard</Button>
      </div>

      <div className="page-head">
        <div>
          {/* #100 Name the active scope truthfully (the table is scoped by the
              global partner selection even when the in-page selector is hidden). */}
          <Eyebrow>Performance · {period.label}{partner ? ` · ${partnerName(partner)}` : partnerScope !== ALL_PARTNERS ? ` · ${partnerName(partnerScope)}` : ''}{myScope.hasToggle && shape.branches > 1 ? ` · ${scope === 'mine' ? myScope.label : 'Whole company'}` : ''}</Eyebrow>
          <h1 className="page-head__title" style={{ marginTop: 10 }}>League tables</h1>
          <p className="page-head__sub">Every agency, branch and referrer ranked in full. Search, sort by any metric, and page through the whole book. The dashboard shows the top ten; this is the complete list.</p>
        </div>
        <div className="page-head__actions">
          {myScope.hasToggle && shape.branches > 1 && <ScopeToggle scope={scope} setScope={setScope} mineLabel={myScope.label} />}
          <PeriodSelect ariaLabel="League time period" value={period.id} onChange={setPeriod} options={getPeriods().map((p) => ({ value: p.id, label: p.label }))} />
          {/* NO GATE ON THE BUTTON, because the gate belongs in the document.
              buildLeagueDoc used to write Partner commission and Agent commission
              against every row with no reader test at all, relying on this button
              being hidden. It now drops those COLUMNS for a reader who may not see
              them and keeps the sheets, which is the right shape: the league is
              who referred how much, and that is a Manager's job, every branch and
              every member of their team.
              This was briefly wrapped in <RoleOnly roles={['superadmin',
              'management']} commission> during the commission sweep, which took
              the whole workbook away from a Manager to withhold one column, and
              took it from opndoor_manager and developer as well, neither of whom
              the sweep was about. Withheld figures, not withheld documents. */}
          <Button variant="dark" size="sm" onClick={() => void exportBranded(buildLeagueDoc(role, partnerScope, partner, period, view))} title={`Downloads the ${TABS.find((t) => t.id === view)?.label} table as a branded Excel workbook`}>
            <Icon name="download" /> Export
          </Button>
        </div>
      </div>

      <div className="lt-toolbar">
        <div className="lt-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} className={`lt-tab${view === t.id ? ' is-active' : ''}`} role="tab" onClick={() => changeView(t.id)}>{t.label}</button>
          ))}
        </div>
      </div>

      <div className="lt-toolbar">
        <div className="lt-search">
          <Icon name="search" />
          <input type="text" placeholder="Search by name" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        </div>
        <RoleOnly roles={['superadmin']}>
          <PartnerSelect
            ariaLabel="Partner"
            value={partnerScope === ALL_PARTNERS ? (partner || ALL_PARTNERS) : partnerScope}
            onChange={(v) => { setPartner(v === ALL_PARTNERS ? '' : v); setPage(0); }}
            disabled={partnerScope !== ALL_PARTNERS}
            title={partnerScope !== ALL_PARTNERS ? 'This league view is already scoped by the selected partner.' : undefined}
            options={[{ value: ALL_PARTNERS, label: 'All partners' }, ...getPartners().map((p) => ({ value: p.id, label: p.name }))]}
          />
        </RoleOnly>
        <span className="lt-count">Showing <b>{total ? `${start + 1}-${Math.min(start + PAGE, total)}` : '0'}</b> of <b>{total}</b></span>
      </div>

      <Card>
        <div className="table-wrap">
          <table className="dt">
            <thead>
              <tr>
                <th className="num" style={{ width: 44 }}>#</th>
                {showMovement && <th style={{ width: 56 }} title="Movement since the same table 7 days ago">7d</th>}
                {cols.map((c) => {
                  const [key, label, sortable] = c;
                  const isSort = sort === key;
                  return (
                    <th
                      key={key}
                      className={`${sortable ? 'sortable' : ''}${key !== 'name' ? ' num' : ''}${isSort ? ' is-sort' : ''}`}
                      onClick={sortable ? () => toggleSort(key) : undefined}
                    >
                      {label}
                      {sortable && <span className="sort-ar">{isSort && dir === 1 ? '▲' : '▼'}</span>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, i) => {
                const rank = start + i + 1;
                // #owner Drill through to the matching Applications filter (management +
                // opndoor admin view only — this table is the full view). Referrer rows
                // link to ?referrer=, exactly as agency/branch figures drill elsewhere.
                const drill = view === 'agency' ? `/applications?agency=${encodeURIComponent(r.name)}`
                  : view === 'branch' ? `/applications?branch=${encodeURIComponent(r.name)}`
                  : `/applications?referrer=${encodeURIComponent(r.name)}`;
                return (
                  <tr key={`${r.name}-${r.sub}`} onClick={() => navigate(drill)} style={{ cursor: 'pointer' }} title={`View applications for ${r.name}`}>
                    <td className="num"><span className={`rank${rank <= 3 ? ' top' : ''}`}>{rank}</span></td>
                    {showMovement && <td><Movement m={r.movement ?? null} /></td>}
                    {cols.map((c, ci) =>
                      ci === 0 ? (
                        <td key={c[0]}>
                          <div className="lt-name">{r.name}{showPartner && r.partner ? <span className="lt-partner">{r.partner}</span> : null}</div>
                          <div className="lt-sub">{r.sub}</div>
                        </td>
                      ) : (
                        <td key={c[0]} className="num">{cellFor(c[0], r, view)}</td>
                      ),
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className={`lt-empty${total ? '' : ' is-shown'}`}>No matches.</div>
        <CardFoot>
          <div className="pager" style={{ width: '100%' }}>
            <span className="pager__info">Page {safePage + 1} of {pages}</span>
            <div className="pager__btns">
              <Button variant="ghost" size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0}>Previous</Button>
              <Button variant="ghost" size="sm" onClick={() => setPage((p) => p + 1)} disabled={safePage >= pages - 1}>Next</Button>
            </div>
          </div>
        </CardFoot>
      </Card>
    </>
  );
}
