/* =====================================================================
   Reconciliation service (opndoor admin only).
   The real queue of agencies/branches created on the fly by referrers
   (review_state = pending_review), each with its parent, creator, created-at,
   attached referral count, and a same/similar-name hint against confirmed
   records. "Confirm as new" promotes it to confirmed (audited). HubSpot sync runs
   on a 2-minute cron and on demand via triggerCrmSync (the Sync button);
   merge is not built yet.

   Live mode uses the reconciliation_queue / confirm_org_entity RPCs; the badge
   count is derived synchronously from the hydrated org (pending entities).
   Mock/test mode keeps an in-memory demo queue.
   ===================================================================== */
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';
import { functionErrorMessage } from './paymentService';
import { getAgencies } from './orgService';
import { ALL_PARTNERS } from './types';
import { formatDateTime } from '@/lib/format';

export interface ReconRow {
  /** Composite key `${type}:${entityId}` for React lists. */
  id: string;
  entityId: string;
  type: 'agency' | 'branch';
  name: string;
  parent: string | null;
  by: string;
  when: string;
  refs: number;
  /** Name of a confirmed record this looks like, or null. */
  match: string | null;
  /** True when the match is an exact (case-insensitive) same-name hit. */
  matchExact: boolean;
  /** #117 True on an agency whose auto "[Agency], Head office" branch is folded into this card. */
  foldedHeadOffice?: boolean;
}

function fmtWhen(ts: string): string {
  const d = new Date(ts);
  return formatDateTime(d);
}

// Mock/demo queue (mock mode only). Illustrative pending entities.
const MOCK_QUEUE: ReconRow[] = [
  { id: 'branch:m1', entityId: 'm1', type: 'branch', name: 'Sth Kensington', parent: 'Foxglove Residential', by: 'James Okafor', when: '18/06/2026 · 14:22', refs: 1, match: 'South Kensington', matchExact: false },
  { id: 'agency:m2', entityId: 'm2', type: 'agency', name: 'Marylebone and Co.', parent: null, by: 'Aisha Khan', when: '17/06/2026 · 09:48', refs: 2, match: 'Marylebone & Co', matchExact: false },
  { id: 'branch:m3', entityId: 'm3', type: 'branch', name: 'Wandsworth', parent: 'Hartwell Estates', by: 'Marcus Lin', when: '16/06/2026 · 16:05', refs: 3, match: null, matchExact: false },
  { id: 'agency:m4', entityId: 'm4', type: 'agency', name: 'Camden Town Lettings', parent: null, by: 'Daniel Wright', when: '13/06/2026 · 10:12', refs: 1, match: null, matchExact: false },
  // #117 A single-office fly-created agency: its auto "[Agency], Head office" branch
  // folds into the agency card (confirming the agency sweeps it), so it is not a
  // separate queue item — the card notes the folded head office.
  { id: 'agency:m5', entityId: 'm5', type: 'agency', name: 'Bracken & Vale', parent: null, by: 'Priya Nair', when: '12/06/2026 · 11:30', refs: 1, match: null, matchExact: false, foldedHeadOffice: true },
];

/** The pending-review queue (admin only). Async: live RPC or the mock queue. */
export async function loadReconciliationQueue(): Promise<ReconRow[]> {
  if (SUPABASE_ENABLED) {
    const { data, error } = await sb().rpc('reconciliation_queue');
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((r: any) => ({
      id: `${r.entity_type}:${r.entity_id}`,
      entityId: r.entity_id,
      type: r.entity_type,
      name: r.name,
      parent: r.parent ?? null,
      by: r.created_by_name ?? 'A referrer',
      when: r.created_at ? fmtWhen(r.created_at) : '',
      refs: Number(r.referral_count ?? 0),
      match: r.match_name ?? null,
      matchExact: !!r.match_exact,
      foldedHeadOffice: !!r.folded_head_office,
    }));
  }
  return MOCK_QUEUE.slice();
}

/** Confirm a pending entity as a new canonical record (audited). */
export async function confirmReconEntity(type: 'agency' | 'branch', entityId: string): Promise<void> {
  if (SUPABASE_ENABLED) {
    const { error } = await sb().rpc('confirm_org_entity', { p_type: type, p_id: entityId });
    if (error) throw new Error(error.message);
    return;
  }
  const i = MOCK_QUEUE.findIndex((r) => r.entityId === entityId);
  if (i < 0) return;
  const row = MOCK_QUEUE[i];
  MOCK_QUEUE.splice(i, 1);
  // #96 Confirming an agency also sweeps its auto-created "[Agency], Head office" branch.
  if (row.type === 'agency') {
    const ho = `${row.name}, Head office`.toLowerCase();
    const bi = MOCK_QUEUE.findIndex((r) => r.type === 'branch' && r.parent === row.name && r.name.toLowerCase() === ho);
    if (bi >= 0) MOCK_QUEUE.splice(bi, 1);
  }
}

/** Trigger an on-demand CRM sync (admin only). Fire-and-forget: the edge
    function runs asynchronously; a 2-minute cron also runs it automatically.

    The RPC is trigger_crm_sync and not the older supplier-named twin, because
    an rpc() argument is a string literal that survives minification and shows up
    in a grep of dist/. The old function still exists for the cron. */
export async function triggerCrmSync(): Promise<void> {
  if (SUPABASE_ENABLED) {
    const { error } = await sb().rpc('trigger_crm_sync');
    if (error) throw new Error(error.message);
    return;
  }
  // Mock mode: no backend to call.
}

/** Pending count for the sidebar badge. Derived synchronously from the hydrated
    org in live mode (admins hydrate every agency/branch), or the demo queue. */
export function reconciliationPendingCount(): number {
  if (SUPABASE_ENABLED) {
    let n = 0;
    for (const a of getAgencies(ALL_PARTNERS)) {
      if (a.unreviewed) n += 1;
      // #117 an unreviewed agency's auto head-office folds into its card (not a separate decision).
      const ho = `${a.name}, head office`.toLowerCase();
      n += (a.branches || []).filter((b) => b.unreviewed && !(a.unreviewed && b.name.toLowerCase() === ho)).length;
    }
    return n;
  }
  return MOCK_QUEUE.length;
}


/* =====================================================================
   Direct-rail agency matches (opndoor admin only).
   A separate queue from the on-the-fly review above: these are direct-signup
   applications whose free-text agency name we matched server-side. An exact
   name match pre-fills the agency; everything else is a person's call. The
   branch is ALWAYS a person's call. Resolving points the application at a real
   branch (partner_id stays opndoor-direct, enforced in SQL); dismissing marks
   it not-in-network and leaves it on the house branch.
   ===================================================================== */
export interface MatchCandidate { agency_id: string; name: string; partner_id: string; sim: number }

export interface AgencyMatchRow {
  applicationId: string;
  guaranteeRef: string;
  tenantName: string;
  property: string;
  /** What the tenant typed, verbatim. */
  typedName: string;
  /** The one exact-match agency, or null when zero or several. */
  autoAgencyId: string | null;
  autoAgencyName: string | null;
  /** Top fuzzy candidates, logged for calibration and shown as hints. Never auto-accepted. */
  candidates: MatchCandidate[];
  when: string;
  /** 'needs_review' (a person picks the branch) or 'resolved' (auto-accepted). */
  state: string;
  /** 'email' when an exact agent-contact email set the branch and agency without a
      person; null for a name candidate awaiting review. */
  matchedBy: string | null;
  /** The branch an email auto-match resolved to, for its read-only line. */
  resolvedBranchName: string | null;
}

/* ---------------------------------------------------------------------------
   AGENCIES IN A SUPPLIER'S ESTATE WITH NO AGENCY EMAIL.

   Matt, 2026-10-02: "For supplier-estate agencies with no agency email,
   show a clear warning on the supplier's Agencies tab and list them on
   Reconciliation so Opndoor can add one. No warnings for Opndoor's own
   agencies without an email."

   THE AGENCY ADDRESS IS THE SUBJECT, not "can a deed reach anybody". The
   agency email is the default every branch inherits, so an agency without
   one has no default and the next office added under it inherits nothing.
   That is why an agency whose branches each hold a mailbox of their own is
   on this list: nothing is stranded today, and the default is still
   missing. `branchesCovered` says which case a row is, so the screen can
   be honest about it rather than shouting at both the same way.

   A LIST, like Not in network: there is no button, because the fix is to
   open that agency and add a contact, which is a different screen's job.
   --------------------------------------------------------------------------- */
export interface AgencyWithoutAnEmail {
  agencyId: string;
  agencyName: string;
  partnerName: string;
  branches: number;
  /** How many of those branches hold an address of their own. Equal to
      `branches` means nothing is stranded today; less means some office
      has nowhere at all to send a deed. */
  branchesCovered: number;
}

/* The mock book carries both shapes, for the same reason the not-in-network
   one does: one agency fully covered per branch and one genuinely stranded,
   so the two renderings both ship having been looked at. */
const MOCK_NO_AGENCY_EMAIL: AgencyWithoutAnEmail[] = [
  { agencyId: 'mock-ag-1', agencyName: 'Kestrel Lettings', partnerName: 'Kestrel Lettings', branches: 2, branchesCovered: 2 },
  { agencyId: 'mock-ag-2', agencyName: 'Harbourfoot Residential', partnerName: 'Kestrel Lettings', branches: 2, branchesCovered: 1 },
];

export async function loadSupplierAgenciesWithoutAnEmail(): Promise<AgencyWithoutAnEmail[]> {
  if (SUPABASE_ENABLED) {
    const { data, error } = await sb().rpc('supplier_agencies_without_an_email');
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((r: any) => ({
      agencyId: String(r.agency_id),
      agencyName: r.agency_name || 'An agency',
      partnerName: r.partner_name || '',
      branches: Number(r.branches) || 0,
      branchesCovered: Number(r.branches_covered) || 0,
    }));
  }
  return MOCK_NO_AGENCY_EMAIL.slice();
}

export interface MatchBranch { id: string; name: string; area: string | null }

export async function loadAgencyMatchQueue(): Promise<AgencyMatchRow[]> {
  if (SUPABASE_ENABLED) {
    const { data, error } = await sb().rpc('agency_match_queue');
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((r: any) => ({
      applicationId: r.application_id,
      guaranteeRef: r.guarantee_ref,
      tenantName: r.tenant_name || 'A tenant',
      property: r.property || '',
      typedName: r.typed_name || '',
      autoAgencyId: r.auto_agency_id ?? null,
      autoAgencyName: r.auto_agency_name ?? null,
      candidates: Array.isArray(r.candidates) ? r.candidates : [],
      when: r.created_at ? fmtWhen(r.created_at) : '',
      state: r.state ?? 'needs_review',
      matchedBy: r.matched_by ?? null,
      resolvedBranchName: r.resolved_branch_name ?? null,
    }));
  }
  return MOCK_AGENCY_MATCHES.slice();
}

export async function loadMatchBranchOptions(agencyId: string): Promise<MatchBranch[]> {
  if (SUPABASE_ENABLED) {
    const { data, error } = await sb().rpc('agency_branches_for_match', { p_agency: agencyId });
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((b: any) => ({ id: b.branch_id, name: b.name, area: b.area ?? null }));
  }
  return MOCK_MATCH_BRANCHES[agencyId] ?? [];
}

export async function resolveAgencyMatch(applicationId: string, branchId: string): Promise<void> {
  if (SUPABASE_ENABLED) {
    const { error } = await sb().rpc('resolve_agency_match', { p_application: applicationId, p_branch: branchId });
    if (error) throw new Error(error.message);
    return;
  }
  const i = MOCK_AGENCY_MATCHES.findIndex((r) => r.applicationId === applicationId);
  if (i >= 0) MOCK_AGENCY_MATCHES.splice(i, 1);
}

export async function dismissAgencyMatch(applicationId: string, note?: string): Promise<void> {
  if (SUPABASE_ENABLED) {
    const { error } = await sb().rpc('dismiss_agency_match', { p_application: applicationId, p_note: note ?? null });
    if (error) throw new Error(error.message);
    return;
  }
  const i = MOCK_AGENCY_MATCHES.findIndex((r) => r.applicationId === applicationId);
  if (i >= 0) MOCK_AGENCY_MATCHES.splice(i, 1);
}

/* ---------------------------------------------------------------------------
   NM-N. THE AGENCIES A DIRECT TENANT NAMED THAT WE DO NOT WORK WITH.

   Matt, 2026-09-30: "list agencies a direct tenant named that we don't work
   with on the Reconciliation page, with the agent contact given, for someone
   to add to HubSpot by hand."

   A READ AND NOTHING ELSE. The same instruction opens "don't create
   companies in HubSpot automatically", so there is deliberately no write
   here, no sync call, and no button that reaches the CRM. What a person does
   with this list happens in HubSpot, by hand.

   ONE ROW PER AGENCY, not per application: `not_in_network_agencies` groups
   on the normalised typed name the matcher already keeps, so three tenants
   who named the same agency are one company to create.

   NOTHING OF THE TENANT'S IS IN THIS TYPE, and that is the whole shape of
   item 24's last sentence. There is no guaranteeRef, no tenant name and no
   property: the SQL does not return them, and this interface could not carry
   them if it did.
   --------------------------------------------------------------------------- */

/** An agent contact a tenant gave. Every field is optional: the
 *  delivery_contact_named constraint was re-added NOT VALID in
 *  20260904120000, so an older row can be an agency name and nothing else. */
export interface NotInNetworkContact {
  agencyName: string | null;
  title: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
}

export interface NotInNetworkAgency {
  /** The normalised name, which is what makes two spellings one agency. */
  nameKey: string;
  /** The spelling the most recent tenant used, which is what to type in. */
  typedName: string;
  /** How many direct tenants named it. The difference between a prospect
   *  worth the typing and a one-off. */
  tenants: number;
  lastNamedAt: string;
  /** Empty when no tenant gave an AGENT contact. A private landlord is not
   *  an agent and is deliberately not carried here. */
  contacts: NotInNetworkContact[];
}

/* WHAT SOMEBODY DID ABOUT A NOT-IN-NETWORK AGENCY. Matt, 2026-09-30:
   "'Added to HubSpot' (marks it done, records who and when, and removes
   it from the list) and 'Ignore' (removes it, recorded)."

   ONE CALL FOR BOTH, because the difference between them is what the
   person did next and not how the list behaves. Both record who and
   when, and both take the row off until a tenant names that agency
   again -- which is the half a done-flag cannot do. */
export async function decideNotInNetwork(
  nameKey: string, decision: 'added' | 'ignored', typedName?: string,
): Promise<void> {
  if (!SUPABASE_ENABLED) return;
  const { error } = await sb().rpc('decide_not_in_network', {
    p_name_key: nameKey, p_decision: decision, p_typed_name: typedName ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function loadNotInNetworkAgencies(): Promise<NotInNetworkAgency[]> {
  if (SUPABASE_ENABLED) {
    const { data, error } = await sb().rpc('not_in_network_agencies');
    if (error) throw new Error(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []).map((r: any) => ({
      nameKey: r.name_key,
      typedName: r.typed_name || r.name_key,
      tenants: Number(r.tenants) || 0,
      lastNamedAt: r.last_named_at ? fmtWhen(r.last_named_at) : '',
      contacts: Array.isArray(r.contacts) ? r.contacts : [],
    }));
  }
  return MOCK_NOT_IN_NETWORK.map((r) => ({ ...r, contacts: r.contacts.map((c) => ({ ...c })) }));
}

/* The mock book carries both shapes on purpose: one agency with an agent
   contact, and one with none at all -- which on dev is the real case, because
   the dismissed application there gave a private landlord. A fixture that
   only has the happy shape is how the empty-contact rendering ships
   untested. */
const MOCK_NOT_IN_NETWORK: NotInNetworkAgency[] = [
  { nameKey: 'foxton & hale', typedName: 'Foxton & Hale', tenants: 3, lastNamedAt: '28/09/2026 · 16:20',
    contacts: [{ agencyName: 'Foxton & Hale', title: 'Ms', firstName: 'Ruth', lastName: 'Calder',
      email: 'lettings@foxtonhale.test', phone: '020 7946 2200' }] },
  { nameKey: 'quayside residential', typedName: 'Quayside Residential', tenants: 1, lastNamedAt: '21/09/2026 · 09:05',
    contacts: [] },
];

const MOCK_AGENCY_MATCHES: AgencyMatchRow[] = [
  { applicationId: 'am1', guaranteeRef: 'GR-1000', tenantName: 'Sam Okafor', property: 'Leeds LS1 4DY',
    typedName: 'Meridian Lettings', autoAgencyId: 'ag-meridian', autoAgencyName: 'Meridian Lettings',
    candidates: [{ agency_id: 'ag-meridian', name: 'Meridian Lettings', partner_id: 'p1', sim: 1 }], when: '24/08/2026 · 12:00',
    state: 'needs_review', matchedBy: null, resolvedBranchName: null },
  { applicationId: 'am2', guaranteeRef: 'GR-1001', tenantName: 'Alex Field', property: 'Sheffield S1 2HH',
    typedName: 'barnad & co', autoAgencyId: null, autoAgencyName: null,
    candidates: [{ agency_id: 'ag-barnard', name: 'Barnard & Co', partner_id: 'p1', sim: 0.62 }], when: '24/08/2026 · 11:30',
    state: 'needs_review', matchedBy: null, resolvedBranchName: null },
  { applicationId: 'am3', guaranteeRef: 'GR-1002', tenantName: 'Priya Shah', property: 'York YO1 9QL',
    typedName: 'Harbour Lettings', autoAgencyId: 'ag-harbour', autoAgencyName: 'Harbour Lettings',
    candidates: [], when: '24/08/2026 · 10:00',
    state: 'resolved', matchedBy: 'email', resolvedBranchName: 'Riverside' },
];
const MOCK_MATCH_BRANCHES: Record<string, MatchBranch[]> = {
  'ag-meridian': [{ id: 'br-m-city', name: 'City Centre', area: 'LS1' }, { id: 'br-m-hq', name: 'Head office', area: null }],
  'ag-barnard': [{ id: 'br-b-1', name: 'Sheffield', area: 'S1' }],
};

/* =====================================================================
   REFUNDS THAT LANDED ON COMMISSION ALREADY SENT ON A STATEMENT.

   Matt, 2026-10-01, verbatim: "Refund after a commission statement has
   been sent: when a refund lands on an application whose commission was
   already on a sent statement, raise an internal alert to Opndoor naming
   the payee, the statement reference and the commission affected. On that
   alert, Opndoor admin chooses, with a confirmation box: (a) reissue a
   corrected statement to the payee, or (b) carry the amount as a
   deduction line on the payee's next statement. Nothing happens
   automatically. Record who chose what and when."

   THE ALERT GOES OUT BY EMAIL, through the existing ops machinery. What
   lives here is the QUESTION it raises, which needs a surface because it
   needs an answer. Reconciliation is where Opndoor already works through
   queues of exactly this kind.
   ===================================================================== */

export interface RefundQuestion {
  id: string;
  guaranteeRef: string;
  tenantName: string;
  payeeName: string;
  /** 'agency' | 'group' | 'branch' | 'partner', in the payee's own words. */
  payeeLevel: string;
  statementMonth: string;
  statementReference: string;
  commission: number;
  raisedAt: string;
  refundedAt: string;
}

export async function loadRefundQuestions(): Promise<RefundQuestion[]> {
  if (!SUPABASE_ENABLED) return [];
  const { data, error } = await sb().rpc('refund_questions_open');
  if (error) throw new Error(error.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    id: r.id,
    guaranteeRef: r.guarantee_ref,
    tenantName: (r.tenant_name || '').trim(),
    payeeName: r.payee_name,
    payeeLevel: r.payee_level,
    statementMonth: r.statement_month,
    /* A QUESTION ALWAYS HAS ONE in practice, because a month that was
       posted has a stored reference by definition. Left as a fallback
       rather than an assertion: a blank cell where a document number
       should be is the one thing a reader would not know how to act on. */
    statementReference: r.statement_reference || `the ${r.statement_month} statement`,
    commission: Number(r.commission) || 0,
    raisedAt: r.raised_at ? fmtWhen(r.raised_at) : '',
    refundedAt: r.refunded_at ? fmtWhen(r.refunded_at) : '',
  }));
}

export async function decideRefundQuestion(
  id: string, decision: 'reissue' | 'deduct',
): Promise<void> {
  if (!SUPABASE_ENABLED) return;
  const { error } = await sb().rpc('decide_refund_question', { p_id: id, p_decision: decision });
  if (error) throw new Error(error.message);
}

/**
 * Send the corrected statement for a question already marked 'reissue'.
 *
 * TWO STEPS, NOT ONE, and deliberately: the decision is recorded by the
 * database and the document is sent by the edge function, and the first
 * must survive the second failing. A send that falls over leaves a
 * decided question with no reissue against it, which the screen can
 * offer again; one call that did both would either lose the decision or
 * send twice.
 */
export async function reissueCorrectedStatement(
  questionId: string,
): Promise<{ ok: boolean; reference?: string; recipients?: number; error?: string }> {
  if (!SUPABASE_ENABLED) return { ok: false, error: 'Not connected.' };
  const { data, error } = await sb().functions.invoke('commission-statements', {
    body: { action: 'reissue', question: questionId },
  });
  if (error) return { ok: false, error: await functionErrorMessage(error, 'Could not send the corrected statement.') };
  if (!data?.ok) return { ok: false, error: data?.error || 'Could not send the corrected statement.' };
  return { ok: true, reference: data.reference, recipients: data.recipients };
}

/* =====================================================================
   HOW MUCH IS WAITING ON RECONCILIATION, COUNTED ONCE.

   Matt, 2026-10-02, verbatim:

     "1. The 'All' tab must include every item from every tab; it
         currently says 'Nothing to check' while 'Supplier agencies with
         no email' has 2 and 'Not in network' has 1. The top three tiles
         must also count what's actually waiting.
      2. Home's Reconciliation count and the sidebar badge must equal the
         'All' count, including 'Not in network'.
      3. Home's Reconciliation link opens on whichever tab has items (or
         All)."

   FOUR SURFACES STATED THE SAME NUMBER AND THREE OF THEM WERE WRONG,
   each in its own way: the All tab counted the review queue alone, the
   tiles above it counted the review queue alone, and Home and the
   sidebar counted the review queue plus matches plus the no-email
   agencies -- which was this morning's fix (`f1f98e1`) and still left
   out refunds and not-in-network. Three different subsets of one page,
   on four screens, is how the tile said 0 beside three rows of work.

   SO IT IS COUNTED HERE, ONCE. Every caller reads the same object, and
   `all` is a field rather than something each of them adds up: the sum
   is the part that was wrong four times, so it is the part that must
   not be written four times.

   THE SUBSET TABS ARE NOT IN THE SUM. Agencies, Branches and "Might
   already exist" are slices of the review queue, exactly as Fee unpaid
   and Invited are slices of In progress on Applications -- the same
   trap Matt named there on the same day. Adding them would double-count
   every new record.

   "NOT IN NETWORK" IS IN THE SUM because he said so, in those words. It
   is the one tab that is not work in the sense the others are: nothing
   on it can be actioned on the page, it is a list to retype into
   HubSpot. It is still something waiting for a person, which is what
   the number counts.
   ===================================================================== */
export interface ReconciliationTotals {
  /** New agencies and branches awaiting review. The tabs All, Agencies,
      Branches and "Might already exist" are all views of these. */
  review: number;
  matches: number;
  refunds: number;
  noEmail: number;
  notInNetwork: number;
  /** Every item on the page, which is what the All tab shows. */
  all: number;
}

/** The empty answer, for a reader who is not opndoor staff and for the
    moment before the first load returns. */
export const NO_RECONCILIATION_WORK: ReconciliationTotals = {
  review: 0, matches: 0, refunds: 0, noEmail: 0, notInNetwork: 0, all: 0,
};

/* THE ARITHMETIC, SEPARATE FROM THE FETCH, because the Reconciliation
   page already has all five lists in hand -- it draws their rows -- and
   fetching them again to count them would be a second round trip that
   could disagree with the first. Home and the sidebar want only the
   numbers, so they take the loader below. One function decides what
   counts and what adds up; two decide where the rows come from. */
export function reconciliationTotals(input: {
  review: { length: number };
  matches: { state?: string }[];
  refunds: { length: number };
  noEmail: { length: number };
  notInNetwork: { length: number };
}): ReconciliationTotals {
  /* NEEDS REVIEW, not every row the match queue holds. Home counted it
     this way and the page's own tab counted every row, so the two
     disagreed about the same queue before this; a badge counting
     resolved matches sends somebody to a page with nothing to do on it. */
  const m = input.matches.filter((r) => r.state === 'needs_review').length;
  const t = {
    review: input.review.length,
    matches: m,
    refunds: input.refunds.length,
    noEmail: input.noEmail.length,
    notInNetwork: input.notInNetwork.length,
  };
  return { ...t, all: t.review + t.matches + t.refunds + t.noEmail + t.notInNetwork };
}

export async function loadReconciliationTotals(): Promise<ReconciliationTotals> {
  const [review, matches, notInNetwork, refunds, noEmail] = await Promise.all([
    loadReconciliationQueue(), loadAgencyMatchQueue(), loadNotInNetworkAgencies(),
    loadRefundQuestions(), loadSupplierAgenciesWithoutAnEmail(),
  ]);
  return reconciliationTotals({ review, matches, refunds, noEmail, notInNetwork });
}

/** Which tab a reader should land on: the only one with items, or All
    when several have them and All is where they can see them together.
    Matt, 2026-10-02: "opens on whichever tab has items (or All)." */
export function reconciliationLandingTab(t: ReconciliationTotals): string {
  const withWork = ([
    ['review', t.review], ['matches', t.matches], ['refunds', t.refunds],
    ['noemail', t.noEmail], ['notinnetwork', t.notInNetwork],
  ] as const).filter(([, n]) => n > 0);
  if (withWork.length !== 1) return 'all';
  // The review queue IS the All tab's own list, so there is no tab to
  // name for it beyond All.
  return withWork[0][0] === 'review' ? 'all' : withWork[0][0];
}
