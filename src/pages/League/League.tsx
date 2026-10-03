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
  ALL_PARTNERS, buildLeagueDoc, exportBranded, fmtBig, getAgencies, getLeague, getPeriods, partnerName,
  getReferrerLeague, maySeeCommission, isOpndoorStaff,
  type LeagueRow, type LeagueScope, type LeagueView, type ReferrerBoard, type Period,
} from '@/data';
/* THE SAME DEFAULT REPORTING USES, from the one place it is written.
   League keeps its own period state, deliberately, but there is no
   reason for the two screens to disagree about where to start. */
import { DEFAULT_PERIOD } from '@/data/mock/analyticsModel';
import { PeriodSelect, RankSelect } from '@/components/ui/Select';
import { isAgencyUser } from '@/data/capabilities';
import { ScopePicker } from '@/components/ui/ScopePicker';
import { recentScopes } from '@/data/scopeRecents';
import { originFromParams, originOptions } from '@/data/origin';
import { rankFromParam } from '@/data/leagueLink';
import { uniqueAgencyIdByName, uniqueBranchIdByName } from '@/data/orgService';
import { scopedSummaries } from '@/data/applicationsService';
import { getPositions, type Position } from '@/data/positionsService';
import { liveScopeShape } from '@/data/liveAnalytics';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Button } from '@/components/ui/Button';
import { withoutVia, rowIsItsOwnPartner } from '@/data/viaSupplier';
import { Icon } from '@/components/ui/Icon';
import { Card, CardFoot } from '@/components/ui/Card';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { RoleOnly } from '@/components/ui/RoleOnly';
import './League.css';

const PAGE = 15;
/* `sub` IS IN HERE AND IS NOT SORTABLE. It is the referrer board's
   "Agency or supplier" column, added 2026-10-02, and it is the row's
   existing sub-line -- where somebody works, which groupRows already
   fills -- promoted to a column of its own rather than a second
   lookup. */
type SortKey = keyof Pick<LeagueRow, 'name' | 'sub' | 'refs' | 'fees' | 'paid' | 'deed' | 'sp' | 'conv' | 'partnerComm' | 'agentComm'>;
type Col = [SortKey, string, boolean]; // [key, label, sortable]

/* THE MOVEMENT COLUMN, SAID IN WORDS. Matt, 2026-10-01: 'rename the "7d"
   column to "Change this week" with a tooltip explaining "new" and "-"'.

   "7d" is how the figure was computed, not what it tells you, and the two
   things the column prints most often are a word and a dash that it never
   explained anywhere. */
const MOVEMENT_TITLE = 'Change in rank since the same table seven days ago. '
  + '"new" means this row was not on the board a week ago. '
  + '"-" means its position has not changed.';

const COLS: Record<LeagueView, Col[]> = {
  agency: [['name', 'Agency', false], ['refs', 'Referrals', true], ['fees', 'Fees collected', true], ['paid', 'Paid', true], ['deed', 'Deeds', true], ['sp', 'Sent to paid', true], ['conv', 'Sent to deed', true], ['partnerComm', 'Supplier comm.', true], ['agentComm', 'Agent comm.', true]],
  /* A BRANCH generates fees; it only EARNS commission when it holds a rate of its
     own, because under the additive model the agency (or group) is the payee
     otherwise. So the branch board leads on fees generated, and the commission
     column shows a dash wherever the branch is not itself a payee — rather than
     repeating its agency's earnings against every branch name. */
  branch: [['name', 'Branch', false], ['refs', 'Referrals', true], ['fees', 'Fees generated', true], ['paid', 'Paid', true], ['deed', 'Deeds', true], ['sp', 'Sent to paid', true], ['conv', 'Sent to deed', true], ['partnerComm', 'Supplier comm.', true], ['agentComm', 'Own commission', true]],
  /* "REFERRERS", NOT "NEGOTIATORS". Matt, 2026-10-02: "call it
     'Referrers' on screen and in the export, since it includes Directors
     and supplier staff". Negotiator is one LEVEL on our estate's ladder,
     and this board ranks everybody who sent a referral -- a Director who
     typed one in, and a supplier's own staff, neither of whom is a
     Negotiator. The tab named the smallest of the three populations it
     holds.

     AND WHERE THEY WORK, which the board could not say: two people of
     one name at two companies read as one person with a strange total,
     and a supplier's referrer sitting among our agencies' looked like
     one of ours. */
  referrer: [['name', 'Referrer', false], ['sub', 'Agency or supplier', false], ['refs', 'Referrals', true], ['fees', 'Fees collected', true], ['paid', 'Paid', true], ['deed', 'Deeds', true], ['sp', 'Sent to paid', true], ['conv', 'Sent to deed', true]],
  /* THE SAME MEASURES AS THE OTHERS, which is what Matt asked for, and
     the same two commission columns: a supplier IS a payee, so its own
     cut is the figure the board is most often read for. */
  supplier: [['name', 'Supplier', false], ['refs', 'Referrals', true], ['fees', 'Fees collected', true], ['paid', 'Paid', true], ['deed', 'Deeds', true], ['sp', 'Sent to paid', true], ['conv', 'Sent to deed', true], ['partnerComm', 'Supplier comm.', true], ['agentComm', 'Agent comm.', true]],
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
  /* SUPPLIERS, LAST AND OPNDOOR-ONLY. Matt, 2026-09-30: "Admin only;
     agencies and suppliers never see it." A league of Opndoor's
     customers ranked against each other is not a thing a customer may
     read, so the tab does not EXIST for them rather than being empty:
     an empty board still tells a supplier that the ranking is there. */
  { id: 'supplier', label: 'Suppliers' },
];

/* RANK BY, per board. Fees is the default everywhere. The fees column is named
   differently on the branch board (a branch GENERATES fees, it does not collect
   them, because under the additive model its agency is usually the payee), so
   the option reads off the same COLS row the column header does rather than
   restating it and drifting. */
function RANK_OPTIONS(view: LeagueView): { value: string; label: string }[] {
  const label = (key: string, fallback: string) =>
    (COLS[view]?.find((c) => c[0] === key)?.[1] as string) ?? fallback;
  return [
    { value: 'fees', label: label('fees', 'Fees collected') },
    { value: 'refs', label: label('refs', 'Referrals') },
    { value: 'deed', label: label('deed', 'Deeds') },
  ];
}

/** The opening sentence, naming exactly the boards on the page. Lower-cased and
    listed with an Oxford-free "and", so one tab reads "Every negotiator ranked
    in full." and three read "Every agency, branch and negotiator ranked in
    full." */
export function introFor(tabs: { id: LeagueView; label: string }[]): string {
  /* "EVERYONE WHO HAS REFERRED", not "every negotiator". Matt,
     2026-10-01. A Director and a Manager refer too and are both on this
     board, so naming it after the junior level described the wrong set --
     and the people it left out are the ones most likely to be reading. */
  const words = tabs.map((t) => ({ agency: 'agency', branch: 'branch', referrer: 'negotiator', supplier: 'supplier' }[t.id] ?? t.label.toLowerCase()));
  if (!words.length) return 'Nothing to rank in this scope yet.';
  if (words.length === 1 && words[0] === 'negotiator') return 'Everyone who has referred, ranked in full.';
  const list = words.length === 1
    ? words[0]
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  return `Every ${list} ranked in full.`;
}


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

/* #5 The League opens on its own period, independent of the dashboard's
   selection, then the user can change it locally.

   LAST 30 DAYS SINCE 2026-10-01. Matt: "default League and Reporting to
   'Last 30 days' instead of 'This calendar month', so they aren't empty
   on the 1st of the month." A league table of a month that started this
   morning ranks nobody, and the 1st is exactly when people look. */
/* AND A LINK MAY SET IT. Matt, 2026-10-03: "Reporting's 'View all'
   links open League on its default period instead of the period selected
   on Reporting. Carry the period (and the chosen measure) across in the
   link, so League shows the same rows." The page still OWNS the period
   -- the dashboard's selection does not follow the reader around, which
   is the rule above -- but a link that says which period it means is the
   reader asking, not a filter leaking between pages. An unknown or
   absent id falls back to the page's own default. */
function useLeaguePeriod(asked?: string | null): [Period, (id: string) => void] {
  const periods = getPeriods();
  const [period, setPeriodState] = useState<Period>(() => (
    periods.find((p) => p.id === asked)
    ?? periods.find((p) => p.id === DEFAULT_PERIOD)
    ?? periods[0]
  ));
  return [period, (id: string) => setPeriodState(periods.find((p) => p.id === id) ?? periods[0])];
}

// #5/#107 Week-over-week rank movement (▲n up / ▼n down / – held / new = no prior
// standing, e.g. new entrant or no 7-day comparison yet). Rendered explicitly, never
// blank.
function Movement({ m }: { m: number | null }) {
  if (m == null) return <span className="lt-move lt-move--new" title="New, or no comparison 7 days ago">new</span>;
  if (m === 0) return <span className="lt-move lt-move--flat" title="No change">-</span>;
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
  /* THE PERIOD OFF THE LINK HERE TOO. A negotiator pressing "View all"
     under Reporting's referrer chart lands on this board, not the full
     one, so carrying the period on only the full view would have left
     exactly the readers the chart is about on the default. */
  const [refParams] = useSearchParams();
  const [period, setPeriod] = useLeaguePeriod(refParams.get('period'));
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
                  {showMovement && <th style={{ width: 120 }} title={MOVEMENT_TITLE}>Change this week</th>}
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
  const { role, partnerScope, currentUserId, scopeSel, setScopeSel, dataVersion } = useSession();
  const [params] = useSearchParams();
  const [period, setPeriod] = useLeaguePeriod(params.get('period'));
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
  /* AND THE ORIGIN THIS VISIT OPENS ON. Matt, 2026-10-02: "League has
     also picked up Origin: Direct from Applications, so the Agencies
     table shows 'No matches'. Filters must not carry between pages:
     League, Applications and Reporting each open with their own defaults
     (Origin: Everything) unless a link sets a filter."

     `scopeSel` is one session value and this page reads it, so a
     selection made on Applications was still in force here -- and the
     direct rail has no agencies in it at all, so the Agencies board
     emptied. The rule is the same one Applications now applies on
     arrival: a link decides, and a link that names nothing clears it.
     Written here rather than in SessionContext because "its own default"
     is the page's to state, and League's happens to be the same as
     everybody's. */
  useEffect(() => {
    const fromLink = originFromParams({
      origin: params.get('origin'),
      partner: params.get('partner'),
      route: params.get('route'),
    });
    if (fromLink !== scopeSel) setScopeSel(fromLink);
    // Arrival only, exactly as on Applications: re-running this whenever
    // the selection changes would make the link override the picker for
    // as long as the reader stayed on the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const myScope = useMemo(() => scopeFromPositions(positions), [positions]);
  const [scope, setScope] = useState<LeagueScope>('mine');

  // WHICH BOARDS THERE ARE TO RANK. A board over a population of one is a
  // single row under a header that already names it, so the Agencies tab drops
  // out for a single-agency viewer and the Branches tab for a single-branch one.
  // Referrers always stays: people are the one thing every scope has several of,
  // and it is the board an agency actually reads. Applies to an admin too, the
  // moment the partner selector narrows them to one agency.
  const shape = useMemo(() => liveScopeShape(role, partnerScope), [role, partnerScope]);
  const agencyViewer = isAgencyUser(role, partnerScope);
  const opndoorStaff = isOpndoorStaff(role);
  const tabs = useMemo(() => TABS.filter((t) =>
    t.id === 'referrer'
    || (t.id === 'agency' && shape.agencies > 1)
    || (t.id === 'branch' && shape.branches > 1)
    // Opndoor staff only, and never for a reader narrowed to one party:
    // a ranking of one is not a ranking, the rule the other boards follow.
    || (t.id === 'supplier' && opndoorStaff)), [shape, opndoorStaff]);

  const askedView = (params.get('view') as LeagueView) || 'agency';
  // Fall back to a tab that exists rather than rendering an empty board: a
  // ?view=agency link followed by a single-agency manager lands on Referrers.
  const initialView = tabs.some((t) => t.id === askedView) ? askedView : (tabs[tabs.length - 1]?.id ?? 'referrer');
  const [view, setView] = useState<LeagueView>(COLS[initialView] ? initialView : 'referrer');
  useEffect(() => {
    if (!tabs.some((t) => t.id === view)) setView(tabs[tabs.length - 1]?.id ?? 'referrer');
  }, [tabs, view]);
  const [q, setQ] = useState('');
  /* AND THE MEASURE OFF THE LINK. Fees is the board's own default; a
     link that names a measure ("Referral count" on the chart, `refs`
     here) opens on that column instead, so "View all" under a chart
     ranked by referrals does not re-rank the same rows by money. The
     mapping between the two vocabularies is in data/leagueLink.ts. */
  const [sort, setSort] = useState<SortKey>(() => rankFromParam(params.get('rank')) ?? 'fees');
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
  /* THE OPTIONS COME FROM THE BOOK BEFORE THE SELECTION, exactly as on
     Applications: built from the filtered set the control would hold
     only what is already chosen, with no way back to anything else. */
  const leagueBook = useMemo(
    () => scopedSummaries({ role, scope: ALL_PARTNERS }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role, dataVersion],
  );
  const leagueOrigins = useMemo(() => originOptions(leagueBook, scopeSel), [leagueBook, scopeSel]);
  const all = getLeague(view, { role, scope: ALL_PARTNERS, partner: activePartner, period, branchIds, sel: scopeSel });

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
  /* The control shows the ranked column when the order is descending by one of
     the three it offers, and falls back to Fees the moment the reader sorts by
     something else (a name, a conversion rate) or flips to ascending, because
     "ranked by fees, smallest first" is not a ranking anybody means. */
  const rankBy: SortKey = (dir === -1 && (['fees', 'refs', 'deed'] as SortKey[]).includes(sort)) ? sort : 'fees';
  function rankByChange(col: SortKey) {
    setSort(col);
    setDir(-1);
    setPage(0);
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
              global partner selection even when the in-page selector is hidden).

              NOT THE ROUTE, FOR AN AGENCY USER. partnerName resolves a house-route
              partner through houseRouteLabel, so a Regent reader saw
              "Performance · This month · Agency referral": the name of the rail
              their agency sits on, which is opndoor plumbing and means nothing to
              them. The admin's in-page selector arm (`partner`) and a supplier
              reading their own partner name both keep it, which is what #100 was
              about. */}
          {/* AND THE RAIL'S NAME IS OFF BOTH ARMS, not one. The guard was on
              the scope arm only, so a Regent Director with the in-page
              partner selector set still read "Performance · This month ·
              Agency referral" -- the name of the house route their agency
              sits on, which is opndoor plumbing. Matt, 2026-10-01: "remove
              'Agency referral' from the header line." */}
          <Eyebrow>Performance · {period.label}{!agencyViewer && partner ? ` · ${partnerName(partner)}` : ''}{!agencyViewer && !partner && partnerScope !== ALL_PARTNERS ? ` · ${partnerName(partnerScope)}` : ''}{myScope.hasToggle && shape.branches > 1 ? ` · ${scope === 'mine' ? myScope.label : 'Whole company'}` : ''}</Eyebrow>
          <h1 className="page-head__title" style={{ marginTop: 10 }}>League tables</h1>
          {/* BUILT FROM THE TABS ACTUALLY SHOWN. This was hardcoded to "Every
              agency, branch and referrer", which promised a Regent Director three
              boards over a page showing one, and named them with the old
              vocabulary. The tabs are already filtered by scope; the sentence now
              reads off the same list rather than describing a different page. */}
          <p className="page-head__sub">{introFor(tabs)} Search, sort by any metric, and page through the whole book. The dashboard shows the top ten; this is the complete list.</p>
        </div>
        <div className="page-head__actions">
          {myScope.hasToggle && shape.branches > 1 && <ScopeToggle scope={scope} setScope={setScope} mineLabel={myScope.label} />}
          {/* RANK BY, as a control rather than only as a clickable column.
              Sorting by clicking a heading is discoverable once you know tables
              do that; the question "who is top by fees" deserves to be answerable
              without knowing. It writes the same sort state the headings do, so
              the two cannot disagree, and the heading arrow still moves when you
              use it. Deeds is offered because the column is already there and
              already sortable, so it costs one line. */}
          <RankSelect
            ariaLabel="Rank by"
            value={rankBy}
            onChange={(v: string) => rankByChange(v as SortKey)}
            options={RANK_OPTIONS(view)}
          />
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
          <Button variant="dark" size="sm" onClick={() => void exportBranded(buildLeagueDoc(role, partnerScope, partner, period, view, branchIds))} title={`Downloads the ${TABS.find((t) => t.id === view)?.label} table as a branded Excel workbook`}>
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
        {/* THE SAME CONTROL AS APPLICATIONS, and the same VALUE. Matt,
            2026-09-30: "replace the 'All partners' dropdown with a
            searchable filter that can narrow to any single agency (e.g.
            Regent's Lettings), group or supplier, or to all agencies or
            all suppliers. Branches and Negotiators tabs follow the
            selection."

            The dropdown it replaces could only ever name a PARTNER, so
            an admin could not narrow the league to one agency at all --
            every agency we onboard shares the house partner. A second
            control that behaved almost like Applications' is how two
            screens come to disagree, so this is that control, reading
            the scope selection the session already holds. */}
        <RoleOnly roles={['superadmin']}>
          <ScopePicker
            ariaLabel="Origin"
            value={scopeSel}
            options={leagueOrigins}
            recents={recentScopes()}
            onChange={(v: string) => { setScopeSel(v); setPage(0); }}
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
                {showMovement && <th style={{ width: 120 }} title={MOVEMENT_TITLE}>Change this week</th>}
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
                /* BY ID WHERE THE ROW CAN BE RESOLVED TO ONE. Matt,
                   2026-10-02: "Links must filter by the agency's or
                   branch's id, everywhere."

                   A LEAGUE ROW IS NOT A RECORD, which is the honest
                   difficulty here. It is an aggregate keyed on
                   `${partner}\u0000${name}`, built from application
                   SUMMARIES, and a summary carries its agency as a
                   string -- there is no agency id anywhere in the data
                   this board is made of. So the id is looked up by
                   name, and where one name is two agencies the lookup
                   refuses rather than guessing: the link then falls
                   back to the name, which is what it has always done,
                   and the row's own sub-line already names the estate.

                   Fixing it properly means carrying agency_id on the
                   application summary, which is a change to the
                   hydration every screen reads. It is in docs/QUEUE.md
                   under "For Matt in the morning" rather than done
                   quietly as part of a link change. */
                const one = view === 'agency' ? uniqueAgencyIdByName(r.name)
                  : view === 'branch' ? uniqueBranchIdByName(r.name) : null;
                const drill = view === 'agency'
                  ? (one ? `/applications?agencyId=${encodeURIComponent(one)}` : `/applications?agency=${encodeURIComponent(r.name)}`)
                  : view === 'branch'
                    ? (one ? `/applications?branchId=${encodeURIComponent(one)}` : `/applications?branch=${encodeURIComponent(r.name)}`)
                    : `/applications?referrer=${encodeURIComponent(r.name)}`;
                const hasSubCol = cols.some((c) => c[0] === 'sub');
                return (
                  <tr key={`${r.name}-${r.sub}`} onClick={() => navigate(drill)} style={{ cursor: 'pointer' }} title={`View applications for ${r.name}`}>
                    <td className="num"><span className={`rank${rank <= 3 ? ' top' : ''}`}>{rank}</span></td>
                    {showMovement && <td><Movement m={r.movement ?? null} /></td>}
                    {cols.map((c, ci) =>
                      ci === 0 ? (
                        /* THE SUPPLIER IS SAID ONCE. Matt, 2026-10-02:
                           "where a row already shows its supplier (the
                           tag on screen ...), drop '(via …)' from the
                           name so it isn't said twice." `showPartner` is
                           exactly the condition that the tag is drawn,
                           so it is also exactly the condition that the
                           suffix is redundant.

                           AND THE SUB LINE MOVES OUT where the board has
                           a column for it: the referrer board gained
                           "Agency or supplier", and leaving the same
                           text stacked under the name would be the
                           duplication this instruction is about in a
                           second form. */
                        <td key={c[0]}>
                          <div className="lt-name">
                            {showPartner ? withoutVia(r.name) : r.name}
                            {/* AND NOT WHERE THE ROW IS THE PARTNER. On the
                                Suppliers board the name and the tag are the
                                same string, so this printed "Kestrel Lettings
                                / Kestrel Lettings". The tag is attribution,
                                and a row about the supplier has nothing to
                                attribute. */}
                            {showPartner && r.partner && !rowIsItsOwnPartner(r)
                              ? <span className="lt-partner">{r.partner}</span> : null}
                          </div>
                          {!hasSubCol && !rowIsItsOwnPartner(r) && <div className="lt-sub">{r.sub}</div>}
                        </td>
                      ) : c[0] === 'sub' ? (
                        <td key={c[0]} className="soft">{showPartner ? withoutVia(r.sub) : r.sub}</td>
                      ) : (
                        /* THE RANKED COLUMN IS BOLD, in every row and not only
                           in its heading. Both columns are always shown, so
                           without this the only sign of which one the order
                           follows is a small arrow at the top of a long table. */
                        <td key={c[0]} className={`num${sort === c[0] ? ' is-ranked' : ''}`}>{cellFor(c[0], r, view)}</td>
                      ),
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className={`lt-empty${total ? '' : ' is-shown'}`}>No matches.</div>
        {/* THE SAME NOTE THE DASHBOARD'S FUNNEL CARRIES, because this
            board's two conversion columns are the same measure. Matt,
            2026-10-02: "add the dashboard's one-line note that a rate can
            exceed 100% when payments land this period for referrals sent
            earlier."

            A RATE OVER 100% READS AS A BUG and is not one: each column
            counts the events that happened INSIDE the period, so a
            referral sent in August and paid in September is a payment
            with no sent to divide by. The dashboard explained that and
            League, which ranks people on those very columns, did not. */}
        <div className="lt-note">
          <Icon name="info" strokeWidth={2} />
          <span>
            Conversion is <b>period throughput</b>: each column counts the events that occurred within the
            period, so a rate can exceed 100% when payments or deeds land this period for referrals sent earlier.
          </span>
        </div>
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
