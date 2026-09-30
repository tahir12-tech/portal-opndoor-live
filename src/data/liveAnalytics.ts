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

   AND EVERY COMMISSION FIGURE IN HERE ASKS maySeeCommission FIRST.
   An agency Manager is role 'management' without sees_commission: they read every
   referral, every branch and the whole team, and they are shown nothing the agency
   earns. This file is where that has to hold, because it is the MODEL. A screen
   that hides a figure it was still handed is one refactor away from showing it
   again, and in the meantime the number is sitting in the page's memory. So a
   reader the predicate refuses gets commission that was never computed: zero at
   the row (liveAggregate, groupRows, liveMonths, which are sums of a rate) and an
   empty settlement or statement (the whole point of which is what is owed).
   Volumes, conversion, guaranteed value and the FEE THE TENANT WAS CHARGED are
   untouched: a Manager is supposed to see all of it, and gating those would break
   the level rather than protect it.
   ===================================================================== */
import { SUPABASE_ENABLED } from '@/lib/supabase';
import type { LeagueRow, LeagueView, PartnerScope, Period, Role } from './types';
import { ALL_PARTNERS, agencyLevelOf, maySeeCommission } from './types';
import { showsOffices } from './agencyOffices';
import { allFull, findRecord, guaranteeExpiry, isHydrated, type FullApp, guaranteedAnnual } from './applicationsService';
import { getPartner, getPartners, partnerName } from './partnersService';
import { periodRange, scopeFull, inRange } from './paymentMetrics';
import { payeesFor, orgRate, totalRate, feeBaseFor, agentRailApp, feeBasisOf, sourcesOf, linesFor, type FeeBasis } from './commissionSplit';
import { deliveryStateOf } from './deliveryState';
// Walk fix 21: one rule for the line under a referrer's name.
import { whereTheyWork, type WhereReader } from './whereTheyWork';
// Walk fixes 8 and 16 share one rule for what is under guarantee, and when.
import { inForceDuring } from './inForce';
import { isDirectRail, isHousePartner } from './channel';
// Walk fixes 15 and 20: the CUSTOMER is the origin, not the route partner.
import { originOf, originValue } from './origin';
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

/** Display label for a referring user, under the name, on League and on Volume
    by referrer.

    THE THREE LEVELS, as the rest of the product names them. This used to print
    the internal role words: a Director and a Manager both read "Management",
    which does not distinguish them and is not a word the client uses, and a
    Negotiator read "Referrer", which is the role name the level replaced. The
    Director / Manager split needs the commission bit, because that is the only
    thing separating them.

    The 'opndoor' arm stays (#112): opndoor-admin actors are labelled honestly
    rather than as an agency level, and agencyLevelOf answers null for them, so
    that arm has to be explicit. */
export function roleLabel(role: Role | null | undefined, seesCommission?: boolean | null): string {
  if (role === 'superadmin' || role === 'opndoor_manager') return 'opndoor';
  return agencyLevelOf(role ?? 'referrer', seesCommission === true) ?? 'opndoor';
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
  /* COMMISSION PAYABLE TO A REAL SUPPLIER, which is not the same as the
     partner cut. On the agent rail the "partner" is the house route
     opndoor-agents, so that cut is opndoor's OWN margin and is not owed to
     anybody. Summing it under a heading that says payable would state
     opndoor's revenue as money leaving the business. */
  supplierCommNet: number;
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
  // Asked once, outside the loop: whether this reader may be told what the agency
  // earns does not change from row to row.
  const seesComm = maySeeCommission(role);
  // #2/#13 Withdrawn and Expired are terminal and pre-payment: they leave the
  // funnel entirely, so they are excluded from every count, conversion denominator,
  // ops metric and average here (never inside Sent, never in stuck-at-Sent).
  const set = scopeFull(allFull(), role, scope).filter((x) => !x.withdrawn && !x.expired);
  const a: LiveAgg = {
    sent: 0, paid: 0, deed: 0, feesGross: 0, refundValue: 0, refundCount: 0, feesNet: 0,
    guaranteed: 0, partnerCommNet: 0, supplierCommNet: 0, agentCommNet: 0, partnerCommExcl: 0, agentCommExcl: 0,
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
    //
    // AND NEITHER RATE IS APPLIED AT ALL FOR A READER WHO MAY NOT SEE MONEY.
    // Same technique for the same reason: the four commission totals below are
    // nothing but sums of these two rates, so zeroing here leaves a Manager's
    // aggregate with no earnings figure to find. What they could see before: this
    // aggregate is what fills the dashboard's commission tile (the headline, the
    // second line and the reversal on refunds) and the commission columns of the
    // summary export, so the whole of it reached a Manager's Reporting page.
    const r = !seesComm ? { partner: 0, agent: 0 }
      : { partner: agentRailApp(app) ? 0 : app.partnerRate, agent: totalRate(app) };
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
      } else if (app.partiallyRefunded) {
        /* R2. A PARTIAL REFUND MOVES MONEY, NOT THE GUARANTEE. The deed still
           stands and the underwriter is still on risk, so this is NOT counted
           as a refunded application and its commission is NOT excluded --
           losing the whole commission line over ten pounds is the defect this
           fixes, measured on dev at GBP 311.54 against a GBP 10 refund.

           But the money that went back is not money kept, so the amount still
           reduces net fees. Only the AMOUNT, never feeBaseFor: falling back to
           the whole fee here would silently restore the very behaviour being
           removed.

           Commission stays on the WHOLE fee rather than being pro-rated down.
           That is the status quo for any application that was not refunded,
           and whether a partial refund should reduce it is a commercial
           decision recorded as NM-I, not one to take in an arithmetic fix. */
        a.refundValue += app.refundedAmount ?? 0;
        a.partnerCommNet += feeBaseFor(app) * r.partner;
        if (!isHousePartner(app.partner)) a.supplierCommNet += feeBaseFor(app) * r.partner;
        a.agentCommNet += feeBaseFor(app) * r.agent;
      } else {
        a.partnerCommNet += feeBaseFor(app) * r.partner;
        // Only a genuine supplier is owed the partner cut; a house route's is
        // opndoor's own margin. isHousePartner is the same test every screen
        // uses to keep plumbing partners off it.
        if (!isHousePartner(app.partner)) a.supplierCommNet += feeBaseFor(app) * r.partner;
        a.agentCommNet += feeBaseFor(app) * r.agent;
      }
    }
    /* PER DEED, AND A DEED COVERS A SHARE. This summed the whole tenancy's rent
       once per deed, so a two-tenant tenancy at £2,000 contributed £48,000 to a
       figure labelled "total guaranteed rent value" when £24,000 was guaranteed.
       Every tile, chart and export total that reads this was overstated by the
       joint share of the book. */
    if (inRange(app.deedAt, start, end)) a.deed += 1;
    /* WALK FIX 16. "12 months' rent for each executed deed IN FORCE in the
       period, counting a joint tenancy once, not once per tenant."

       WAS: summed alongside the deed count above, on the same test -- the
       deed ISSUED inside the period. That is the right question for "how
       many deeds did we issue" and the wrong one for "how much rent is
       under guarantee", and the two had been sharing a line. A guarantee
       written last year and still running contributed nothing; one written
       inside the period and already over contributed fully. The two errors
       move the total in opposite directions, which is how the figure could
       look plausible while being built from the wrong set.

       The count stays on deeds ISSUED, because that is what it counts.

       inForceDuring is shared with the bordereau (item 8): the same three
       clauses, so an underwriter's document and this tile cannot disagree
       about which guarantees exist. "Counting a joint tenancy once" needs
       no dedupe and never did -- guaranteedAnnual returns the SHARE and the
       shares sum to the rent. */
    if (inForceDuring(app, start, end)) a.guaranteed += guaranteedAnnual(app);
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
  /* WALK FIX 21. Where this person's referrals came from, gathered across
     their rows: somebody who moved office has two, and the line has to be
     able to say both rather than pick one. Only filled for referrer rows. */
  agencies: Set<string>; branches: Set<string>;
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

type GroupKey = 'agency' | 'branch' | 'referrer' | 'month' | 'supplier';

/** A stable identity for the group (so distinct entities that share a display
    name — e.g. a "High Street" branch under two agencies — are never merged). */
function keyOf(app: FullApp, key: GroupKey, monthLabel: (d: Date) => string): { id: string; name: string; sub: string; partner: string } | null {
  /* A separator that cannot occur in an agency or branch name, so two
     distinct orgs can never collide on one key. Written as an ESCAPE, not
     as the raw byte it used to be: a literal NUL makes the whole file
     binary to grep, which then reports no matches instead of an error,
     and a search tool that silently finds nothing is a trap. */
  const S = '\u0000';
  const pn = partnerName(app.partner);
  /* Q3, ANSWERED. Matt, 2026-09-30: "Direct signups never appear in
     Volume by branch, Volume by agency or any agency chart (no
     'Unattached' row)."

     A direct signup is matched to a real agency and branch by the
     automatic matcher, so somebody can service it, and that is the whole
     reason it reaches these two groupings at all: `app.agency` is set and
     looks exactly like a referral that agency made. It did not make it,
     and the rest of the estate already says so -- `commission_statement_lines`
     excludes the direct rail, `agency_weekly_digest` excludes it, and
     `agreement_volume` excludes it so a matched tenant cannot push an
     agency into a better commission band. The charts were the surface
     that did not.

     AND THE UNMATCHED ONES ARE THE "Unattached" ROW. A direct signup with
     no agency yet grouped under `(unknown agency)`, which is a row of
     Opndoor's own business wearing an agency's clothes.

     THE REFERRER ARM ALREADY DID THIS, three comments below, for the same
     reason. This is the same rule on the two groupings that were missed.

     BY SLUG, because keyOf runs before anything is hydrated that could
     answer it any other way, and `isDirectRail` is the client's mirror of
     `application_channel`'s first arm -- narrower than `isHousePartner`,
     which would also exclude every real agency referral. */
  if ((key === 'agency' || key === 'branch') && isDirectRail(app.partner)) return null;
  /* VOLUME BY SUPPLIER. Matt, 2026-09-30: "Add a 'Volume by supplier'
     card alongside Volume by agency, same style."

     A REAL SUPPLIER ONLY, which is `isHousePartner` and not
     `isDirectRail`: the house partner every agency shares is not a
     supplier, and a chart with one enormous bar called "Agency referral"
     beside the real suppliers would be the same mistake the Every
     customer table exists to avoid. The referencing hand-over and the
     direct rail go with it. */
  if (key === 'supplier') {
    if (isHousePartner(app.partner)) return null;
    return { id: app.partner, name: pn, sub: '', partner: pn };
  }
  if (key === 'agency') return { id: `${app.partner}${S}${app.agency}`, name: app.agency || '(unknown agency)', sub: '', partner: pn };
  /* NM-P. A SINGLE-OFFICE AGENCY IS NAMED BY THE AGENCY, and its subtitle
     goes with it -- the sub is the agency, so leaving it would print the
     same words on both lines of the row.

     THE ID IS UNTOUCHED. It is the grouping key, not a label: two distinct
     offices that happen to share a display name must still be two rows,
     and collapsing the key would merge them. Only what the reader SEES
     changes, which is the whole of Matt's rule. */
  if (key === 'branch') {
    const names = showsOffices(app.agency);
    return {
      id: `${app.partner}${S}${app.agency}${S}${app.branch}`,
      name: names ? (app.branch || '(unknown branch)') : (app.agency || '(unknown agency)'),
      sub: names ? (app.agency || '') : '',
      partner: pn,
    };
  }
  if (key === 'referrer') {
    // opndoor internal staff never appear in referrer performance rankings (League
    // Referrers, dashboard volume-by-referrer, export breakdown, by-referrer trend).
    // Their applications remain fully real in every other surface (money,
    // settlements, agency/branch groupings, exports).
    if (app.referrerRole === 'superadmin') return null;
    /* Nor does an application that nobody referred. A direct signup has no
       referrer at all (applications.referrer_id is nullable as of
       20260812090000), and without this it would rank as a referrer whose
       volume grows every time the direct rail is used.

       WALK FIX 18: ASKED OF THE ID, NOT THE NAME. This tested `!app.referrer`,
       which is the DISPLAY NAME, and hydrate fills that from
       `referrer_name ?? joined.full_name ?? '(unknown)'`. Dev's ten direct
       applications carry referrer_name = 'Direct signup' with a null
       referrer_id, so the name was always truthy and the guard never fired --
       the list showed "Direct signup" ranked as a Negotiator, which is what
       Matt reported.

       And not `referrerRole` either, which is the trap in the obvious fix:
       it comes from the embedded users row and RLS can withhold that from a
       reader who can still see the application. Dev has 17 agency
       applications in that state, and keying on the role would drop real
       referrals by real people while fixing the direct ones.

       `referrerId === undefined` is the mock path, which has no such column
       and whose rows all have real referrers; only an explicit null is "no
       referrer". */
    if (app.referrerId === null) return null;
    if (!app.referrer) return null;
    /* WALK FIX 21. The sub was `roleLabel(...)`: "Negotiator", "Director".
       Matt: "their level ... which is irrelevant. Show where they work
       instead." Left EMPTY here and filled in groupRows below, because
       where somebody works is gathered across their rows and this function
       sees one row at a time -- a referrer with referrals from two offices
       has to be able to say so. */
    return { id: `${app.partner}${S}${app.referrer}`, name: app.referrer || '(unknown)', sub: '', partner: '' };
  }
  // month: bucket by the sent month (drives the referrer "monthly volume" chart)
  if (!app.sentAt) return null;
  const lbl = monthLabel(app.sentAt);
  return { id: lbl, name: lbl, sub: '', partner: '' };
}

/** Group the scoped set into ranked LeagueRows by agency / branch / referrer / month.
    `seesComm` is the caller's answer to maySeeCommission: false means the rows carry
    no commission, and the ranking is unaffected because it has never been a
    commission ranking (fees, then refs, then name). */
function groupRows(
  set: FullApp[], key: GroupKey, start: Date, end: Date, seesComm: boolean,
  reader: WhereReader = 'opndoor',
): LeagueRow[] {
  const monthLabel = (d: Date) => `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`;
  const map = new Map<string, Group>();
  const get = (id: string, name: string, sub: string, partner: string): Group => {
    let g = map.get(id);
    if (!g) { g = { id, name, sub, partner, refs: 0, paid: 0, deed: 0, refLets: new Set(), paidLets: new Set(), agencies: new Set(), branches: new Set(), feesGross: 0, refundValue: 0, partnerComm: 0, agentComm: 0, partnerCommExcl: 0, agentCommExcl: 0 }; map.set(id, g); }
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
    // contributes no partner commission to any ranking or breakdown row. And the
    // same rule again for a reader who may not see money: LeagueRow.partnerComm /
    // agentComm are numbers, so "no figure" is zero here, which is the only shape
    // the row allows. A Manager reading League saw both columns in full, per agency
    // and per branch, which is the agency's income broken down by office.
    const r = !seesComm ? { partner: 0, agent: 0 }
      : { partner: agentRailApp(app) ? 0 : app.partnerRate, agent: agentShare };
    const sentIn = inRange(app.sentAt, start, end);
    const paidIn = inRange(app.paidAt, start, end);
    const deedIn = inRange(app.deedAt, start, end);
    if (!sentIn && !paidIn && !deedIn) continue; // nothing in period for this entity
    const g = get(k.id, k.name, k.sub, k.partner);
    if (key === 'referrer') { g.agencies.add(app.agency ?? ''); g.branches.add(app.branch ?? ''); }
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
  /* WALK FIX 21, and the reader decides what it says. An admin's list spans
     agencies so it names both; an agency with several offices names the
     office; a single-office agency gets no line, because every row would
     say the same thing. `reader` is worked out once per call rather than
     per row: it is a fact about the book, not about the person. */
  const rows = [...map.values()].map((g) => (
    key === 'referrer'
      ? emit({ ...g, sub: whereTheyWork({ reader, agencies: [...g.agencies], branches: [...g.branches] }) })
      : emit(g)));
  // Months sort chronologically (most recent first); entities sort by fees.
  if (key === 'month') return rows.sort((x, y) => monthOrder(y.name) - monthOrder(x.name));
  return rows.sort((x, y) => y.fees - x.fees || y.refs - x.refs || x.name.localeCompare(y.name)); // #104 fees, then refs, then name
}

function monthOrder(label: string): number {
  const [abbr, yr] = label.split(' ');
  return Number(yr) * 12 + MONTH_ABBR.indexOf(abbr);
}

/** What the monthly-volume trend can be measured in. Walk fix 17 added the
 *  two that are Opndoor's own view of its book. */
export type TrendMeasure = 'commission' | 'payable' | 'value' | 'count' | 'deeds';

/**
 * WHICH MEASURES THIS READER IS OFFERED, and in which order. Walk fix 17.
 *
 * "Opndoor doesn't earn commission, it pays it. For admin, the trend's
 * options should be Opndoor's view: fees collected, commission payable,
 * referrals sent, deeds issued, defaulting to fees collected. 'Commission
 * earned' stays for agency and supplier users, where it's their money."
 *
 * THE OLD SERIES WAS NOT MERELY UNHELPFUL, IT WAS STRUCTURALLY ZERO. The
 * trend's "commission" is the supplier cut, and `liveMonths` zeroes that on
 * a house route because a house route's cut is Opndoor's own margin owed to
 * nobody -- which is right, and is asserted in
 * our_margin_is_not_theirs.test.sql. So an admin on the house rail could
 * only ever see twelve bars of zero beside a tile saying GBP 3,232. The
 * money model was correct and the CHART was offering a reader a series that
 * cannot apply to them.
 *
 * FIRST IS THE DEFAULT, which is why the order is Matt's and not
 * alphabetical, and why this returns a list rather than a set.
 *
 * AND A CUSTOMER IS NEVER OFFERED "payable". It is Opndoor's view of what
 * leaves the business; an agency reading it would be reading its own income
 * as an expense.
 */
export function trendMeasuresFor(
  role: Role, seesCommission: boolean,
): { value: TrendMeasure; label: string }[] {
  if (role === 'superadmin' || role === 'opndoor_manager') {
    return [
      { value: 'value', label: 'Fees collected' },
      /* AND NOT TO A READER WHO MAY NOT SEE COMMISSION, which on this arm
         means Opndoor's ops staff. `payable` is what Opndoor owes out, so
         it is a commission figure by the test RoleOnly's note sets: it
         would let somebody work out what the estate earns. Migration
         20261005170000 is explicit that may_see_commission is "never true
         for opndoor_manager, who is Opndoor operations and has never seen
         commission."

         THIS WAS LATENT, NOT NEW. The role was named on this arm from the
         start, but the trend card itself sat behind a RoleOnly allowlist
         that omitted them, so the option was never drawn. Fixing their
         blank Reporting page draws the card, which is what turned a dormant
         line into a live one -- and is the reason the gate belongs here and
         not in the caller. */
      ...(maySeeCommission(role) ? [{ value: 'payable' as TrendMeasure, label: 'Commission payable' }] : []),
      { value: 'count', label: 'Referrals sent' },
      { value: 'deeds', label: 'Deeds issued' },
    ];
  }
  return [
    // The measure itself is the commission surface here, so the OPTION is
    // what gets gated, not the chart it draws.
    ...(seesCommission ? [{ value: 'commission' as TrendMeasure, label: 'Commission earned' }] : []),
    { value: 'value' as TrendMeasure, label: 'Fees collected' },
    { value: 'count' as TrendMeasure, label: 'Referral count' },
  ];
}

/**
 * WHO IS READING, as far as the line under a referrer's name is concerned.
 * Walk fix 21.
 *
 * Three answers, and only one of them is about a role: Opndoor staff read
 * across agencies, and for everybody else what decides it is the SHAPE of
 * their own book rather than their permissions. An agency Director and an
 * agency Negotiator get the same line.
 *
 * COUNTED OFF THE SCOPED SET, BEFORE THE PERIOD FILTER. "An agency with more
 * than one branch" is a fact about the agency, not about what it happened to
 * refer this month -- counting inside the period would drop the second line
 * from a two-office agency in a quiet month and put it back in a busy one.
 */
function readerFor(role: Role, set: FullApp[]): WhereReader {
  if (role === 'superadmin' || role === 'opndoor_manager') return 'opndoor';
  const branches = new Set(set.map((a) => (a.branch ?? '').trim()).filter(Boolean));
  return branches.size > 1 ? 'multi-branch' : 'one-branch';
}

/** One customer's line on the estate-wide Reporting table. Walk fixes 15
 *  and 20. */
export interface CustomerRow {
  /** The origin selection this row is, so a click can narrow to it. */
  key: string;
  name: string;
  kind: 'agency' | 'supplier';
  sent: number;
  fees: number;
  deeds: number;
  /** What Opndoor owes out on this customer's business. Zero for a reader
   *  who may not see commission, never absent: the column is a number. */
  payable: number;
  /** THE AGENCY'S OWN ID, SO THE ROW CAN BE OPENED.
   *  `key` is `agency:<name>` because Matt's ruling of 2026-08-17 is that
   *  an agency exists once across partners and is identified by name. The
   *  ROUTE is a different question: /agencies/:key resolves against
   *  `id ?? name`, so a link built from the name alone lands nowhere for
   *  any agency that has an id -- which on dev is all of them and in the
   *  mock book is none, so the fixture hid it completely. Absent on a
   *  supplier row, where the slug in `key` is already the route. */
  agencyId?: string;
}

/**
 * ONE ROW PER CUSTOMER: every supplier and every agency, side by side.
 * Walk fix 20, and the table at the centre of walk fix 15's answer (NM-F).
 *
 * WHY THIS IS NOT livePartnerBreakdown. That groups by `app.partner`, and on
 * the AGENCY rail every agency of ours is carried by one house partner,
 * `opndoor-agents`. So it has one row for the whole agency estate, named
 * after a company that does not exist outside our own schema, and one row
 * per supplier -- which is why Matt reported "Kestrel appears nowhere" and
 * "Northgate appears twice" of the same screen. "Per partner" was never
 * "per customer": on the agency rail the partner is a ROUTE.
 *
 * THE CUSTOMER IS THE ORIGIN, which is what origin.ts exists to name. Same
 * derivation the Applications list column and the scope narrowing use, so
 * the table cannot disagree with either about who exists or what they are
 * called.
 *
 * AND THE DIRECT RAIL IS NOT A CUSTOMER. It is Opndoor's own business with
 * no agency or supplier behind it; a row for it would be Opndoor appearing
 * in its own customer list.
 *
 * THE MEASURES ARE OPNDOOR'S FOUR, the same four as walk fix 17's trend, and
 * on the same event dates as liveAggregate so the table foots to the tiles
 * above it: sent by sent date, fees and commission by PAYMENT date, deeds by
 * deed date.
 */
export function liveByCustomer(role: Role, scope: PartnerScope, period: Period): CustomerRow[] {
  const [start, end] = periodRange(period);
  const set = scopeFull(allFull(), role, scope);
  /* Commission payable is a commission figure, so the rule that governs
     every other one governs this: a reader the predicate refuses gets a
     zero that was never computed rather than a figure to hide. */
  const seesComm = maySeeCommission(role);
  const map = new Map<string, CustomerRow>();
  for (const app of set) {
    // #2/#13 Withdrawn and Expired are terminal and out of every volume
    // figure, matching liveAggregate and groupRows.
    if (app.withdrawn || app.expired) continue;
    const o = originOf(app);
    if (o.kind !== 'agency' && o.kind !== 'supplier') continue;
    const key = originValue(app);
    let row = map.get(key);
    if (!row) { row = { key, name: o.name, kind: o.kind, sent: 0, fees: 0, deeds: 0, payable: 0, agencyId: o.kind === 'agency' ? app.agencyId : undefined }; map.set(key, row); }
    if (inRange(app.sentAt, start, end)) row.sent += 1;
    if (inRange(app.deedAt, start, end)) row.deeds += 1;
    if (inRange(app.paidAt, start, end)) {
      row.fees += feeBaseFor(app);
      /* What leaves the business, and only on a fee that stayed. The
         agency's cut always; a real supplier's too, never a house route's,
         which is Opndoor's own margin. The same two terms as the trend's
         `payable` and as the tile's headline. */
      if (!app.refunded && seesComm) {
        row.payable += feeBaseFor(app) * totalRate(app);
        if (!isHousePartner(app.partner)) row.payable += feeBaseFor(app) * app.partnerRate;
      }
    }
  }
  // Biggest first: fees, then referrals, then name. The same order the
  // league uses, so two tables of the same customers agree about who is top.
  return [...map.values()].sort((a, b) => b.fees - a.fees || b.sent - a.sent || a.name.localeCompare(b.name));
}

/** Live volume rows for the three dashboard charts (full lists; callers take top-N). */
export function liveVolume(role: Role, scope: PartnerScope, period: Period): { branches: LeagueRow[]; agencies: LeagueRow[]; referrers: LeagueRow[]; suppliers: LeagueRow[] } {
  const [start, end] = periodRange(period);
  const set = scopeFull(allFull(), role, scope);
  const isRef = role === 'referrer';
  const seesComm = maySeeCommission(role);
  return {
    branches: groupRows(set, 'branch', start, end, seesComm),
    agencies: groupRows(set, 'agency', start, end, seesComm),
    /* A FOURTH LIST FROM THE SAME FUNCTION, not a new one, so the two
       cards cannot disagree about a period or a measure. */
    suppliers: groupRows(set, 'supplier', start, end, seesComm),
    // A referrer's own third chart is their monthly volume; everyone else's is by referrer.
    referrers: groupRows(set, isRef ? 'month' : 'referrer', start, end, seesComm, readerFor(role, set)),
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
  /* THE LEAGUE IS RANKED ON FEES, WHICH IS WHY A MANAGER STILL HAS ONE.
     Ordering here is fees collected, then referrals, then name (see groupRows), and
     the fee a tenant was charged is the price of the product, not the agency's
     earnings. So refusing a Manager the commission columns costs them no position
     and no row: the volume ranking IS the ranking, and it is the same table a
     Director sees with two columns removed. Nothing to substitute. */
  const seesComm = maySeeCommission(role);
  // Walk fix 21: "Same rule anywhere else referrers are listed (League,
  // exports)." Ignored by groupRows for the agency, branch and month views.
  const reader = readerFor(role, set);
  const cur = groupRows(set, view, start, end, seesComm, reader);
  // #107 Week-over-week movement: rank the SAME table as it stood 7 days ago (the
  // window pulled back a week) and diff positions by entity (on the fly, no store).
  // A period shorter than a week has no comparable prior table, so movement is null.
  const prevEnd = new Date(end.getTime() - 7 * DAY);
  const priorRank = new Map<string, number>();
  if (prevEnd > start) groupRows(set, view, start, prevEnd, seesComm, reader).forEach((r, i) => priorRank.set(leagueKey(r), i));
  return cur.map((r, i) => {
    const pr = priorRank.get(leagueKey(r));
    return { ...r, movement: pr == null ? null : pr - i };
  });
}

export interface MonthRow {
  label: string; refs: number; fees: number; deeds: number;
  /** Commission EARNED by the reader: the supplier cut, zero on a house
      route because a house route's cut is Opndoor's own margin. */
  comm: number;
  /* WALK FIX 17. COMMISSION PAYABLE, which is the other side of the same
     money and is what an Opndoor admin's page is about. `comm` above is
     structurally zero for an admin looking at the house rail -- correctly,
     and that is why the trend showed GBP 0 every month while the tile said
     GBP 3,232. This is what leaves the business: the agency's cut plus a
     real supplier's, net of refunds, matching the tile's own
     `agentCommNet + supplierCommNet`. */
  payable: number;
}

/** Trailing-12-month buckets: referrals sent, gross fees paid, deeds issued, and
    net partner commission (per-application rates, refunded apps excluded) per
    month. Fees are gross (collected), matching the volume/league basis. */
export function liveMonths(role: Role, scope: PartnerScope): MonthRow[] {
  const set = scopeFull(allFull(), role, scope);
  // `comm` stays at its zero for a reader who may not see money: the trend card's
  // measure dropdown offered "Commission earned" and OPENED on it, so a Manager's
  // first sight of Reporting was twelve months of the agency's earnings. The months
  // themselves, the referrals and the fees collected are theirs and are untouched.
  const seesComm = maySeeCommission(role);
  const end = nowRef();
  const start = new Date(end.getFullYear(), end.getMonth() - 11, 1);
  const months: (MonthRow & { key: number })[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    months.push({ label: `${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`, key: d.getFullYear() * 12 + d.getMonth(), refs: 0, fees: 0, deeds: 0, comm: 0, payable: 0 });
  }
  const lo = months[0].key, hi = months[11].key;
  const idx = (d: Date) => d.getFullYear() * 12 + d.getMonth();
  const at = (d: Date) => months.find((x) => x.key === idx(d));
  for (const app of set) {
    if (app.withdrawn || app.expired) continue; // #2/#13 terminal: excluded from trailing-12-month volume/fees
    if (app.sentAt && idx(app.sentAt) >= lo && idx(app.sentAt) <= hi) { const m = at(app.sentAt); if (m) m.refs += 1; }
    if (app.paidAt && idx(app.paidAt) >= lo && idx(app.paidAt) <= hi) {
      const m = at(app.paidAt);
      /* isHousePartner, not agentRailApp. On a HOUSE partner partnerRate is
         Opndoor's own cut and must never appear as the reader's commission;
         a NAMED partner configured 'opndoor_referenced' is still owed real
         commission, and zeroing by referencing mode would wipe a legitimate
         supplier settlement. :220 already draws the line this way. */
      if (m) {
        m.fees += feeBaseFor(app);
        if (!app.refunded && seesComm) m.comm += feeBaseFor(app) * (isHousePartner(app.partner) ? 0 : app.partnerRate);
        /* WALK FIX 17. What Opndoor owes out on this fee: the agency's cut
           (totalRate, always) plus a real supplier's (never a house route's,
           which is Opndoor's own margin). The same two terms the tile's
           headline adds, and the same refund rule. */
        /* `seesComm` HERE TOO, which the line above has always had and this
           one did not. A reader the predicate refuses gets a zero that was
           never computed rather than a figure the chart is trusted to hide,
           which is the rule liveByCustomer states for the same measure.
           Nobody who is OFFERED this measure loses anything: the only arm
           of trendMeasuresFor that lists it is the Opndoor one, and an
           admin passes the predicate. */
        if (!app.refunded && seesComm) {
          m.payable += feeBaseFor(app) * totalRate(app);
          if (!isHousePartner(app.partner)) m.payable += feeBaseFor(app) * app.partnerRate;
        }
      }
    }
    if (app.deedAt && idx(app.deedAt) >= lo && idx(app.deedAt) <= hi) { const m = at(app.deedAt); if (m) m.deeds += 1; }
  }
  /* NOT ROUNDED HERE. These were whole pounds, which is right for the only
     consumer this was written for (the dashboard trend tile, where fmtBig
     reads "£4.4k" either way) and wrong the moment a second consumer printed
     them into a money column: September collected £4,430.77 and the export
     said £4,431.00 beside £4,430.77 on every other surface.

     Rounding belongs at the point of DISPLAY, where the surface knows whether
     it wants a headline or a figure. A data function that rounds has decided
     that for every caller it will ever have, including the ones that do not
     exist yet. The export carried a re-summing workaround for exactly one
     release; it is gone with this line. */
  return months.map((m) => ({ label: m.label, refs: m.refs, fees: m.fees, deeds: m.deeds, comm: m.comm, payable: m.payable }));
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
export interface CommissionSettlement {
  monthLabel: string;
  /** THE MACHINE KEY, YYYY-MM. monthLabel is for a human to read; anything
      that has to ADDRESS the month -- the stored statement reference, above
      all -- needs this, and parsing the English back out of the label is how
      a reference ends up depending on a month name. */
  monthKey: string;
  settlementDate: Date;
  partners: PartnerSettlement[];
}

/** Partner commission payable on the 15th of this month, for the prior calendar
    month (net of refunds), broken down per partner with constituent apps. */
/**
 * THE TWO WINDOWS A SETTLEMENT CAN BE ABOUT.
 *
 * 'prior' is the closed month, payable on the 15th of this one: what is owed.
 * 'current' is this month to date, payable on the 15th of next: what is
 * building up. Reporting shows both, because showing only the first said "no
 * commission is payable for August" over a September that was accruing money,
 * which reads as "you have earned nothing" and is the opposite of true.
 *
 * ONE PLACE, so the two blocks cannot disagree about where a month ends.
 */
export type SettlementWindow = 'prior' | 'current';

function settlementWindow(w: SettlementWindow): { bStart: Date; bEnd: Date; settlementDate: Date } {
  const now = nowRef();
  if (w === 'current') {
    return {
      bStart: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0),
      // TO DATE, not to the end of the month: money that has not been taken yet
      // is not accruing, it is forecast, and this figure is read as a fact.
      bEnd: now,
      settlementDate: new Date(now.getFullYear(), now.getMonth() + 1, 15),
    };
  }
  return {
    bStart: new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0),
    bEnd: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999),
    settlementDate: new Date(now.getFullYear(), now.getMonth(), 15),
  };
}

export function getCommissionSettlement(role: Role, scope: PartnerScope, window: SettlementWindow = 'prior'): CommissionSettlement {
  const { bStart, bEnd, settlementDate } = settlementWindow(window);
  const monthLabel = `${MONTH_LONG[bStart.getMonth()]} ${bStart.getFullYear()}`;
  const monthKey = monthKeyOf(bStart);
  /* NO PARTNERS AND SO NO MONEY for a reader who may not see commission. A
     settlement is nothing but what is owed and to whom, so there is no narrower
     version of it to compute: the month and the settlement date stay, because they
     are a calendar and not a figure, and every payable line is absent rather than
     zero. A Manager read this as the bordereau block on Reporting, one line per
     partner with the amount due and the constituent applications under it. */
  if (!maySeeCommission(role)) return { monthLabel, monthKey, settlementDate, partners: [] };
  const set = scopeFull(allFull(), role, scope);
  const byPartner = new Map<string, PartnerSettlement>();
  for (const a of set) {
    if (!inRange(a.paidAt, bStart, bEnd)) continue;
    if (a.refunded) continue; // net of refunds: a refunded application earns no commission
    /* OPNDOOR'S OWN MARGIN IS NOT THE AGENCY'S BUSINESS. Round 6. This was
       the one commission accumulator in the file with no rail test -- compare
       the three at :199, :412 and :664 -- so an agency Director's Reporting
       page carried a line "Agency referral - £X" where X is 25% of their own
       fees, which is Opndoor's house cut on their book, and added it to what
       they were owed. A Director divides that line by the fees beside it and
       reads our margin. Rule 3 makes commercial terms Director-level; it does
       not make OUR terms theirs. The export path already refused this
       (exportsService returns an empty export for an agency reader); the
       screen did not. */
    if (isHousePartner(a.partner)) continue;
    const commission = feeBaseFor(a) * a.partnerRate;
    let ps = byPartner.get(a.partner);
    if (!ps) { ps = { partner: a.partner, partnerName: partnerName(a.partner), commission: 0, apps: [] }; byPartner.set(a.partner, ps); }
    ps.commission += commission;
    ps.apps.push({ ref: a.ref, agency: a.agency, branch: a.branch, paidAt: a.paidAt!, rent: a.rent, fee: feeBaseFor(a), commission, tenantInitials: tenantInitialsFor(a.ref) });
  }
  const partners = [...byPartner.values()].sort((x, y) => y.commission - x.commission);
  partners.forEach((p) => p.apps.sort((x, y) => y.commission - x.commission));
  return { monthLabel, monthKey, settlementDate, partners };
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
  /* EVERY COLUMN OF THIS TABLE IS COMMISSION except the paid count and the fees, and
     it exists to state the split, so it is refused whole rather than thinned out.
     The #85 ghost-partner padding below would otherwise hand back a row per active
     partner with zeros in it, which is a commission table with the figures removed
     and still reads as one. */
  if (!maySeeCommission(role)) return [];
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
  /** YYYY-MM. See CommissionSettlement.monthKey. */
  monthKey: string;
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

export function getAgentCommissionSettlement(role: Role, scope: PartnerScope, window: SettlementWindow = 'prior'): AgentCommissionSettlement {
  const { bStart, bEnd, settlementDate } = settlementWindow(window);
  const monthLabel = monthLabelOf(bStart);
  const monthKey = monthKeyOf(bStart);
  /* THE AGENCY'S OWN EARNINGS, which is the figure the Manager level exists to
     withhold, so this is the one that mattered most: no payees, no rollup and a
     zero total. A Manager saw it on Reporting as "Your commission" with the amount
     payable on the 15th and every payee under it. Nothing is substituted, because
     "what you are owed" has no version that is not money. */
  if (!maySeeCommission(role)) return { monthLabel, monthKey, settlementDate, agencies: [], payees: [], total: 0 };
  const acc = accruePayees(scopeFull(allFull(), role, scope), bStart, bEnd);
  const payees: AgentSettlementPayee[] = [...acc.values()]
    .map((r) => ({ key: r.key, level: r.level, orgId: r.orgId, agency: r.orgName,
      partner: r.partner, partnerName: partnerName(r.partner), commission: r.commission, apps: r.apps }))
    .sort((x, y) => y.commission - x.commission);
  payees.forEach((p) => p.apps.sort((x, y) => y.commission - x.commission));
  const agencies: AgentSettlementAgency[] = payees.filter((p) => p.level === 'agency');
  const total = payees.reduce((s2, p) => s2 + p.commission, 0);
  return { monthLabel, monthKey, settlementDate, agencies, payees, total };
}

/** The months this viewer has anything to state, newest first. Built from the
    payment dates actually in their book, so a month with no activity is never
    offered as an empty statement. */
export function statementMonths(role: Role, scope: PartnerScope): { key: string; label: string }[] {
  // A list of the months the agency earned in is itself a commission surface: it
  // says when there was money and how far back the ledger runs, and every month on
  // it opens a statement. No months for a reader who may not see one.
  if (!maySeeCommission(role)) return [];
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
  // Refused at the model as well as at the panel. The panel (CommissionStatement)
  // answers the same predicate and shows a sentence instead, which is the right
  // answer on a screen; this is the answer for anybody who calls the service
  // directly, now or after the next refactor of that page. Every line carries a
  // rate, a source and a commission amount: there is no partial statement.
  if (!maySeeCommission(role)) return [];
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

export interface TrendRow {
  label: string; count: number; fees: number; comm: number;
  /** Walk fix 17: Opndoor's own two measures. */
  deeds: number; payable: number;
  sub?: string;
}

/** Live 12-month trend: by-month or an entity breakdown, carrying real net
    partner commission (per-application rates) so it reconciles with the KPIs. */
export function liveTrend(view: 'month' | 'branch' | 'agency' | 'referrer', role: Role, scope: PartnerScope): TrendRow[] {
  // Both paths carry a zero `comm` for a reader the predicate refuses: liveMonths
  // never adds it, and groupRows never applies a rate.
  if (view === 'month') return liveMonths(role, scope).map((m) => ({ label: m.label, count: m.refs, fees: m.fees, comm: m.comm, deeds: m.deeds, payable: m.payable }));
  const set = scopeFull(allFull(), role, scope);
  const end = nowRef();
  const start = new Date(end.getFullYear(), end.getMonth() - 11, 1);
  // Unrounded, for the same reason as liveMonths above.
  return groupRows(set, view, start, end, maySeeCommission(role), readerFor(role, set))
    .map((r) => ({
      label: r.name, count: r.refs, fees: r.fees, comm: r.partnerComm,
      deeds: r.deed,
      // Walk fix 17: both halves of what leaves the business. LeagueRow's
      // partnerComm is already zero on a house route, so adding it here is
      // the supplier cut and nothing else.
      payable: r.agentComm + r.partnerComm,
      sub: r.sub || undefined,
    }));
}
