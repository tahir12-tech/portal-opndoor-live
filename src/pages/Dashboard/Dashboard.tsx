/* =====================================================================
   Dashboard — the analytics home. Funnel, hero KPIs, commission (role-gated,
   per-partner rates), the three volume charts with measure dropdowns, the
   12-month trend (Management + opndoor admin), the support metrics, the
   period + partner filters, and the three CSV exports incl. the bordereau.

   Every figure comes from analyticsService/exportsService (the parametric
   model). INTEGRATION points live in those services, not here.

   COMMISSION IS A SECOND QUESTION ON THIS PAGE, not the same one as role.
   An agency has three levels and two of them are role 'management': a Director
   sees what the agency earns, a Manager sees everything else. Every gate here
   said roles={['superadmin', 'management']}, which a Manager satisfies, so this
   page read the agency's earnings out to them: the commission tile, Commission
   by partner, the commission statement, both settlement blocks, the settlements
   needs-attention line, and the 12-month trend, which OPENED on Commission
   earned. The surfaces that state earnings now carry `commission` (RoleOnly
   consults maySeeCommission for those, and only those); the trend keeps its card
   and loses the one measure. Fees the TENANT was charged, guaranteed rent,
   volumes, conversion and expiries stay: they are the Manager's own referrals
   and gating them would take away the level rather than protect it.
   ===================================================================== */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ALL_PARTNERS, buildApplicationDoc, buildExpiriesCsv, buildPerformanceDoc, buildPartnerStatementDoc, buildAgentStatementDoc, downloadCsv, exportBranded,
  fmtBig, getCommissionSettlement, getAgentCommissionSettlement, livePartnerBreakdown, getDashboardData, getPartners, getPeriods, getTrend, maySeeCommission, partnerName,
  type LeagueRow, type Period, type TrendRow,
} from '@/data';
import { formatLondonDate } from '@/lib/format';
import { BASIS_META, type ExportBasis } from '@/data';
import { getAgentRailFunnel, viewerRunsEligibilityJourney, type AgentRailFunnel } from '@/data/agentFunnel';
import { isAgencyUser } from '@/data/capabilities';
import { liveScopeShape } from '@/data/liveAnalytics';
import { CommissionStatement } from '@/components/CommissionStatement';
import { useSession } from '@/session/SessionContext';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card, CardBody, CardFoot, CardHead } from '@/components/ui/Card';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Pill } from '@/components/ui/Pill';
import { Tag } from '@/components/ui/Tag';
import { RoleOnly } from '@/components/ui/RoleOnly';
import { RoleNote } from '@/components/ui/RoleNote';
import { BarChart, type BarRow } from '@/components/ui/BarChart';
import { MeasureSelect, PeriodSelect, TrendSelect } from '@/components/ui/Select';
import './Dashboard.css';

type ChartKey = 'branch' | 'agency' | 'referrer';
type Measure = 'value' | 'count' | 'conv';
type TrendMeasure = 'commission' | 'value' | 'count';
type TrendView = 'month' | 'branch' | 'agency' | 'referrer';

const TOP_N = 10;

function measureLabel(m: string): string {
  return m === 'commission' ? 'Commission earned' : m === 'conv' ? 'Conversion, Sent to Deed' : m === 'value' ? 'Fees collected' : 'Referrals sent';
}

/**
 * Build the (top-10) bars for a volume chart: fees / count / conversion, with an
 * always-on Sent-to-Deed sub-line on branch and agency bars (and the parent
 * agency on branch bars). Returns the bars, the total for the count line, and a
 * fixed max for the conversion measure (scaled against 100%).
 */
function buildChartRows(key: ChartKey, rows: LeagueRow[], m: Measure): { bars: BarRow[]; total: number; max?: number } {
  const showConv = key === 'branch' || key === 'agency';
  const isConv = m === 'conv' && showConv;
  const total = rows.length;

  if (isConv) {
    const sorted = rows
      .map((r) => ({ label: r.name, sub: r.sub || undefined, pct: Math.round(r.conv * 100) }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, TOP_N);
    return { bars: sorted.map((x) => ({ label: x.label, sub: x.sub, value: x.pct, display: `${x.pct}%` })), total, max: 100 };
  }

  const sorted = rows.slice().sort((a, b) => (m === 'value' ? b.fees - a.fees : b.refs - a.refs)).slice(0, TOP_N);
  const bars: BarRow[] = sorted.map((r) => {
    const subBits: string[] = [];
    if (r.sub) subBits.push(r.sub);
    if (showConv) subBits.push(`${Math.round(r.conv * 100)}% Sent to Deed`);
    return { label: r.name, sub: subBits.join(' · ') || undefined, value: m === 'value' ? r.fees : r.refs, display: m === 'value' ? fmtBig(r.fees) : String(r.refs) };
  });
  return { bars, total };
}

export function Dashboard() {
  usePageMeta('dashboard', 'Reporting', ['Home', 'Reporting']);
  const { role, partnerScope, selectedPartner, setSelectedPartner, period, setPeriod } = useSession();

  /* IS THIS ONE OF OUR OWN AGENCIES READING THEIR OWN SCREEN?
     The same question Reporting, League, Applications and the nav already ask,
     and the same answer: not the role, which an agency director and a supplier's
     manager both wear as 'management', but the party in scope. */
  const agencyFacing = isAgencyUser(role, partnerScope);

  /* MAY THIS READER BE SHOWN WHAT THE AGENCY EARNS? A third question again, and
     not answerable from the role: Director and Manager are both 'management'.
     RoleOnly asks it for everything wrapped in `commission`, so this local copy
     is only for the figures that are not inside a RoleOnly at all (the
     settlements needs-attention line) and for the trend's measure list, where
     the card stays and one option goes. */
  const seesCommission = maySeeCommission(role);

  // Every figure comes from getDashboardData: live records in Supabase mode
  // (d.live), the deterministic synthetic model in mock/test mode.
  const d = useMemo(() => getDashboardData(role, period, partnerScope), [role, period, partnerScope]);
  // Partner commission settlement for the prior calendar month (payment-date
  // accrual, net of refunds), payable on the 15th. Live mode only; ignores the
  // period filter (it is a fixed monthly settlement question).
  const settlement = useMemo(() => getCommissionSettlement(role, partnerScope), [role, partnerScope]);
  // Agent commission settlement (agency level) and the per-partner commission
  // breakdown for the selected period. Live mode, non-referrers.
  const agentSettlement = useMemo(() => getAgentCommissionSettlement(role, partnerScope), [role, partnerScope]);
  const partnerBreakdown = useMemo(() => livePartnerBreakdown(role, partnerScope, period), [role, partnerScope, period]);
  // Settlement is a money-reconciliation surface: show pence on every row and the
  // total so the rows always sum to the stated total (commission is rent x rate,
  // which is frequently a half-pound).
  const gbpPence = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const settleDate = `${settlement.settlementDate.getDate()} ${settlement.settlementDate.toLocaleDateString('en-GB', { month: 'long' })} ${settlement.settlementDate.getFullYear()}`;
  const agentSettleDate = `${agentSettlement.settlementDate.getDate()} ${agentSettlement.settlementDate.toLocaleDateString('en-GB', { month: 'long' })} ${agentSettlement.settlementDate.getFullYear()}`;
 const dmyShort = (x: Date) => formatLondonDate(x);

  // #6 Per-payee commission statements: a branded, self-footing statement for one
  // partner (partner commission) or one agency (agent commission). Each builder reads
  // the SAME settlement data rendered below (getCommissionSettlement /
  // getAgentCommissionSettlement, same role + scope), so a downloaded statement foots
  // exactly to the on-screen settlement figure. Gated with the sections below (canSeeSettlements).
  const downloadPartnerStatement = (partnerId: string) => void exportBranded(buildPartnerStatementDoc(role, partnerScope, partnerId));
  const downloadAgentStatement = (partner: string, agency: string) => void exportBranded(buildAgentStatementDoc(role, partnerScope, partner, agency));

  // ---- Needs-attention row (compact stat-lines promoted from existing data) ----
  // Same scoped figures shown everywhere; each line renders only when non-zero.
  const canSeeSettlements = role === 'superadmin' || role === 'management';
  const partnerDue = settlement.partners.reduce((s, p) => s + p.commission, 0);
  // AUTHORITATIVE total: the sum of every payee line. The agencies rollup holds
  // agency-level lines only, so summing it would miss group and branch payees.
  const agentDue = agentSettlement.total;
  const settleDayMonth = `${settlement.settlementDate.getDate()} ${settlement.settlementDate.toLocaleDateString('en-GB', { month: 'long' })}`;
  // #81 Tenancy-start corrections now apply automatically from the agent's link
  // (no opndoor review), so the "corrections to review" needs-attention line and
  // its count are gone.

  // Agent-rail partner: the funnel runs Invited to Deed and gains early stuck
  // alerts. Per-partner decision (a supplier partner keeps the three-stage funnel);
  // only meaningful when scoped to a single partner, and only for staff who see the
  // funnel at all (canSeeSettlements). progress only, never content.
  /* THE JOURNEY, not the estate. This asked the PARTNER whether to draw nine
     stages, which is the estate question: Regent's partner is opndoor-agents, so
     it said yes, and a Regent manager would have opened the dashboard to nine
     stages with seven permanently zero. Their tenants arrive pre-referenced, so
     their journey is Sent, Paid, Deed.

     Resolved server-side and scoped: a manager sees their own agencies, an admin
     sees the partner they are viewing. A partner running BOTH journeys answers
     yes for an admin viewing all of it and no for a manager scoped to the
     pre-referenced agency alone. */
  const [runsEligibility, setRunsEligibility] = useState(false);
  useEffect(() => {
    let alive = true;
    viewerRunsEligibilityJourney(role === 'superadmin' && partnerScope !== ALL_PARTNERS ? partnerScope : undefined)
      .then((v) => { if (alive) setRunsEligibility(v); })
      .catch(() => { if (alive) setRunsEligibility(false); });
    return () => { alive = false; };
  }, [partnerScope, role]);

  const agentRailPartner = runsEligibility;
  const [agentFunnel, setAgentFunnel] = useState<AgentRailFunnel | null>(null);
  useEffect(() => {
    if (!agentRailPartner || !canSeeSettlements) { setAgentFunnel(null); return; }
    let alive = true;
    getAgentRailFunnel(role === 'superadmin' && partnerScope !== ALL_PARTNERS ? partnerScope : undefined)
      .then((f) => { if (alive) setAgentFunnel(f); })
      .catch(() => { if (alive) setAgentFunnel(null); });
    return () => { alive = false; };
  }, [agentRailPartner, canSeeSettlements, partnerScope, role]);

  const naAwaiting = d.live && d.awaiting > 0;
  const naStuckSent = d.stuckSent !== '0';
  // Settlement moved to the ops Home for opndoor admin; on Reporting the settlement
  // needs-attention line (and the #settlements anchor it jumps to) is a partner's
  // own payable, so it is management-only here.
  /* THE LOUDEST LEAK ON THE PAGE, and the only commission figure here that was
     never inside a RoleOnly to begin with: this line reads "Settlements due 15
     October: £X partner / £Y agent" at the top of the screen, above the funnel.
     `role === 'management'` is exactly what a Manager is, so a Manager opened
     Reporting to the agency's payable in bold before anything else loaded. It
     also anchors to #settlements, which is now gated, so leaving the line would
     have pointed at nothing. Both halves answer to the predicate now. */
  const naSettlements = d.live && role === 'management' && seesCommission && (partnerDue > 0 || agentDue > 0);
  // #93 Deed-delivery failure is ops furniture: management + opndoor admin only.
  const naNoContact = d.live && canSeeSettlements && d.deedsNoContact > 0;
  const naLapsing = d.live && canSeeSettlements && d.lapsing14 > 0;
  // Agent-rail early-stage stuck alerts (only when this partner is on that rail).
  const naStuckInvited = !!agentFunnel && agentFunnel.stuck_invited > 0;
  const naStuckFee = !!agentFunnel && agentFunnel.stuck_fee > 0;
  const naStuckRef = !!agentFunnel && agentFunnel.stuck_referencing > 0;
  const hasNeedsAttention = naAwaiting || naStuckSent || naSettlements || naNoContact || naLapsing || naStuckInvited || naStuckFee || naStuckRef;

  // #25: the agent settlement can span many agencies, so show the top 5 inline and
  // collapse the rest behind a "View all" expander. The Performance export always
  // carries the full list. (The partner settlement is a bounded set and stays full.)
  const agentTop = agentSettlement.payees.slice(0, 5);
  const agentRest = agentSettlement.payees.slice(5);
  const agentAgencyRow = (a: (typeof agentSettlement.payees)[number]) => (
    <div key={`${a.partner}-${a.agency}`} className="settle__partner">
      <div className="settle__row">
        <span>Agent commission payable to <b>{a.agency}</b></span>
        <span className="settle__amt">{gbpPence(a.commission)}</span>
      </div>
      <div style={{ marginTop: 8 }}>
        <Button variant="ghost" size="sm" onClick={() => downloadAgentStatement(a.partner, a.agency)} title={`Download a branded agent commission statement for ${a.agency} (${agentSettlement.monthLabel}). Foots to the figure above.`}>
          <Icon name="download" /> Download statement
        </Button>
      </div>
      <details className="settle__exp">
        <summary>Show applications ({a.apps.length})</summary>
        <div className="settle__apps">
          <table>
            <thead>
              <tr><th>Reference</th><th>Branch</th><th className="num">Paid</th><th className="num">Fee</th><th className="num">Agent commission</th></tr>
            </thead>
            <tbody>
              {a.apps.map((ap) => (
                <tr key={ap.ref}>
                  <td>{ap.ref}</td>
                  <td>{ap.branch}</td>
                  <td className="num">{dmyShort(ap.paidAt)}</td>
                  <td className="num">{gbpPence(ap.rent)}</td>
                  <td className="num">{gbpPence(ap.commission)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );

  const [measure, setMeasure] = useState<Record<ChartKey, Measure>>({ branch: 'value', agency: 'value', referrer: 'value' });
  const [trendView, setTrendView] = useState<TrendView>('month');
  /* THE CARD IS VOLUME, THE DEFAULT MEASURE WAS NOT. "Monthly volume trend" is a
     Manager's screen by every part of the line (referral counts, fees collected,
     twelve months of their own branches), so it is not gated. But its measure
     dropdown offered Commission earned, which is TrendRow.comm, fees times the
     agency or partner rate, and it OPENED ON IT: a Manager's first sight of this
     page was twelve bars of agency earnings with the latest month highlighted.
     So the option goes for them and the card opens on fees collected instead,
     which is what the title says it measures anyway. */
  const [trendMeasure, setTrendMeasure] = useState<TrendMeasure>(seesCommission ? 'commission' : 'value');
  /* Resolved on every read rather than trusted because the option was missing
     when it was set. The initialiser above is correct on a normal sign-in
     (hydrateCommissionVisibility runs before the first Reporting paint), but it
     runs once, and component state outlives the reader: a different user
     resolving inside the same runtime is a case the session already handles
     explicitly (#100 in SessionContext), and 'commission' left in this state
     would survive it. */
  const shownMeasure: TrendMeasure = trendMeasure === 'commission' && !seesCommission ? 'value' : trendMeasure;

  const partners = getPartners();
  const periods = getPeriods();

  // The scope label shows only for opndoor admin; Management only ever sees its own partner.
  const scopeName = partnerScope === ALL_PARTNERS ? 'All partners' : partnerName(partnerScope);
  const eyebrowText = `${role === 'superadmin' ? `${scopeName} · ` : ''}Performance · ${period.label}`;

  // ---- volume charts ----
  // A panel that ranks a population of one is not a ranking. An agency with a
  // single branch got "Volume by branch" and "Volume by agency" as two charts of
  // the same single bar, under a header already naming it. Both drop out and the
  // people chart stays, which is the only one with more than one thing in it.
  // Applies to an admin too, the moment they filter to one agency.
  const shape = liveScopeShape(role, partnerScope);
  const chartMeta: { key: ChartKey; rows: LeagueRow[]; scope: string }[] = [
    ...(shape.branches > 1 ? [{ key: 'branch' as ChartKey, rows: d.branches, scope: d.branchScope }] : []),
    ...(shape.agencies > 1 ? [{ key: 'agency' as ChartKey, rows: d.agencies, scope: d.agencyScope }] : []),
    { key: 'referrer', rows: d.referrers, scope: d.referrerScope },
  ];

  // ---- monthly trend ----
  // Every read of the measure below goes through shownMeasure, so r.comm is
  // unreachable for a reader the predicate refuses even if the state says otherwise.
  const trendVal = (r: TrendRow): number => (shownMeasure === 'count' ? r.count : shownMeasure === 'commission' ? r.comm : r.fees);
  const rawTrend = getTrend(trendView, role, partnerScope);
  const trendRows: BarRow[] = useMemo(() => {
    const rows = rawTrend.slice();
    // "By month" keeps chronological order (latest highlighted); breakdowns sort by value.
    if (trendView !== 'month') rows.sort((a, b) => trendVal(b) - trendVal(a));
    return rows.map((r) => ({ label: r.label, sub: r.sub, value: trendVal(r), display: shownMeasure === 'count' ? String(r.count) : fmtBig(trendVal(r)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawTrend, trendView, shownMeasure]);
  const trendTopIndex = trendView === 'month' ? trendRows.length - 1 : 0;
  // Entity views (branch/agency/referrer) are 12-month TOTALS, not a monthly
  // series, so the caption states that explicitly (the bars have no time axis by design).
  /* BY BRANCH AND BY AGENCY FOLLOW THE SCOPE RULE, the same one the three volume
     charts above already follow. A one-office agency was offered "By branch", and
     choosing it drew a single bar labelled with the office they are already
     looking at: a control that can only ever restate the page. By referrer stays
     for everyone, because every agency has more than one person to compare even
     when it has one office. */
  const trendOptions = useMemo(() => [
    { value: 'month', label: 'By month' },
    ...(shape.branches > 1 ? [{ value: 'branch', label: 'By branch' }] : []),
    ...(shape.agencies > 1 ? [{ value: 'agency', label: 'By agency' }] : []),
    { value: 'referrer', label: 'By referrer' },
  ], [shape.branches, shape.agencies]);

  /* And fall back if the choice stops being offered, which League already does
     for its tabs and this did not: a reader who picked By branch on a group and
     then narrowed to one agency would have been left on a hidden option showing
     one bar. */
  useEffect(() => {
    if (!trendOptions.some((o) => o.value === trendView)) setTrendView('month');
  }, [trendOptions, trendView]);

  const trendSub = `${measureLabel(shownMeasure)} · ${trendView === 'month' ? 'last 12 months' : `by ${trendView} · total over the last 12 months`}`;

  // ---- exports ----
  const [appsOpen, setAppsOpen] = useState(false);
  const [appsBasis, setAppsBasis] = useState<ExportBasis>('referred');
  // #86 Expiries export, defaulting to the month ~6 weeks out (the cron cohort).
  const [expOpen, setExpOpen] = useState(false);
  const [expMonth, setExpMonth] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 42); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });

  function exportSummary() {
    void exportBranded(buildPerformanceDoc(role, period as Period));
  }
  function runAppsExport() {
    const built = buildApplicationDoc(role, period as Period, appsBasis);
    if (built) void exportBranded(built);
    setAppsOpen(false);
  }
  function runExpiries() {
    const mv = (expMonth || '2026-06').split('-');
    const out = buildExpiriesCsv(role, +mv[0], +mv[1] - 1);
    if (out) downloadCsv(out.csv, out.filename);
    setExpOpen(false);
  }
  return (
    <>
      <div className="page-head">
        <div>
          <Eyebrow>{eyebrowText}</Eyebrow>
          <h1 className="page-head__title" style={{ marginTop: 10 }}>Dashboard</h1>
          <p className="page-head__sub">{d.sub}</p>
        </div>
        <div className="page-head__actions">
          <RoleOnly roles={['superadmin']}>
            <PeriodSelect
              ariaLabel="Partner"
              title="View all partners combined, or drill into one partner"
              value={selectedPartner}
              onChange={setSelectedPartner}
              options={[{ value: ALL_PARTNERS, label: 'All partners' }, ...partners.map((p) => ({ value: p.id, label: p.name }))]}
            />
          </RoleOnly>
          <PeriodSelect ariaLabel="Dashboard time period" value={period.id} onChange={setPeriod} options={periods.map((p) => ({ value: p.id, label: p.label }))} />
          {/* This was the only one of the four export controls with no RoleOnly.
              The document it builds carries commission for every role entitled to
              it, so the button has to be gated like its three siblings. The
              builder now refuses for itself as well. */}
          {/* None of these three buttons takes `commission`, and that is the
              verdict rather than an oversight: what the reader ends up holding is
              decided inside the builders, which each ask maySeeCommission and drop
              the commission lines and columns for a Manager. The rest of each
              document (referrals, fees, conversion, expiring guarantees) is theirs.
              Gating the buttons would take the whole document to remove a block. */}
          <RoleOnly roles={['superadmin', 'management', 'referrer']}>
            <Button variant="dark" size="sm" onClick={exportSummary} title="Downloads a structured CSV of the dashboard analytics for the selected time period">
              <Icon name="download" /> Export summary
            </Button>
          </RoleOnly>
          <RoleOnly roles={['superadmin', 'management']}>
            <Button variant="ghost" size="sm" onClick={() => setAppsOpen(true)} title="Downloads one row per application, pseudonymised by guarantee reference">
              <Icon name="apps" /> Application export
            </Button>
          </RoleOnly>
          <RoleOnly roles={['superadmin', 'management']}>
            <Button variant="ghost" size="sm" onClick={() => setExpOpen(true)} title="Guarantees expiring in a chosen month, soonest first, for renewal outreach">
              <Icon name="calendar" /> Expiries
            </Button>
          </RoleOnly>
          {/* #Ops: the underwriter bordereau moved to the ops Home (Operations),
              alongside commission settlement. opndoor admin runs it there. */}
        </div>
      </div>

      {/* THE LEVELS, IN THE AGENCY'S OWN WORDS. This said "Management and
          super-admin users see the full portfolio across every agency and
          branch", which is our vocabulary twice over: nobody at an agency holds
          "Management" or "super-admin", and "every agency and branch" describes
          Opndoor's estate rather than the reader's own shop. A Negotiator being
          told what they cannot see should be told it in the names their own
          colleagues go by, which are the three the invite dialog offers. */}
      <RoleOnly roles={['referrer']}>
        <RoleNote style={{ marginBottom: 18 }}>
          You are viewing your <b>own referrals only</b>. Directors and Managers see the whole agency.
        </RoleNote>
      </RoleOnly>

      <div className="dash-grid">
        {/* NEEDS ATTENTION — compact stat-lines, each linking to the relevant view */}
        {hasNeedsAttention && (
          <section className="needs-attn">
            {naAwaiting && (
              <Link className="na-stat na-stat--sign" to="/applications?deed=awaiting" title="Applications with a deed out for the tenant's signature">
                <span className="na-stat__n">{d.awaiting}</span>
                <span className="na-stat__l">awaiting tenant signature</span>
                <Icon name="arrowRight" className="na-stat__go" />
              </Link>
            )}
            {naStuckSent && (
              <Link className="na-stat na-stat--sent" to="/applications?status=sent" title="Applications sent but not yet paid">
                <span className="na-stat__n">{d.stuckSent}</span>
                <span className="na-stat__l">stuck at Sent · awaiting payment</span>
                <Icon name="arrowRight" className="na-stat__go" />
              </Link>
            )}
            {naStuckInvited && (
              <Link className="na-stat na-stat--warn" to="/applications?status=invited" title="Agent-rail tenants invited but not registered after 7 days">
                <span className="na-stat__n">{agentFunnel!.stuck_invited}</span>
                <span className="na-stat__l">invited, not registered after 7 days</span>
                <Icon name="arrowRight" className="na-stat__go" />
              </Link>
            )}
            {naStuckFee && (
              <Link className="na-stat na-stat--warn" to="/applications?status=fee-unpaid" title="Agent-rail tenants registered but the application fee is unpaid after 7 days">
                <span className="na-stat__n">{agentFunnel!.stuck_fee}</span>
                <span className="na-stat__l">application fee unpaid after 7 days</span>
                <Icon name="arrowRight" className="na-stat__go" />
              </Link>
            )}
            {naStuckRef && (
              <Link className="na-stat na-stat--warn" to="/applications?status=referencing" title="Agent-rail applications awaiting the eligibility decision for over 7 days">
                <span className="na-stat__n">{agentFunnel!.stuck_referencing}</span>
                <span className="na-stat__l">awaiting decision over 7 days</span>
                <Icon name="arrowRight" className="na-stat__go" />
              </Link>
            )}
            {naNoContact && (
              <Link className="na-stat na-stat--warn" to="/applications?deed=delivery-failed" title="Deeds issued but not delivered to the agent (no reachable claim contact). Open the list to add a contact, then resend the deed.">
                <span className="na-stat__n">{d.deedsNoContact}</span>
                <span className="na-stat__l">deed{d.deedsNoContact === 1 ? '' : 's'} issued · delivery failed, view and resend</span>
                <Icon name="arrowRight" className="na-stat__go" />
              </Link>
            )}
            {naLapsing && (
              <Link className="na-stat na-stat--warn" to="/activity" title="In-force guarantees expiring within 14 days. Arrange a renewal or a fresh referral so cover stays in place.">
                <span className="na-stat__n">{d.lapsing14}</span>
                <span className="na-stat__l">guarantee{d.lapsing14 === 1 ? '' : 's'} lapsing within 14 days</span>
                <Icon name="arrowRight" className="na-stat__go" />
              </Link>
            )}
            {naSettlements && (
              <a className="na-stat na-stat--pay" href="#settlements" title="Jump to the settlement sections below">
                <span className="na-stat__l">
                  <b>Settlements due {settleDayMonth}:</b> {gbpPence(partnerDue)} partner / {gbpPence(agentDue)} agent
                </span>
                <Icon name="arrowRight" className="na-stat__go" />
              </a>
            )}
          </section>
        )}

        {/* FUNNEL */}
        <Card>
          <CardHead
            title={agentFunnel ? 'Live application journey' : 'Live referral funnel'}
            sub={agentFunnel ? 'Invited to Deed signed' : d.funnelScope}
            actions={agentFunnel ? undefined : <Pill variant="paid" style={{ fontSize: 12 }}>Sent to Paid is the headline metric</Pill>}
          />
          <CardBody>
            {agentFunnel ? (
              <div className="afunnel">
                {[
                  { k: 'Invited', n: agentFunnel.invited },
                  { k: 'Registered', n: agentFunnel.registered },
                  { k: 'Details', n: agentFunnel.details },
                  { k: 'Application fee', n: agentFunnel.fee },
                  { k: 'Documents', n: agentFunnel.documents },
                  { k: 'Submitted', n: agentFunnel.submitted },
                  { k: 'Decision', n: agentFunnel.approved + agentFunnel.declined, sub: `${agentFunnel.approved} approved · ${agentFunnel.declined} declined` },
                  { k: 'Guarantee fee', n: agentFunnel.guarantee },
                  { k: 'Deed', n: agentFunnel.deed },
                ].map((s) => (
                  <div key={s.k} className="afunnel__tile">
                    <div className="afunnel__n">{s.n.toLocaleString('en-GB')}</div>
                    <div className="afunnel__l">{s.k}</div>
                    {s.sub && <div className="afunnel__sub">{s.sub}</div>}
                  </div>
                ))}
              </div>
            ) : (
            <>
            <div className="funnel">
              <div className="fstage fstage--sent">
                <div className="fstage__top"><Pill variant="sent">Sent</Pill></div>
                <div className="fstage__count">{d.sent}</div>
                <div className="fstage__label">Referrals sent to tenants</div>
                <div className="fstage__bar"><i /></div>
              </div>
              <div className="fconnect fconnect--head">
                <div className="fconnect__cap">Sent → Paid</div>
                <div className="fconnect__rate">{d.sp}</div>
                <div className="fconnect__arrow"><Icon name="arrowRight" /></div>
              </div>
              <div className="fstage fstage--paid">
                <div className="fstage__top"><Pill variant="paid">Paid</Pill></div>
                <div className="fstage__count">{d.paid}</div>
                <div className="fstage__label">Guarantor fee paid</div>
                <div className="fstage__bar"><i /></div>
              </div>
              <div className="fconnect">
                <div className="fconnect__cap">Paid → Deed</div>
                <div className="fconnect__rate">{d.pd}</div>
                <div className="fconnect__arrow"><Icon name="arrowRight" /></div>
              </div>
              <div className="fstage fstage--deed">
                <div className="fstage__top"><Pill variant="deed">Deed Issued</Pill></div>
                <div className="fstage__count">{d.deed}</div>
                <div className="fstage__label">Guarantee deeds issued</div>
                <div className="fstage__bar"><i /></div>
              </div>
            </div>
            {d.live && (
              <div className="funnel-note">
                <Icon name="info" strokeWidth={2} />
                <span>Conversion is <b>period throughput</b>: each stage counts the events that occurred within the period, so a rate can exceed 100% when payments or deeds land this period for referrals sent earlier.</span>
              </div>
            )}
            </>
            )}
          </CardBody>
          <CardFoot>
            <span className="muted" style={{ fontSize: 12.5 }}>
              Overall sent to deed conversion <b style={{ color: 'var(--ink)' }}>{d.overall}</b>
              {d.live && d.awaiting > 0 && (
                <> · <b style={{ color: 'var(--sent)' }}>{d.awaiting}</b> awaiting tenant signature{d.awaitingAged > 0 ? ` (${d.awaitingAged} over 7 days)` : ''}</>
              )}
            </span>
            <Button variant="quiet" size="sm" to="/applications" arrow>View all applications</Button>
          </CardFoot>
        </Card>

        {/* HERO KPIs */}
        <section className="herorow">
          {/* DELIBERATELY NOT A COMMISSION SURFACE, and the one most likely to be
              flagged as one because it is the biggest number on the page. Every
              figure in this tile is the fee the TENANT was charged (gross, less
              refunds, net) plus the rent those deeds guarantee. That is the price
              of the product and a fact about referrals the Manager owns and can
              already read one by one on Applications. No rate is stated and the
              rate routes return nothing for them, so it does not reconstruct the
              agency's income. Gating it would leave a Manager a dashboard with no
              money on it at all, which is not the level. */}
          <RoleOnly roles={['superadmin', 'management']}>
            {/* #85 Net fees leads the money block; Total guaranteed rent value second. */}
            <div className="card hero-kpi hero-kpi--dark">
              <div className="kpi__label">Net fees{d.live ? ' (after refunds)' : ''}</div>
              <div className="hero-kpi__row" style={{ marginTop: 10 }}>
                <span className="hero-kpi__big">{d.live ? d.net : d.fees}</span>
              </div>
              <p style={{ position: 'relative', fontSize: 13, color: 'rgba(255,255,255,0.72)', marginTop: 8, maxWidth: '42ch' }}>
                {/* The basis is stated as it actually was, never asserted as a
                    month: Regent's single-tenant fee is three weeks and their
                    joint fee is five. Empty in a period with no fees at all. */}
                {/* The noun agrees with the count, off deedsIssued (the number)
                    rather than deedcount (the display string): a first deed read
                    "across 1 issued deeds". Same idiom as the needs-attention
                    lines below, which have always agreed. */}
                Guarantor fees collected across {d.deedcount} issued deed{d.deedsIssued === 1 ? '' : 's'}{d.feeBasisCopy ? `, ${d.feeBasisCopy}` : ''}, net of any refunds.
              </p>
              {d.live && (
                <div className="hero-kpi__split">
                  <div><span className="k">Fees collected (gross)</span><span className="v">{d.feesGross}</span></div>
                  <div><span className="k">Less refunds{d.refundCount ? ` (${d.refundCount})` : ''}</span><span className="v v--neg">{d.refunds}</span></div>
                </div>
              )}
              <div className="hero-kpi__sub" style={{ marginTop: 14 }}>
                <span className="lbl">Total guaranteed rent value</span>
                <span className="val">{d.guaranteed}</span>
              </div>
            </div>
          </RoleOnly>

          <RoleOnly roles={['referrer']}>
            <div className="card hero-kpi hero-kpi--dark">
              <div className="kpi__label">Your fees collected{d.live ? ' (net of refunds)' : ''}</div>
              <div className="hero-kpi__row" style={{ marginTop: 10 }}>
                <span className="hero-kpi__big">{d.live ? d.net : d.fees}</span>
              </div>
              <p style={{ position: 'relative', fontSize: 13, color: 'rgba(255,255,255,0.72)', marginTop: 8, maxWidth: '42ch' }}>
                Guarantor fees from the referrals you sent that reached Paid{d.feeBasisCopy ? `, at ${d.feeBasisCopy}` : ''}.
              </p>
              {d.live ? (
                <div className="hero-kpi__split">
                  <div><span className="k">Fees collected (gross)</span><span className="v">{d.feesGross}</span></div>
                  <div><span className="k">Less refunds{d.refundCount ? ` (${d.refundCount})` : ''}</span><span className="v v--neg">{d.refunds}</span></div>
                  <div><span className="k">Your referrals paid</span><span className="v">{d.paid}</span></div>
                </div>
              ) : (
                <div className="hero-kpi__sub">
                  <span className="lbl">Your referrals paid</span>
                  <span className="val">{d.paid}</span>
                </div>
              )}
            </div>
          </RoleOnly>

          {/* THE COMMISSION TILE, AND IT IS THE WHOLE TILE THAT GOES. Every figure
              in it is earnings: commHeadline is the net agent or partner
              commission, commSecondVal is the other side of the same split, and
              commExcl is the commission reversed on refunds. A Manager was shown
              "Commission (agreed terms)" with an amount, beside the fees tile, at
              the top of their own dashboard. There is no narrower version of this
              tile to show them, because the amount IS the tile. */}
          <RoleOnly roles={['superadmin', 'management']} commission>
            <div className="card hero-kpi">
              <div className="spread">
                {/* The label is the service's, not the page's: it is the one bit
                    of this tile's copy that has to agree with the tag beside it
                    about who is reading (see commLbl in analyticsService). */}
                <div className="kpi__label">{d.commLbl}</div>
                <Tag>{d.commTag}</Tag>
              </div>
              <div className="hero-kpi__row" style={{ marginTop: 14 }}>
                <span className="comm-headline">{d.commHeadline}</span>
                {/* NO PERCENTAGE ANYWHERE ON AN AGENCY'S COMMISSION TILE, and
                    that includes this one. It is a hard-coded 12.4% that only
                    ever appears in mock/demo mode, so it is demo furniture
                    rather than a measurement, and a figure nobody computed is
                    the worst kind of rate to show somebody their money under. */}
                {d.live
                  ? (d.refundCount > 0 && <span className="muted" style={{ fontSize: 12 }}>Excluded on refunds {d.commExcl}</span>)
                  : !agencyFacing && <span className="kpi__delta kpi__delta--up"><Icon name="caretUp" strokeWidth={2.4} />12.4% vs prior period</span>}
              </div>
              {/* Dropped, not zeroed, on the agent rail: one of our agencies has
                  no supplier above it, and a £0 "partner commission" line reads
                  as money withheld rather than as a party that does not exist. */}
              {d.commSecondShown && (
                <div style={{ marginTop: 'auto', paddingTop: 18, borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span className="muted" style={{ fontSize: 13 }}>{d.commSecondLbl}</span>
                  <span style={{ fontFamily: 'var(--display)', fontWeight: 700, fontSize: 18, color: 'var(--ink)' }}>{d.commSecondVal}</span>
                </div>
              )}
              {d.live && d.refundCount > 0 && (
                <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>{d.commExclDetail} excluded on refunded fees</div>
              )}
            </div>
          </RoleOnly>

          <RoleOnly roles={['referrer']}>
            <div className="card hero-kpi">
              <div className="spread">
                <div className="kpi__label">Your referral performance</div>
                <Tag>Your own slice</Tag>
              </div>
              <div className="hero-kpi__row" style={{ marginTop: 14 }}>
                <span className="comm-headline" style={{ color: 'var(--ink)' }}>{d.sent}</span>
                <span className="muted" style={{ fontSize: 14, fontWeight: 600 }}>referrals sent</span>
              </div>
              <div style={{ marginTop: 'auto', paddingTop: 18, borderTop: '1px solid var(--line)', display: 'flex', gap: 30 }}>
                <div><div className="muted" style={{ fontSize: 12 }}>Sent → Paid</div><div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 22, letterSpacing: '-0.02em', color: 'var(--heliotrope-deep)', marginTop: 2 }}>{d.sp}</div></div>
                <div><div className="muted" style={{ fontSize: 12 }}>Paid → Deed</div><div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 22, letterSpacing: '-0.02em', color: 'var(--ink)', marginTop: 2 }}>{d.pd}</div></div>
                <div><div className="muted" style={{ fontSize: 12 }}>Deeds issued</div><div style={{ fontFamily: 'var(--display)', fontWeight: 800, fontSize: 22, letterSpacing: '-0.02em', color: 'var(--ink)', marginTop: 2 }}>{d.deedcount}</div></div>
              </div>
            </div>
          </RoleOnly>
        </section>

        {/* Live payment figures (gross/refunds/net + net commission) are folded
            into the hero KPIs above; there is no separate block. */}

        {/* PERFORMANCE BAND: commission-by-partner, then the breakdown cards, then trend. */}
        {/* COMMISSION BY PARTNER (selected period), OPNDOOR STAFF AND SUPPLIERS ONLY.
            The RoleOnly allowlist was the whole gate, and 'management' is now
            worn by a director at one of our own agencies, so this table opened on
            their dashboard: seven columns splitting their money with a party they
            have never heard of, under a caption saying "partner" five times.
            Partner is Opndoor's word for Opndoor's own business. An agency has
            exactly one route, it is house plumbing, and there is nothing here for
            them to read. Dropped for them entirely rather than narrowed to one
            row, because one row of a rate they do not pay is not a smaller
            version of this table, it is the same mistake in less space. A
            supplier's manager keeps it: the table is about them. */}
        {/* And a supplier's manager keeps it only if they may see earnings at all:
            four of its seven columns are commission, gross and net, on both sides
            of the split. `agencyFacing` already removed it from our own agencies;
            `commission` removes it from anyone else's Manager. */}
        {d.live && partnerBreakdown.length > 0 && !agencyFacing && (
          <RoleOnly roles={['superadmin', 'management']} commission>
            <section className="card settle">
              <div className="settle__head">
                <div>
                  <div className="kpi__label">Commission by partner</div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
                    Partner and agent commission for the <b>selected period</b>, gross and net of refunds. Net columns reconcile to the summary totals. Settlement (what is actually payable next) is calculated separately, for the <b>prior calendar month</b>. Active partners are listed even with no paid referrals in the period; paused or onboarding partners with no activity are not shown.
                  </div>
                </div>
              </div>
              <div className="settle__apps">
                <table>
                  <thead>
                    <tr>
                      <th>Partner</th><th className="num">Paid</th><th className="num">Fees (gross)</th>
                      <th className="num">Partner comm (gross)</th><th className="num">Partner comm (net)</th>
                      <th className="num">Agent comm (gross)</th><th className="num">Agent comm (net)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {partnerBreakdown.map((p) => (
                      <tr key={p.partner}>
                        <td>{p.partnerName}</td>
                        <td className="num">{p.paid}</td>
                        <td className="num">{gbpPence(p.feesGross)}</td>
                        <td className="num">{gbpPence(p.partnerCommGross)}</td>
                        <td className="num">{gbpPence(p.partnerCommNet)}</td>
                        <td className="num">{gbpPence(p.agentCommGross)}</td>
                        <td className="num">{gbpPence(p.agentCommNet)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </RoleOnly>
        )}

        {/* CHARTS. All three stay whole for a Manager. Their three measures are
            fees collected, referral count and Sent-to-Deed conversion: the ranking
            is of their own branches, agencies and people, and none of the bars is
            an earning. Commission is not offered here at all (see Measure), unlike
            the trend below, so there is nothing on these to gate. */}
        <section className="chartrow">
          {chartMeta.map(({ key, rows, scope }) => {
            const { bars, total, max } = buildChartRows(key, rows, measure[key]);
            const options = key === 'referrer'
              ? [{ value: 'value', label: 'Fees collected' }, { value: 'count', label: 'Referral count' }]
              : [{ value: 'value', label: 'Fees collected' }, { value: 'count', label: 'Referral count' }, { value: 'conv', label: 'Conversion (Sent to Deed)' }];
            const countLine = total > TOP_N ? `Top ${TOP_N} of ${total}` : `${total} total`;
            const chart = (
              <Card key={key}>
                <CardHead
                  title={key === 'referrer' ? d.referrerTitle : key === 'branch' ? 'Volume by branch' : 'Volume by agency'}
                  sub={`${measureLabel(measure[key])} · ${scope} · within the selected period`}
                  actions={
                    <MeasureSelect
                      ariaLabel={`Measure for volume by ${key}`}
                      value={measure[key]}
                      onChange={(v) => setMeasure((m) => ({ ...m, [key]: v as Measure }))}
                      options={options}
                    />
                  }
                />
                <CardBody>
                  <BarChart rows={bars} topIndex={0} max={max} />
                </CardBody>
                <CardFoot>
                  <span className="muted" style={{ fontSize: 12.5 }}>{countLine}</span>
                  <Button variant="quiet" size="sm" to={`/league?view=${key}`} arrow>View all</Button>
                </CardFoot>
              </Card>
            );
            // Returned before the wrapper below, so this chart had no gate at
            // all. It names referrers against fees collected, so it needs the
            // same allowlist as its siblings rather than an early exit.
            if (key === 'referrer') {
              return (
                <RoleOnly key={key} roles={['superadmin', 'management']}>
                  {chart}
                </RoleOnly>
              );
            }
            return (
              <RoleOnly key={key} roles={['superadmin', 'management']}>
                {chart}
              </RoleOnly>
            );
          })}
        </section>

        {/* MONTHLY TREND */}
        <RoleOnly roles={['superadmin', 'management']}>
          <Card style={{ marginBottom: 18 }}>
            <CardHead
              title="Monthly volume trend"
              sub={trendSub}
              actions={
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <TrendSelect
                    ariaLabel="Break the trend down by"
                    value={trendView}
                    onChange={(v) => setTrendView(v as TrendView)}
                    options={trendOptions}
                  />
                  <TrendSelect
                    ariaLabel="Measure for the trend"
                    value={shownMeasure}
                    onChange={(v) => setTrendMeasure(v as TrendMeasure)}
                    options={[
                      // The measure itself is the commission surface here, so the
                      // option is what gets gated, not the chart it draws.
                      ...(seesCommission ? [{ value: 'commission', label: 'Commission earned' }] : []),
                      { value: 'value', label: 'Fees collected' },
                      { value: 'count', label: 'Referral count' },
                    ]}
                  />
                </div>
              }
            />
            <CardBody>
              <BarChart rows={trendRows} topIndex={trendTopIndex} />
            </CardBody>
          </Card>
        </RoleOnly>

        {/* COMMISSION STATEMENT — the agency's own ledger for a month it picks.
            Distinct from the settlement blocks below, which answer "what are we
            about to pay" for the prior month only. Same accumulator, so they
            agree; different question, so both are here. Management and admin:
            a referrer is not a payee and reads their own referrals instead. */}
        {/* The eyebrow goes with the statement, not before it: "Your commission"
            standing over an empty space tells a Manager exactly what they are not
            being shown, which is worse than the heading being absent. */}
        {d.live && (
          <RoleOnly roles={['superadmin', 'management']} commission>
            <div className="section-label"><Eyebrow>Your commission</Eyebrow></div>
            <CommissionStatement role={role} scope={partnerScope} />
          </RoleOnly>
        )}

        {/* SETTLEMENTS (below performance) — payable totals; applications collapsed.
            All three blocks are money owed to the agency or to the supplier above
            it, down to the per-application commission column inside the expanders,
            so all three carry `commission`. The label included: it is the anchor
            the needs-attention line jumps to, and a heading reading "Settlements"
            over nothing is a worse answer than no heading. */}
        {(naSettlements || (d.live && (settlement.partners.length > 0 || agentSettlement.payees.length > 0))) && (
          <RoleOnly roles={['management']} commission>
            <div id="settlements" className="section-label"><Eyebrow>Settlements</Eyebrow></div>
          </RoleOnly>
        )}

        {/* COMMISSION SETTLEMENT (partner, prior calendar month, payable the 15th) */}
        {d.live && settlement.partners.length > 0 && (
          <RoleOnly roles={['management']} commission>
            <section className="card settle">
              <div className="settle__head">
                <div>
                  <div className="kpi__label">Supplier commission settlement</div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
                    Supplier commission accrued on payments in <b>{settlement.monthLabel}</b> (calendar month, net of refunds), payable on <b>{settleDate}</b>.
                  </div>
                </div>
              </div>
              {settlement.partners.map((p) => (
                <div key={p.partner} className="settle__partner">
                  <div className="settle__row">
                    <span>Commission payable to <b>{p.partnerName}</b></span>
                    <span className="settle__amt">{gbpPence(p.commission)}</span>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <Button variant="ghost" size="sm" onClick={() => downloadPartnerStatement(p.partner)} title={`Download a branded partner commission statement for ${p.partnerName} (${settlement.monthLabel}). Foots to the figure above.`}>
                      <Icon name="download" /> Download statement
                    </Button>
                  </div>
                  <details className="settle__exp">
                    <summary>Show applications ({p.apps.length})</summary>
                    <div className="settle__apps">
                      <table>
                        <thead>
                          <tr><th>Reference</th><th>Branch</th><th className="num">Paid</th><th className="num">Fee</th><th className="num">Commission</th></tr>
                        </thead>
                        <tbody>
                          {p.apps.map((ap) => (
                            <tr key={ap.ref}>
                              <td>{ap.ref}</td>
                              <td>{ap.branch}{ap.agency ? ` · ${ap.agency}` : ''}</td>
                              <td className="num">{dmyShort(ap.paidAt)}</td>
                              <td className="num">{gbpPence(ap.rent)}</td>
                              <td className="num">{gbpPence(ap.commission)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                </div>
              ))}
            </section>
          </RoleOnly>
        )}

        {/* AGENT COMMISSION SETTLEMENT (agency level, prior calendar month, payable the 15th) */}
        {d.live && agentSettlement.payees.length > 0 && (
          <RoleOnly roles={['management']} commission>
            <section className="card settle">
              <div className="settle__head">
                <div>
                  <div className="kpi__label">Agent commission settlement</div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 3 }}>
                    Agent commission accrued on payments in <b>{agentSettlement.monthLabel}</b> (calendar month, net of refunds), payable to each payee on <b>{agentSettleDate}</b>.
                  </div>
                </div>
              </div>
              <div className="settle__row settle__row--agg">
                <span>Agent commission due <b>{settleDayMonth}</b> across <b>{agentSettlement.payees.length}</b> {agentSettlement.payees.length === 1 ? 'payee' : 'payees'}</span>
                <span className="settle__amt">{gbpPence(agentDue)}</span>
              </div>
              {agentTop.map(agentAgencyRow)}
              {agentRest.length > 0 && (
                <details className="settle__exp settle__exp--more">
                  <summary>View all {agentSettlement.payees.length} payees</summary>
                  {agentRest.map(agentAgencyRow)}
                </details>
              )}
            </section>
          </RoleOnly>
        )}

        {/* SUPPORT METRICS */}
        <div className="section-label"><Eyebrow>Operational health</Eyebrow></div>
        <section className="supportrow">
          <div className="card smetric">
            <div className="kpi__label">Average monthly rent</div>
            <div className="kpi__value" style={{ marginTop: 10 }}>{d.rent}</div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>Across all referred tenancies</div>
          </div>
          <div className="card smetric">
            <div className="kpi__label">Avg. time Sent → Payment</div>
            <div className="kpi__value" style={{ marginTop: 10 }}>{d.avgSentToPaid} <span className="unit">days</span></div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>From referral sent to fee paid</div>
          </div>
          <div className="card smetric">
            <div className="kpi__label">Avg. time Payment → Deed</div>
            <div className="kpi__value" style={{ marginTop: 10 }}>{d.avgPaidToDeed} <span className="unit">days</span></div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>From fee paid to deed issued</div>
          </div>
        </section>
      </div>

      {/* APPLICATION EXPORT MODAL (Management + opndoor admin) */}
      {appsOpen && role !== 'referrer' && (
        <div className="bdx-scrim is-open" onMouseDown={(e) => e.target === e.currentTarget && setAppsOpen(false)}>
          <div className="bdx" role="dialog" aria-modal="true">
            <div className="bdx__head">
              <div>
                <div className="bdx__title">Application export</div>
                <div className="bdx__sub">One pseudonymised row per application, for the period selected on the dashboard. Choose what the period filters on.</div>
              </div>
              <button className="bdx__close" aria-label="Close" onClick={() => setAppsOpen(false)}><Icon name="x" /></button>
            </div>
            <div className="bdx__body">
              <div className="field">
                <label htmlFor="apps-basis">Filter the period by</label>
                <select id="apps-basis" value={appsBasis} onChange={(e) => setAppsBasis(e.target.value as ExportBasis)}>
                  <option value="referred">Date referred (Sent), reconciles to Referrals sent</option>
                  <option value="paid">Date paid, reconciles to fees collected</option>
                  <option value="deed">Date deed issued, reconciles to Deeds issued</option>
                  <option value="activity">All activity: everything Sent, Paid or Deed issued in the period</option>
                </select>
                <span className="hint">{BASIS_META[appsBasis].hint}</span>
              </div>
              <div className="bdx__warn" style={{ background: 'var(--white-lilac)', borderColor: 'rgba(211,100,251,0.25)' }}>
                <Icon name="info" />
                <span>Each row always shows the application's latest status and its paid and deed dates whenever they occurred, so a referral made one month and paid the next is captured on the "Date paid" basis for the month it was paid.</span>
              </div>
            </div>
            <div className="bdx__foot">
              <Button variant="ghost" onClick={() => setAppsOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={runAppsExport}>Export</Button>
            </div>
          </div>
        </div>
      )}

      {/* #86 EXPIRIES MODAL (management + opndoor admin) */}
      {expOpen && (role === 'superadmin' || role === 'management') && (
        <div className="bdx-scrim is-open" onMouseDown={(e) => e.target === e.currentTarget && setExpOpen(false)}>
          <div className="bdx" role="dialog" aria-modal="true">
            <div className="bdx__head">
              <div>
                <div className="bdx__title">Expiring guarantees</div>
                <div className="bdx__sub">Every in-force guarantee expiring in the chosen month, soonest first. {role === 'superadmin' ? 'All partners.' : 'Your partner only.'} Already-expired guarantees are never shown.</div>
              </div>
              <button className="bdx__close" aria-label="Close" onClick={() => setExpOpen(false)}><Icon name="x" /></button>
            </div>
            <div className="bdx__body">
              <div className="field">
                <label htmlFor="exp-month">Month (by guarantee expiry date)</label>
                <input type="month" id="exp-month" min="2024-09" max="2028-12" value={expMonth} onChange={(e) => setExpMonth(e.target.value)} />
              </div>
              <div className="bdx__warn" style={{ background: 'var(--white-lilac)', borderColor: 'rgba(211,100,251,0.25)' }}>
                <Icon name="info" />
                <span>Columns: guarantee reference, tenant name, property address, agency and branch, tenancy start, expiry date, days remaining, monthly and annualised rent, and referrer. Management receive this cohort by email six weeks before the month begins.</span>
              </div>
            </div>
            <div className="bdx__foot">
              <Button variant="ghost" onClick={() => setExpOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={runExpiries}>Download expiries</Button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
