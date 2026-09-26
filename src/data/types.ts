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
  id: string;
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
  /** Per-partner commission rates (fractions of one month's rent). Never hard-coded. */
  partnerRate: number;
  agentRate: number;
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
}
export interface HelpFaq {
  id: string;
  q: string;
  a: string;
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
