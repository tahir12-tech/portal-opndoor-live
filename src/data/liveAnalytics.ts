/* =====================================================================
   Live analytics — every dashboard/league/export figure computed from the
   hydrated live application set (Supabase mode). Retires the synthetic model
   in real mode; mock/test mode still uses mock/analyticsModel via the callers.

   Basis (single, reconcilable): EVENT-IN-PERIOD. Each funnel stage counts
   applications by whether its own event fell in the period (Sent = sentAt,
   Paid = paidAt, Deed = deedAt). Fees collected = fees paid in the period
   (gross); commission = net of refunds; total guaranteed rent value =
   annualised rent over deeds issued in the period. This makes the funnel,
   KPIs, charts, league and exports all reconcile to the same live events, and
   matches the Live payments block. Conversion rates are therefore period
   throughput ratios (stage-in-period / prior-stage-in-period), not sent-cohort
   tracked, so they can exceed 100% in a period dominated by deferred payments.

   Commission uses each application's SNAPSHOTTED per-partner rates (app.partnerRate
   / app.agentRate, frozen at creation), never the partner's live rate, so editing
   a partner's rate never moves historical figures. It is net of refunds: gross
   commission on fees paid in the period, minus the commission on fees refunded in
   the period. For a single-partner scope this equals feesNet x rate (the Live
   payments block's presentation).
   ===================================================================== */
import { SUPABASE_ENABLED } from '@/lib/supabase';
import type { LeagueRow, LeagueView, PartnerScope, Period, Role } from './types';
import { ALL_PARTNERS } from './types';
import { allFull, findRecord, guaranteeExpiry, isHydrated, type FullApp } from './applicationsService';
import { getPartner, getPartners, partnerName } from './partnersService';
import { periodRange, scopeFull, inRange } from './paymentMetrics';
import { payeesFor, orgRate, totalRate, feeBaseFor, agentRailApp, feeBasisOf, sourcesOf, linesFor, type FeeBasis } from './commissionSplit';
import { deliveryStateOf } from './deliveryState';
import type { CommissionSource } from './types';

/**
 * Is the viewer looking at the agent rail alone?
 *
 * The ESTATE, read off the partner in scope. A manager is pinned to their own
 * partner, so for Regent's people this is always true and the dashboard drops
 * every partner-commission figure. An admin on "all partners" is looking at both
 * rails at once and keeps them.
 *
 * Distinct from viewerRunsEligibilityJourney, which asks the OTHER question —
 * who checks the tenant — and gives Regent the opposite answer.
 */
export function agentRailScope(scope: PartnerScope): boolean {
  if (scope === ALL_PARTNERS) return false;
  return getPartner(scope)?.referencingMode === 'opndoor_referenced';
}

const DAY = 86_400_000;
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * True when live analytics should be used: Supabase mode AND the live set has
 * been hydrated. Keyed on hydration, not on row count, so a genuinely empty
 * scope renders honest zeros instead of silently reverting to the mock model.
 */
export function liveAvailable(): boolean {
  return SUPABASE_ENABLED && isHydrated();
}

/** "Now" — real in Supabase mode; the fixed demo date otherwise (parity with periodRange). */
function nowRef(): Date {
  return SUPABASE_ENABLED ? new Date() : new Date(2026, 5, 26);
}

/** Display label for a referring user's actual role (league attribution). */
function roleLabel(role: Role | null | undefined): string {
  if (role === 'superadmin') return 'opndoor'; // #112: opndoor-admin actors are labelled honestly as "opndoor", never "Referrer"
  if (role === 'management') return 'Management';
  return 'Referrer';
}

export interface LiveAgg {
  sent: number;
  paid: number;
  deed: number;
  feesGross: number;
  refundValue: number;
  refundCount: number;
  feesNet: number;
  guaranteed: number; // annualised rent over deeds issued in the period
  partnerCommNet: number;
  agentCommNet: number;
  partnerCommExcl: number; // commission excluded because the fee was refunded (in period)
  agentCommExcl: number;
  // Current-state operational metrics (whole scoped book, not period-filtered)
  stuckSent: number;
  stuckPaid: number;
  awaiting: number; // deeds awaiting tenant signature
  awaitingAged: number; // ... unsigned more than 7 days
  avgRent: number;
  /* TENANCY-GRAIN COUNTS, for the ratios whose two halves are counted
     differently. Only the tenancy LEAD ever reaches Deed Issued — one deed names
     every tenant — so `deed` is already one per let, while `sent` and `paid`
     count applicants, because each applicant is sent to and pays for themselves.
     Dividing one by the other reported a three-person tenancy as 33% converted.
     These are the honest denominators; `sent` and `paid` keep their own meaning
     for the counts they head. */
  sentTenancies: number;
  paidTenancies: number;
  avgSentToPaidDays: number | null;
  avgPaidToDeedDays: number | null;
  bookSize: number; // scoped applications total
  /** The distinct rate sources behind agentCommNet, so the headline can name
      where the money came from instead of asserting a rate is the standard. */
  sources: CommissionSource[];
  /** What the period's fees were a basis OF. kind 'none' when none were paid. */
  feeBasis: FeeBasis;
  /** True when nothing in the paid set has a partner to pay: the whole period is
      agent rail, so every partner-commission figure is structurally zero and is
      hidden rather than shown as £0. */
  noPartnerCut: boolean;
}

/** Aggregate the scoped set for a period (event-in-period money/counts + current-state ops). */
export function liveAggregate(role: Role, scope: PartnerScope, period: Period): LiveAgg {
  const [start, end] = periodRange(period);
  // #2/#13 Withdrawn and Expired are terminal and pre-payment: they leave the
  // funnel entirely, so they are excluded from every count, conversion denominator,
  // ops metric and average here (never inside Sent, never in stuck-at-Sent).
  const set = scopeFull(allFull(), role, scope).filter((x) => !x.withdrawn && !x.expired);
  const a: LiveAgg = {
    sent: 0, paid: 0, deed: 0, feesGross: 0, refundValue: 0, refundCount: 0, feesNet: 0,
    guaranteed: 0, partnerCommNet: 0, agentCommNet: 0, partnerCommExcl: 0, agentCommExcl: 0,
    stuckSent: 0, stuckPaid: 0, awaiting: 0, awaitingAged: 0, avgRent: 0,
    avgSentToPaidDays: null, avgPaidToDeedDays: null, bookSize: set.length,
    sentTenancies: 0, paidTenancies: 0,
    sources: [], feeBasis: { kind: 'none', phrase: '' }, noPartnerCut: false,
  };
  let rentSum = 0;
  let s2pSum = 0, s2pN = 0, p2dSum = 0, p2dN = 0;
  const now = nowRef().getTime();
  // The paid-in-period set, kept so the fee basis and the rate sources are read
  // off the same rows the money was summed from and cannot drift from them.
  const paidSet: FullApp[] = [];
  // Identity for "one let": the tenancy where there is one, else the application
  // itself, which IS a tenancy of one.
  const letOf = (x: FullApp) => x.tenancyId ?? `solo:${x.ref}`;
  const sentLets = new Set<string>();
  const paidLets = new Set<string>();
  // The rent belongs to the LET, not to each applicant: every sibling row carries
  // the whole tenancy's monthly_rent, so adding it per row reported a book of one
  // £3,000 pair and one £1,500 single as averaging £2,500 instead of £2,250.
  const rentedLets = new Set<string>();
  for (const app of set) {
    // COMMISSION COMES OFF THE LINES. agent_rate is written as their total at
    // creation and is equal today, but it is a denormalised copy that cannot name
    // a payee or say where its rate came from, and the statement needs both.
    //
    // THE AGENT RAIL HAS NO PARTNER. partner_rate is populated on every row —
    // resolve_rates fills it whichever rail the referral came in on — so
    // multiplying by it on one of our own agencies invents a payable that nobody
    // owes and that no invoice will ever be raised for. Zeroed at the row, not
    // hidden at the screen, so exports and the dashboard agree.
    const r = { partner: agentRailApp(app) ? 0 : app.partnerRate, agent: totalRate(app) };
    if (!rentedLets.has(letOf(app))) { rentedLets.add(letOf(app)); rentSum += app.rent; }
    if (inRange(app.sentAt, start, end)) { a.sent += 1; sentLets.add(letOf(app)); }
    if (inRange(app.paidAt, start, end)) {
      paidLets.add(letOf(app));
      // A fee is attributed to the period it was PAID; a refunded application
      // earns no net commission (identical to the per-row Application export, so
      // every commission figure reconciles). Refund amount reduces net fees.
      a.paid += 1;
      paidSet.push(app);
      a.feesGross += feeBaseFor(app);
      if (app.refunded) {
        a.refundCount += 1;
        a.refundValue += app.refundedAmount ?? feeBaseFor(app);
        a.partnerCommExcl += feeBaseFor(app) * r.partner;
        a.agentCommExcl += feeBaseFor(app) * r.agent;
      } else {
        a.partnerCommNet += feeBaseFor(app) * r.partner;
        a.agentCommNet += feeBaseFor(app) * r.agent;
      }
    }
    if (inRange(app.deedAt, start, end)) { a.deed += 1; a.guaranteed += app.rent * 12; }
    // Current-state operational metrics (not period-filtered).
    if (app.status === 'sent') a.stuckSent += 1;
    if (app.status === 'paid' && !app.deedAt && !app.refunded) a.stuckPaid += 1;
    if (app.deedState === 'awaiting_tenant') {
      a.awaiting += 1;
      if (app.deedSentAt && (now - app.deedSentAt.getTime()) / DAY > 7) a.awaitingAged += 1;
    }
    if (app.sentAt && app.paidAt) { s2pSum += (app.paidAt.getTime() - app.sentAt.getTime()) / DAY; s2pN += 1; }
    if (app.paidAt && app.deedAt) { p2dSum += (app.deedAt.getTime() - app.paidAt.getTime()) / DAY; p2dN += 1; }
  }
  a.feesNet = a.feesGross - a.refundValue;
  a.sources = sourcesOf(paidSet.flatMap((x) => linesFor(x)));
  a.feeBasis = feeBasisOf(paidSet);
  // "Nothing here has a partner", not "the partner earned nothing": an empty
  // period answers false, so a screen with no data shows its usual shape.
  a.noPartnerCut = paidSet.length > 0 && paidSet.every(agentRailApp);
  a.sentTenancies = sentLets.size;
  a.paidTenancies = paidLets.size;
  a.avgRent = rentedLets.size ? rentSum / rentedLets.size : 0;
  a.avgSentToPaidDays = s2pN ? s2pSum / s2pN : null;
  a.avgPaidToDeedDays = p2dN ? p2dSum / p2dN : null;
  return a;
}

/** Deeds that did not get where they were going, for the needs-attention row.

    WAS "no agent_contacts row", which is the supplier rail's ladder: one of our
    agencies delivers to its active PEOPLE and has no mailbox, so every estate
    deed counted here whatever actually happened. Now the same rule the filter
    and the badge read, so the three cannot disagree. Counts both states, because
    the needs-attention row is ops and both need working. */
export function deedsWithoutContact(role: Role, scope: PartnerScope): number {
  const set = scopeFull(allFull(), role, scope);
  let n = 0;
  for (const app of set) {
    const s = deliveryStateOf(app);
    if (s === 'failed' || s === 'cannot_deliver') n += 1;
  }
  return n;
}

/** #86 In-force guarantees expiring within the next 14 days (already-expired
    excluded), the slippage tripwire for the needs-attention row. */
export function lapsingWithin14(role: Role, scope: PartnerScope): number {
  const set = scopeFull(allFull(), role, scope);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const in14 = new Date(today);
  in14.setDate(in14.getDate() + 14);
  let n = 0;
  for (const app of set) {
    if (app.status !== 'deed' || app.refunded) continue;
    const exp = app.expiry ?? (app.tenancyStart ? guaranteeExpiry(app.tenancyStart) : null);
    if (exp && exp >= today && exp <= in14) n += 1; // expired excluded (exp >= today)
  }
  return n;
}

/**
 * HOW MANY OF EACH THING THE VIEWER'S SCOPE ACTUALLY HOLDS.
 *
 * "Volume by agency" over one agency is a single bar labelled with the name
 * already in the page header, and "Volume by branch" over one branch is the
 * same chart again. Both were rendered for every viewer because the dashboard
 * was written for opndoor looking at an estate, where there are always several.
 * For a single-branch agency the screen was three copies of one number.
 *
 * Counted over the WHOLE scoped book rather than the selected period, so a
 * quiet month does not make a panel appear and disappear; and over the book
 * rather than over the org tables, because the book is what every other figure
 * on the page is computed from and cannot disagree with it.
 */
export function liveScopeShape(role: Role, scope: PartnerScope): { agencies: number; branches: number } {
  const set = scopeFull(allFull(), role, scope);
  const agencies = new Set<string>();
  const branches = new Set<string>();
  for (const app of set) {
    if (app.agency) agencies.add(app.agencyId || app.agency);
    if (app.branch) branches.add(app.branchId || `${app.agency}/${app.branch}`);
  }
  return { agencies: agencies.size, branches: branches.size };
}

/** Per-group accumulator, emitted as a LeagueRow. */
interface Group {
  id: string;
  name: string;
  sub: string;
  partner?: string;
  refs: number; paid: number; deed: number;
  /** Tenancy-grain denominators; see LiveAgg.sentTenancies for why. */
  refLets: Set<string>; paidLets: Set<string>;
  feesGross: number; refundValue: number;
  partnerComm: number; agentComm: number;
  partnerCommExcl: number; agentCommExcl: number;
}

function emit(g: Group): LeagueRow {
  return {
    key: g.id, // #107 partner-distinct identity for week-over-week movement matching
    name: g.name,
    sub: g.sub,
    partner: g.partner,
    refs: g.refs,
    fees: g.feesGross, // "Fees collected" is gross; commission below is net of refunds
    paid: g.paid,
    deed: g.deed,
    // Both applicant-grain. Sent to Deed briefly divided by LETS, which was
    // right while one deed covered a whole tenancy; each tenant now signs their
    // own, so `deed` counts people and a let denominator would exceed 100%.
    sp: g.refs ? g.paid / g.refs : 0,
    conv: g.refs ? g.deed / g.refs : 0,
    partnerComm: g.partnerComm, // already net: refunded applications are excluded below
    agentComm: g.agentComm,
  };
}

type GroupKey = 'agency' | 'branch' | 'referrer' | 'month';

/** A stable identity for the group (so distinct entities that share a display
    name — e.g. a "High Street" branch under two agencies — are never merged). */
function keyOf(app: FullApp, key: GroupKey, monthLabel: (d: Date) => string): { id: string; name: string; sub: string; partner: string } | null {
  const S = ' ';
  const pn = partnerName(app.partner);
  if (key === 'agency') return { id: `${app.partner}${S}${app.agency}`, name: app.agency || '(unknown agency)', sub: '', partner: pn };
  if (key === 'branch') return { id: `${app.partner}${S}${app.agency}${S}${app.branch}`, name: app.branch || '(unknown branch)', sub: app.agency || '', partner: pn };
  if (key === 'referrer') {
    // opndoor internal staff never appear in referrer performance rankings (League
    // Referrers, dashboard volume-by-referrer, export breakdown, by-referrer trend).
    // Their applications remain fully real in every other surface (money,
    // settlements, agency/branch groupings, exports).
    if (app.referrerRole === 'superadmin') return null;
    // Nor does an application that nobody referred. A direct signup has no
    // referrer at all (applications.referrer_id is nullable as of 20260812090000),
    // and without this it would rank as a referrer called "(unknown)" whose
    // volume grows every time the direct rail is used. Tested by
    // referrer-exclusion.test.ts alongside the superadmin case.
    if (!app.referrer) return null;
    return { id: `${app.partner}${S}${app.referrer}`, name: app.referrer || '(unknown)', sub: roleLabel(app.referrerRole), partner: '' };
  }
  // month: bucket by the sent month (drives the referrer "monthly volume" chart)
  if (!app.sentAt) return null;
  const lbl = monthLabel(app.sentAt);
  return { id: lbl, name: lbl, sub: '', partner: '' };
}

/** Group the scoped set into ranked LeagueRows by agency / branch / referrer / month. */
function groupRows(set: FullApp[], key: GroupKey, start: Date, end: Date): LeagueRow[] {
  const monthLabel = (d: Date) => `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`;
  const map = new Map<string, Group>();
  const get = (id: string, name: string, sub: string, partner: string): Group => {
    let g = map.get(id);
    if (!g) { g = { id, name, sub, partner, refs: 0, paid: 0, deed: 0, refLets: new Set(), paidLets: new Set(), feesGross: 0, refundValue: 0, partnerComm: 0, agentComm: 0, partnerCommExcl: 0, agentCommExcl: 0 }; map.set(id, g); }
    return g;
  };
  for (const app of set) {
    // #2/#13 Withdrawn and Expired are terminal and excluded from every league/
    // volume figure (refs, conversion, fees), matching liveAggregate's exclusion.
    if (app.withdrawn || app.expired) continue;
    const k = keyOf(app, key, monthLabel);
    if (!k) continue;
    // PER-ORG ATTRIBUTION. An agency/branch row earns its OWN lines; a referrer or
    // month row is not an org, so it carries the whole payout. partnerRate is the
    // supplier rail and is untouched.
    const agentShare = key === 'agency' ? orgRate(app, 'agency', app.agencyId, app.agency)
      : key === 'branch' ? orgRate(app, 'branch', app.branchId, app.branch)
      : totalRate(app);
    // Same rule as liveAggregate: an agency of ours has no partner to pay, so it
    // contributes no partner commission to any ranking or breakdown row.
    const r = { partner: agentRailApp(app) ? 0 : app.partnerRate, agent: agentShare };
    const sentIn = inRange(app.sentAt, start, end);
    const paidIn = inRange(app.paidAt, start, end);
    const deedIn = inRange(app.deedAt, start, end);
    if (!sentIn && !paidIn && !deedIn) continue; // nothing in period for this entity
    const g = get(k.id, k.name, k.sub, k.partner);
    const letId = app.tenancyId ?? `solo:${app.ref}`;
    if (sentIn) { g.refs += 1; g.refLets.add(letId); }
    if (paidIn) {
      // Same rule as liveAggregate: refunded application earns no net commission.
      g.paid += 1; g.paidLets.add(letId); g.feesGross += feeBaseFor(app);
      // The refund is of the FEE, not of the rent. Matches liveAggregate and
      // livePartnerBreakdown, which both already said feeBaseFor.
      if (app.refunded) { g.refundValue += app.refundedAmount ?? feeBaseFor(app); g.partnerCommExcl += feeBaseFor(app) * r.partner; g.agentCommExcl += feeBaseFor(app) * r.agent; }
      else { g.partnerComm += feeBaseFor(app) * r.partner; g.agentComm += feeBaseFor(app) * r.agent; }
    }
    if (deedIn) g.deed += 1;
  }
  const rows = [...map.values()].map(emit);
  // Months sort chronologically (most recent first); entities sort by fees.
  if (key === 'month') return rows.sort((x, y) => monthOrder(y.name) - monthOrder(x.name));
  return rows.sort((x, y) => y.fees - x.fees || y.refs - x.refs || x.name.localeCompare(y.name)); // #104 fees, then refs, then name
}

function monthOrder(label: string): number {
  const [abbr, yr] = label.split(' ');
  return Number(yr) * 12 + MONTH_ABBR.indexOf(abbr);
}

/** Live volume rows for the three dashboard charts (full lists; callers take top-N). */
export function liveVolume(role: Role, scope: PartnerScope, period: Period): { branches: LeagueRow[]; agencies: LeagueRow[]; referrers: LeagueRow[] } {
  const [start, end] = periodRange(period);
  const set = scopeFull(allFull(), role, scope);
  const isRef = role === 'referrer';
  return {
    branches: groupRows(set, 'branch', start, end),
    agencies: groupRows(set, 'agency', start, end),
    // A referrer's own third chart is their monthly volume; everyone else's is by referrer.
    referrers: groupRows(set, isRef ? 'month' : 'referrer', start, end),
  };
}

/** Live league rows for one view (agency/branch/referrer), period + scope filtered. */
/** Stable identity of a league row (same entity across two rankings). Prefers the
    partner-distinct group key, so two same-named referrers at different partners never
    collide on movement; falls back to name|sub|partner for rows without a key (mock). */
function leagueKey(r: LeagueRow): string {
  return r.key ?? `${r.name}|${r.sub}|${r.partner ?? ''}`;
}

export function liveLeague(view: LeagueView, role: Role, scope: PartnerScope, partner: string, period: Period, branchIds?: string[]): LeagueRow[] {
  const [start, end] = periodRange(period);
  // opndoor admin's in-page partner filter narrows an all-partners scope to one.
  const effScope: PartnerScope = scope === ALL_PARTNERS && partner ? partner : scope;
  let set = scopeFull(allFull(), role, effScope);
  // Position ladder ("my branch(es) / my brand"): narrow the league (and only the
  // league — scopeFull, which the dashboard shares, is left alone) to the viewer's
  // own branch set. An empty list means the caller holds a scope that covers no
  // branch, so the league is empty rather than the whole partner.
  if (branchIds) {
    const allow = new Set(branchIds);
    set = set.filter((a) => a.branchId != null && allow.has(a.branchId));
  }
  const cur = groupRows(set, view, start, end);
  // #107 Week-over-week movement: rank the SAME table as it stood 7 days ago (the
  // window pulled back a week) and diff positions by entity (on the fly, no store).
  // A period shorter than a week has no comparable prior table, so movement is null.
  const prevEnd = new Date(end.getTime() - 7 * DAY);
  const priorRank = new Map<string, number>();
  if (prevEnd > start) groupRows(set, view, start, prevEnd).forEach((r, i) => priorRank.set(leagueKey(r), i));
  return cur.map((r, i) => {
    const pr = priorRank.get(leagueKey(r));
    return { ...r, movement: pr == null ? null : pr - i };
  });
}

export interface MonthRow { label: string; refs: number; fees: number; deeds: number; comm: number; }

/** Trailing-12-month buckets: referrals sent, gross fees paid, deeds issued, and
    net partner commission (per-application rates, refunded apps excluded) per
    month. Fees are gross (collected), matching the volume/league basis. */
export function liveMonths(role: Role, scope: PartnerScope): MonthRow[] {
  const set = scopeFull(allFull(), role, scope);
  const end = nowRef();
  const start = new Date(end.getFullYear(), end.getMonth() - 11, 1);
  const months: (MonthRow & { key: number })[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    months.push({ label: `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`, key: d.getFullYear() * 12 + d.getMonth(), refs: 0, fees: 0, deeds: 0, comm: 0 });
  }
  const lo = months[0].key, hi = months[11].key;
  const idx = (d: Date) => d.getFullYear() * 12 + d.getMonth();
  const at = (d: Date) => months.find((x) => x.key === idx(d));
  for (const app of set) {
    if (app.withdrawn || app.expired) continue; // #2/#13 terminal: excluded from trailing-12-month volume/fees
    if (app.sentAt && idx(app.sentAt) >= lo && idx(app.sentAt) <= hi) { const m = at(app.sentAt); if (m) m.refs += 1; }
    if (app.paidAt && idx(app.paidAt) >= lo && idx(app.paidAt) <= hi) {
      const m = at(app.paidAt);
      if (m) { m.fees += feeBaseFor(app); if (!app.refunded) m.comm += feeBaseFor(app) * app.partnerRate; }
    }
    if (app.deedAt && idx(app.deedAt) >= lo && idx(app.deedAt) <= hi) { const m = at(app.deedAt); if (m) m.deeds += 1; }
  }
  return months.map((m) => ({ label: m.label, refs: m.refs, fees: Math.round(m.fees), deeds: m.deeds, comm: Math.round(m.comm) }));
}

/* ---------- Tenant initials (privacy-preserving) ----------
   Settlement statements identify the tenant by INITIALS ONLY, never the full
   name. FullApp carries no tenant name, so the initials are read from the
   pseudonymised application record (findRecord) — the same source the live
   bordereau uses. Empty string when no record/name is resolvable (e.g. mock mode),
   so the statement falls back to the guarantee reference alone. */
function nameInitials(n: string): string {
  return n.trim().split(/\s+/).map((p) => p[0] ?? '').slice(0, 2).join('').toUpperCase();
}
function tenantInitialsFor(ref: string): string {
  const rec = findRecord(ref);
  return rec?.name ? nameInitials(rec.name) : '';
}

/* ---------- Partner commission settlement ----------
   Commission accrues on the payment date (calendar-month buckets, matching the
   per-application net-of-refunds rule) and is settled on the 15th of the
   following month. This answers, for the prior calendar month, exactly what is
   payable to each partner and which applications make it up. */
export interface SettlementApp {
  ref: string; agency: string; branch: string; paidAt: Date;
  /** The tenancy's monthly rent. NOT what was charged: see `fee`. */
  rent: number;
  /** WHAT THIS APPLICANT WAS CHARGED, and the amount the rate applied to.
      Equal to rent at standard terms and different at every negotiated one, so a
      statement that prints rent under "Fee" states a price nobody paid and a
      derived rate nobody agreed. Added because it was doing exactly that. */
  fee: number;
  commission: number; tenantInitials: string;
}
export interface PartnerSettlement { partner: string; partnerName: string; commission: number; apps: SettlementApp[]; }
export interface CommissionSettlement { monthLabel: string; settlementDate: Date; partners: PartnerSettlement[]; }

/** Partner commission payable on the 15th of this month, for the prior calendar
    month (net of refunds), broken down per partner with constituent apps. */
export function getCommissionSettlement(role: Role, scope: PartnerScope): CommissionSettlement {
  const now = nowRef();
  const bStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
  const bEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999); // last day of prior month
  const settlementDate = new Date(now.getFullYear(), now.getMonth(), 15); // 15th of this month
  const monthLabel = `${MONTH_LONG[bStart.getMonth()]} ${bStart.getFullYear()}`;
  const set = scopeFull(allFull(), role, scope);
  const byPartner = new Map<string, PartnerSettlement>();
  for (const a of set) {
    if (!inRange(a.paidAt, bStart, bEnd)) continue;
    if (a.refunded) continue; // net of refunds: a refunded application earns no commission
    const commission = feeBaseFor(a) * a.partnerRate;
    let ps = byPartner.get(a.partner);
    if (!ps) { ps = { partner: a.partner, partnerName: partnerName(a.partner), commission: 0, apps: [] }; byPartner.set(a.partner, ps); }
    ps.commission += commission;
    ps.apps.push({ ref: a.ref, agency: a.agency, branch: a.branch, paidAt: a.paidAt!, rent: a.rent, fee: feeBaseFor(a), commission, tenantInitials: tenantInitialsFor(a.ref) });
  }
  const partners = [...byPartner.values()].sort((x, y) => y.commission - x.commission);
  partners.forEach((p) => p.apps.sort((x, y) => y.commission - x.commission));
  return { monthLabel, settlementDate, partners };
}

/* ---------- Per-partner commission breakdown (selected period) ----------
   Commission accrues on the payment date; each row is one partner with its
   partner-side and agent-side commission, both gross and net of refunds. The
   net columns sum to the summary's partnerCommNet / agentCommNet, so the table
   reconciles to the headline totals. */
export interface PartnerCommissionRow {
  partner: string;
  partnerName: string;
  paid: number;
  feesGross: number;
  refundValue: number;
  partnerCommGross: number;
  partnerCommNet: number;
  agentCommGross: number;
  agentCommNet: number;
}

export function livePartnerBreakdown(role: Role, scope: PartnerScope, period: Period): PartnerCommissionRow[] {
  const [start, end] = periodRange(period);
  const set = scopeFull(allFull(), role, scope);
  const map = new Map<string, PartnerCommissionRow>();
  for (const app of set) {
    if (!inRange(app.paidAt, start, end)) continue; // commission attributed to the payment period
    // Lines, not the scalar; and no partner cut on the agent rail. Identical to
    // liveAggregate, so this table foots to the KPIs above it.
    const r = { partner: agentRailApp(app) ? 0 : app.partnerRate, agent: totalRate(app) };
    let row = map.get(app.partner);
    if (!row) {
      row = { partner: app.partner, partnerName: partnerName(app.partner), paid: 0, feesGross: 0, refundValue: 0,
        partnerCommGross: 0, partnerCommNet: 0, agentCommGross: 0, agentCommNet: 0 };
      map.set(app.partner, row);
    }
    row.paid += 1;
    row.feesGross += feeBaseFor(app);
    row.partnerCommGross += feeBaseFor(app) * r.partner;
    row.agentCommGross += feeBaseFor(app) * r.agent;
    if (app.refunded) {
      row.refundValue += app.refundedAmount ?? feeBaseFor(app);
    } else {
      row.partnerCommNet += feeBaseFor(app) * r.partner;
      row.agentCommNet += feeBaseFor(app) * r.agent;
    }
  }
  // #85 Under All-partners scope, list every active partner even with no paid
  // referrals in the period, so a partner never silently vanishes ("ghost").
  // Paused/onboarding partners with no activity stay hidden (noted in the caption).
  if (scope === ALL_PARTNERS) {
    for (const p of getPartners()) {
      if (p.status === 'active' && !map.has(p.id)) {
        map.set(p.id, { partner: p.id, partnerName: p.name, paid: 0, feesGross: 0, refundValue: 0,
          partnerCommGross: 0, partnerCommNet: 0, agentCommGross: 0, agentCommNet: 0 });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.partnerCommNet - a.partnerCommNet);
}

/* ---------- Agent commission settlement ----------
   Mirrors the partner settlement, but for the agent share, aggregated at AGENCY
   level (the agent commission is payable to the letting agency): prior calendar
   month accrual on the payment date, net of refunds, payable the 15th, with the
   constituent applications listed. */
export interface AgentSettlementAgency { agency: string; partner: string; partnerName: string; commission: number; apps: SettlementApp[]; }
/** One PAYEE for the period. A group, an agency or a branch may each be one. */
export interface AgentSettlementPayee extends AgentSettlementAgency {
  level: 'group' | 'agency' | 'branch';
  orgId: string | null;
  /** Stable identity, so a statement addresses a payee rather than a name. */
  key: string;
}
export interface AgentCommissionSettlement {
  monthLabel: string;
  settlementDate: Date;
  /** The agency ROLLUP: agency-level lines only. Kept for every existing reader. */
  agencies: AgentSettlementAgency[];
  /** AUTHORITATIVE. One line per payee; the period total is their sum. */
  payees: AgentSettlementPayee[];
  /** Sum of every payee line. Use this, not the agencies rollup, for a total. */
  total: number;
}

/* ---------- The statement, and the settlement, from ONE accumulator ----------

   An agency's commission statement and Opndoor's settlement figure have to be
   the same number, and the way to guarantee that is not to assert it afterwards
   but to compute it once. accruePayees is the single pass: applications that
   PAID inside a window, refunds excluded, one line per payee per application.

   getAgentCommissionSettlement is that pass over the prior calendar month, and
   is unchanged in shape and in every figure it returned before. The statement is
   the same pass over a month the reader chooses, carrying the per-line detail a
   statement has to show and a settlement total does not: the tenant, the tenancy,
   the fee the rate applied to, the share of it this applicant paid, and where the
   rate came from. settlement-statement.test.ts asserts they foot. */

/** One application's contribution to one payee, with everything a statement
    line has to name. The frozen line is the authority for the rate AND for its
    source: neither is recomputed, so a statement issued in May reads the same
    in November. */
export interface StatementLine {
  ref: string;
  tenant: string;
  /** Set when this applicant is one of a joint tenancy; null for a tenancy of one. */
  tenancyId: string | null;
  /** "2 of 2" — this applicant's place in the tenancy. '' when there is no tenancy. */
  tenancyPlace: string;
  branch: string;
  paidAt: Date;
  /** What THIS applicant paid. On a joint tenancy that is their share of the
      tenancy fee, which is also the amount their commission is a share of. */
  fee: number;
  /** Their share of the tenancy, or null when they are the whole of it. */
  sharePercent: number | null;
  rate: number;
  source: CommissionSource | null;
  commission: number;
}

export interface CommissionStatement {
  /** 'YYYY-MM', the machine key for the month. */
  monthKey: string;
  monthLabel: string;
  payeeKey: string;
  level: 'group' | 'agency' | 'branch';
  orgId: string | null;
  /** The payee's own name. Never a partner name: on the agent rail the partner
      is house plumbing and must not appear on a customer's statement. */
  payeeName: string;
  lines: StatementLine[];
  total: number;
}

const monthKeyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabelOf = (d: Date) => `${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`;

/** THE ONE PASS. Every payee's lines for applications paid inside the window. */
function accruePayees(set: FullApp[], bStart: Date, bEnd: Date): Map<string, {
  key: string; level: 'group' | 'agency' | 'branch'; orgId: string | null; orgName: string;
  partner: string; commission: number; apps: SettlementApp[]; lines: StatementLine[];
}> {
  const byPayee = new Map<string, {
    key: string; level: 'group' | 'agency' | 'branch'; orgId: string | null; orgName: string;
    partner: string; commission: number; apps: SettlementApp[]; lines: StatementLine[];
  }>();
  for (const a of set) {
    if (!inRange(a.paidAt, bStart, bEnd)) continue;
    if (a.refunded) continue; // net of refunds
    const fee = feeBaseFor(a);
    const mates = a.tenancyId ? set.filter((x) => x.tenancyId === a.tenancyId).length : 0;
    // ONE LINE PER PAYEE. A historic row has no split and resolves to a single
    // agency line at the scalar rate, so it lands exactly where it always did.
    for (const p of payeesFor(a, fee)) {
      // Namespaced by partner as well, so same-named orgs under different
      // partners never merge -- what the old `${a.partner}${a.agency}` key was for.
      const key = `${a.partner}|${p.key}`;
      let row = byPayee.get(key);
      if (!row) {
        row = { key, level: p.level, orgId: p.orgId, orgName: p.orgName || '(unknown agency)',
          partner: a.partner, commission: 0, apps: [], lines: [] };
        byPayee.set(key, row);
      }
      row.commission += p.amount;
      row.apps.push({ ref: a.ref, agency: a.agency, branch: a.branch, paidAt: a.paidAt!, rent: a.rent, fee, commission: p.amount, tenantInitials: tenantInitialsFor(a.ref) });
      row.lines.push({
        ref: a.ref,
        // The summary store carries the name; a row whose summary has not
        // loaded falls back to its reference rather than to a blank cell.
        tenant: findRecord(a.ref)?.name || a.ref,
        tenancyId: a.tenancyId ?? null,
        tenancyPlace: a.tenancyId && a.tenancyPosition ? `${a.tenancyPosition} of ${mates || a.tenancyPosition}` : '',
        branch: a.branch,
        paidAt: a.paidAt!,
        fee,
        sharePercent: a.sharePercent ?? null,
        rate: p.rate,
        source: p.source,
        commission: p.amount,
      });
    }
  }
  return byPayee;
}

export function getAgentCommissionSettlement(role: Role, scope: PartnerScope): AgentCommissionSettlement {
  const now = nowRef();
  const bStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
  const bEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
  const settlementDate = new Date(now.getFullYear(), now.getMonth(), 15);
  const monthLabel = monthLabelOf(bStart);
  const acc = accruePayees(scopeFull(allFull(), role, scope), bStart, bEnd);
  const payees: AgentSettlementPayee[] = [...acc.values()]
    .map((r) => ({ key: r.key, level: r.level, orgId: r.orgId, agency: r.orgName,
      partner: r.partner, partnerName: partnerName(r.partner), commission: r.commission, apps: r.apps }))
    .sort((x, y) => y.commission - x.commission);
  payees.forEach((p) => p.apps.sort((x, y) => y.commission - x.commission));
  const agencies: AgentSettlementAgency[] = payees.filter((p) => p.level === 'agency');
  const total = payees.reduce((s2, p) => s2 + p.commission, 0);
  return { monthLabel, settlementDate, agencies, payees, total };
}

/** The months this viewer has anything to state, newest first. Built from the
    payment dates actually in their book, so a month with no activity is never
    offered as an empty statement. */
export function statementMonths(role: Role, scope: PartnerScope): { key: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const a of scopeFull(allFull(), role, scope)) {
    if (!a.paidAt || a.refunded) continue;
    seen.set(monthKeyOf(a.paidAt), monthLabelOf(a.paidAt));
  }
  return [...seen.entries()].map(([key, label]) => ({ key, label })).sort((x, y) => (x.key < y.key ? 1 : -1));
}

/**
 * The commission statement for one month: one per payee the viewer can see.
 *
 * Scoped like everything else — a manager gets their own agency's, an admin
 * gets one per payee and picks. Over the PRIOR calendar month it returns, payee
 * for payee, the same totals as getAgentCommissionSettlement, because it is the
 * same accumulator; settlement-statement.test.ts holds that to account.
 */
export function getCommissionStatements(role: Role, scope: PartnerScope, monthKey: string): CommissionStatement[] {
  const [y, m] = monthKey.split('-').map(Number);
  if (!y || !m) return [];
  const bStart = new Date(y, m - 1, 1, 0, 0, 0, 0);
  const bEnd = new Date(y, m, 0, 23, 59, 59, 999);
  const label = monthLabelOf(bStart);
  const acc = accruePayees(scopeFull(allFull(), role, scope), bStart, bEnd);
  return [...acc.values()]
    .map((r) => ({
      monthKey, monthLabel: label, payeeKey: r.key, level: r.level, orgId: r.orgId,
      payeeName: r.orgName,
      lines: r.lines.sort((x, y) => x.paidAt.getTime() - y.paidAt.getTime() || x.ref.localeCompare(y.ref)),
      total: r.commission,
    }))
    .sort((x, y) => y.total - x.total);
}

export interface TrendRow { label: string; count: number; fees: number; comm: number; sub?: string; }

/** Live 12-month trend: by-month or an entity breakdown, carrying real net
    partner commission (per-application rates) so it reconciles with the KPIs. */
export function liveTrend(view: 'month' | 'branch' | 'agency' | 'referrer', role: Role, scope: PartnerScope): TrendRow[] {
  if (view === 'month') return liveMonths(role, scope).map((m) => ({ label: m.label, count: m.refs, fees: m.fees, comm: m.comm }));
  const set = scopeFull(allFull(), role, scope);
  const end = nowRef();
  const start = new Date(end.getFullYear(), end.getMonth() - 11, 1);
  return groupRows(set, view, start, end).map((r) => ({ label: r.name, count: r.refs, fees: Math.round(r.fees), comm: Math.round(r.partnerComm), sub: r.sub || undefined }));
}
