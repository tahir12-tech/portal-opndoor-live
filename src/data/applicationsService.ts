/* =====================================================================
   Applications service.
   Enforces partner isolation and the referrer "own referrals only" rule,
   builds the display-ready detail record, and exposes the referral
   lifecycle actions.

   Live mode reads the RLS-scoped working copies hydrated from Supabase and
   filters/sorts client-side; the role + scope isolation shown here is ALSO
   enforced server-side by RLS. The lifecycle actions call Edge Functions:
   createReferral -> create-referral (Stripe Checkout + branded email),
   amendTenancyStartDb -> amend-tenancy-start (deed-state-aware reissue),
   sendDeedToAgent -> send_deed_to_agent RPC. Mock/test mode uses the seed.
   ===================================================================== */
import { gbpPence, formatDate, formatLongDate } from '@/lib/format';
import type { CommissionLine, ApplicationDetail, ApplicationSummary, DeedState, PartnerScope, Role, Status, WithdrawReason } from './types';
import { ALL_PARTNERS, isOpndoorStaff } from './types';
import { AGENT_ADDR, APPLICATION_RECORDS as RECORDS_SEED, APPLICATIONS_LIST as LIST_SEED, type AppRecord } from './mock/applications';
import { getPartner, partnerName } from './partnersService';
import { channelOf, type Channel } from './channel';
// One predicate for "is this row in the selected party", shared with the
// reporting rail. See `origin` on AppFilterOpts. origin.ts does not import
// this file, so there is no cycle.
import { originMatches, type OriginScope } from './origin';
import { reachableAgencyNames } from './orgService';
import { deliveryStateOf } from './deliveryState';
import { isPlaceholderOrg } from './agencyOffices';
import { viaSupplier } from './viaSupplier';

/** Who works the delivery QUEUE, as opposed to who is waiting for a deed.
    "Cannot deliver" means our own record of who can receive is incomplete, which
    is Opndoor's to fix and not a customer's. */
const ADMIN_ROLES: Role[] = ['superadmin', 'opndoor_manager'];
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';

// Working copies. Seeded from the mock; replaced from Supabase after login.
// Mock summaries carry no referrer name (only `owner`); derive it from the detail
// records by ref so the Applications referrer filter has data in mock/demo mode.
// Live mode replaces LIST wholesale, with referrer + sentAtTs set in hydrate.
const REFERRER_BY_REF = new Map(RECORDS_SEED.map((r) => [r.ref, r.referrer]));
let LIST: ApplicationSummary[] = LIST_SEED.map((s) => ({ ...s, referrer: s.referrer ?? REFERRER_BY_REF.get(s.ref) ?? null }));
let RECORDS: AppRecord[] = RECORDS_SEED;

/** Replace the applications working copies from the back end (Supabase mode). */
export function hydrateApplications(list: ApplicationSummary[], records: AppRecord[]): void {
  LIST = list;
  RECORDS = records;
}

/** The full scoped summary set (used by the activity feed). */
export function allSummaries(): ApplicationSummary[] {
  return LIST;
}

/** How many applications are awaiting the eligibility decision (status
    'referencing'), for the superadmin Awaiting-decision queue badge. Superadmin
    sees every partner, so this counts the whole set. */
export function awaitingDecisionCount(): number {
  return LIST.filter((r) => r.status === 'referencing').length;
}

/** Full per-application record (real mode) for analytics and exports. */
export interface FullApp {
  ref: string;
  partner: string;
  agency: string;
  branch: string;
  /** Branch id, for scoping the league to a viewer's position (the name is for
      display; the id is what app_scope_branches / a manager's scope match on). */
  branchId?: string;
  /** DB ids, so downstream joins address an org rather than a display name. */
  agencyId?: string;
  groupId?: string | null;
  referrer: string;
  /** WHETHER THERE IS A REFERRER AT ALL, which is a different question from
   *  what to call them. Walk fix 18: a direct signup has no referring person
   *  (`applications.referrer_id` is nullable) but dev stores the LABEL
   *  "Direct signup" in `referrer_name`, so every test of the display name
   *  said yes and the direct rail ranked as a referrer.
   *
   *  Not answerable from `referrerRole` either: that comes from the embedded
   *  users row, which RLS can withhold from a reader who can still see the
   *  application. Dev has 17 agency applications in exactly that state. The
   *  id is the only honest signal, so the id is carried. */
  referrerId?: string | null;
  /** The referring user's actual role (superadmin/management/referrer), so the
      league can label who generated the referral truthfully. */
  referrerRole?: Role | null;
  /** THE COMPANY THE REFERRER THEMSELVES WORKS FOR, by slug, or null.
   *
   *  Not `partner`, which is the rail the REFERRAL came in on. The two
   *  differ exactly where Matt found the bug: Kestrel's own director
   *  referred for Frost Partnership, a Kestrel agency, so the application's
   *  partner is Kestrel and its agency is Frost, and the referrer board
   *  labelled the person "Frost Partnership, Frost Mayfair".
   *
   *  Only a supplier's staff have one. Our own estate's people are placed by
   *  POSITION (public.user_scopes) and carry no partner at all, so a value
   *  here means "this person belongs to that supplier". Null where RLS
   *  withholds the users row, which reads as "not known to be a supplier's"
   *  and falls back to where they referred from. */
  referrerPartner?: string | null;
  /** The commission half of the referrer's level. With referrerRole it names
      Director, Manager or Negotiator; role alone cannot separate the first two. */
  referrerSeesCommission?: boolean | null;
  owner: number;
  status: Status;
  /** What this application was BEFORE it expired, or null. The only thing
      that tells an unfinished direct draft, closed after thirty days, from a
      real referral that expired unpaid: `sentAt` cannot, because every direct
      draft carries it from creation. Read through `reachedPayment`. */
  expiredFrom?: Status | null;
  rent: number;
  /** Commission rates SNAPSHOTTED at creation (fractions of one month's rent).
      Every commission/settlement/league/export figure reads these, never the
      partner's live rate, so editing a partner's rate never moves history. */
  partnerRate: number;
  agentRate: number;
  /** The guarantee fee charged, snapshotted. Equal to rent until deal-shape pricing. */
  fee: number;
  /** How many weeks of rent the fee is, snapshotted. One month is 52/12 weeks; a
      negotiated basis is 3 or 5. Selected by hydrate and previously dropped
      here, which left every export unable to say WHY a fee was what it was. */
  feeBasisWeeks?: number | null;
  /** The joint tenancy this applicant belongs to, or undefined for a tenancy of one. */
  tenancyId?: string | null;
  /** 1-based entry order. Position 1 leads: it carries the one deed. */
  tenancyPosition?: number | null;
  sharePercent?: number | null;
  /** This applicant's share of the tenancy RENT, in pounds. Distinct from `fee`,
      which is their share of the tenancy FEE. Also selected and dropped before. */
  shareAmount?: number | null;
  /** The frozen split, one entry per payee. Absent on historic rows. */
  commissionLines?: CommissionLine[];
  /** Whether Opndoor paid the agencies directly, as at the moment this
      referral was created and its commission frozen. true: the supplier
      line and the agency lines are SEPARATE payees and Opndoor owes their
      sum. false: the agency share comes out of the supplier total and
      Opndoor owes the supplier only. Null off a supplier estate, and for
      any row with no snapshot, where the live flag is the fallback.
      Mirrors applications.opndoor_pays_agents_at_freeze. */
  opndoorPaysAgentsAtFreeze?: boolean | null;
  sentAt: Date | null;
  paidAt: Date | null;
  deedAt: Date | null;
  tenancyStart: Date | null;
  expiry: Date | null;
  /** Fully refunded: the guarantee is CANCELLED. Every "is this still in
   *  force" reader tests this one, so a partial refund must never set it. */
  refunded: boolean;
  /** R2. Some money went back and the guarantee still stands: the deed is
   *  live, the underwriter is on risk, the agency keeps its commission. Only
   *  `refundedAmount` moved. Separate from `refunded` because the two answer
   *  different questions and one boolean answering both is how a GBP 10
   *  refund came to wipe a GBP 311.54 commission line. */
  partiallyRefunded: boolean;
  refundedAt: Date | null;
  refundedAmount: number | null;
  refundAfterStart: boolean;
  /** Deed sub-state while Paid, or null before a deed exists. */
  deedState: DeedState | null;
  deedSentAt: Date | null;
  /** When the tenant first opened the deed to sign (null = not yet viewed). */
  deedViewedAt: Date | null;
  /** #2 True when withdrawn at Sent (terminal, pre-payment). */
  withdrawn: boolean;
  withdrawnReason: WithdrawReason | null;
  withdrawnNote: string | null;
  /** #13 True when auto-expired (unpaid 14 days after Sent); terminal, pre-payment. */
  expired: boolean;
}

let FULL: FullApp[] = [];
let HYDRATED = true;

/** Replace the full application set from the back end (Supabase mode). */
export function hydrateFull(rows: FullApp[]): void {
  FULL = rows.slice();
  HYDRATED = true;
}

/** The full application set (empty in mock mode). */
export function allFull(): FullApp[] {
  return FULL;
}

/**
 * True once the live application set has been hydrated from Supabase — even if
 * the viewer's scope is genuinely empty. Live analytics keys on this (not on
 * "any rows present") so a real but empty scope shows honest zeros rather than
 * silently falling back to the synthetic mock model.
 */
export function isHydrated(): boolean {
  return HYDRATED;
}

const STATUS_LABEL: Record<Status, string> = { draft: 'In progress', referencing: 'Awaiting decision', declined: 'Declined', sent: 'Sent', paid: 'Paid', deed: 'Deed Issued', withdrawn: 'Withdrawn', expired: 'Expired' };

export interface AppScopeOpts {
  role: Role;
  scope: PartnerScope;
  /** opndoor admin's optional in-page partner sub-filter. */
  partner?: string;
  /** #owner Period range [start, end]; when set, status counts recount to apps
      whose SENT date falls in it (matching the dashboard period options). */
  periodRange?: [Date, Date];
}

export interface AppFilterOpts extends AppScopeOpts {
  /** 'refunded' and 'awaiting' (deed out for signature) are cross-cuts of Paid;
      'delivery-failed' is a cross-cut of Deed (issued but not delivered to an
      agent contact, #84). */
  status?: Status | 'all' | 'refunded' | 'awaiting' | 'delivery-failed' | 'cannot-deliver' | 'withdrawn' | 'expired' | 'invited' | 'fee-unpaid';
  agency?: string;
  /** Several agencies at once, by name. The origin selector's only selection
      with no single-value equivalent is a GROUP, which is its agencies; every
      other selection reaches the filters that already existed. Empty means no
      agency matches, not every agency (see originToFilter). */
  agencies?: string[];
  branch?: string;
  /** #owner Referrer display-name filter (management + opndoor admin only). */
  referrer?: string;
  /** Route filter: one of the four channels (Direct / Agent / Partner / Provider),
      derived per row from partner slug + rail. Visible to every role. */
  channel?: Channel;
  /** THE ORIGIN SELECTION, ASKED AS ITSELF. Walk fix 7.
   *
   *  The list used to narrow by translating a selection into the three
   *  options above (`partner`, `agencies`, `channel`) through
   *  `originToFilter`. That translation has no arm for the two RAILS --
   *  `rail:supplier` and `rail:agency`, which are the second and third
   *  choices in the picker -- and its fallthrough is "no filter", so
   *  choosing either left the whole book on screen.
   *
   *  `originMatches` already had both arms and is what Reporting narrows by,
   *  so this asks it rather than adding a third expression of one rule. That
   *  is what the header of origin.ts is about.
   *
   *  NARROWS, NEVER WIDENS. It runs after scopedSet, so it can only ever
   *  reduce what the reader was already allowed. Never a scope test. */
  origin?: OriginScope;
  q?: string;
  sort?: string;
}

/** How an application arrived, from its summary row (partner slug + rail). */
function channelOfRow(r: ApplicationSummary): Channel {
  return channelOf({ partnerSlug: r.partner, partnerMode: getPartner(r.partner)?.referencingMode });
}

/** Role + partner + AGENCY isolation (drives counts and the "total" figure). */
/* =====================================================================
   DOES THIS ROW SIT AT THE OFFICE THE FILTER NAMES?

   Matt, 2026-10-04: "filter by the office's id, not its name."

   TWO KINDS OF VALUE REACH THIS, which is why it is a function and not a
   comparison:

     an ID    from the Branch dropdown, whose options are keyed on the id
              since the two Frost Mayfairs were found merged into one, and
              from every `?branchId=` link in the product.
     a NAME   from a `?branch=` link, which the three surfaces that build one
              still emit as a fallback where a branch has no id, and from a
              bookmark somebody saved before 2026-10-02 when all of them did.

   THE MODE IS DECIDED ONCE, OVER THE WHOLE SET, and that is the care in it.
   Deciding per row -- "this row has an id, so refuse a name" -- looks right
   and quietly breaks an old bookmark: every row would refuse the name and the
   list would come back empty with no explanation. Deciding once asks the only
   question that matters: IS this value one of the ids in the book? If it is,
   it is an id and only ids match it, so the two Frost Mayfairs stay apart. If
   it is not, it is a name, and matching on the name is what that bookmark has
   always done and the best available reading of it.

   AN AMBIGUOUS NAME IS STILL AMBIGUOUS in that second case, and deliberately:
   a bookmark that says "Frost Mayfair" and nothing else cannot be resolved to
   one of two, and showing both is better than showing neither.
   ===================================================================== */
function branchFilter(set: ApplicationSummary[], value: string): (r: ApplicationSummary) => boolean {
  const isId = set.some((r) => r.branchId && r.branchId === value);
  if (isId) return (r) => r.branchId === value;
  return (r) => r.branch === value;
}

function scopedSet(opts: AppScopeOpts): ApplicationSummary[] {
  let set = LIST.slice();
  if (opts.scope !== ALL_PARTNERS) set = set.filter((r) => r.partner === opts.scope);
  /* THE PARTNER IS A ROUTE, NOT A COMPANY, on the agency rail: every agency
     shares the house partner, so the line above narrows a Regent user to every
     agency Opndoor carries. The server narrows further and this agrees with
     it. Null in mock mode means "do not narrow" (reachableAgencyNames). */
  if (opts.scope !== ALL_PARTNERS) {
    const mine = reachableAgencyNames();
    if (mine) set = set.filter((r) => !r.agency || mine.has(r.agency));
  }
  if (opts.role === 'referrer') set = set.filter((r) => r.owner);
  return set;
}

/** #owner Sent-date epoch ms for period filtering: the true sent time when
    hydrated, else the summary's anchor-event day (mock rows have no separate
    sent date, and are dated close to their sent date). */
function sentTsOf(r: ApplicationSummary): number {
  return r.sentAtTs != null ? r.sentAtTs : new Date(r.date).getTime();
}
function inPeriod(r: ApplicationSummary, range?: [Date, Date]): boolean {
  if (!range) return true;
  const ts = sentTsOf(r);
  return ts >= range[0].getTime() && ts <= range[1].getTime();
}

/* THE SEARCH, AS A PREDICATE RATHER THAN A LINE INSIDE ONE READER.

   Matt, 2026-10-01: "every status tab count follows the current filters
   (origin, period, branch, referrer, search)".

   Four of those five were already shared between the rows and the counts.
   Search was not: it lived as four lines inside `getApplications` and
   `countByStatus` had never heard of it, so typing a reference narrowed the
   list to one row while every tab above it went on counting the whole book
   and "Showing 1 of 4" kept a denominator the filter had already excluded.

   A count that is computed over a different set from the list beneath it is
   the worst kind of wrong number: it is not off by a bit, it is the answer
   to a question nobody asked. Making it a named predicate is what stops the
   next filter being added to one reader and not the other. */
function matchesQuery(r: ApplicationSummary, q?: string): boolean {
  const needle = (q ?? '').trim().toLowerCase();
  if (!needle) return true;
  return `${r.tenant} ${r.prop} ${r.ref} ${r.ben} ${r.branch}`.toLowerCase().includes(needle);
}

export function countByStatus(opts: AppFilterOpts): { all: number; draft: number; invited: number; feeUnpaid: number; referencing: number; declined: number; sent: number; paid: number; deed: number; refunded: number; awaiting: number; deliveryFailed: number; cannotDeliver: number; withdrawn: number; expired: number } {
  // #owner Chips recount within the selected period (sent-date bucketed), and
  // must follow the same partner/agency/branch/referrer filters as the rows.
  let set = scopedSet(opts);
  if (opts.partner) set = set.filter((r) => r.partner === opts.partner);
  /* BY ID, NOT BY NAME. Matt, 2026-10-04. Resolved once over the set rather
     than per row: see branchFilter for why that distinction is the whole of
     it. Built from the PARTNER-NARROWED set, which is the same rows the
     predicate below runs on. */
  const matchesBranch = branchFilter(set, opts.branch ?? '');
  set = set.filter((r) => {
    if (opts.branch && !matchesBranch(r)) return false;
    if (opts.agency && r.agency !== opts.agency) return false;
    if (opts.agencies && !opts.agencies.includes(r.agency)) return false;
    if (opts.referrer && r.referrer !== opts.referrer) return false;
    if (opts.channel && channelOfRow(r) !== opts.channel) return false;
    // Walk fix 7. AFTER the scope filters, never instead of them.
    if (opts.origin && !originMatches(r, opts.origin)) return false;
    // THE FIFTH FILTER, which this reader did not have. See matchesQuery.
    if (!matchesQuery(r, opts.q)) return false;
    return inPeriod(r, opts.periodRange);
  });
  /* 'refunded' and 'awaiting' overlap 'paid' (both keep status Paid by
     design), so they are counted in addition to paid, not instead of it.
     'deliveryFailed' is a cross-cut of Deed (issued but no reachable
     agent contact).

     ALL IS EVERY ROW, since 2026-10-02. Matt: "'All' equals the sum of
     the other tabs. 'Showing X of Y' counts the same set." It used to be
     sent + paid + deed, with draft, awaiting decision, declined,
     withdrawn and expired each `return`ing before it was reached -- so
     the tab called All was the funnel, and said so nowhere.

     THE SUM HOLDS OVER THE EXCLUSIVE TABS: draft + referencing +
     declined + sent + paid + deed + withdrawn + expired. Invited is
     inside draft, feeUnpaid is inside SENT (it was inside draft until
     2026-10-03), refunded and awaiting are inside paid,
     and the two delivery counts are inside deed; adding those in as
     well would double-count rows the reader can see are one row. Matt's
     own example names Fee unpaid, which is one of the subsets, so the
     sentence means "All holds everything" rather than "add the chips
     up". */
  const counts = { all: 0, draft: 0, invited: 0, feeUnpaid: 0, referencing: 0, declined: 0, sent: 0, paid: 0, deed: 0, refunded: 0, awaiting: 0, deliveryFailed: 0, cannotDeliver: 0, withdrawn: 0, expired: 0 };
  set.forEach((r) => {
    counts.all++;
    if (r.status === 'withdrawn') { counts.withdrawn++; return; }
    if (r.status === 'expired') { counts.expired++; return; }
    // Awaiting decision is pre-approval: its own count and tab, and now
    // part of All like everything else.
    if (r.status === 'referencing') { counts.referencing++; return; }
    if (r.status === 'declined') { counts.declined++; return; }
    // Agent-rail draft: its own tab, plus Invited. Fee unpaid is NOT one of
    // its sub-states any more: see below.
    if (r.status === 'draft') { counts.draft++; if (!r.registered) counts.invited++; return; }
    counts[r.status]++;
    /* FEE UNPAID IS A SUBSET OF SENT, NOT OF DRAFT, since 2026-10-03. Matt:
       it "should list every application where the tenant has been asked for
       the guarantee fee and hasn't paid (today the 3 Sent referrals ...), not
       unfinished direct applications that haven't reached payment ... Its
       count must match."

       IT COUNTED DRAFTS, and so did the list, so the two agreed about the
       wrong thing -- which is why no test caught it until the list was fixed
       and they came apart. Both now read `sent`, and the comment above about
       which counts are subsets of which is corrected with them: feeUnpaid
       sits inside `sent`, so the exclusive-tab sum is unaffected. */
    if (r.status === 'sent') counts.feeUnpaid++;
    if (r.refunded) counts.refunded++;
    if (r.awaitingSignature) counts.awaiting++;
    /* #93 said delivery failure was an ops surface and hid it from referrers.
       That was right about the state it could actually detect, which was
       "nobody to send to" — an ops queue. A send that ERRORED is different: the
       person waiting for the deed should know, and send_deed_to_agent already
       lets the owning referrer resend. So the two states are counted
       separately, and only the ops one is restricted. The counts must match the
       list gates above or a tab shows rows against a zero. */
    const dstate = deliveryStateOf(r);
    if (dstate === 'failed') counts.deliveryFailed++;
    if (dstate === 'cannot_deliver' && ADMIN_ROLES.includes(opts.role)) counts.cannotDeliver++;
  });
  return counts;
}

/**
 * Every row in this viewer's scope, BEFORE the page's own filters.
 *
 * Tenancy grouping has to be computed from this rather than from the filtered
 * rows: filter to "Paid" and the lead (which is in 'deed') disappears, and a
 * group derived from what is left promotes the wrong applicant to lead, retitles
 * the others, and reports the tenancy's status from a sibling.
 */
export function scopedSummaries(opts: AppScopeOpts): ApplicationSummary[] {
  return scopedSet(opts);
}

/**
 * The other applicants on this application's tenancy, this viewer's scope only.
 *
 * Derived from the summary rows rather than fetched: the tenancy shape is
 * already on every row, and going through scopedSet means a referrer sees the
 * siblings they own and nothing else — exactly the isolation the list applies.
 * Returns an empty array for a sole applicant, and for a joint applicant whose
 * siblings this viewer cannot reach: in both cases there is nothing to show.
 */
export function tenancySiblings(ref: string, opts: AppScopeOpts): ApplicationSummary[] {
  const set = scopedSet(opts);
  const me = set.find((r) => r.ref === ref);
  if (!me?.tenancyId) return [];
  return set
    .filter((r) => r.tenancyId === me.tenancyId)
    .sort((a, b) => (a.tenancyPosition ?? 0) - (b.tenancyPosition ?? 0) || a.ref.localeCompare(b.ref));
}

/** The visible rows for the given filters (scoped + status/agency/branch/search/sort). */
/* =====================================================================
   WAS THE TENANT EVER ASKED TO PAY?

   Matt, 2026-10-03, on Reporting: "A referral counts as sent once it was
   sent to the tenant, whatever happened after. Unfinished direct
   applications that never reached the tenant being asked to pay are the
   only ones left out." And on the Applications list: "'Fee unpaid' ...
   should list every application where the tenant has been asked for the
   guarantee fee and hasn't paid ... not unfinished direct applications
   that haven't reached payment."

   ONE QUESTION, ASKED BY TWO SCREENS, so it is one function.

   AND `sentAt` IS NOT THE ANSWER, which is the trap. Every direct draft
   carries `sent_at` from the moment it is created -- that is what
   `expired_from` was added for in 20261007530000, when the thirty-day
   close matched nothing because it was looking at `sent_at`. GR-20626 on
   dev is `status = 'draft'` with `sent_at` set and no rent given.

   SO IT IS THE STATUS, AND WHAT THE STATUS USED TO BE. A draft was never
   asked. A draft that was closed after thirty days is `expired` with
   `expired_from = 'draft'`, and was never asked either. Dev holds seven
   of those and eight genuine referrals that expired unpaid, and nothing
   but this column tells them apart.
   ===================================================================== */
export function reachedPayment(r: { status: Status; expiredFrom?: Status | null }): boolean {
  if (r.status === 'draft') return false;
  if (r.expiredFrom === 'draft') return false;
  return true;
}

export function getApplications(opts: AppFilterOpts): ApplicationSummary[] {
  let rows = scopedSet(opts);
  if (opts.partner) rows = rows.filter((r) => r.partner === opts.partner);
  /* THE SAME PREDICATE countByStatus BUILDS, over the same rows, so the chips
     and the list cannot disagree about which office they are showing. */
  const matchesBranch = branchFilter(rows, opts.branch ?? '');
  rows = rows.filter((r) => {
    /* "ALL" MEANS ALL, since 2026-10-02. Matt: "the 'All' tab counts and
       shows every application in the current filters, including In
       progress, Fee unpaid and Expired, so 'All' equals the sum of the
       other tabs."

       WHAT IT WAS. Pre-Sent (draft, awaiting decision, declined) and
       terminal (withdrawn, expired) were out of the default view and
       each appeared only under its own chip, so All was the operational
       funnel: sent + paid + deed. That read as a contradiction the
       moment a filter made the funnel small -- "All 1" above "In
       progress 8" -- because two numbers on one row cannot both be a
       total.

       WHAT STAYS. The block still runs for every OTHER tab, so choosing
       Paid does not sweep in drafts, and Invited keeps its own arm.
       Only 'all' and the no-status case are let through.

       AND FEE UNPAID IS NO LONGER ONE OF THEM, 2026-10-03. It had an arm
       here because it used to mean "a draft that has not paid"; it now
       means "asked and has not paid", which is `status = 'sent'` and
       therefore never reaches this block at all -- the block only runs
       for draft and the terminal states. Its arm was removed rather than
       left, because a clause that can never be true reads as a rule. */
    const everything = !opts.status || opts.status === 'all';
    if (!everything
        && (r.status === 'draft' || r.status === 'referencing' || r.status === 'declined'
            || r.status === 'withdrawn' || r.status === 'expired')) {
      const shown = opts.status === r.status
        || (opts.status === 'invited' && r.status === 'draft' && !r.registered);
      if (!shown) return false;
    }
    if (opts.status === 'refunded') { if (!r.refunded) return false; }
    else if (opts.status === 'awaiting') { if (!r.awaitingSignature) return false; }
    // TWO FILTERS, TWO STATES. 'delivery-failed' is a send that errored and is
    // the agency's business; 'cannot-deliver' is nobody to send to and is ops.
    // Both read the columns the delivery path writes, never the agent_contacts
    // tree, which is the supplier rail's ladder and answers wrongly for ours.
    else if (opts.status === 'delivery-failed') { if (deliveryStateOf(r) !== 'failed') return false; }
    else if (opts.status === 'cannot-deliver') { if (!ADMIN_ROLES.includes(opts.role) || deliveryStateOf(r) !== 'cannot_deliver') return false; }
    else if (opts.status === 'invited') { if (r.status !== 'draft') return false; }
    /* FEE UNPAID IS "ASKED AND HAS NOT PAID". Matt, 2026-10-03: it "should
       list every application where the tenant has been asked for the
       guarantee fee and hasn't paid (today the 3 Sent referrals ...), not
       unfinished direct applications that haven't reached payment".

       IT WAS THE EXACT OPPOSITE: `r.status === 'draft' && !r.feePaid`, so
       the tab listed the one application nobody had asked for anything and
       none of the three that were waiting on a payment. It shared a branch
       with `invited`, which IS about drafts, and the shared branch is how
       the two came to mean the same thing.

       `sent` AND NOT "EVER UNPAID". Dev also holds eight referrals that
       expired without paying; they are not waiting on a tenant, they are
       finished. Matt's own list is the three. */
    else if (opts.status === 'fee-unpaid') { if (r.status !== 'sent') return false; }
    else if (opts.status && opts.status !== 'all' && r.status !== opts.status) return false;
    /* BY ID WHERE THE FILTER GIVES ONE. Matt, 2026-10-04: "filter by the
       office's id, not its name." See branchFilter. */
    if (opts.branch && !matchesBranch(r)) return false;
    if (opts.agency && r.agency !== opts.agency) return false;
    if (opts.agencies && !opts.agencies.includes(r.agency)) return false;
    // #owner Referrer filter (management + opndoor admin) and period (sent-date).
    if (opts.referrer && r.referrer !== opts.referrer) return false;
    if (opts.channel && channelOfRow(r) !== opts.channel) return false;
    // Walk fix 7. AFTER the scope filters, never instead of them.
    if (opts.origin && !originMatches(r, opts.origin)) return false;
    if (!inPeriod(r, opts.periodRange)) return false;
    if (!matchesQuery(r, opts.q)) return false;
    return true;
  });
  const sort = opts.sort || 'Newest first';
  // Sort by the anchor event time (deed/paid/sent) to the second when available,
  // falling back to the day string; ties break by reference so the order is
  // stable and deterministic (never dependent on fetch order).
  const when = (r: ApplicationSummary): number => (r.eventTs != null ? r.eventTs : new Date(r.date).getTime());
  rows = rows.slice().sort((a, b) => {
    if (sort === 'Rent: high to low') return b.rent - a.rent || a.ref.localeCompare(b.ref);
    const diff = when(a) - when(b);
    const chrono = sort === 'Oldest first' ? diff : -diff;
    return chrono || a.ref.localeCompare(b.ref);
  });
  return rows;
}

export interface DuplicateMatch { ref: string; statusLabel: string; }

/** #5 An ACTIVE (non-terminal) application matching the tenant email + property
    postcode, for the soft duplicate warning on New Application. Scope-isolated, so
    a referrer is only warned about their own referrals. Returns null (no false
    warnings) in mock mode, where seed records carry no tenant email. */
export function findActiveReferralByTenantProperty(opts: AppScopeOpts, email: string, postcode: string): DuplicateMatch | null {
  const em = email.trim().toLowerCase();
  const pc = postcode.replace(/\s+/g, '').toLowerCase();
  if (!em || !pc) return null;
  for (const s of scopedSet(opts)) {
    if (s.refunded) continue; // refunded is a terminal cross-cut
    if (s.status === 'withdrawn' || s.status === 'expired') continue; // #2/#13 terminal: not an active duplicate
    const rec = RECORDS.find((r) => r.ref === s.ref);
    const rEm = (rec?.email ?? '').trim().toLowerCase();
    const rPc = (rec?.postcode ?? '').replace(/\s+/g, '').toLowerCase();
    if (rEm && rEm === em && rPc === pc) return { ref: s.ref, statusLabel: STATUS_LABEL[s.status] };
  }
  return null;
}

/** Distinct agency names within a scope (for the applications filter dropdown). */
export function agencyNamesForScope(opts: AppScopeOpts): string[] {
  const rows = scopedSet(opts).filter((r) => (opts.partner ? r.partner === opts.partner : true));
  const names: string[] = [];
  rows.forEach((r) => {
    // A PLACEHOLDER IS NOT A CHOICE. See branchNamesForScope below.
    if (!names.includes(r.agency) && !isPlaceholderOrg(r.agency)) names.push(r.agency);
  });
  return names.sort();
}

/** #owner Distinct referrer names within a scope (for the applications referrer
    filter). Management + opndoor admin surface it; referrers see only their own. */
export function referrerNamesForScope(opts: AppScopeOpts): string[] {
  const rows = scopedSet(opts).filter((r) => (opts.partner ? r.partner === opts.partner : true));
  const names: string[] = [];
  rows.forEach((r) => {
    const n = r.referrer;
    if (n && !names.includes(n)) names.push(n);
  });
  return names.sort();
}

/** Distinct branch names within a scope, optionally limited to one agency. */
/* =====================================================================
   ONE ENTRY PER OFFICE, NOT PER OFFICE NAME.

   Matt, 2026-10-04: "offices with the same name in different estates are
   merged into one entry (two 'Frost Mayfair' offices show as one). List each
   office separately and label supplier-estate ones, e.g. 'Frost Mayfair (via
   Kestrel Lettings)', and filter by the office's id, not its name."

   THE MERGE WAS THE SMALLER HALF. This deduped on `names.includes(r.branch)`,
   so the dropdown showed one "Frost Mayfair" -- and because the VALUE was the
   name, choosing it narrowed to both of them. An admin looking at Kestrel's
   office was shown our own Frost's referrals in the same list. Dev holds
   exactly that pair, in two estates, each with one office of that name.

   DEDUPED ON THE ID WHERE THERE IS ONE, on the name where there is not. A
   mock row and an older fixture have no ids, and keying only on the id would
   collapse every one of them into a single blank-keyed entry. The name is the
   fallback, which is what the whole function used to be.

   THE LABEL IS `viaSupplier`, which already exists for this and is already
   used in the exports and on the league rows: it adds "(via Kestrel
   Lettings)" only where both estates are in view AND the office is a
   supplier's, so a supplier reading their own book sees their office named
   plainly. That is why the scope is passed rather than assumed.

   SORTED BY THE LABEL, so the two Frosts sit next to each other and the
   difference between them is the thing the reader is looking at.
   ===================================================================== */
export interface OrgFilterOption {
  /** What the filter narrows on: the id where we have one, else the name. */
  value: string;
  /** What the reader sees, including "(via …)" where it is needed. */
  label: string;
}

export function branchOptionsForScope(opts: AppScopeOpts, agency?: string): OrgFilterOption[] {
  const rows = scopedSet(opts)
    .filter((r) => (opts.partner ? r.partner === opts.partner : true))
    .filter((r) => !agency || r.agency === agency);
  const seen = new Set<string>();
  const out: OrgFilterOption[] = [];
  rows.forEach((r) => {
    /* NOT THE PLACEHOLDER. Matt, 2026-10-01: the house rail's "Unattached"
       is dropped "everywhere that label appears", and a filter chip is one
       of the places it appeared -- the Branch dropdown offered it as though
       it were an office somebody could narrow to. Filtering TO it would
       have worked, which is worse than it not being there: it is a real
       value on the rows, so the list would have narrowed to every direct
       signup under a heading naming an office that does not exist. */
    if (isPlaceholderOrg(r.branch)) return;
    const value = r.branchId || r.branch;
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push({ value, label: viaSupplier(opts.scope, r.branch, r.partner) });
  });
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** The names alone, for the callers that still want them (a heading, a chip). */
export function branchNamesForScope(opts: AppScopeOpts, agency?: string): string[] {
  const rows = scopedSet(opts)
    .filter((r) => (opts.partner ? r.partner === opts.partner : true))
    .filter((r) => !agency || r.agency === agency);
  const names: string[] = [];
  rows.forEach((r) => {
    if (!names.includes(r.branch) && !isPlaceholderOrg(r.branch)) names.push(r.branch);
  });
  return names.sort();
}

/** Find the parent agency of a branch (used when arriving filtered by ?branch=). */
export function agencyOfBranch(branch: string): string | '' {
  const rec = LIST.find((r) => r.branch === branch);
  return rec ? rec.agency : '';
}

/* ---------- Detail builder (deterministic, ported from portal-apps.js) ---------- */
const DAY = 86400000;

function parseISO(s: string): Date {
  const p = s.split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}
// One format, shared. See lib/format: the leading zero goes with it, so
// "9 Sep 2026" rather than "09 Sep 2026" wherever a date is shown.
const fmtShort = formatDate;
const fmtLong = formatLongDate;
function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY);
}
/** Local-time HH:MM, matching the timeline's dd Mon yyyy · HH:MM format. */
function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
/** Whole years from dob to the reference day (birthday-aware). */
function ageOn(dob: Date, today: Date): number {
  let a = today.getFullYear() - dob.getFullYear();
  if (today.getMonth() < dob.getMonth() || (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate())) a -= 1;
  return a;
}

/**
 * The single source of truth for the guarantee expiry date: the tenancy start
 * date plus 12 months, minus one day. It is always computed from the tenancy
 * start date, never from the deed issued or paid date.
 * Example: tenancy start 15/06/2026 gives expiry 14/06/2027.
 * Every screen and export that shows an expiry routes through this function.
 */
export function guaranteeExpiry(tenancyStart: Date): Date {
  // Using a day component of (date - 1) rolls calendar boundaries correctly
  // and avoids millisecond/DST drift.
  return new Date(tenancyStart.getFullYear() + 1, tenancyStart.getMonth(), tenancyStart.getDate() - 1);
}

function deaccent(s: string): string {
  // Strip combining diacritical marks (U+0300–U+036F) after NFD decomposition.
  return s.normalize ? s.normalize('NFD').replace(/[̀-ͯ]/g, '') : s;
}
function initials(n: string): string {
  return n.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

export function findRecord(ref: string | null): AppRecord | null {
  return RECORDS.find((r) => r.ref === ref) ?? null;
}

/** A safe, blank detail flagged not-found, so the detail page can render an
    honest "not accessible" state without ever substituting another record. */
function notFoundDetail(ref: string): ApplicationDetail {
  const now = new Date();
  return {
    ref, status: 'sent', statusLabel: '', withdrawnReason: null, name: '', initials: '', title: '', role: '', fullName: '',
    dob: '', email: '', phone: '', addr1: '', addr2: '', city: '', county: '', postcode: '',
    agency: '', branch: '', partner: '', partnerName: '', agentAddr: '', rent: '', rentNum: 0, referrer: '', referrerRole: null,
    tenancyStart: '', tenancyStartDate: now, sentAt: now, paidAt: null, deedAt: null,
    sentStr: '', paidStr: null, deedStr: null, issue: null, expiry: null, annual: '',
    paymentDate: null, owner: 0, notFound: true,
  };
}

/**
 * The fee as charged, and what it is a basis of.
 *
 * Kept next to the rent rather than derived from it, because they are the same
 * number only at standard terms: three weeks of rent is 0.69 of a month, and a
 * tenant of a joint tenancy pays a share of even that. A screen that prints the
 * rent under the words "guarantor fee" is stating a price nobody will be charged.
 */
/* =====================================================================
   WHAT A DEED GUARANTEES, ANNUALISED.

   Twelve months of the rent THIS DEED covers, which on a joint tenancy is this
   tenant's share and not the tenancy's whole rent.

   Every surface that stated or summed this used `rent * 12`, and rent is the whole
   tenancy's. So a two-tenant tenancy at £2,000 reported £24,000 on each of its two
   deeds and £48,000 when they were summed: twice the rent anybody guaranteed. On
   GR-20846 the tenant's own page showed £24,000 against a deed covering their 46%,
   which is £920 a month and £11,040 a year.

   The invariant this restores, and the reason the figure is worth getting right:
   summing the guaranteed value of a tenancy's deeds equals twelve months of the
   tenancy's rent, exactly, because the shares sum to the rent. £11,040 + £12,960 =
   £24,000. Asserted in src/data/guaranteedValue.test.ts.

   shareAmount, not sharePercent times rent: the share AMOUNT is what was agreed and
   frozen, and re-deriving it from a percentage reintroduces the rounding that
   apportion() settled to the penny.
   ===================================================================== */
export function guaranteedAnnual(r: { rent: number; shareAmount?: number | null }): number {
  const base = r.shareAmount != null && r.shareAmount > 0 ? r.shareAmount : r.rent;
  return base * 12;
}

function feeLabels(r: { rent: number; fee?: number | null; sharePercent?: number | null }):
  { feeGBP?: string; feeBasisLabel?: string } {
  const fee = r.fee ?? null;
  if (fee == null) return {};
  const gbp = gbpPence(fee);
  /* THE BASIS IS A RATIO AND BOTH HALVES MUST BE THE SAME PERSON'S.
     This divided the applicant's own fee by the WHOLE tenancy's rent, so one
     tenant of a 50/50 pair on a five-week deal read "1.67 weeks of rent (this
     tenant's 50% share)" while the dashboard called the identical deal five
     weeks. Both numbers were defensible on their own and together they were
     nonsense. The share scales the denominator too, which is also what
     feeBasisOf in commissionSplit.ts does, so the two helpers now agree. */
  const share = r.sharePercent != null && r.sharePercent > 0 ? r.sharePercent / 100 : 1;
  const base = r.rent * share;
  if (Math.abs(fee - base) < 0.005) return { feeGBP: gbp, feeBasisLabel: "one month's rent" };
  const weeks = base > 0 ? (fee * 52) / (base * 12) : 0;
  const suffix = r.sharePercent != null && r.sharePercent < 100
    ? ` (this tenant's ${r.sharePercent}% share)` : '';
  return { feeGBP: gbp, feeBasisLabel: `${Number(weeks.toFixed(2))} weeks of rent${suffix}` };
}

export function getApplicationDetail(ref: string | null): ApplicationDetail {
  // No silent substitution: a reference that does not exist or is not accessible
  // to the viewer (RLS returned nothing in live mode) yields an honest not-found
  // detail rather than another of the viewer's own records.
  const r = findRecord(ref);
  if (!r) return notFoundDetail(ref ?? '');
  const idx = RECORDS.indexOf(r);

  // A Supabase-hydrated record carries the real Sent timestamp; when present we
  // show exactly what was entered and when each event happened. Mock/seed records
  // (test mode) omit these, so the deterministic stand-ins are used instead.
  const real = r.sentAtTs != null;

  // ---- Timeline (real timestamps in live mode; synthesised offsets otherwise) ----
  let sentAt: Date;
  let paidAt: Date | undefined;
  let deedAt: Date | undefined;
  if (real) {
    sentAt = new Date(r.sentAtTs as string);
    paidAt = r.paidAtTs ? new Date(r.paidAtTs) : undefined;
    deedAt = r.deedAtTs ? new Date(r.deedAtTs) : undefined;
  } else {
    const event = parseISO(r.date);
    if (r.status === 'deed') {
      deedAt = event;
      paidAt = addDays(event, -2);
      sentAt = addDays(event, -6);
    } else if (r.status === 'paid') {
      paidAt = event;
      sentAt = addDays(event, -4);
    } else {
      sentAt = event;
    }
  }

  const tenancyStart = real && r.tenancyStartTs ? new Date(r.tenancyStartTs) : addDays(sentAt, 16);

  // ---- Date of birth + age ----
  const today = SUPABASE_ENABLED ? new Date() : new Date(2026, 5, 26);
  let dob: Date;
  if (real && r.dob) {
    dob = parseISO(r.dob);
  } else {
    const dobYear = 1999 - (idx % 9);
    dob = new Date(dobYear, (idx * 5) % 12, ((idx * 7) % 27) + 1);
  }
  const age = ageOn(dob, today);

  // ---- Contact + property (real values in live mode; synthesised otherwise) ----
  const emailUser = deaccent(r.name).toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '.');
  const phoneTail = r.ref.replace(/\D/g, '').slice(-3);
  const email = real ? (r.email ?? '') : `${emailUser}@gmail.com`;
  const phone = real ? (r.phone ?? '') : `+44 7700 900${phoneTail}`;
  const addr2 = real ? (r.addr2 ?? '') : '';
  const city = real ? (r.city ?? '') : 'London';
  const county = real ? (r.county ?? '') : 'Greater London';
  // This deed's own guaranteed value: a share on a joint tenancy, the whole
  // rent on a sole one. See guaranteedAnnual.
  const annual = guaranteedAnnual(r);

  // Partner is only on the summary LIST (both mock and live), not AppRecord.
  const summary = LIST.find((x) => x.ref === r.ref);
  const summarySlug = summary?.partner ?? '';
  return {
    ref: r.ref,
    status: r.status,
    statusLabel: STATUS_LABEL[r.status],
    referencingMode: r.referencingMode,
    channel: channelOf({ partnerSlug: summarySlug, partnerMode: getPartner(summarySlug)?.referencingMode }),
    withdrawnReason: r.withdrawnReason ?? null,
    name: r.name,
    initials: initials(r.name),
    title: r.title,
    role: r.role,
    fullName: `${r.title} ${r.name}`.trim(),
    dob: `${fmtLong(dob)} (${age})`,
    email,
    phone,
    addr1: r.addr1,
    addr2,
    city,
    county,
    postcode: r.postcode,
    agency: r.agency,
    branch: r.branch,
    partner: summarySlug,
    partnerName: partnerName(summarySlug),
    agentAddr: AGENT_ADDR[r.branch] || `${r.branch}, London`,
    /* TO THE PENNY. Matt, 2026-10-03, on GR-23853: "'Rent to be guaranteed
       £23,030.4' must show two decimal places; check every money figure on
       this page and the tenant pages." Bare toLocaleString has no MINIMUM,
       so £1,500.00 printed as £1,500 and £23,030.40 as £23,030.4 -- the
       same number read two ways on one screen. He gave this rule on
       2026-10-01 too and only the paid amount was fixed then, which is why
       there is now a guard. */
    rent: gbpPence(r.rent),
    rentNum: r.rent,
    ...feeLabels({ rent: r.rent, fee: summary?.fee ?? null, sharePercent: r.sharePercent ?? null }),
    referrer: r.referrer,
    // referrerRole is on the summary LIST (like partner), not AppRecord (#112).
    referrerRole: LIST.find((x) => x.ref === r.ref)?.referrerRole ?? null,
    referrerSeesCommission: LIST.find((x) => x.ref === r.ref)?.referrerSeesCommission ?? null,
    tenancyStart: fmtLong(tenancyStart),
    tenancyStartDate: tenancyStart,
    sentAt,
    paidAt: paidAt || null,
    deedAt: deedAt || null,
    sentStr: `${fmtShort(sentAt)} · ${real ? fmtTime(sentAt) : '10:24'}`,
    paidStr: paidAt ? `${fmtShort(paidAt)} · ${real ? fmtTime(paidAt) : '16:09'}` : null,
    deedStr: deedAt ? `${fmtShort(deedAt)} · ${real ? fmtTime(deedAt) : '09:41'}` : null,
    issue: deedAt ? fmtShort(deedAt) : null,
    // Expiry is always tenancy start + 12 months - 1 day, never anchored on the deed date.
    expiry: deedAt ? fmtShort(guaranteeExpiry(tenancyStart)) : null,
    annual: gbpPence(annual),
    paymentDate: paidAt || null,
    owner: r.owner,
    landlordName: r.landlordName ?? undefined,
    landlordEmail: r.landlordEmail ?? undefined,
  };
}

/* ---------- Lifecycle actions ---------- */

/** One applicant. A joint tenancy is this, repeated. */
export interface ReferralTenantInput {
  title: string;
  firstName: string;
  /** Optional. Carried because the eligibility check runs against a legal name. */
  middleName?: string;
  lastName: string;
  dob: string;
  email: string;
  phone: string;
  /** Their share of the rent. Both are sent; see shareMath.ts. */
  sharePercent?: number;
  shareAmount?: number;
}

export interface CreateReferralInput {
  title: string;
  firstName: string;
  /** Optional. Carried because the eligibility check runs against a legal name. */
  middleName?: string;
  lastName: string;
  /** The applicant's share of the rent. Both are sent; see shareMath.ts. */
  sharePercent?: number;
  shareAmount?: number;
  dob: string;
  email: string;
  phone: string;
  /** EVERY applicant, when there is more than one. Absent (or a single entry)
      means a sole tenant and the server takes the untouched single-tenant path:
      create_referral, one Stripe session, one email. Two or more means one
      tenancy, one fee resolved at that count and split by share, and each
      applicant then finished exactly as a sole tenant is. */
  tenants?: ReferralTenantInput[];
  addr1: string;
  addr2: string;
  city: string;
  county: string;
  postcode: string;
  rent: number;
  tenancyStart: string;
  agency: string;
  branch: string;
  /** On-the-fly org creation: whether the agency/branch were created inline, and
      the contact to capture (agency contact email required when agencyNew). */
  agencyNew?: boolean;
  branchNew?: boolean;
  agencyContactEmail?: string;
  agencyContactName?: string;
  agencyContactPhone?: string;
  branchContactEmail?: string;
  /** The partner an on-the-fly agency/branch belongs to. Ignored server-side for
      partner users (their own partner is authoritative); required for an opndoor
      admin fly-creating a brand-new agency. Null when scope is "all partners". */
  partner?: string;
  /** THE ROUTE THIS REFERRAL CAME DOWN, stated rather than inferred.
      Only an opndoor admin can have chosen one (Q-06 item H); the server
      refuses any supplier the branch does not sit under. Everyone else
      omits it and the route resolves from the caller, as before. */
  route?: string;
}

/**
 * Create a referral (status = Sent). In live mode this invokes the create-referral
 * Edge Function, which validates + inserts as the caller (RLS applies), opens a
 * Stripe test Checkout Session for the guarantor fee and emails the branded
 * payment link; the guarantee reference is assigned by the DB. Stripe (paid) then
 * PandaDoc (deed) advance it via webhooks. Mock/test mode returns a synthetic ref.
 */
export interface CreateReferralResult {
  ref: string;
  paymentUrl: string | null;
  emailSent: boolean;
  emailError: string | null;
  /** Present only for a joint tenancy: what each applicant was charged and
      whether their own email went. The confirmation needs it because "the
      tenant has been emailed" is four separate truths on a four-person let. */
  tenancy?: Array<{ ref: string; name: string; email: string; share: number; amount: number; emailSent: boolean }>;
}

export async function createReferral(input: CreateReferralInput): Promise<CreateReferralResult> {
  if (!SUPABASE_ENABLED) {
    return { ref: `GR-${30000 + Math.floor(LIST.length)}`, paymentUrl: null, emailSent: false, emailError: null };
  }
  // Creating the referral IS the send: the create-referral Edge Function validates
  // and inserts (as the caller, so RLS + field rules apply), opens a Stripe test
  // Checkout Session for the guarantor fee, and emails the tenant the branded
  // payment email (redirected to the review address in test mode).
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const { data, error } = await sb().functions.invoke('create-referral', {
    body: {
      agency: input.agency, branch: input.branch, origin,
      title: input.title, firstName: input.firstName, lastName: input.lastName,
      middleName: input.middleName ?? null,
      sharePercent: input.sharePercent ?? null, shareAmount: input.shareAmount ?? null,
      dob: input.dob || null, email: input.email, phone: input.phone,
      addr1: input.addr1, addr2: input.addr2, city: input.city, county: input.county, postcode: input.postcode,
      rent: input.rent, tenancyStart: input.tenancyStart || null,
      tenants: input.tenants && input.tenants.length > 1 ? input.tenants : null,
      agencyContactEmail: input.agencyContactEmail || null,
      agencyContactName: input.agencyContactName || null,
      agencyContactPhone: input.agencyContactPhone || null,
      branchContactEmail: input.branchContactEmail || null,
      partner: input.partner || null,
      route: input.route || null,
    },
  });
  if (error) {
    let msg = error.message as string;
    try {
      const ctx = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.();
      if (ctx?.error) msg = ctx.error;
    } catch { /* ignore */ }
    throw new Error(msg || 'Could not create the referral.');
  }
  if (!data?.ok) throw new Error(data?.error || 'Could not create the referral.');
  return {
    ref: data.ref, paymentUrl: data.paymentUrl ?? null,
    emailSent: !!data.emailSent, emailError: data.emailError ?? null,
    tenancy: data.tenancy ?? undefined,
  };
}

/**
 * Persist a tenancy-start amendment via the amend-tenancy-start Edge Function.
 * The function calls the amend_tenancy_start RPC (deed-state-aware permission,
 * AAL2, ownership) then orchestrates the deed: void+regenerate while awaiting
 * signature, or archive+replace once executed. Returns the server's summary.
 * No-op in mock mode. The UI calculation is amendTenancyStart above.
 */
/** #81 Count of submitted-and-unresolved agent tenancy-start corrections in the
    caller's scope (admin: all; management: their partner). 0 in mock mode. */
export async function pendingTenancyCorrections(): Promise<number> {
  if (!SUPABASE_ENABLED) return 0;
  const { data, error } = await sb().rpc('count_pending_tenancy_corrections');
  if (error) return 0;
  return Number(data) || 0;
}

export async function amendTenancyStartDb(ref: string, newStart: Date, confirmReissue = false): Promise<string | undefined> {
  if (!SUPABASE_ENABLED) return undefined;
  const iso = `${newStart.getFullYear()}-${String(newStart.getMonth() + 1).padStart(2, '0')}-${String(newStart.getDate()).padStart(2, '0')}`;
  const { data, error } = await sb().functions.invoke('amend-tenancy-start', { body: { ref, newStart: iso, confirmReissue } });
  if (error) throw new Error('Could not amend the tenancy start date.');
  // #82 A signed deed needs an explicit consequence confirmation before the server
  // proceeds; surface that distinctly so the UI can prompt and retry.
  if (data?.needsConfirm) { const e = new Error(data.error || 'Confirmation required.'); (e as Error & { needsConfirm?: boolean }).needsConfirm = true; throw e; }
  if (!data?.ok) throw new Error(data?.error || 'Could not amend the tenancy start date.');
  return data.message as string | undefined;
}

/**
 * Send the issued deed to the agent via the send-deed-to-agent Edge Function,
 * which enforces canSendDeed / the referrer restriction (send_deed_to_agent RPC)
 * and then delivers the same branded deed email the automatic path sends on
 * execution. This is the manual / recovery-resend path. No-op in mock mode.
 */
/**
 * Send the signed deed to the agent.
 *
 * `resend` is the caller saying they have read when it last went and mean to
 * send it again. Without it the server refuses a second send to the resolved
 * contact: one delivery per signed deed, which is the rule a duplicate on
 * GR-20846 was written against (20261007320000).
 */
export async function sendDeedToAgent(
  ref: string, recipientEmail?: string, saveContact?: boolean, resend?: boolean,
): Promise<{ sentTo?: string }> {
  if (!SUPABASE_ENABLED) return {};
  const { data, error } = await sb().functions.invoke('send-deed-to-agent', {
    body: {
      ref, recipientEmail: recipientEmail ?? null,
      saveContact: saveContact ?? false, resend: resend === true,
    },
  });
  if (error) {
    let msg = error.message as string;
    try {
      const ctx = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.();
      if (ctx?.error) msg = ctx.error;
    } catch { /* ignore */ }
    throw new Error(msg || 'Could not send the deed to the agent.');
  }
  if (!data?.ok) throw new Error(data?.error || 'Could not send the deed to the agent.');
  return { sentTo: data.sentTo as string | undefined };
}

/**
 * Send the issued deed to the LANDLORD via the send-deed-to-landlord Edge
 * Function. For agency staff (an owning referrer or a manager in scope) on their
 * own application; the RPC re-checks the audience, stores the landlord's name and
 * email on the application for a no-retype resend, and the function emails the
 * signed deed as an attachment with the sender's covering line. No-op in mock mode.
 */
export async function sendDeedToLandlord(ref: string, name: string, email: string, note?: string): Promise<{ sentTo?: string }> {
  if (!SUPABASE_ENABLED) return {};
  const { data, error } = await sb().functions.invoke('send-deed-to-landlord', {
    body: { ref, name, email, note: note ?? '' },
  });
  if (error) {
    let msg = error.message as string;
    try {
      const ctx = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.();
      if (ctx?.error) msg = ctx.error;
    } catch { /* ignore */ }
    throw new Error(msg || 'Could not send the deed to the landlord.');
  }
  if (!data?.ok) throw new Error(data?.error || 'Could not send the deed to the landlord.');
  return { sentTo: data.sentTo as string | undefined };
}

/**
 * Who may amend the tenancy start date. The cut is HAS THE TENANCY STARTED,
 * and nothing else.
 *
 * Matt, 2026-10-04, after asking what the rule was and being told nobody had
 * ever chosen it: "agency and supplier users can change a start date only
 * before the tenancy starts (signed or not); after the start date, only
 * Opndoor staff can."
 *
 * - Before the start date: an owning Referrer, or anyone at management level,
 *   whether or not the deed is signed. While a deed is awaiting signature the
 *   outstanding document is voided and regenerated; a signed one is archived
 *   and replaced. Both still happen, they just no longer decide WHO may ask.
 * - On or after the start date: opndoor staff only. `expiry_date` is
 *   GENERATED from this date, so moving it changes the cover on a live
 *   guarantee the underwriter already holds on the bordereau.
 *
 * WHAT CHANGED, in both directions: an agency user may now correct a signed
 * deed before the tenancy begins, which was management-only; and nobody
 * outside opndoor may touch one after it begins, which anybody in role could.
 *
 * isOpndoorStaff, WHICH INCLUDES opndoor_manager. Matt, 2026-10-04: "any
 * Opndoor staff (admins and opndoor managers) can change a start date at any
 * time ... Widen amend_tenancy_start's guard to match." I first wrote this as
 * superadmin alone, because the RPC's reach guard was is_admin() and the
 * wider predicate would have offered a manager a dialog the server refused.
 * 20261008100000 moved the guard to is_opndoor_staff() instead, so the two
 * now say the same thing -- which is the only reason this line is safe.
 *
 * `started` IS ABOUT THE DATE ON THE RECORD, never the one being typed.
 *
 * The back end (can_amend_tenancy_start + the amend_tenancy_start RPC)
 * enforces this independently; this is the same rule for the screen.
 */
export function canAmendTenancyStart(
  role: Role, _status: Status, ownedByReferrer: boolean,
  _deedState: string | null = null, started = false,
): boolean {
  if (started) return isOpndoorStaff(role);
  return mayAmendBeforeStart(role, ownedByReferrer);
}

/* `_status` and `_deedState` ARE KEPT AND DELIBERATELY UNREAD. Every caller
   still passes them and the SQL mirror still takes them, so dropping them
   would be a signature churn across both estates to no effect. Underscored
   because what they are now is evidence: the rule used to turn on the deed
   state and no longer does, and a reader who sees them ignored here learns
   that faster than from a paragraph. */

/** The rule before the tenancy begins, shared so there is one copy of it. */
function mayAmendBeforeStart(role: Role, ownedByReferrer: boolean): boolean {
  // Positive. The bare `true` granted this to every non-referrer role.
  // "At any time" covers before the start too, so opndoor staff are in here
  // as well, where an opndoor manager used to be excluded along with everyone
  // outside the agency's own management.
  return role === 'referrer' ? ownedByReferrer : isOpndoorStaff(role) || role === 'management';
}

/**
 * Why this person cannot amend, where the reason is worth saying out loud.
 *
 * Matt asked for the sentence to appear "in the dialog for everyone else",
 * which only works if the dialog can still be opened. So the Amend button
 * stays for anybody who would have been allowed but for the start date, and
 * the dialog explains instead of offering a field that would be refused.
 * Hiding the control would leave an agency wondering where it went.
 *
 * Null means either that they may amend, or that they were never offered it
 * in the first place (wrong role, not their referral) -- those readers get no
 * button and so have no dialog to read a reason in.
 */
export function amendStartBlockedReason(role: Role, ownedByReferrer: boolean, started: boolean): string | null {
  if (!started) return null;
  if (isOpndoorStaff(role)) return null;
  // Would they have been allowed before the start date? Only then is the start
  // date the thing standing in their way, and only then is it worth saying.
  if (!mayAmendBeforeStart(role, ownedByReferrer)) return null;
  return 'The tenancy has started. Contact opndoor to change the date.';
}

/**
 * Who may send the issued deed to the agent. Referrers may send, but only on
 * their own application; Management and opndoor admin may send on any in scope.
 * Referrers are send-only (no one-off recipient, no saving contacts) — that is
 * enforced in the UI. The back end must enforce this rule independently.
 */
export function canSendDeed(role: Role, ownedByReferrer: boolean): boolean {
  if (role === 'referrer') return ownedByReferrer;
  return role === 'superadmin' || role === 'management';
}

/**
 * Who may "Replace and resend deed" (void the outstanding PandaDoc document and
 * issue a fresh one) while a deed is awaiting signature: Management and opndoor
 * admin only, never Referrers. The tenant-nudge "Resend signature request" is
 * available to every authorised viewer (owning Referrer, Management, admin) and
 * so is not gated here. The back end (pandadoc-void-regenerate) re-checks this.
 */
export function canReplaceDeed(role: Role): boolean {
  return role === 'superadmin' || role === 'management';
}

/**
 * #2 Who may withdraw an application: only while it is at Sent (before payment).
 * The owning Referrer may withdraw their own; Management any within their partner;
 * opndoor admin any. Never once Paid — post-payment exits are the refund flow.
 * The mark_withdrawn RPC enforces this rule independently.
 */
export function canWithdraw(role: Role, status: Status, ownedByReferrer: boolean): boolean {
  if (status !== 'sent') return false;
  // Positive. The bare `true` granted this to every non-referrer role.
  return role === 'referrer' ? ownedByReferrer : role === 'superadmin' || role === 'management';
}

/**
 * Withdraw a Sent application with a reason (and a note when reason is 'other').
 * Persists via the mark_withdrawn RPC, which re-checks Sent-only + permission and
 * writes the activity-log entry with the actor and reason. No-op in mock mode
 * (the caller reflects the change in the demo view locally).
 */
export async function withdrawApplication(ref: string, reason: WithdrawReason, note: string): Promise<void> {
  if (!SUPABASE_ENABLED) {
    // #10 Mock/demo mode: mutate the working copies so every surface (detail pill/
    // banner, list row, chip, dashboard counter) reflects the withdrawal after the
    // caller's refresh() bumps dataVersion. Live mode persists via the RPC below and
    // re-hydrates instead.
    const rec = RECORDS.find((r) => r.ref === ref);
    if (rec) { rec.status = 'withdrawn'; rec.withdrawnReason = reason; }
    const row = LIST.find((r) => r.ref === ref);
    if (row) { row.status = 'withdrawn'; row.withdrawn = true; }
    return;
  }
  const { error } = await sb().rpc('mark_withdrawn', { p_ref: ref, p_reason: reason, p_note: note.trim() || null });
  if (error) throw new Error(error.message || 'Could not withdraw the application.');

  /* =====================================================================
     AND TELL THE TENANT.

     Matt, 2026-10-03: "after withdrawal, does the tenant's payment link stop
     working, and is the tenant told? It should stop working, and the tenant
     should get a short email that the application was withdrawn by the
     agency."

     THE LINK ALREADY STOPPED WORKING -- `getPayPageState` answers `isClosed`
     for a withdrawn application and the checkout action refuses -- and the
     tenant was never told, so somebody who had been asked for money found
     out by opening a dead link.

     AFTER THE RPC AND NOT INSIDE IT, because `mark_withdrawn` is plpgsql and
     cannot send email. Every tenant email in the product is an edge function
     for that reason.

     A FAILED EMAIL DOES NOT FAIL THE WITHDRAWAL. The withdrawal is already
     committed by the line above, and throwing here would tell the person who
     pressed the button that it had not worked when it had: they would press
     it again and meet "Only an application at Sent can be withdrawn". The
     failure is written to the activity log by the function itself, where
     Opndoor can see it and resend. */
  try {
    await sb().functions.invoke('withdraw-notice', { body: { ref } });
  } catch {
    // Deliberately swallowed. See above: the withdrawal stands either way.
  }
}

export interface AmendResult {
  /** True after payment (Paid/Deed Issued): the deed is reissued. */
  reissued: boolean;
  /** New issue and expiry when reissued, otherwise null. */
  issue: Date | null;
  expiry: Date | null;
}

/**
 * Amend the tenancy start date. Any valid date is accepted; the form checks
 * that the input is a real dd/mm/yyyy date that differs from the current start.
 * Before payment (Sent) this just corrects the start date. After payment it
 * reissues the Deed of Guarantee and recomputes the 12-month expiry.
 * This computes the UI result only; amendTenancyStartDb persists the change via
 * the amend-tenancy-start Edge Function, which enforces the deed-state-aware
 * permission rule and orchestrates the reissue server-side.
 */
export function amendTenancyStart(status: Status, newStart: Date): AmendResult {
  if (status === 'sent') return { reissued: false, issue: null, expiry: null };
  // Reissue: the expiry recomputes from the new tenancy start (start + 12 months - 1 day).
  return { reissued: true, issue: new Date(2026, 5, 26), expiry: guaranteeExpiry(newStart) };
}
