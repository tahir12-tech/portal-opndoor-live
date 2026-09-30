/* =====================================================================
   Domain types for the Guarantee Referral Portal.
   These mirror the data model in HANDOFF.md section 6. The service layer
   (src/data/*) returns these shapes today from mock data; a real back end
   would return the same shapes from API calls.
   ===================================================================== */
import type { Channel } from './channel';

/** The three portal roles. "superadmin" is opndoor admin in code. */
/**
 * Portal roles.
 *
 * 'developer' is a partner-side integrator: they belong to a partner the way
 * management does, see the Dev Centre, and must never see commercial data
 * (no commission, no league, no exports, no bordereau).
 *
 * When adding a role, prefer POSITIVE allowlists at every gate. A negative test
 * such as `role !== 'referrer'` silently grants the new role whatever the
 * negation implies, which is how the fourth role would have inherited the
 * commission columns.
 */
export type Role = 'superadmin' | 'management' | 'referrer' | 'developer' | 'opndoor_manager';

/**
 * May this role see commission, fees and the league?
 *
 * The ONE place that answers the question. Every caller previously asked it as
 * `role !== 'referrer'`, which is a negative test: it granted commission to any
 * role that was not a referrer, so the developer role would have inherited it
 * everywhere, and so will the next role somebody adds.
 *
 * Positive by construction. A new role sees no commission until it is named
 * here, and being wrong costs a manager a column rather than showing a partner's
 * rates to someone who should not have them.
 */
export function maySeeCommission(role: Role): boolean {
  if (role === 'superadmin') return true;
  if (role !== 'management') return false;
  return SEES_COMMISSION;
}

/**
 * MAY THIS ROLE READ A BOOK WIDER THAN THEIR OWN REFERRALS?
 *
 * The second question, and it is not the one above. Reading the book and
 * seeing what it earns are two permissions: `opndoor_manager` holds the
 * first and never the second, and an agency Manager holds the first for
 * their own agency and not the second.
 *
 * WHY THIS EXISTS AS A NAME instead of the literal it replaces. The same
 * allowlist -- 'superadmin' and 'management', written out by hand -- stood
 * in four places that all have to agree: `scopeFull`, which decides the
 * rows; `liveDashboard` and `dashboardData`, which decide the words over
 * them; and the RoleOnly gates on Reporting, which decide whether the
 * section is drawn at all. When `opndoor_manager` was added in
 * 20260922090000, all four went stale together and Opndoor's ops staff got
 * a blank Reporting page. A positive allowlist is right, and the note at
 * the top of this file says why; a positive allowlist copied four times is
 * four things to forget. One name, so the next role is added once.
 *
 * READ IT AS A SEAT, NOT A CAPABILITY. It answers "does this person work
 * across parties". It does not name 'referrer', whose own referrals are a
 * separate arm in scopeFull, and it does not name 'developer', the sandbox
 * seat that is given nothing here on purpose.
 */
export const READS_THE_WHOLE_BOOK: Role[] = ['superadmin', 'opndoor_manager', 'management'];

/** The predicate form of READS_THE_WHOLE_BOOK, for callers outside JSX. */
export function readsTheWholeBook(role: Role): boolean {
  return READS_THE_WHOLE_BOOK.includes(role);
}

/* THE DIRECTOR / MANAGER SPLIT, and why one boolean is enough.
   An agency has three levels. Negotiator is the referrer role it always was.
   Director and Manager are BOTH management scope: same screens, same reach,
   same team, and the only difference is whether they are shown what the
   agency earns. So it is one bit on the user, not a third role, and every
   policy and position rule that already reasons about 'management' keeps
   working without being revisited.

   WHY DEFAULTING TRUE IS SAFE, which looks like a fail-open and is not. This
   flag decides what the client DRAWS. public.may_see_commission() decides what
   the database ANSWERS, and it is the boundary: for a Manager,
   application_commission_rates, my_partner_rates, commission_split_batch and
   commission_preview all return nothing. A client that wrongly believes it may
   show commission therefore renders a column of blanks and zeros, not somebody
   else's money. Defaulting the other way would blank the figures for every
   Director in mock and demo mode, where nothing hydrates, which is a visible
   fault to fix a risk that does not exist. */
let SEES_COMMISSION = true;

/** Set from the signed-in user's own row at hydrate. Mock mode never calls it
    and keeps the default, which is what the demo has always shown. */
export function hydrateCommissionVisibility(sees: boolean): void {
  SEES_COMMISSION = sees;
}

/** The three levels an agency person can hold, as the product names them.
    Opndoor's own roles are not agency levels and answer null. */
export type AgencyLevel = 'Director' | 'Manager' | 'Negotiator';

export function agencyLevelOf(role: Role, seesCommission: boolean): AgencyLevel | null {
  if (role === 'referrer') return 'Negotiator';
  if (role === 'management') return seesCommission ? 'Director' : 'Manager';
  return null;
}

/** The card copy, given verbatim by the client and kept in one place so the
    invite dialog, the admin people table and Team cannot describe the same
    level differently. */
export const AGENCY_LEVELS: { level: AgencyLevel; role: Role; seesCommission: boolean; desc: string }[] = [
  { level: 'Director', role: 'management', seesCommission: true,
    desc: 'Sees everything: every referral, every branch, the team, and what the agency earns.' },
  { level: 'Manager', role: 'management', seesCommission: false,
    desc: 'Sees every referral, every branch and the team. Commission figures are not shown.' },
  { level: 'Negotiator', role: 'referrer', seesCommission: false,
    desc: 'Sees their own referrals only.' },
];

/* =====================================================================
   THE LADDER, CLIENT SIDE.

   A LENS, NOT THE BOUNDARY. public.assert_may_act_on_user and the
   users_level_ladder_guard trigger are the rule; this decides which buttons are
   drawn. Both exist because a button that cannot work should not be offered, and
   because `role` here is mutable by the dev role switcher, so nothing computed
   from it can be trusted as authority.

   TWO RULES, AND THEY ARE NOT THE SAME COMPARISON:

     the PERSON you act on must be strictly BELOW you   mayActOn
     the LEVEL you hand out may be AT OR BELOW yours    levelsGrantableBy

   which is why a Director sees all three levels in the invite dialog and a
   Manager sees Manager and Negotiator, while neither may touch an equal. Keep the
   two functions separate for that reason: collapsing them into one comparison is
   how the invite dialog and the row actions would start disagreeing.
   ===================================================================== */

/** Where somebody sits: 0 opndoor staff, 1 Director, 2 Manager, 3 Negotiator or
    developer, null for a role with no place on the ladder. Lower is more
    authority. The twin of public.level_rank_of. */
export function levelRank(role: Role, seesCommission: boolean): number | null {
  if (role === 'superadmin' || role === 'opndoor_manager') return 0;
  if (role === 'management') return seesCommission ? 1 : 2;
  if (role === 'referrer' || role === 'developer') return 3;
  return null;
}

/**
 * Is this person Opndoor's own staff? The twin of public.is_opndoor_staff.
 *
 * WALK FIX 5. "Opndoor admins see everything by their role and must never be
 * given an office or position." Written as a named predicate rather than
 * `levelRank(...) === 0` at each site, because it is a different question
 * from "where do they sit on the ladder" and reads as one: rank 0 means
 * above all three agency levels, and this means not on the ladder at all.
 */
export function isOpndoorStaff(role: Role): boolean {
  return role === 'superadmin' || role === 'opndoor_manager';
}

/** The pair a level is resolved from, plus the id, because self is never actionable. */
export interface Actor { id?: string | null; role: Role; seesCommission: boolean }

/** Strictly below. Self is at your own level, so it is never actionable. */
export function mayActOn(actor: Actor, target: Actor): boolean {
  if (actor.id && target.id && actor.id === target.id) return false;
  const a = levelRank(actor.role, actor.seesCommission);
  if (a === 0) return true;                       // opndoor staff, above all three
  const t = levelRank(target.role, target.seesCommission);
  return a != null && t != null && a < t;
}

/**
 * May this actor set a per-person setting on this person: AT OR BELOW their
 * own level, in contrast to mayActOn, which is strictly below.
 *
 * The difference is not an oversight in either. mayActOn governs things done
 * TO somebody -- deactivate, reset their MFA, change their level -- and a peer
 * is not somebody you do those to. This governs a setting about who is copied
 * on referrals, where set_receives_notifications deliberately admits a peer
 * and the person themselves: a Manager may tick a fellow Manager, and anybody
 * may tick themselves.
 *
 * Gating the control on mayActOn instead hid it from every Manager on a team
 * of Managers, and from everybody looking at their own row, while SQL would
 * happily have accepted the change. A control narrower than its rule is a
 * feature somebody was told they had and cannot find.
 */
export function mayActOnOrEqual(actor: Actor, target: Actor): boolean {
  if (actor.id && target.id && actor.id === target.id) return true;
  const a = levelRank(actor.role, actor.seesCommission);
  if (a === 0) return true;                       // opndoor staff, above all three
  const t = levelRank(target.role, target.seesCommission);
  return a != null && t != null && a <= t;
}

/** The levels this actor may hand out: at or below their own. Drives the invite
    dialog and the Change level chooser. */
export function levelsGrantableBy(actor: Actor): typeof AGENCY_LEVELS {
  const a = levelRank(actor.role, actor.seesCommission);
  if (a === 0) return AGENCY_LEVELS;
  if (a == null) return [];
  return AGENCY_LEVELS.filter((l) => (levelRank(l.role, l.seesCommission) ?? 99) >= a);
}

/**
 * The role to assume when a stored or supplied role cannot be recognised.
 * Deliberately the LEAST privileged, never the most: an unparseable value must
 * not become an escalation. See SessionContext.initialRole.
 */
export const LEAST_PRIVILEGED_ROLE: Role = 'referrer';

/** A partner id, or the special "all partners combined" scope (opndoor admin only). */
export type PartnerScope = string;
export const ALL_PARTNERS = 'all';

/** Application lifecycle. 'referencing' is the direct rail's pre-approval state
    (submitted, awaiting the eligibility decision); the referral and inbound rails
    are created at 'sent' and never sit here. */
export type Status = 'draft' | 'referencing' | 'declined' | 'sent' | 'paid' | 'deed' | 'withdrawn' | 'expired';
export type WithdrawReason = 'another_guarantor' | 'tenancy_fell_through' | 'duplicate' | 'other';
/** Deed sub-state while Paid (DB-enforced set), or null before a deed exists. */
export type DeedState = 'awaiting_tenant' | 'executed' | 'declined' | 'voided' | 'error';
/** Guarantor-fee payment state (DB-enforced set). */
export type PaymentState = 'awaiting' | 'paid' | 'refunded';
export type PartnerStatus = 'active' | 'onboarding' | 'paused';
export type UserStatus = 'active' | 'pending' | 'deactivated';

/* ---------- Partner ---------- */
export interface Partner {
  /** The SLUG. Every screen, route and scope compares these. */
  id: string;
  /** The database uuid, present in Supabase mode only. Needed by any RPC that
   *  takes a partner; `id` is not that. */
  dbId?: string;
  name: string;
  status: PartnerStatus;
  /** Live-from month, e.g. "2024-09". */
  since: string;
  /** Demo analytics weight; a real back end would sum real records instead. */
  weight: number;
  primary?: boolean;
  /** An Opndoor house / plumbing partner (opndoor-direct, referencing-partner,
      opndoor-agents). Never offered as a selectable partner or named in a screen;
      its name is shown as its route label instead. */
  isHouse?: boolean;
  users: number;
  apps: number;
  /** Per-partner commission rates (fractions of one month's rent). Never hard-coded.

      ON A SUPPLIER THESE ARE ONE NUMBER AND A SLICE OF IT, not two that add
      up. Matt, 2026-09-30: "Supplier commission is one total rate ... and
      that total includes the agents' share. The agent's share is carved out
      of it". So `partnerRate` is the TOTAL Opndoor pays on a supplier
      referral, and `agentRate` is the part of it the agents get, which the
      volume tiers can override per referral.

      ON THE AGENCY RAIL THEY ARE UNCHANGED and still separate things:
      `partnerRate` on the house partner is Opndoor's own margin, which is
      owed to nobody and never appears on a statement, and `agentRate` is
      the agency's cut. The two rails read the same two columns differently,
      which is why `isHousePartner` guards every place they are spent. */
  partnerRate: number;
  agentRate: number;
  /** Opndoor pays this supplier's agents directly, instead of paying the
      whole total to the supplier for it to settle with its own. Off by
      default. NM-C 5. */
  opndoorPaysAgents?: boolean;
  /** #79 What a referrer sees on the League Referrers tab for this partner.
      full = peers ranked with fees + counts; rankings = counts only; private =
      own performance only. Commission is never shown to referrers. Default full. */
  referrerLeaderboard?: LeaderboardMode;
  /** What happens to an application after it arrives. Snapshotted onto each
      application at creation, so changing this never rewrites work in flight. */
  referencingMode?: ReferencingMode;
  /** Capabilities. Two flags rather than one partner "type": an agency is portal
      only, a CRM is API only, and some partners are both, so a type would need a
      value per combination. */
  portalReferralsEnabled?: boolean;
  apiAccessEnabled?: boolean;
}

export type ReferencingMode = 'pre_referenced_open' | 'pre_referenced_screened' | 'opndoor_referenced';

/** Labels for the three modes. The stored value is what goes in the audit trail. */
export const REFERENCING_MODES: { id: ReferencingMode; label: string; desc: string }[] = [
  { id: 'pre_referenced_screened', label: 'Pre-referenced, screened',
    desc: 'The partner references first and opndoor applies its own criteria. Applications are refused.' },
  { id: 'pre_referenced_open', label: 'Pre-referenced, open',
    desc: 'The partner references first and opndoor applies no criteria at all. A commercial position, granted deliberately.' },
  { id: 'opndoor_referenced', label: 'opndoor referenced',
    desc: 'opndoor completes the reference. Applications are refused.' },
];

export type LeaderboardMode = 'full' | 'rankings' | 'private';

export interface CommissionRates {
  partner: number;
  agent: number;
}

/* ---------- Organisation hierarchy ---------- */

/**
 * An agent contact on an agency or a branch. Exactly one is primary per owner.
 * A branch with no contacts inherits the parent agency's (see effectiveContacts).
 */
export interface AgentContact {
  /** DB row id (Supabase mode). Absent in mock/test mode. */
  id?: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  primary: boolean;
}

/** An agency group (a brand family under a partner) — the top commission tier and
    the target of a "whole group" position. */
/** One payee on an application's commission split, frozen at creation. */
/** Where a commission rate came from. Mirrors the SQL check constraint on
    application_commission_lines.source and commission_split's `source` column. */
export type CommissionSource = 'standard' | 'agreement' | 'rate';

export interface CommissionLine {
  level: 'group' | 'agency' | 'branch';
  /** DB id of the org paid. Null for a historic row reconstructed from the scalar. */
  orgId: string | null;
  orgName: string;
  /** Share of the guarantee fee, as a fraction. */
  rate: number;
  /** Which slot the rate came out of, frozen at creation alongside it. Null on a
      row created before this was recorded: unknown, and never guessed, because a
      guess stamped onto a settled statement is worse than an honest blank. */
  source?: CommissionSource | null;
  /** The amount the rate is a share of, frozen. On a joint tenancy this is the
      applicant's own share of the tenancy fee, not the whole fee. Null on
      historic rows, where the application's fee is the only basis there is. */
  basisAmount?: number | null;
  /** WHAT THIS PAYEE EARNS ON THIS APPLICATION, frozen at creation, in pounds.
      On a joint tenancy it is the TENANCY's commission apportioned across the
      tenants with the last line taking the rounding, which is not the same as
      this line's basis times its rate: rounding each line on its own let a
      tenancy's lines sum to a penny more than the tenancy's own commission.
      Null on rows frozen before the column existed; readers fall back to
      basis x rate, which is what those rows were always worth. */
  amount?: number | null;
}

export interface AgencyGroup {
  id: string;
  /** Owning partner id (slug in the client working copy). */
  partner: string;
  name: string;
  /** Group-tier commission override (fractions of one month's rent), or null to
      inherit the partner tier. */
  partnerRate?: number | null;
  agentRate?: number | null;
}

export interface Branch {
  /** This branch's OWN commission line, or null when it is not in the split. */
  agentRate?: number | null;
  /** DB row id (Supabase mode). Absent in mock/test mode. */
  id?: string;
  name: string;
  area: string;
  referrers?: number;
  referrals: number;
  guaranteed: string;
  fees?: number;
  contacts?: AgentContact[];
  /** Set when a referrer created this on the fly; surfaced in reconciliation. */
  unreviewed?: boolean;
  /** A house-partner placeholder ("Unattached") that only exists to satisfy the
      applications NOT NULL FKs for unmatched direct signups. Never a real agency;
      excluded from the Agencies list and its deed warning. */
  isPlaceholder?: boolean;
}

export interface Agency {
  /** This agency's own referencing route, or null/undefined to inherit its partner. */
  referencingMode?: string | null;

  /** DB row id (Supabase mode). Absent in mock/test mode. */
  id?: string;
  /** Owning partner id. The same name under two partners is two records. */
  partner: string;
  name: string;
  /** Legacy free-text group label (agencies.group_name). Superseded by groupId. */
  group?: string;
  /** The real agency_groups row this agency belongs to (its brand's group), or
      absent when ungrouped. */
  groupId?: string;
  /** This agency's own commission override (fractions of one month's rent), or
      null/absent to inherit the next tier up. resolve_rates: group -> agency -> partner. */
  partnerRate?: number | null;
  agentRate?: number | null;
  users?: number;
  referrals: number;
  guaranteed: string;
  fees?: number;
  contacts?: AgentContact[];
  /** UI expand state (seeded so the primary agency starts open). */
  open?: boolean;
  branches: Branch[];
  unreviewed?: boolean;
  /** A house-partner placeholder ("Unattached") — see Branch.isPlaceholder. Never a
      real agency; excluded from the Agencies list and its deed warning. */
  isPlaceholder?: boolean;
}

/* ---------- User ---------- */
export interface User {
  name: string;
  /** Work email (real in Supabase mode; derived in mock mode). */
  email: string;
  role: Role;
  lastActive: string;
  status: UserStatus;
  /** Partner id, or "opndoor" for opndoor admin staff (who belong to no partner). */
  partner: string;
  /** A negotiator's home branch id (referrer placed at a branch); null for managers,
      admins and legacy referrers. Lets the agency tree show negotiators on branches. */
  homeBranchId?: string | null;
}

/* ---------- Application (referral) ---------- */
export interface ApplicationSummary {
  ref: string;
  tenant: string;
  prop: string;
  branch: string;
  agency: string;
  /** Legacy beneficiary label retained for search only; the deed is in favour of the property. */
  ben: string;
  rent: number;
  status: Status;
  date: string; // ISO yyyy-mm-dd (the anchor event's day, for display)
  /**
   * Anchor event time in epoch ms (deed issued, else paid, else sent), for a
   * genuinely newest-first sort that is deterministic to the second. Omitted on
   * legacy mock rows; callers fall back to `date`.
   */
  eventTs?: number;
  /** 1 when the demo referrer (Priya Nair) owns this referral. */
  owner: number;
  partner: string;
  referrerRole?: Role | null; // #112 the referring user's role, so opndoor-admin actors read "opndoor"
  /** The commission half of the referrer's level: with referrerRole it names
      Director, Manager or Negotiator. Role alone cannot tell the first two apart. */
  referrerSeesCommission?: boolean | null;
  /** The referring user's display name, for the Applications referrer filter
      (management + opndoor admin). Null when unknown. */
  referrer?: string | null;
  /** Sent-date epoch ms, for the Applications period filter (which buckets on the
      sent date). Null on legacy/mock rows; callers fall back to `date`. */
  sentAtTs?: number | null;
  /** True when the guarantor fee was refunded (status stays Paid, by design). */
  refunded?: boolean;
  /** #2 True when the application was withdrawn at Sent (terminal, pre-payment). */
  withdrawn?: boolean;
  /** #13 True when auto-expired (unpaid 14 days after Sent); terminal, pre-payment. */
  expired?: boolean;
  /** True when the deed is out for signature (deed_state 'awaiting_tenant'); a
      sub-state of Paid, filterable from the list and the dashboard. */
  awaitingSignature?: boolean;
  /* DELIVERY, WHICH IS TWO QUESTIONS AND WAS ONE.
     'cannot_deliver' is nobody to send to on this rail's ladder: an ops queue,
     admin-facing, nothing the agency can act on. 'failed' is a send that was
     ATTEMPTED and errored: the agency sees it, because they are waiting for it
     and they can press Resend. See deliveryStateOf in deliveryState.ts. */
  awaitingStaffSend?: boolean;
  /** When the executed deed was sent. Without it deliveryStateOf() on a LIST row
      could never answer 'delivered' and fell through to 'not_attempted'. */
  deedSentAt?: Date | null;
  deliveryFailedAt?: Date | null;
  deliveryAttemptedTo?: string | null;
  deliverySource?: string | null;
  deliveryReason?: string | null;
  /** The rail this application runs on (snapshot). 'opndoor_referenced' is the
      agent rail with the nine-stage journey; the pre_referenced_* modes are the
      supplier rail with the three-stage view. */
  referencingMode?: ReferencingMode;
  /** Agent-rail pre-Sent progress signals (progress only, never content), for the
      list's early-stage filters. registered = the tenant has claimed the invite
      and made an account; feePaid = the application fee has been paid. */
  registered?: boolean;
  feePaid?: boolean;
  /* ---- THE JOINT TENANCY, when there is one ----------------------------
     Several applications share one tenancy: one property, one guarantee, one
     deed. Every sibling carries the WHOLE tenancy rent in `rent`, so a list
     that draws them as two rows draws one let twice. These are what let a
     screen say otherwise. All absent on a sole applicant, which is the common
     case by a distance. */
  tenancyId?: string | null;
  /** 1-based, the order the agent entered them. Position 1 leads the tenancy:
      it carries the one deed, its reminders and its expiry. */
  tenancyPosition?: number | null;
  sharePercent?: number | null;
  /** This applicant's slice of the rent, which is what they are referenced against. */
  shareAmount?: number | null;
  /** What this applicant is actually charged: their share of the tenancy fee. */
  fee?: number | null;
  paidAtTs?: number | null;
  /** This application's OWN deed sub-state. Every tenant of a joint tenancy has
      one, because every tenant signs their own deed; it was previously populated
      only on the lead, which is why the siblings read as having no deed. */
  deedState?: string | null;
}

/** Display-ready record for the detail view (see applicationsService.getApplicationDetail). */
export interface ApplicationDetail {
  ref: string;
  status: Status;
  statusLabel: string;
  /** The rail (snapshot): 'opndoor_referenced' drives the nine-stage journey
      timeline; the pre_referenced_* modes keep the three-stage view. */
  referencingMode?: ReferencingMode;
  /** How the application arrived (derived from partner slug + rail), for the route
      badge on the record. See channelOf; the UI label is ROUTE_LABEL[channel]. */
  channel?: Channel;
  /** #2 Withdrawal reason when status is 'withdrawn' (else null). */
  withdrawnReason: WithdrawReason | null;
  name: string;
  initials: string;
  title: string;
  role: string;
  fullName: string;
  dob: string;
  email: string;
  phone: string;
  addr1: string;
  addr2: string;
  city: string;
  county: string;
  postcode: string;
  agency: string;
  branch: string;
  /** Owning partner display name (shown to admin + management, #83). */
  partnerName: string;
  agentAddr: string;
  rent: string;
  rentNum: number;
  /** The guarantor fee as charged, which is one month's rent only at standard
      terms. An agency on a negotiated basis pays weeks of it, and one tenant of
      a joint tenancy pays a share. Absent on a record with no snapshotted fee,
      where the rent is still the honest answer. */
  feeGBP?: string;
  /** "one month's rent", "3 weeks of rent", or their share of it. */
  feeBasisLabel?: string;
  referrer: string;
  referrerRole?: Role | null; // #112 so opndoor-admin actors can be labelled "opndoor", not "Referrer"
  referrerSeesCommission?: boolean | null;
  tenancyStart: string;
  tenancyStartDate: Date;
  sentAt: Date;
  paidAt: Date | null;
  deedAt: Date | null;
  sentStr: string;
  paidStr: string | null;
  deedStr: string | null;
  issue: string | null;
  expiry: string | null;
  annual: string;
  paymentDate: Date | null;
  /** 1 when the signed-in demo referrer owns this referral (for amend scoping). */
  owner: number;
  /** Landlord the agent last sent the executed deed to, stored so a resend
      prefills without retyping. Agent rail only; absent until first sent. */
  landlordName?: string;
  landlordEmail?: string;
  /** True when the requested reference does not exist or is not accessible to
      the viewer (RLS returned nothing). The detail page renders an honest
      not-found state rather than substituting another record. */
  notFound?: boolean;
}

/* ---------- Help & resources ---------- */
export interface HelpResource {
  id: string;
  icon: string;
  type: string;
  title: string;
  desc: string;
  meta: string;
  href?: string;
  file?: { name: string; url: string; mime: string };
  /** #110 Minimum role that may see this resource. Undefined = everyone.
      'management' = management + opndoor admin; 'superadmin' = opndoor admin only. */
  minRole?: Role;
  /** WHICH RAIL THIS IS WRITTEN FOR. Undefined = both.

      'supplier' material talks about referring tenants on somebody else's stock,
      adding agencies, white-labelling and the sales conversation, none of which
      an agency on our own estate does. Shown to a Regent reader it describes a
      product they are not using. */
  rail?: 'supplier' | 'agency';
  /** This resource describes commission. Only a Director (and opndoor) may open
      it: minRole 'management' cannot express that, because a Director and a
      Manager are both 'management' and the whole point of the Manager level is
      that they are not shown what the agency earns. */
  needsCommission?: boolean;
}
export interface HelpFaq {
  id: string;
  q: string;
  a: string;
  /** Same two dimensions as HelpResource, for the same reasons: an answer can be
      supplier-rail material, and an answer can state the commission, which a
      Manager must not be shown however senior they are. */
  rail?: 'supplier' | 'agency';
  needsCommission?: boolean;
}
export interface HelpManager {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
}
export interface HelpContent {
  gettingStarted: HelpResource[];
  templates: HelpResource[];
  faqs: HelpFaq[];
  managers: HelpManager[];
}
export type HelpResourceSection = 'gettingStarted' | 'templates';

/* ---------- Analytics ---------- */
export interface Period {
  id: string;
  label: string;
  fSent: number;
  sp: number;
  pd: number;
}

/* ---------- Activity feed + upcoming expiries ---------- */
export type ActivityKind = 'sent' | 'paid' | 'deed' | 'withdrawn' | 'expired';
export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  ref: string;
  tenant: string;
  prop: string;
  branch: string;
  agency: string;
  partner: string;
  at: Date;
}

/** Urgency bands for an approaching expiry (mutually exclusive ranges). */
export type ExpiryBand = 'soon' | 'warn' | 'notice' | 'later';
export interface UpcomingExpiry {
  ref: string;
  tenant: string;
  prop: string;
  branch: string;
  agency: string;
  partner: string;
  expiry: Date;
  /** Whole days from today to the expiry date (>= 0 for upcoming). */
  daysUntil: number;
  band: ExpiryBand;
  /** Expiry reminders already sent for this guarantee (live mode; 0 in mock). */
  remindersSent: number;
}

/* ---------- League tables ---------- */
export type LeagueView = 'agency' | 'branch' | 'referrer';
export interface LeagueRow {
  name: string;
  sub: string;
  /** Owning partner display name, for the Partner column shown in All-partners scope. */
  partner?: string;
  refs: number;
  fees: number;
  paid: number;
  deed: number;
  /** Sent-to-Paid conversion (fraction). */
  sp: number;
  /** Sent-to-Deed conversion (fraction). */
  conv: number;
  /** Partner commission (per-partner rate applied to fees). */
  partnerComm: number;
  /** Agent commission (per-partner rate applied to fees). */
  agentComm: number;
  /** #107 Week-over-week rank movement vs the same table 7 days prior: positive =
      up N places, negative = down, 0 = held, null = new / not comparable. */
  movement?: number | null;
  /** Stable per-entity identity (partner-distinct), for matching a row to its prior
      standing. Not displayed. Live rows only; mock rows fall back to name|sub|partner. */
  key?: string;
}
