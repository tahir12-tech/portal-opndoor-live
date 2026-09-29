/* =====================================================================
   Analytics service.
   Produces every dashboard figure — funnel, conversions, guaranteed value,
   fees, commission, the volume breakdowns and the 12-month trend.

   In Supabase mode (liveAvailable) every figure is computed from the hydrated
   live application set via liveAnalytics, period-filtered by real dates and
   scoped by role/partner. In mock/test mode the deterministic parametric model
   (mock/analyticsModel) is used so the smoke suite stays meaningful. The split
   follows the established SUPABASE_ENABLED pattern.

   WHO MAY BE TOLD WHAT THE AGENCY EARNS is asked here, in the model, and not only
   at the tile. An agency Manager (role 'management', no sees_commission) reads
   every referral, every branch, the funnel, the fees the tenants were charged, the
   guaranteed value and the team, and is shown no commission figure anywhere. Both
   builders below therefore hand back the same DashboardModel with its commission
   half replaced whole (NO_COMMISSION), computed from an aggregate that carries no
   commission either. The two questions this file used to answer with one flag are
   kept apart now: see the note in liveDashboard.
   ===================================================================== */
import type { LeagueRow, Period, PartnerScope, Role } from './types';
import { fmtRatePct } from '@/lib/format';
import { maySeeCommission } from './types';
import { KEYS, loadString, saveString } from './storage';
import {
  ANNUAL, AVG_RENT, BASE_PAID_FULL, BASE_PAID_REF, BASE_SENT_FULL, BASE_SENT_REF,
  DEFAULT_PERIOD, PERIODS, REF_FRACTION, SHAPE_FULL, SHAPE_REF, TREND_MONTHS,
  convFor, scaleRows, type PeriodDef, type ShapeRow,
} from './mock/analyticsModel';
import { getRatesFor, weightFor } from './partnersService';
import { isAgencyUser, partyIsAgency } from './capabilities';
import { ALL_PARTNERS } from './types';
import { liveAvailable, liveAggregate, liveVolume, liveTrend, deedsWithoutContact, lapsingWithin14, agentRailScope, type LiveAgg, type TrendRow } from './liveAnalytics';
import { SOURCE_LABEL } from './commissionSplit';
export type { TrendRow } from './liveAnalytics';
export { getCommissionSettlement, getAgentCommissionSettlement, getCommissionStatements, statementMonths, liveScopeShape, agentRailScope, livePartnerBreakdown, liveAvailable } from './liveAnalytics';
export type { CommissionSettlement, PartnerSettlement, SettlementApp, AgentCommissionSettlement, AgentSettlementAgency, PartnerCommissionRow, CommissionStatement, StatementLine, SettlementWindow } from './liveAnalytics';

export function getPeriods(): Period[] {
  return PERIODS.map((p) => ({ ...p }));
}

export function getSelectedPeriod(): Period {
  const id = loadString(KEYS.period);
  return PERIODS.find((p) => p.id === id) || PERIODS.find((p) => p.id === DEFAULT_PERIOD)!;
}

export function setSelectedPeriod(id: string): void {
  saveString(KEYS.period, id);
}

function fmtMoney(n: number): string {
  return `£${Math.round(n).toLocaleString('en-GB')}`;
}
function signedNeg(n: number): string {
  return n ? `- ${fmtMoney(n)}` : fmtMoney(0);
}
function pct(n: number, d: number): string {
  return `${d ? Math.round((n / d) * 100) : 0}%`;
}
function days(n: number | null): string {
  return n == null ? '-' : `${n.toFixed(1)}`;
}
export function fmtBig(n: number): string {
  if (n >= 1e6) return `£${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `£${Math.round(n / 1e3)}k`;
  return `£${Math.round(n)}`;
}

export interface DashboardModel {
  sub: string;
  funnelScope: string;
  sent: string;
  paid: string;
  deed: string;
  sp: string;
  pd: string;
  overall: string;
  guaranteed: string;
  deedcount: string;
  /** The same count as a NUMBER. deedcount is already grouped for display
      ("1,284"), and copy that has to agree with its noun cannot be written
      against a formatted string: "across 1 issued deeds" was the result. */
  deedsIssued: number;
  fees: string;
  /** The commission tile's own label. It lived in the page as a d.live ternary,
      which is where it could not see WHO was reading: an agency reads a figure
      struck under terms they signed, and Opndoor reads what it earned. */
  commLbl: string;
  commTag: string;
  commHeadline: string;
  commSecondLbl: string;
  commSecondVal: string;
  /** A third line, used by the admin payable split (Agencies / Suppliers). */
  commThirdLbl: string;
  commThirdVal: string;
  commThirdShown: boolean;
  /** False on the agent rail, where there is no partner to pay and the second
      line would be a structural zero presented as a figure. */
  commSecondShown: boolean;
  /** What the period's fees were a basis of, for the copy under Net fees: "one
      month's rent each", "3 weeks of rent each", or "each at its agreed fee
      basis" when the book is mixed. '' when no fees were collected. */
  feeBasisCopy: string;
  rent: string;
  stuckSent: string;
  stuckPaid: string;
  avgSentToPaid: string;
  avgPaidToDeed: string;
  branchScope: string;
  agencyScope: string;
  referrerTitle: string;
  referrerScope: string;
  branches: LeagueRow[];
  agencies: LeagueRow[];
  referrers: LeagueRow[];
  /** True when computed from live records (drives the folded gross/refunds/net presentation). */
  live: boolean;
  /** Live payment breakdown, folded into the KPI cards (meaningful only when live). */
  feesGross: string;
  refunds: string;
  refundCount: number;
  net: string;
  commExcl: string;
  commExclDetail: string;
  /** Deeds currently awaiting tenant signature, and how many aged past 7 days. */
  awaiting: number;
  awaitingAged: number;
  /** Deeds issued with no resolvable claim contact (undeliverable to the agent). */
  deedsNoContact: number;
  /** #86 In-force guarantees expiring within 14 days (slippage tripwire). */
  lapsing14: number;
}

/* =====================================================================
   THE COMMISSION HALF OF THE MODEL, AND WHAT IT IS WHEN THERE IS NONE.

   An agency Manager is role 'management' without sees_commission: every referral,
   every branch, the whole team, and nothing the agency earns. The tile is gated in
   the page now, but the MODEL is what has to be empty. A hidden figure that was
   still computed is one refactor of the markup away from being drawn again, and
   until then it is sitting in the page's memory for anybody who opens the console.

   Picked out as a type so the two builders below cannot answer this in two
   different ways, and so that a commission field added here later has to be given
   its absent form in NO_COMMISSION before it will compile.

   EMPTY STRINGS, NOT '£0'. These fields are strings, so absence is '' and there is
   no null to reach for without changing what the page is handed. And £0 would be
   the worse lie of the two: the agency did earn, a tile reading "Commission
   (agreed terms) £0" states something false about their business, where '' states
   nothing at all. commSecondShown is false for the same reason it is false on the
   agent rail, which is that there is no second line to draw.
   ===================================================================== */
type CommissionPart = Pick<DashboardModel,
  'commLbl' | 'commTag' | 'commHeadline' | 'commSecondLbl' | 'commSecondVal'
  | 'commSecondShown' | 'commThirdLbl' | 'commThirdVal' | 'commThirdShown'
  | 'commExcl' | 'commExclDetail'>;

const NO_COMMISSION: CommissionPart = {
  commLbl: '', commTag: '', commHeadline: '', commSecondLbl: '', commSecondVal: '',
  commThirdLbl: '', commThirdVal: '', commThirdShown: false,
  commSecondShown: false, commExcl: '', commExclDetail: '',
};

/** Convert a synthetic ShapeRow ([name, refs, fees, sub?]) to a LeagueRow. */
function synthEntity(key: 'branch' | 'agency' | 'referrer', rows: ShapeRow[], pRate: number, aRate: number): LeagueRow[] {
  return rows.map((r) => {
    const refs = r[1];
    const fees = r[2];
    const [sp, pd] = key === 'referrer' ? [0.78, 0.9] : convFor(key, r[0]);
    const conv = sp * pd;
    return {
      name: r[0], sub: r[3] ?? '', refs, fees,
      paid: Math.round(refs * sp), deed: Math.round(refs * conv),
      sp, conv, partnerComm: fees * pRate, agentComm: fees * aRate,
    };
  });
}

/** Build every dashboard figure for a role, period and partner scope. */
export function getDashboardData(role: Role, period: PeriodDef | Period, scope: PartnerScope): DashboardModel {
  if (liveAvailable()) return liveDashboard(role, period as Period, scope);
  return synthDashboard(role, period, scope);
}

/** Live dashboard: every figure summed from the hydrated application set. */
function liveDashboard(role: Role, period: Period, scope: PartnerScope): DashboardModel {
  /* ONE FLAG WAS ANSWERING TWO QUESTIONS, AND GOT BOTH WRONG FOR A MANAGER.
     This was `const isRef = !maySeeCommission(role)`, which was the same question
     for as long as the only reader refused commission was a Negotiator looking at
     their own referrals. A Manager is refused commission too and is the opposite
     kind of reader: they see the whole book. So the flag did the two things it
     should never have done at once.

     It did not remove a single commission figure. It CHOSE ONE: the isRef branch
     headlines agentCommNet, which is the agency's own earnings, so a Manager's
     headline figure was the number the level exists to withhold, under "Commission
     (agreed terms)", at the top of their dashboard.

     And it demoted their book to their own referrals in the copy. "Your referrals
     from sent through to deed issued", "your branches", "your agency", over rows
     that scopeFull had correctly given them for the whole agency. The labels
     contradicted the figures under them.

     So: ownOnly is whether this reader sees only their own, read off the same
     allowlist scopeFull uses (superadmin and management get the book, everybody
     else their own or nothing), so the copy can never disagree with the rows again.
     seesComm is the predicate, and it decides money and nothing else. */
  const ownOnly = role !== 'superadmin' && role !== 'management';
  const seesComm = maySeeCommission(role);
  const a: LiveAgg = liveAggregate(role, scope, period);
  const vol = liveVolume(role, scope, period);
  // Descriptor percentages are the EFFECTIVE rate implied by the actual snapshotted
  // commission (gross commission / gross fees), never the partner's live rate, so
  // the "% of one month's rent" label always reconciles with the £ figure beside it
  // and never moves when a partner's live rate is later edited. Only when the period
  // has no fees at all (nothing to reconcile) do we fall back to the current headline
  // rate as an indicative label.
  //
  // THAT FALLBACK IS A REAL RATE, so it is not fetched for a reader who may not see
  // one. An empty period would otherwise have handed a Manager the partner's live
  // percentage as the label, which is the one path here that is not already zeroed
  // by the aggregate. Both percentages feed the commission tag and nothing else.
  const live = seesComm ? getRatesFor(scope) : { partner: 0, agent: 0 };
  const effRate = (net: number, excl: number, fallback: number) =>
    a.feesGross ? (net + excl) / a.feesGross : fallback;
  const pPct = fmtRatePct(effRate(a.partnerCommNet, a.partnerCommExcl, live.partner));
  const aPct = fmtRatePct(effRate(a.agentCommNet, a.agentCommExcl, live.agent));
  /* `blended` lived here: under an all-partners scope the amounts blend
     per-partner rates, so a single "%" descriptor would not reconcile with the
     figure, and the tag said "per-partner rates" instead. The admin tag no
     longer states a rate at all, because the tile is now Commission PAYABLE
     split by who is owed rather than a rate applied to a fee, so there is
     nothing left for it to qualify. */

  // THE ESTATE. One of our agencies has no supplier above it, so every
  // partner-commission figure on this screen is a structural zero. Read off the
  // scope rather than off the period's rows, so a quiet month does not make the
  // partner line reappear on an agency that will never have one.
  const noPartner = agentRailScope(scope);
  /* NO RATE ON AN AGENCY'S OWN COMMISSION TILE.
     The tag read "Agreement · 23% of 3 weeks of rent, net of refunds". That 23%
     is an EFFECTIVE rate, gross commission over gross fees across every
     agreement that paid in the period, and it was computed that way so it would
     always reconcile with the pound figure beside it. It reconciles and it is
     still not a rate anybody agreed to: a director with a 25% branch and a 20%
     branch has agreed to both and to neither, and the blend moves every month on
     mix alone. So the tile states the amount and says the terms are agreed; the
     rates themselves are named line by line, per agreement, in the commission
     statement further down the same page, which is the one place a rate can be
     stated truthfully.

     Read off isAgencyUser, not off noPartner: an Opndoor admin filtered to one
     of our agencies answers true to noPartner and is still Opndoor, looking
     across a book where the blend is the thing being measured. They keep the
     rate they have always had. */
  /* THE TILE'S WORDS FOLLOW THE PARTY, NOT THE READER. Under View as, an
     Opndoor admin reading an agency's Reporting is not an agency user, but
     the page is that agency's page and the tile has to say what the agency
     would read -- "Commission (agreed terms)", no blended rate -- rather than
     Opndoor's "Commission payable". Same question the page itself asks in
     Dashboard.tsx; written here too because this function is given the scope
     and not the session. */
  const agencyFacing = isAgencyUser(role, scope)
    || (role === 'superadmin' && scope !== ALL_PARTNERS && partyIsAgency(scope));
  // What the rates in the headline actually are. Named from the frozen lines, so
  // a negotiated 20% is called an agreement and not "the Opndoor standard".
  const srcWord = a.sources.length === 1 ? SOURCE_LABEL[a.sources[0]]
    : a.sources.length > 1 ? 'Agreed rates' : null;
  const sourcePrefix = srcWord ? `${srcWord} · `
    : ownOnly ? 'Your agent commission · ' : 'Agent commission · ';
  // "the guarantee fee" is the honest fallback for a period with no fees in it:
  // there is no basis to name, and naming a month's rent would be a guess.
  const basisPhrase = a.feeBasis.phrase || 'the guarantee fee';
  const feeBasisCopy = a.feeBasis.kind === 'none' ? ''
    : a.feeBasis.kind === 'mixed' ? 'each at its agreed fee basis'
    : `${a.feeBasis.phrase} each`;

  /* THE COMMISSION TILE, OR NOTHING WHERE IT WAS. Every field in here is earnings
     or a rate on earnings, including the tag (an effective percentage) and the
     refund reversal (commission taken back). A Manager was shown all of it, so it
     goes as one block rather than field by field: a half-built tile is how the next
     figure gets left behind. The aggregate behind it is already zero for them (see
     liveAggregate), so there is no £ anywhere in this model to recover. */
  const comm: CommissionPart = !seesComm ? NO_COMMISSION : {
    // THE HEADLINE IS THE MONEY THE VIEWER EARNS.
    //
    // It used to be partner commission for everyone but a referrer, which read
    // correctly for a supplier — Rightmove's manager IS the partner — and read as
    // nonsense for one of our agencies, whose own commission was demoted to a
    // footnote under a partner figure that is structurally zero. On the agent
    // rail the agency's own lines ARE the commission, so they lead, and the
    // partner line is dropped rather than shown as £0.
    //
    // The rate is named by its SOURCE, off the frozen lines. "20% of one month's
    // rent" was wrong twice for Regent: the 20% is their agreement, not the
    // standard, and the basis is three weeks, not a month. All of which is how
    // OPNDOOR reads this tile; an agency's carries no rate at all, for the reason
    // set out at agencyFacing above.
    /* PAYABLE, FOR OPNDOOR. An admin reading this page is not looking at what
       opndoor EARNED, they are looking at what it owes out, which is a
       different number: the house route's partner cut is opndoor's own margin
       and is not owed to anybody. supplierCommNet excludes it. An agency's own
       tile is unchanged and still reads as their agreed terms. */
    commLbl: agencyFacing ? 'Commission (agreed terms)' : ownOnly ? 'Commission earned' : 'Commission payable',
    commTag: agencyFacing
      ? `${sourcePrefix}net of refunds`
      : ownOnly || noPartner
      ? `${sourcePrefix}${aPct} of ${basisPhrase}, net of refunds`
      // No "partner" pill on the admin tile: the split below names who is owed,
      // and "partner" is our word for one of the two kinds.
      : 'Net of refunds',
    commHeadline: ownOnly || noPartner ? fmtMoney(a.agentCommNet)
      : fmtMoney(a.agentCommNet + a.supplierCommNet),
    // Rate-free for an agency even though commSecondShown is false for them and
    // this string is not currently drawn: the rule is about the TILE, and the
    // next person to draw a second line there must not smuggle the blend back in.
    commSecondLbl: agencyFacing
      ? 'Agent commission (net of refunds)'
      : ownOnly
      ? `Passed to opndoor as partner (${pPct}, net)`
      : 'Agencies',
    commSecondVal: ownOnly ? fmtMoney(a.partnerCommNet) : fmtMoney(a.agentCommNet),
    commSecondShown: !noPartner,
    // The other half of the payable split. Admin only: an agency has no
    // suppliers and a single-partner reader is looking at their own cut.
    commThirdLbl: 'Suppliers',
    commThirdVal: fmtMoney(a.supplierCommNet),
    commThirdShown: !agencyFacing && !ownOnly && !noPartner,
    commExcl: signedNeg(a.partnerCommExcl + a.agentCommExcl),
    commExclDetail: noPartner
      ? fmtMoney(a.agentCommExcl)
      : `Partner ${fmtMoney(a.partnerCommExcl)} · Agent ${fmtMoney(a.agentCommExcl)}`,
  };

  return {
    sub: ownOnly
      ? 'Your referrals from sent through to deed issued, computed from your live records.'
      : 'Live view of referrals from sent through to deed issued, computed from live records.',
    funnelScope: ownOnly ? 'Sent to Paid to Deed Issued · your referrals' : 'Sent to Paid to Deed Issued · all branches',
    sent: a.sent.toLocaleString('en-GB'),
    paid: a.paid.toLocaleString('en-GB'),
    deed: a.deed.toLocaleString('en-GB'),
    sp: pct(a.paid, a.sent),
    /* APPLICANT GRAIN ON BOTH SIDES, AGAIN.
       These were switched to tenancy denominators earlier today, correctly at
       the time: one deed covered a whole let and only the lead reached Deed
       Issued, so deeds-over-applicants read a three-person let as 33%
       converted. The per-tenant deed ruling inverts that. Every tenant now has
       their own deed, so `deed` counts applicants again, and dividing by lets
       would report the same three-person let as 300%. Both halves of every
       ratio here count people. */
    pd: pct(a.deed, a.paid),
    overall: pct(a.deed, a.sent),
    guaranteed: fmtBig(a.guaranteed),
    deedcount: a.deed.toLocaleString('en-GB'),
    deedsIssued: a.deed,
    fees: fmtMoney(a.feesGross),
    ...comm,
    feeBasisCopy,
    rent: fmtMoney(a.avgRent),
    stuckSent: a.stuckSent.toLocaleString('en-GB'),
    stuckPaid: a.stuckPaid.toLocaleString('en-GB'),
    avgSentToPaid: days(a.avgSentToPaidDays),
    avgPaidToDeed: days(a.avgPaidToDeedDays),
    branchScope: ownOnly ? 'your branches' : 'top branches',
    agencyScope: ownOnly ? 'your agency' : 'by agency',
    referrerTitle: ownOnly ? 'Your monthly volume' : 'Volume by referrer',
    referrerScope: ownOnly ? 'recent months' : 'top performers',
    branches: vol.branches,
    agencies: vol.agencies,
    referrers: vol.referrers,
    live: true,
    feesGross: fmtMoney(a.feesGross),
    refunds: signedNeg(a.refundValue),
    refundCount: a.refundCount,
    net: fmtMoney(a.feesNet),
    awaiting: a.awaiting,
    awaitingAged: a.awaitingAged,
    deedsNoContact: deedsWithoutContact(role, scope),
    lapsing14: lapsingWithin14(role, scope),
  };
}

/** Synthetic dashboard (mock/test mode): the deterministic parametric model. */
function synthDashboard(role: Role, period: PeriodDef | Period, scope: PartnerScope): DashboardModel {
  /* THE SAME TWO QUESTIONS, and here the conflation also SHRANK THE BOOK.
     `isRef = !maySeeCommission(role)` drove the size of the synthetic funnel as
     well as the copy, so a Manager in mock or demo mode was modelled as a single
     referrer: REF_FRACTION of the referrals sent, the referrer shapes instead of
     the full ones, and the referrer's own stuck counts. They are supposed to see
     every referral in the agency. See liveDashboard for the whole argument; both
     builders now split it the same way. */
  const ownOnly = role !== 'superadmin' && role !== 'management';
  const seesComm = maySeeCommission(role);
  const w = ownOnly ? 1 : weightFor(scope);
  const sent = ownOnly ? Math.max(1, Math.round(period.fSent * REF_FRACTION)) : Math.round(period.fSent * w);
  const paid = Math.round(sent * period.sp);
  const deed = Math.round(paid * period.pd);
  const feesNum = paid * AVG_RENT;
  const shape = ownOnly ? SHAPE_REF : SHAPE_FULL;
  const baseSent = ownOnly ? BASE_SENT_REF : BASE_SENT_FULL;
  const basePaid = ownOnly ? BASE_PAID_REF : BASE_PAID_FULL;
  const kc = sent / baseSent;
  const kf = paid / basePaid;
  const baseStuck = ownOnly ? [8, 3] : [74, 27];
  /* THE RATES ARE THE WHOLE OF THE COMMISSION HERE, so a reader who may not see
     money is never given them. Everything downstream of this line is earnings: the
     two percentages in the tag, the tile's own figures, and the partnerComm /
     agentComm on every breakdown row (the agency's income split by office and by
     person, which the League page ranks and exports). LeagueRow's two commission
     fields are numbers, so absence there is zero, and the honest way to hold a zero
     is never to have applied a rate to anything. */
  const rates = seesComm ? getRatesFor(scope) : { partner: 0, agent: 0 };
  const pPct = fmtRatePct(rates.partner);
  const aPct = fmtRatePct(rates.agent);
  // The same reader test as the live path, so mock and demo mode show an agency
  // the tile they will meet in the real portal rather than a rate-bearing one.
  /* THE TILE'S WORDS FOLLOW THE PARTY, NOT THE READER. Under View as, an
     Opndoor admin reading an agency's Reporting is not an agency user, but
     the page is that agency's page and the tile has to say what the agency
     would read -- "Commission (agreed terms)", no blended rate -- rather than
     Opndoor's "Commission payable". Same question the page itself asks in
     Dashboard.tsx; written here too because this function is given the scope
     and not the session. */
  const agencyFacing = isAgencyUser(role, scope)
    || (role === 'superadmin' && scope !== ALL_PARTNERS && partyIsAgency(scope));

  /* And the tile itself, all of it or none of it, exactly as on the live path. The
     synthetic model multiplies the scope's rates by the period's fees right here,
     so this is where the figure has to not be computed: there is no aggregate
     upstream to have zeroed. */
  const comm: CommissionPart = !seesComm ? NO_COMMISSION : {
    commLbl: agencyFacing ? 'Commission (agreed terms)' : ownOnly ? 'Commission earned to date' : 'Commission payable',
    // No frozen lines to name a source from here and no refunds in the model, so
    // the agency tag is the bare "whose money is this", with no rate.
    commTag: agencyFacing ? 'Agent commission'
      : ownOnly ? `Your agent commission · ${aPct} of one month's rent` : 'Net of refunds',
    /* THE HEADLINE IS THE READER'S OWN MONEY, as it already is on the live path.
       This branched on isRef alone, so an agency DIRECTOR was handed the partner
       cut as their headline with their own commission demoted underneath. Live
       mode has dropped that shape for the agent rail for a while (see noPartner
       in liveDashboard); the synthetic model kept it because the model itself
       assumes a supplier above every referral. Relabelling the tile "Commission
       (agreed terms)" over Opndoor's cut would have made a wrong figure read as
       a promise, so the mock path now answers the same way the real one does. */
    commHeadline: ownOnly || agencyFacing ? fmtMoney(feesNum * rates.agent) : fmtMoney(feesNum * rates.partner),
    commSecondLbl: agencyFacing ? 'Agent commission'
      : ownOnly ? `Passed to opndoor as partner (${pPct})` : 'Agencies',
    commSecondVal: ownOnly ? fmtMoney(feesNum * rates.partner) : fmtMoney(feesNum * rates.agent),
    /* The synthetic model has no notion of a house route, so every partner in
       it is a real supplier and the payable split is the pair it already had.
       Mock and demo therefore read the same words as live rather than a
       different tile. */
    commThirdLbl: 'Suppliers',
    commThirdVal: fmtMoney(feesNum * rates.partner),
    commThirdShown: !agencyFacing && !ownOnly,
    // The synthetic model prices every referral at one month's rent by
    // construction, so it always has a partner line and a single basis. One of
    // our own agencies is the exception: there is no supplier above them, and a
    // £0 partner line reads as money withheld rather than as a party that does
    // not exist.
    commSecondShown: !agencyFacing,
    // No refunds in the synthetic model, so there is nothing reversed to state.
    commExcl: signedNeg(0),
    commExclDetail: '',
  };

  return {
    sub: ownOnly
      ? 'Your referrals from sent through to deed issued, across every agency and branch you refer to.'
      : 'Live view of referrals from sent through to deed issued across all agencies and branches.',
    funnelScope: ownOnly ? 'Sent to Paid to Deed Issued · your referrals' : 'Sent to Paid to Deed Issued · all branches',
    sent: sent.toLocaleString('en-GB'),
    paid: paid.toLocaleString('en-GB'),
    deed: deed.toLocaleString('en-GB'),
    sp: pct(paid, sent),
    pd: pct(deed, paid),
    overall: pct(deed, sent),
    guaranteed: fmtBig(deed * ANNUAL),
    deedcount: deed.toLocaleString('en-GB'),
    deedsIssued: deed,
    fees: fmtMoney(feesNum),
    ...comm,
    feeBasisCopy: "one month's rent each",
    rent: '£2,180',
    stuckSent: Math.round(baseStuck[0] * kc).toString(),
    stuckPaid: Math.round(baseStuck[1] * kc).toString(),
    avgSentToPaid: '4.2',
    avgPaidToDeed: '1.8',
    branchScope: ownOnly ? 'your branches' : 'top branches',
    agencyScope: ownOnly ? 'your agency' : 'by agency',
    referrerTitle: ownOnly ? 'Your monthly volume' : 'Volume by referrer',
    referrerScope: ownOnly ? 'recent months' : 'top performers',
    branches: synthEntity('branch', scaleRows(shape.branches, kc, kf), rates.partner, rates.agent),
    agencies: synthEntity('agency', scaleRows(shape.agencies, kc, kf), rates.partner, rates.agent),
    referrers: synthEntity('referrer', scaleRows(shape.referrers, kc, kf), rates.partner, rates.agent),
    live: false,
    feesGross: fmtMoney(feesNum),
    refunds: signedNeg(0),
    refundCount: 0,
    net: fmtMoney(feesNum),
    awaiting: 0,
    awaitingAged: 0,
    deedsNoContact: 0,
    lapsing14: 0,
  };
}

export type TrendView = 'month' | 'branch' | 'agency' | 'referrer';
export type TrendMeasure = 'commission' | 'value' | 'count';

/**
 * The 12-month trend rows for a breakdown, carrying real net commission so the
 * commission measure reconciles with the KPIs/League/exports. Live in Supabase
 * mode; the synthetic model (single scope rate) otherwise.
 */
export function getTrend(view: TrendView, role: Role, scope: PartnerScope): TrendRow[] {
  if (liveAvailable()) return liveTrend(view, role, scope);
  /* TrendRow.comm IS the commission measure of the monthly volume card, and that
     card used to OPEN on it: twelve bars of what the agency earned were the first
     thing a Manager saw on Reporting. The label, the referral count and the fees
     collected are all theirs, so the row keeps its shape and loses its money. Zero
     rather than absent because comm is a number the chart reads unconditionally;
     the measure is refused in the page as well, and this is what is underneath it
     if it ever is not. */
  const rate = maySeeCommission(role) ? getRatesFor(scope).partner : 0;
  if (view === 'month') {
    return TREND_MONTHS.map((m) => { const fees = Math.round(m[1] * AVG_RENT * 0.8); return { label: m[0], count: m[1], fees, comm: Math.round(fees * rate) }; });
  }
  const key = view === 'branch' ? 'branches' : view === 'agency' ? 'agencies' : 'referrers';
  return scaleRows(SHAPE_FULL[key], 3.754, 3.832).map((r) => ({ label: r[0], count: r[1], fees: r[2], comm: Math.round(r[2] * rate), sub: r[3] }));
}
