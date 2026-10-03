/* =====================================================================
   Application detail — the full record for one application, data-driven by
   the :ref route param. Status timeline, tenant / property / agent /
   tenancy, guarantee summary, stored deed, activity feed, and the amend
   tenancy-start modal (opndoor admin + Management), which accepts any valid
   date and reissues the deed.

   In live mode payment/deed state comes from getPaymentInfo (the activity_log
   and application row); amends persist via the amend-tenancy-start Edge Function
   (deed reissue applied server-side); payment and deed generation run on Stripe
   and PandaDoc. Send-deed emails the agent contact resolved by orgService.

   THE THREE LEVELS, AND WHY NOTHING HERE IS BEHIND THE COMMISSION FLAG.
   Director and Manager are both role 'management'. They have the same screens
   and the same reach, and the only difference is whether they are shown what the
   agency earns, which maySeeCommission answers and RoleOnly's `commission` prop
   enforces. Audited surface by surface, and every figure on this record is a
   fact about the REFERRAL rather than about our income from it: the guarantor
   fee as charged and the basis it was charged on, the rent and the annual rent
   the guarantee covers, a joint tenant's share percentage, the paid and deed
   tallies across the tenancy, the delivery state. A Manager owns this referral
   and is meant to read all of it, so none of it is gated and none of it should
   be: gating the fee would leave the person handling the tenancy unable to say
   what their own tenant was charged.

   The commission figures for one application (the rate, the effective
   percentage, the split, the amount payable to the agency) are not drawn on this
   page at all. getApplicationDetail carries none of them, application_commission_lines
   is never read here, and no activity_log kind states an amount owed to anybody,
   so there was no hole on this page to close. If one of those figures is ever
   added here, it goes in inside <RoleOnly roles={[...]} commission> at the same
   time, not afterwards.
   ===================================================================== */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { showsOffices, officeLabel, isPlaceholderOrg } from '@/data/agencyOffices';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ALL_PARTNERS, addApplicationNote, addContact, amendTenancyStart, amendTenancyStartDb, applicationDocumentUrl, approveApplication, canAmendTenancyStart, canSendDeed, canWithdraw, contactForApplication, declineApplication, deedCardState, deedDownloadUrl, deedIsOverdue, mayGenerateDeed, dismissAgencyMatch, effectiveContacts, getApplicationDetail, getApplicationNotes, getPaymentInfo, listApplicationDocuments, loadAgencyMatchQueue, loadMatchBranchOptions, pandadocSandbox, resendDeed, resendPaymentEmail, resolveAgencyMatch, sendDeedToAgent, sendDeedToLandlord, stripeMode, tenancySiblings, groupTenancies, tenancyDeedProgress, tenancyProgress, MEMBER_DEED_LABEL, memberDeedTone, withdrawApplication, type AgencyMatchRow, type AppNote, type MatchBranch, type PaymentInfo, type StaffDocument, type WithdrawReason } from '@/data';
import { useSession } from '@/session/SessionContext';
import { useConfirm } from '@/components/ui/ConfirmModal';
import { isOpndoorStaff } from '@/data/types';
import { gbpPence } from '@/lib/format';
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';
import { maySeeDeliveryState, type DeliveryState } from '@/data/deliveryState';
import { isTenancyStartInAllowedRange,parseFlexibleDate } from '@/lib/validation';
import { tenancyStartGiven } from '@/data/tenancyStartGiven';
import { titleCaseAddress, formatLondonDate, formatDate, formatLongDate, formatDateTime } from '@/lib/format';
import { isAgencyUser } from '@/data/capabilities';
import { viewerShape } from '@/data/viewerShape';
import { usePageMeta } from '@/components/layout/pageMeta';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
// import { shouldShowAwaitingTenantSignature } from './deedStatus';
import { Modal } from '@/components/ui/Modal';
import { Pill, type PillVariant } from '@/components/ui/Pill';
import { StatusTimeline } from '@/components/ui/StatusTimeline';
import { buildAgentJourney, getApplicationJourney, AGENT_JOURNEY_BANDS, type ApplicationJourney } from '@/data/journeyStages';
import { useToast } from '@/components/ui/Toast';
import { ROUTE_LABEL, preReferencedJourney, type Channel } from '@/data/channel';
import './ApplicationDetail.css';
import { allOf, countOf } from '@/lib/plural';



const NOW = new Date(2026, 5, 26);

// Route badge palette, matching the Applications list (portal status variants).
const ROUTE_PILL: Record<Channel, PillVariant> = {
  'Direct': 'muted',
  'Agent referral': 'paid',
  'Partner referral': 'sent',
  'Provider hand-over': 'warn',
};

// One format, shared. See lib/format.
const fmtLong = formatLongDate;
const fmtShort = formatDate;
const fmtInput = (x: Date) => formatLondonDate(x);
// Canonical activity timestamp: dd/mm/yyyy · HH:mm (Europe/London).
const fmtStamp = (x: Date) => formatDateTime(x);
// #103 Accept dd/mm/yyyy as before, plus pasted ISO and month-name formats.
const parseInput = (s: string): Date | null => parseFlexibleDate(s);

interface Activity {
  color: string;
  text: React.ReactNode;
  time: string;
}

/* =====================================================================
   WHERE THE DEED WENT. The Delivery panel's data.

   my_application_delivery is the caller-scoped face of deed_delivery_target,
   which stays service-role because it will resolve an address for any
   application it is handed. The wrapper answers only for an application this
   viewer can already see, and admits exactly who send_deed_to_agent admits, so
   anybody who can read the panel can press the button on it.

   It keys on the application id rather than the guarantee reference, so the id
   is looked up first: the reference is the route's key and the only handle the
   page holds.

   THIS BELONGS IN A SERVICE, not on a page. It is here because the delivery
   read had no service of its own yet; move it to one the moment a second
   screen needs it, rather than copying it.
   ===================================================================== */
interface DeliveryInfo {
  state: DeliveryState;
  /** Where it WOULD go, resolved now. Null when nobody on the ladder answers. */
  toEmail: string | null;
  toName: string | null;
  /** Which rung of the ladder supplied that address. */
  source: string | null;
  /** False when the automatic path will not send this one on its own. */
  autoSend: boolean;
  /** Where the last attempt actually went, which may not be where it would go
      today: the ladder can have changed since. */
  attemptedTo: string | null;
  attemptedSource: string | null;
  failedAt: string | null;
  reason: string | null;
  /** When the deed went to the TENANT to be signed. Not a delivery. */
  sentAt: string | null;
  /** Queued for a staff send (awaiting_staff_send). */
  held: boolean;
  /** When the SIGNED deed was first emailed to the agent, and to whom. */
  deliveredAt: string | null;
  deliveredTo: string | null;
  /** The most recent send after that one, when there has been one. */
  resentAt: string | null;
  /** The CURRENT deed's state, so the panel can say what is happening now
      rather than only what happened last. */
  deedState: string | null;
  /** A delivery a tenancy correction superseded: it really happened and the
      agent holds that PDF, it is simply no longer the current deed. */
  supersededAt: string | null;
  supersededTo: string | null;
}

/** The ladder's rungs in plain words. The column stores our internal names;
    nobody reading a screen should have to know them. */
const DELIVERY_RUNG: Record<string, string> = {
  org_person: 'a named person at the agency',
  delivery_contact: 'the delivery contact saved on this application',
  route_contact: 'the contact for this referral route',
  branch_contact: 'the branch contact',
  explicit: 'an address entered by staff',
};
const rungLabel = (src: string | null): string => (src ? DELIVERY_RUNG[src] ?? src : '');

async function loadDelivery(ref: string): Promise<DeliveryInfo | null> {
  if (!SUPABASE_ENABLED || !ref) return null;
  const client = sb();
  const { data: app } = await client.from('applications').select('id').eq('guarantee_ref', ref).maybeSingle();
  if (!app?.id) return null;
  const { data, error } = await client.rpc('my_application_delivery', { p_app: app.id });
  // A viewer the RPC will not answer for (or a session below AAL2) simply has
  // no panel. Never a half-filled one: a Delivery card that cannot say where
  // the deed went is worse than no card.
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
  if (!row) return null;
  const str = (k: string): string | null => (typeof row[k] === 'string' && row[k] !== '' ? row[k] as string : null);
  return {
    state: (str('state') as DeliveryState | null) ?? 'not_attempted',
    toEmail: str('to_email'),
    toName: str('to_name'),
    source: str('source'),
    autoSend: row.auto_send !== false,
    attemptedTo: str('attempted_to'),
    attemptedSource: str('attempted_source'),
    failedAt: str('failed_at'),
    reason: str('reason'),
    sentAt: str('sent_at'),
    held: row.held === true,
    deliveredAt: str('delivered_at'),
    deliveredTo: str('delivered_to'),
    resentAt: str('resent_at'),
    deedState: str('deed_state'),
    supersededAt: str('superseded_at'),
    supersededTo: str('superseded_to'),
  };
}

// Feed dot colour per activity_log event kind.
const feedColor = (kind: string): string => {
  if (kind === 'payment_received') return 'var(--paid)';
  if (kind === 'deed_reminder_failed') return 'var(--warn, #c77d0a)';
  if (kind === 'refunded' || kind === 'deed_error' || kind === 'payment_email_failed' || kind === 'payment_anomaly') return 'var(--danger, #d64545)';
  if (kind === 'withdrawn') return 'var(--ink-mute, #7a7a8c)';
  if (kind === 'expiry_reminder') return 'var(--warn, #c77d0a)';
  if (kind === 'deed_issued' || kind === 'deed_signed' || kind === 'deed_reissued') return 'var(--deed)';
  if (kind === 'referral_created' || kind === 'payment_email_sent' || kind === 'deed_viewed' || kind === 'deed_archived') return 'var(--sent)';
  return 'var(--heliotrope)';
};
// One partner-safe label per business event type. opndoor admins see the raw
// message instead; kinds not listed (e.g. payment_received, refunded) fall back
// to their stored message, which already carries the amount and is partner-safe.
const BUSINESS_LABEL: Record<string, string> = {
  referral_created: 'Referral created and sent to the tenant',
  payment_email_sent: 'Payment email sent to the tenant',
  payment_email_resent: 'Payment email resent to the tenant',
  // Safety net: if a failure ever surfaces business-visible, partners see this
  // clean copy, never the raw provider error (which stays opndoor-admin-only).
  payment_email_failed: 'Payment email could not be sent; opndoor has been notified',
  // Not "to the tenant": one deed covers a whole joint tenancy, and the same
  // partner-safe line has to be true of a three-person let.
  deed_sent: 'Deed of Guarantee sent for signature',
  deed_delivered: 'Deed of Guarantee delivered to the agent',
  deed_undelivered: 'Deed issued; no agent contact on file, not sent',
  deed_viewed: 'Deed viewed by the tenant',
  deed_signed: 'Deed signed by the tenant',
  deed_reminded: 'Signature reminder sent to the tenant',
  deed_resent: 'Deed re-sent to the tenant',
  deed_voided: 'Outstanding deed voided (superseded)',
  deed_regenerated: 'Deed regenerated and sent to the tenant',
  deed_declined: 'Tenant declined to sign; opndoor is reviewing',
  deed_issued: 'Deed of Guarantee issued',
  // tenancy_amended intentionally omitted: its message carries the partner-safe
  // old -> new detail, which should show to every viewer (not be genericised).
  deed_archived: 'Signed deed archived before amendment',
  deed_reissued: 'Deed reissued for signing',
  // #2 'withdrawn' intentionally omitted: its stored message carries the
  // partner-safe reason, which should show verbatim to every viewer.
};

// #2 Withdrawal reasons, in the order shown in the picker.
const WITHDRAW_REASONS: { value: WithdrawReason; label: string }[] = [
  { value: 'another_guarantor', label: 'Tenant found another guarantor' },
  { value: 'tenancy_fell_through', label: 'Tenancy fell through' },
  { value: 'duplicate', label: 'Duplicate referral' },
  { value: 'other', label: 'Other (add a note)' },
];
const REASON_LABEL: Record<WithdrawReason, string> = {
  another_guarantor: 'tenant found another guarantor',
  tenancy_fell_through: 'tenancy fell through',
  duplicate: 'duplicate referral',
  other: 'other',
};

export function ApplicationDetail() {
  const { ref } = useParams();
  const { role, partnerScope, viewingAs, refresh, dataVersion } = useSession();
  /* Used by the deed resend, which has to say what it is repeating. */
  const { ask, confirmEl } = useConfirm();
  const toast = useToast();
  // #10 dataVersion is a memo dep so `d` recomputes after a mutation + refresh()
  // re-hydrates the working copies — the single source of truth for every surface.
  const d = useMemo(() => getApplicationDetail(ref ?? null), [ref, dataVersion]);

  /* THE OTHER TENANTS on this tenancy, in this viewer's scope. Derived from the
     same summary rows the list reads, through the same scoping, so a referrer
     sees the siblings they own and nothing else. Empty for a sole applicant. */
  const siblings = useMemo(() => {
    // The SAME widening the list applies: opndoor staff read the whole book, and
    // a superadmin with a partner selected in the switcher would otherwise see
    // the pair grouped on /applications and no panel at all when they opened one
    // of them.
    const scope = role === 'superadmin' || role === 'opndoor_manager' ? ALL_PARTNERS : partnerScope;
    return ref ? tenancySiblings(ref, { role, scope }) : [];
  }, [ref, role, partnerScope, dataVersion]);
  const tenancyGroup = useMemo(() => {
    const g = groupTenancies(siblings);
    return siblings[0]?.tenancyId ? g.get(siblings[0].tenancyId) : undefined;
  }, [siblings]);
  const me = siblings.find((x) => x.ref === ref);
  usePageMeta('applications', 'Application detail', ['Home', 'Applications', d.ref]);

  const [currentStart, setCurrentStart] = useState<Date>(d.tenancyStartDate);
  const [deedVersion, setDeedVersion] = useState(1);
  const [amendedDates, setAmendedDates] = useState<{ issue: string; expiry: string } | null>(null);
  const [extraActivity, setExtraActivity] = useState<Activity[]>([]);
  const [showAllActivity, setShowAllActivity] = useState(false); // #113 cap Activity feed at 6
  const [amendOpen, setAmendOpen] = useState(false);
  const [confirmReissueOpen, setConfirmReissueOpen] = useState(false); // #82 signed-deed consequence confirm
  const [amendInput, setAmendInput] = useState('');

  // send-deed-to-agent
  const [sendOpen, setSendOpen] = useState(false);
  const [sendSel, setSendSel] = useState('other'); // '0','1',… (a saved contact) or 'other'
  const [soName, setSoName] = useState('');
  const [soRole, setSoRole] = useState('');
  const [soEmail, setSoEmail] = useState('');
  const [soSave, setSoSave] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);

  // send-deed-to-landlord (agency staff send to their own client)
  const [landlordOpen, setLandlordOpen] = useState(false);
  const [llName, setLlName] = useState('');
  const [llEmail, setLlEmail] = useState('');
  const [llNote, setLlNote] = useState('');
  const [llBusy, setLlBusy] = useState(false);

  // payment (Stripe, real mode)
  const [searchParams] = useSearchParams();
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
  const [resendBusy, setResendBusy] = useState(false);
  const [approveBusy, setApproveBusy] = useState(false);
  // Decline (status 'referencing') — the companion to Approve, with an optional reason.
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [declineBusy, setDeclineBusy] = useState(false);
  // Direct-signup agency match (superadmin), when this record is a Direct tenant
  // whose typed letting agent has not yet been resolved to a branch.
  const [matchRow, setMatchRow] = useState<AgencyMatchRow | null>(null);
  const [matchBranches, setMatchBranches] = useState<MatchBranch[]>([]);
  const [matchAgencyId, setMatchAgencyId] = useState('');
  const [matchBranchId, setMatchBranchId] = useState('');
  const [matchBusy, setMatchBusy] = useState(false);
  const [docs, setDocs] = useState<StaffDocument[]>([]);
  // Agent-rail (opndoor_referenced) nine-stage journey, loaded for the timeline.
  // Progress only, never content.
  const [journey, setJourney] = useState<ApplicationJourney | null>(null);
  const [copied, setCopied] = useState(false);
  const [deedBusy, setDeedBusy] = useState(false);
  // Delivery: where the executed deed goes, and what happened to the last send.
  const [delivery, setDelivery] = useState<DeliveryInfo | null>(null);
  const [dlvBusy, setDlvBusy] = useState(false);
  // #2 Withdraw (Sent, pre-payment only)
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [wReason, setWReason] = useState<WithdrawReason | ''>('');
  const [wNote, setWNote] = useState('');
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  /* #8 NOTES ARE THE SHARED RECORD OF THE APPLICATION.

     Matt, 2026-10-01, after two corrections in one evening: "anyone who can
     see the application reads and adds notes, each showing who wrote it.
     Tenants and other partners never see them."

     So there is no gate here at all. Reaching this page means the server
     resolved the application for this caller, which is the same test
     app_notes_select applies, and a second copy of it on the client could
     only ever disagree -- which is what the first two versions of this line
     did, in both directions. The author on each note comes from a database
     trigger rather than from whoever wrote it. */
  const maySeeNotes = true;
  // The applicant's uploaded documents (bank statements, proof of address) are
  // opndoor-internal: they are collected for the guarantee decision we make, not
  // for the referring agent, so a referrer never sees this card.
  /* AND THE TENANT'S OWN UPLOADS, which is the same fault one line down and
     was found checking the first: bank statements, proof of address, a P60,
     a tax return, collected for the decision Opndoor makes and shown to
     every agency Director by the same shared role word. The policy behind
     them is closed in the same migration, which also closes
     application-document-url, since that endpoint signs the file on the
     strength of the caller's own read.

     NOT REOPENED BY THE NOTES CORRECTION. That one says notes, and a bank
     statement is not a note: these stay Opndoor's on every rail. */
  const maySeeDocuments = isOpndoorStaff(role) && viewingAs === null;
  /* THE DOCUMENTS CARD IS PART OF A JOURNEY THAT DID NOT HAPPEN HERE. A
     pre-referenced tenant is checked by their own agency and goes straight to
     payment: they never reach the Address and Financials steps, so the card can
     only ever say "Nothing uploaded yet" and reads as something missing rather
     than something that was never asked for. Read off the application's own
     FROZEN mode, not channelOf (which answers the estate question and calls
     Regent an agency referral while the journey is pre-referenced) and not the
     journey RPC (async, and agent-rail only). */
  const preReferenced = preReferencedJourney(d.referencingMode);
  /* Is the person READING this one of our own agencies? Used only for copy: an
     agency user must never be shown the supplier rail's contact-ladder remedy,
     which names a thing their screens do not have. */
  const agencyViewer = isAgencyUser(role, partnerScope);
  const showDocuments = maySeeDocuments && !preReferenced;
  /* WHO SEES THE ROUTE. Was `role !== 'referrer'`, which granted the row to
     every role added since by accident. Named positively so the next one has to
     be let in deliberately. A developer is included: they read the book to debug
     an integration and the route is the first thing they need; it is not money. */
  const maySeeRoute = role === 'superadmin' || role === 'opndoor_manager'
    || role === 'management' || role === 'developer';

  /* THE REFERRING AGENT CARD SHOWS ONLY WHAT DIFFERS WITHIN THE READER'S SCOPE.

     For an agency reader it named their own agency, their own office and their
     own address, on every application they opened: four rows restating the page
     header. It is information for an admin looking across the book and, to
     Regent, furniture.

     So each row survives only where it can differ. Branch stays when there is
     more than one office; Agency stays for a group; the agent's own address goes
     with them, because the address of the office is the office. Route is decided
     separately by maySeeRoute and is untouched.

     With nothing left to say the card goes entirely, and "Deed in favour of"
     moves to the Property card, which is where a row about the property belongs
     and where it will be looked for. Admin and supplier views are unchanged:
     agencyViewer is false for both. */
  const referrerShape = useMemo(() => viewerShape(role, partnerScope), [role, partnerScope, dataVersion]);
  const referrerCard = useMemo(() => {
    /* NM-P, ON THIS CARD TOO. Matt, 2026-09-30: "for a single-office
       agency, Referring agent shows just the agency and its own address,
       no Branch line."

       KEYED ON THE AGENCY, NOT ON THE READER, which is the whole of the
       rule and the thing the existing logic could not express. The two
       collapses below are about the READER's scope -- an agency reader
       looking at their own single agency does not need to be told which
       agency -- and they are right and stay. This one is about the
       AGENCY: Regent Property has one office, so there is no branch to
       name, and that is true whoever is looking, including an admin who
       was shown a Branch row repeating the agency's own name. */
    const offices = showsOffices(d.agency, d.partner);
    if (!agencyViewer) {
      return { show: true, agency: true, branch: offices, address: true, deedRowMoves: false };
    }
    const agency = !referrerShape.oneAgency;
    const branch = !referrerShape.oneBranch && offices;
    const address = agency || branch;
    const anything = agency || branch || (maySeeRoute && !!d.partnerName);
    return { show: anything, agency, branch, address, deedRowMoves: true };
  }, [agencyViewer, referrerShape, maySeeRoute, d.partnerName, d.agency, d.partner]);
  const [notes, setNotes] = useState<AppNote[]>([]);
  const [noteBody, setNoteBody] = useState('');
  const [noteBusy, setNoteBusy] = useState(false);

  const loadPayment = useCallback(async () => {
    if (!SUPABASE_ENABLED) return null;
    const info = await getPaymentInfo(d.ref);
    setPaymentInfo(info);
    return info;
  }, [d.ref]);

  useEffect(() => {
    if (!SUPABASE_ENABLED) return;
    let cancelled = false;
    let attempts = 0;
    const justPaid = searchParams.get('paid') === '1';
    const tick = async () => {
      const info = await loadPayment();
      if (cancelled) return;
      // On return from Stripe the webhook may lag a moment; poll briefly until Paid.
      if (justPaid && info && info.paymentState !== 'paid' && info.status === 'sent' && attempts < 5) {
        attempts += 1;
        setTimeout(tick, 2000);
      }
    };
    void tick();
    return () => { cancelled = true; };
  }, [loadPayment, searchParams]);

  // Delivery state for the panel. Reloaded on dataVersion (and by hand after a
  // resend), because a successful send clears the failure and the staff queue
  // both, and the panel must not still be offering Resend over a deed that has
  // just gone out.
  const reloadDelivery = useCallback(async () => {
    setDelivery(await loadDelivery(d.ref));
  }, [d.ref]);

  useEffect(() => { void reloadDelivery(); }, [reloadDelivery, dataVersion]);

  // #8 Load the operational notes for the record, when the viewer may see them.
  const loadNotes = useCallback(async () => {
    if (!maySeeNotes) { setNotes([]); return; }
    setNotes(await getApplicationNotes(d.ref));
  }, [d.ref, maySeeNotes]);

  useEffect(() => { void loadNotes(); }, [loadNotes]);

  // Load the applicant's documents for review. RLS scopes the list; the card is
  // internal, so this only runs for opndoor staff.
  useEffect(() => {
    if (!showDocuments || !d.ref) { setDocs([]); return; }
    let cancelled = false;
    void listApplicationDocuments(d.ref).then((rows) => { if (!cancelled) setDocs(rows); });
    return () => { cancelled = true; };
  }, [d.ref, showDocuments]);

  // The agent-rail journey (nine stages) for the timeline; only for
  // opndoor_referenced applications. dataVersion so it refreshes after an action.
  useEffect(() => {
    if (d.referencingMode !== 'opndoor_referenced' || !d.ref) { setJourney(null); return; }
    let cancelled = false;
    void getApplicationJourney(d.ref).then((jr) => { if (!cancelled) setJourney(jr); });
    return () => { cancelled = true; };
  }, [d.ref, d.referencingMode, dataVersion]);

  // Direct-signup agency match for this record (superadmin only). Reuses the queue
  // RPC and finds this application; keyed on dataVersion so it clears after a
  // resolve/dismiss. Non-Direct records and non-admins never fetch it.
  useEffect(() => {
    if (role !== 'superadmin' || d.channel !== 'Direct' || !d.ref) { setMatchRow(null); return; }
    let cancelled = false;
    void loadAgencyMatchQueue()
      .then((rows) => {
        if (cancelled) return;
        const row = rows.find((r) => r.guaranteeRef === d.ref && r.state === 'needs_review') ?? null;
        setMatchRow(row);
        setMatchAgencyId(row?.autoAgencyId ?? '');
        setMatchBranchId('');
      })
      .catch(() => { if (!cancelled) setMatchRow(null); });
    return () => { cancelled = true; };
  }, [d.ref, d.channel, role, dataVersion]);

  // Branch options for the chosen agency in the inline match.
  useEffect(() => {
    if (!matchAgencyId) { setMatchBranches([]); return; }
    let cancelled = false;
    void loadMatchBranchOptions(matchAgencyId)
      .then((bs) => { if (!cancelled) setMatchBranches(bs); })
      .catch(() => { if (!cancelled) setMatchBranches([]); });
    return () => { cancelled = true; };
  }, [matchAgencyId]);

  const openDoc = async (docId: string) => {
    const r = await applicationDocumentUrl(docId);
    if (r.ok && r.url) window.open(r.url, '_blank', 'noopener');
    else toast(r.error || 'Could not open the document.', 'error');
  };

  const doAddNote = async () => {
    const body = noteBody.trim();
    if (!body) return;
    setNoteBusy(true);
    try {
      await addApplicationNote(d.ref, body);
      setNoteBody('');
      await loadNotes();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not add the note.', 'error');
    } finally {
      setNoteBusy(false);
    }
  };

  const copyLink = async () => {
    if (!paymentInfo?.paymentUrl) return;
    try {
      await navigator.clipboard.writeText(paymentInfo.paymentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast('Payment link copied.');
    } catch {
      toast('Could not copy the link.', 'error');
    }
  };

  const doResend = async () => {
    setResendBusy(true);
    const r = await resendPaymentEmail(d.ref);
    setResendBusy(false);
    // Partner-safe confirmation; the test-mode redirect detail is opndoor-admin-only.
    if (r.ok) { toast(role === 'superadmin' ? 'Payment email resent (test mode) to the review address.' : 'Payment email resent to the tenant.'); void loadPayment(); }
    else toast(r.error || 'Could not resend the email.', 'error');
  };

  // Approve a direct application awaiting the decision: sets it to Sent and emails
  // the tenant to sign in and pay the guarantee fee. Superadmin only, matching
  // set_application_status inside the function. The interim manual stand-in for the
  // Lettings verdict handover (ASK-THE-DEVELOPER.md item 1).
  const doApprove = async () => {
    setApproveBusy(true);
    const r = await approveApplication(d.ref);
    setApproveBusy(false);
    if (r.ok) {
      toast(r.emailError
        ? 'Approved. The tenant email could not be sent; resend it from the payment card.'
        : 'Approved. The tenant has been emailed to sign in and pay the guarantee fee.');
      await refresh();
      void loadPayment();
    } else {
      toast(r.error || 'Could not approve the application.', 'error');
    }
  };

  // Decline an application awaiting the decision: sets it to Declined with the
  // optional reason and emails the referring agent. Superadmin only, matching
  // decline_application inside the function. The reason is shown to the tenant.
  const doDecline = async () => {
    setDeclineBusy(true);
    const r = await declineApplication(d.ref, declineReason);
    setDeclineBusy(false);
    if (r.ok) {
      setDeclineOpen(false);
      toast('Application declined. The referring agent has been notified.');
      await refresh();
      void loadPayment();
    } else {
      toast(r.error || 'Could not decline the application.', 'error');
    }
  };

  // Match a direct tenant's typed letting agent to a real branch, or mark it not
  // in the network. Reuses the reconciliation RPCs; refresh re-hydrates so the
  // record, the queue and the sidebar badge recompute together.
  const doResolveMatch = async () => {
    if (!matchRow || !matchBranchId) return;
    setMatchBusy(true);
    try {
      await resolveAgencyMatch(matchRow.applicationId, matchBranchId);
      toast('Matched to the branch.');
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not match the agent.', 'error');
    } finally {
      setMatchBusy(false);
    }
  };
  const doDismissMatch = async () => {
    if (!matchRow) return;
    setMatchBusy(true);
    try {
      await dismissAgencyMatch(matchRow.applicationId);
      toast('Marked not in the network.');
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update the match.', 'error');
    } finally {
      setMatchBusy(false);
    }
  };

  const doResendDeed = async () => {
    setDeedBusy(true);
    const r = await resendDeed(d.ref);
    setDeedBusy(false);
    if (r.ok) { toast(r.message || 'Reminder sent to the tenant.'); void loadPayment(); }
    else toast(r.error || 'Could not send the deed.', 'error');
  };

  /* Resend the executed deed down the rail's own ladder.
     No recipient is passed: send_deed_to_agent resolves the same target the
     automatic path does, which is the whole point of a Resend after a failure.
     Choosing a different address is the "Send deed to agent" modal's job. */
  const doResendDelivery = async (confirmed = false) => {
    /* A SECOND COPY IS NOT A RETRY. Matt, 2026-10-01: "one delivery per
       signed deed unless someone presses Resend." On GR-20846 the deed went
       automatically at 16:49 and again at 16:51, two minutes later, because
       the panel was showing 16:45 -- the signature request -- and so looked
       as though the delivery had not happened. The time is right now; this
       is the other half, which says out loud what is about to be repeated.
       The server refuses it without the flag either way. */
    if (!confirmed && delivery?.deliveredAt) {
      ask({
        title: 'Send this deed again?',
        body: (
          <>
            <p>
              The signed deed already went to <b>{delivery.deliveredTo ?? delivery.attemptedTo ?? 'the agent'}</b>
              {' '}on <b>{fmtStamp(new Date(delivery.deliveredAt))}</b>
              {delivery.resentAt && <> and was resent on <b>{fmtStamp(new Date(delivery.resentAt))}</b></>}.
            </p>
            <p>They will get a second copy of the same deed.</p>
          </>
        ),
        confirmLabel: 'Send it again',
        run: () => doResendDelivery(true),
      });
      return;
    }
    setDlvBusy(true);
    try {
      const r = await sendDeedToAgent(d.ref, undefined, false, confirmed);
      toast(r.sentTo ? `Deed sent to ${r.sentTo}.` : 'Deed sent.');
      await reloadDelivery();
      void loadPayment();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not send the deed.', 'error');
    } finally {
      setDlvBusy(false);
    }
  };

  const doWithdraw = async () => {
    if (!wReason) return;
    if (wReason === 'other' && !wNote.trim()) { toast('Please add a note explaining the reason.'); return; }
    setWithdrawBusy(true);
    try {
      await withdrawApplication(d.ref, wReason, wNote);
      const note = wNote.trim();
      setWithdrawOpen(false);
      // #10 Single source of truth: re-hydrate the working copies (which bumps
      // dataVersion), so `d`, the list row, the Sent chip and the dashboard counter
      // all recompute to Withdrawn together. In live mode the server activity_log
      // already carries the withdrawal entry (loadPayment pulls it in); the optimistic
      // feed row is MOCK-ONLY, avoiding the ghost/duplicate with the wrong date+actor.
      if (!SUPABASE_ENABLED) {
        setExtraActivity((prev) => [
          { color: 'var(--ink-mute, #7a7a8c)', text: `Application withdrawn (${REASON_LABEL[wReason]})${note ? `: ${note}` : ''}.`, time: `${fmtShort(NOW)} · You` },
          ...prev,
        ]);
      }
      toast('Application withdrawn.');
      await refresh();
      void loadPayment();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not withdraw the application.', 'error');
    } finally {
      setWithdrawBusy(false);
    }
  };


  const doDownloadDeed = async () => {
    if (!SUPABASE_ENABLED) return;
    const r = await deedDownloadUrl(d.ref);
    if (r.ok && r.url) window.open(r.url, '_blank', 'noopener');
    else toast(r.error || 'Could not open the deed.', 'error');
  };

  // #105 Withdrawn/Expired are terminal pre-payment exits: only Sent was reached,
  // and the timeline must render the termination, never a false Paid/Deed tick.
  const timelineTerminated = d.status === 'withdrawn' || d.status === 'expired';
  const reached = timelineTerminated ? 1 : d.status === 'referencing' ? 0 : d.status === 'sent' ? 1 : d.status === 'paid' ? 2 : 3;
  // Third-node caption: on completion it states the outcome; while awaiting it
  // surfaces the deed's signing journey (sent / viewed / not yet viewed). The
  // three milestones themselves are unchanged.
  let deedDate = d.deedStr || 'Awaiting deed';
  let deedNote = d.deedStr ? 'Guarantee deed issued and stored' : 'Deed not yet issued';
  /* =====================================================================
     A CLOSED REFERRAL IS NOT WAITING FOR ANYTHING.

     Matt, 2026-10-03: "Withdrawn application page: the timeline shows 'Deed
     Issued: Awaiting deed' ... For withdrawn (and expired) applications show
     'Not issued: application withdrawn' instead, and no rent to be
     guaranteed."

     "Awaiting deed" IS A PROMISE, and on a withdrawn referral it is a promise
     nobody is keeping: the deed is never coming, the timeline already draws
     the termination (`timelineTerminated` caps `reached` at 1), and the one
     node that had not been told was the caption on the end of it.

     BEFORE THE OTHER ARMS, because they are about a deed in progress and
     this is about there not being one. */
  if (timelineTerminated) {
    deedDate = 'Not issued';
    deedNote = d.status === 'expired'
      ? 'Not issued: application expired'
      : 'Not issued: application withdrawn';
  } else if (d.status === 'deed') {
    deedNote = 'Signed by tenant and issued';
  } else if (paymentInfo?.deedState === 'awaiting_tenant') {
    deedDate = 'Awaiting signature';
    deedNote = paymentInfo.deedViewedAt
      ? `Awaiting tenant signature · viewed ${fmtStamp(new Date(paymentInfo.deedViewedAt))}`
      : `Sent ${paymentInfo.deedSentAt ? fmtStamp(new Date(paymentInfo.deedSentAt)) : ''}, not yet viewed`;
  }
  /* THE FEE, NOT THE RENT.
     Three surfaces on this page print one amount under the words "guarantor
     fee", and all three printed the RENT. The rent is the property's: it is one
     month's rent only at standard terms, 3 and 5 week bases exist, and on a
     joint tenancy every sibling carries the WHOLE tenancy rent in `rent` while
     paying a share of the fee. A two-person £3,000 let therefore told both
     tenants they had paid £3,000 against a charge of half that each.

     paid_amount is the truth where it is there, but apply_stripe_payment is the
     only thing that ever writes it, so every seeded or manually settled row has
     none and fell through to the rent. The fallback is now the fee as
     snapshotted on the application (feeLabels puts feeGBP on the record), and
     only then the rent, for an old record with no fee stored at all.

     AND IT IS NOT COMMISSION, so it is not behind the commission flag. This is
     the price the TENANT paid for the product, on a referral the Manager owns and
     answers the phone about; what the agency earns out of it is a different
     number and is not on this page. Every surface below that prints this label
     (the timeline's Paid caption, the payment card's Amount row, the agent
     rail's guarantee-fee stage) is a Manager's to see. */
  /* TO THE PENNY, ALWAYS. Matt, 2026-10-01: "money always shows two decimal
     places (£34,545.60, not £34,545.6), everywhere." toLocaleString drops a
     trailing zero, so a fee of £34,545.60 printed as £34,545.6 and read as a
     different number from the one on the statement beside it. gbpPence is
     the formatter every reconcilable figure already goes through. */
  const paidAmountLabel = paymentInfo?.paidAmount != null
    ? gbpPence(paymentInfo.paidAmount)
    : d.feeGBP ?? d.rent;
  const feeBasisSuffix = d.feeBasisLabel ? ` · ${d.feeBasisLabel}` : '';
  // #105 On a terminal pre-payment exit the second node shows the termination
  // (greyed via the timeline's 'terminated' state), not "Awaiting payment".
  const paidStep = timelineTerminated
    ? { label: 'Paid', date: d.status === 'withdrawn' ? 'Withdrawn' : 'Expired', note: d.status === 'withdrawn' ? 'Withdrawn before payment' : 'Expired, unpaid after 15 days' }
    : { label: 'Paid', date: d.paidStr || 'Awaiting payment', note: d.paidStr ? `Guarantee fee paid · ${paidAmountLabel}${feeBasisSuffix}` : 'Guarantee fee not yet paid' };
  const steps = [
    { label: 'Sent', date: d.sentStr, note: `Referral sent to tenant by ${d.referrer}` },
    paidStep,
    { label: 'Deed Issued', date: deedDate, note: deedNote },
  ];

  // Agent rail (opndoor_referenced): the nine-stage journey replaces the
  // three-stage view. The supplier rail keeps the steps/reached computed above,
  // exactly as before.
  const agentRail = d.referencingMode === 'opndoor_referenced';
  // The guarantee fee stage carries the amount and the basis it was charged on,
  // both already on this page. No amount reaches the agent that was not already
  // here. (The application fee shows no amount, only its paid date.) The stage
  // used to append the words "one month's rent" itself; it now takes the row's
  // own basis from here, because only the record knows it.
  const guaranteeFee = d.feeGBP || d.rentNum > 0 ? paidAmountLabel : '';
  const jview = agentRail && journey
    ? buildAgentJourney(
        journey,
        (iso) => (iso ? formatLondonDate(new Date(iso)) : ''),
        { guarantee: guaranteeFee, basis: d.feeBasisLabel },
      )
    : null;
  // Threaded layout is only possible once the journey has loaded. Until then (or
  // if the journey RPC returns nothing) an agent-rail app falls back to the
  // payment and deed cards, so nothing is ever missing.
  const threaded = agentRail && jview != null;
  const timelineSteps = jview ? jview.steps : steps;
  const timelineReached = jview ? jview.reached : reached;
  const timelineTerm = jview ? jview.terminated : timelineTerminated;
  const timelineInProgress = jview ? jview.currentInProgress : false;

  const isDeed = d.status === 'deed';
  const deedName = `Guarantee_Deed_${d.ref}${deedVersion > 1 ? `_v${deedVersion}` : ''}.pdf`;
  const deedMeta = deedVersion > 1 ? `PDF · 248 KB · reissued ${fmtShort(NOW)}` : `PDF · 248 KB · issued ${d.issue}`;
  const gsumIssue = isDeed ? amendedDates?.issue ?? d.issue : 'Pending';
  const gsumExpiry = isDeed ? amendedDates?.expiry ?? d.expiry : 'Pending';
  /* AND THE CARD SAYS THE SAME THING. "Reserved, confirmed once the deed is
     issued" on a withdrawn referral reserves something against a deed that
     will never be issued. Matt's own sentence, for both terminal states. */
  const gsumNote = isDeed
    ? 'Auto-assigned by the system'
    : timelineTerminated
      ? (d.status === 'expired' ? 'Not issued: application expired' : 'Not issued: application withdrawn')
      : 'Reserved · confirmed once the deed is issued';

  // ---- Activity feed ----
  // Real mode: one canonical feed sourced solely from the activity_log, with a
  // real timestamp on every row, audience-filtered (raw technical failures are
  // opndoor-admin-only), one label per event type, one format (dd/mm/yyyy · HH:mm),
  // strictly chronological. The status timeline strip above is separate and stays.
  // Mock/demo mode: the deterministic timeline-derived feed, unchanged.
  const isAdmin = role === 'superadmin';
  let activity: Activity[];
  if (SUPABASE_ENABLED && paymentInfo) {
    const log = paymentInfo.log;
    const visible = isAdmin ? log : log.filter((l) => l.visibility !== 'internal');
    const rows = visible.map((l) => ({
      at: new Date(l.at),
      color: feedColor(l.kind),
      text: (isAdmin ? l.message : BUSINESS_LABEL[l.kind] ?? l.message) as React.ReactNode,
      actor: l.actor ?? 'System',
    }));
    // Partner-safe soft entry when the deed is currently stuck (raw error hidden).
    if (!isAdmin && paymentInfo.deedState === 'error') {
      const lastErr = log.find((l) => l.visibility === 'internal'); // log is newest-first
      rows.push({
        at: lastErr ? new Date(lastErr.at) : new Date(),
        color: 'var(--warn, #c77d0a)',
        text: 'Deed delivery delayed, opndoor has been notified',
        actor: 'System',
      });
    }
    rows.sort((a, b) => b.at.getTime() - a.at.getTime());
    activity = [...extraActivity, ...rows.map((r) => ({ color: r.color, text: r.text, time: `${fmtStamp(r.at)} · ${r.actor}` }))];
  } else {
    const baseActivity: Activity[] = [];
    if (d.deedStr) baseActivity.push({ color: 'var(--deed)', text: 'Deed issued and stored against the record', time: `${d.deedStr} · System` });
    if (d.paidStr) baseActivity.push({ color: 'var(--paid)', text: 'Guarantee fee paid by tenant', time: `${d.paidStr} · System` });
    baseActivity.push({ color: 'var(--sent)', text: 'Application sent to tenant', time: `${d.sentStr} · ${d.referrer}` });
    activity = [...extraActivity, ...baseActivity];
  }

  // ---- payment display (Stripe, real mode) ----
  const pi = paymentInfo;
  // ---- #2/#13 terminal (withdrawn / expired) state — single source of truth is
  // d.status, which the memo recomputes after refresh() (no optimistic shadow). ----
  const owned = d.owner === 1;
  const isWithdrawn = d.status === 'withdrawn';
  const isExpired = d.status === 'expired';
  const isTerminal = isWithdrawn || isExpired;
  const withdrawnReason = d.withdrawnReason;
  // A withdrawn/expired application collects no payment: neither Paid nor Awaiting.
  const payWithdrawn = pi?.status === 'withdrawn' || pi?.status === 'expired' || isTerminal;
  // DEFECTS.md 8. A Stripe payment intent on a WITHDRAWN application means money
  // was taken after the withdrawal: apply_stripe_payment writes the intent on
  // that branch but deliberately leaves status and payment_state alone. So the
  // combination is the signal, and it cannot occur any other way.
  //
  // Expired is excluded: a late payment there reinstates to paid by design, which
  // is not an anomaly.
  const paymentAnomaly = pi?.status === 'withdrawn'
    && !!pi?.paymentRef
    && pi?.paymentState !== 'paid'
    && pi?.paymentState !== 'refunded';
  const payRefunded = pi?.paymentState === 'refunded';
  const payPaid = !!pi && !payRefunded && !payWithdrawn && (pi.paymentState === 'paid' || (pi.status !== 'sent' && pi.status !== 'withdrawn' && pi.status !== 'expired'));
  const payAwaiting = !!pi && !payPaid && !payRefunded && !payWithdrawn;
  // #94 The card status line must tier like the feed: non-admins never see the
  // internal "Redirected to ... (test mode)" row (filtered here), and the business
  // message (which names the actor) is rendered as its partner-safe label below.
  const lastEmailLog = (isAdmin ? pi?.log : pi?.log?.filter((l) => l.visibility !== 'internal'))?.find((l) => l.kind.startsWith('payment_email'));

  // Withdraw is offered only at Sent, before payment, to the owner / management / admin.
  const showWithdraw = canWithdraw(role, d.status, owned) && !isTerminal;
  const pillVariant: PillVariant = d.status === 'withdrawn' || d.status === 'expired' || d.status === 'draft' ? 'muted' : d.status === 'referencing' ? 'warn' : d.status === 'declined' ? 'danger' : d.status;
  const statusLabel = d.statusLabel;

  // ---- direct-tenant delivery contact + inline match ----
  const isDirect = d.channel === 'Direct';
  // The agencies offered in the inline match: the exact-name auto match first,
  // then the fuzzy candidates as hints (their similarity shown, never auto-accepted).
  const matchAgencyOptions = matchRow
    ? [
        ...(matchRow.autoAgencyId ? [{ id: matchRow.autoAgencyId, name: matchRow.autoAgencyName ?? 'Suggested agency' }] : []),
        ...matchRow.candidates
          .filter((c) => c.agency_id !== matchRow.autoAgencyId)
          .map((c) => ({ id: c.agency_id, name: `${c.name} · ${Math.round(c.sim * 100)}% match` })),
      ]
    : [];

  // ---- amend permission + context ----
  const PAYMENT = d.paymentDate;
  // Before payment (Sent) amending just corrects data; after payment it reissues the deed.
  const reissues = d.status !== 'sent';
  // #82 Amending a SIGNED (executed) deed is destructive: void + reissue + agent
  // re-notification. It needs an explicit consequence confirmation before saving.
  const executed = d.status === 'deed' || paymentInfo?.deedState === 'executed';
  // Who may amend: Sent -> any viewing role (Referrer only their own); Paid/Deed -> Management + opndoor admin.
  // A withdrawn or expired application is terminal: no amend (or other action) offered.
  const canAmend = !isTerminal && canAmendTenancyStart(role, d.status, owned, paymentInfo?.deedState ?? null);

  // ---- amend validation ----
  // Any valid calendar date is allowed. We only require a real dd/mm/yyyy date
  // that differs from the current start; there is no payment-window restriction.


  //our code update
  const parsed = parseInput(amendInput);
  let amendTone: 'ok' | 'err' | 'neutral' = 'err';
  let amendText = 'Enter a valid date as dd/mm/yyyy';
  let canSave = false;
  if (!amendInput.trim()) {
    amendTone = 'err';
    amendText = 'Enter a valid date as dd/mm/yyyy';
  } else if (parsed) {
    if (parsed.getTime() === currentStart.getTime()) {
      amendTone = 'neutral';
      amendText = 'This is the current start date';
    } else if (!isTenancyStartInAllowedRange(parsed)) {
      amendTone = 'err';
      amendText = 'Date must be within 7 days in the past and 2 years in the future';
    } else {
      amendTone = 'ok';
      amendText = executed
        ? 'Valid. The signed deed will be voided and a corrected deed reissued to the tenant to sign.'
        : reissues ? 'Valid. A new deed will be issued with this date.' : 'Valid. The tenancy start date will be updated.';
      canSave = true;
    }
  }

  //Old code
  // const parsed = parseInput(amendInput);
  // let amendTone: 'ok' | 'err' | 'neutral' = 'err';
  // let amendText = 'Enter a valid date as dd/mm/yyyy';
  // let canSave = false;
  // if (parsed) {
  //   if (parsed.getTime() === currentStart.getTime()) {
  //     amendTone = 'neutral';
  //     amendText = 'This is the current start date';
  //   }
  //   //our code updated
  //   else if (!isTenancyStartInAllowedRange(parsed)) {
  //     amendTone = 'err';
  //     amendText = 'Date must be within 7 days in the past and 2 years in the future';
  //   }  
  //   else {
  //     amendTone = 'ok';
  //     amendText = executed
  //       ? 'Valid. The signed deed will be voided and a corrected deed reissued to the tenant to sign.'
  //       : reissues ? 'Valid. A new deed will be issued with this date.' : 'Valid. The tenancy start date will be updated.';
  //     canSave = true;
  //   }
  // }

  function openAmend() {
    setAmendInput(fmtInput(currentStart));
    setAmendOpen(true);
  }



  //our code update
 async function saveAmend(confirmReissue = false) {
    const parsedDate = parseInput(amendInput);
    /* AN EMPTY BOX AND A WRONG DATE ARE NOT THE SAME COMPLAINT, and the one
       sentence answered both: somebody who had typed nothing was told about a
       seven-day window they had not been anywhere near. */
    if (!amendInput.trim()) { toast('Enter the new tenancy start date.'); return; }
    if (!parsedDate) { toast('That is not a date we can read. Use dd/mm/yyyy.'); return; }
    if (parsedDate.getTime() === currentStart.getTime()) {
      toast('That is already the tenancy start date.');
      return;
    }
    if (!isTenancyStartInAllowedRange(parsedDate)) {
      toast('Enter a tenancy start date within 7 days in the past and 2 years in the future.');
      return;
    }
    // #82 On a signed deed, require the explicit consequence confirmation first.
    if (executed && !confirmReissue) { setConfirmReissueOpen(true); return; }
    let serverMsg: string | undefined;
    try {
      serverMsg = await amendTenancyStartDb(d.ref, parsedDate, confirmReissue);
    } catch (err) {
      // Defence in depth: if the server still asks for confirmation, prompt for it.
      if (err && typeof err === 'object' && (err as { needsConfirm?: boolean }).needsConfirm) { setConfirmReissueOpen(true); return; }
      toast(err instanceof Error ? err.message : 'Could not amend the tenancy start date.', 'error');
      return;
    }
    setConfirmReissueOpen(false);
    const result = amendTenancyStart(d.status, parsedDate);
    setCurrentStart(parsedDate);
    if (result.reissued) {
      setDeedVersion((v) => v + 1);
      if (isDeed && result.issue && result.expiry) setAmendedDates({ issue: fmtShort(result.issue), expiry: fmtShort(result.expiry) });
    }
    // Mock/demo mode only: an optimistic feed entry. In live mode the activity
    // feed is sourced solely from the server activity_log (one entry per amend,
    // written by the Edge Function) and refreshed by loadPayment below, so a
    // client-side entry here would double-log and could claim a phantom reissue.
    if (!SUPABASE_ENABLED) {
      const who = role === 'superadmin' ? 'opndoor' : role === 'management' ? 'Management' : 'Referrer'; // #112
      setExtraActivity((prev) => [
        {
          color: 'var(--heliotrope)',
          text: result.reissued ? <>Tenancy start amended to <b>{fmtLong(parsedDate)}</b>; deed reissued</> : <>Tenancy start amended to <b>{fmtLong(parsedDate)}</b></>,
          time: `${fmtShort(NOW)} · ${who}`,
        },
        ...prev,
      ]);
    }
    setAmendOpen(false);
    // The Edge Function's summary reflects what actually happened to the deed
    // (voided+regenerated, or archived+replaced); prefer it in live mode.
    if (serverMsg) toast(serverMsg);
    else toast(result.reissued ? `Tenancy start updated to ${fmtLong(parsedDate)}. New deed of guarantee issued.` : `Tenancy start updated to ${fmtLong(parsedDate)}.`);
    void loadPayment();
  }



  //old code

  // async function saveAmend(confirmReissue = false) {
  //   if (!parsed || !canSave) return;
  //   // #82 On a signed deed, require the explicit consequence confirmation first.
  //   if (executed && !confirmReissue) { setConfirmReissueOpen(true); return; }
  //   let serverMsg: string | undefined;
  //   try {
  //     serverMsg = await amendTenancyStartDb(d.ref, parsed, confirmReissue);
  //   } catch (err) {
  //     // Defence in depth: if the server still asks for confirmation, prompt for it.
  //     if (err && typeof err === 'object' && (err as { needsConfirm?: boolean }).needsConfirm) { setConfirmReissueOpen(true); return; }
  //     toast(err instanceof Error ? err.message : 'Could not amend the tenancy start date.', 'error');
  //     return;
  //   }
  //   setConfirmReissueOpen(false);
  //   const result = amendTenancyStart(d.status, parsed);
  //   setCurrentStart(parsed);
  //   if (result.reissued) {
  //     setDeedVersion((v) => v + 1);
  //     if (isDeed && result.issue && result.expiry) setAmendedDates({ issue: fmtShort(result.issue), expiry: fmtShort(result.expiry) });
  //   }
  //   // Mock/demo mode only: an optimistic feed entry. In live mode the activity
  //   // feed is sourced solely from the server activity_log (one entry per amend,
  //   // written by the Edge Function) and refreshed by loadPayment below, so a
  //   // client-side entry here would double-log and could claim a phantom reissue.
  //   if (!SUPABASE_ENABLED) {
  //     const who = role === 'superadmin' ? 'opndoor' : role === 'management' ? 'Management' : 'Referrer'; // #112
  //     setExtraActivity((prev) => [
  //       {
  //         color: 'var(--heliotrope)',
  //         text: result.reissued ? <>Tenancy start amended to <b>{fmtLong(parsed)}</b>; deed reissued</> : <>Tenancy start amended to <b>{fmtLong(parsed)}</b></>,
  //         time: `${fmtShort(NOW)} · ${who}`,
  //       },
  //       ...prev,
  //     ]);
  //   }
  //   setAmendOpen(false);
  //   // The Edge Function's summary reflects what actually happened to the deed
  //   // (voided+regenerated, or archived+replaced); prefer it in live mode.
  //   if (serverMsg) toast(serverMsg);
  //   else toast(result.reissued ? `Tenancy start updated to ${fmtLong(parsed)}. New deed of guarantee issued.` : `Tenancy start updated to ${fmtLong(parsed)}.`);
  //   void loadPayment();
  // }

  // ---- send deed to agent ----
  // Resolve the branch's effective contacts (agency default when the branch has none).
  // IN THIS RECORD'S OWN ESTATE. Two estates may hold the same company, and
  // the deed goes to the contact in the one the referral came through.
  const resolved = contactForApplication(d.agency, d.branch, d.partner);
  const eff = effectiveContacts(resolved.agency, resolved.branch);
  const sendSrc = eff.inherited ? `agency default for ${d.agency}` : `${d.branch} branch`;
  const isReferrer = role === 'referrer';
  // Who may send the issued deed: Referrers only on their own; Management + opndoor admin on any in scope.
  const canSend = canSendDeed(role, d.owner === 1);

  /* WHO MAY RUN THE DEED RECOVERY. Directors and Managers, who are both
     'management', plus opndoor's own staff. Not a Negotiator: they see their own
     referrals and are not the person who chases a missing deed for the agency.
     The database refuses either way, through the same RLS-scoped read
     pandadoc-resend does; this is about not offering a control that is not
     theirs. */
  const mayRunDeedRecovery = role === 'management' || role === 'superadmin' || role === 'opndoor_manager';
  // Referrers are send-only: they can only send when a recipient is already resolved.
  const sendDisabled = isReferrer && !resolved.contact;

  function openSend() {
    setSendSel(eff.list.length ? '0' : 'other');
    setSoName('');
    setSoRole('');
    setSoEmail('');
    setSoSave(false);
    setSendOpen(true);
  }

  async function confirmSend() {
    let c: { name: string; email: string; role: string } | null = null;
    if (isReferrer) {
      // Referrers send only to the resolved recipient: no one-off address, no saving.
      if (resolved.contact) c = { name: resolved.contact.name, email: resolved.contact.email, role: resolved.contact.role };
    } else if (sendSel === 'other') {
      const name = soName.trim();
      const email = soEmail.trim();
      if (!name || !email) return;
      c = { name, email, role: soRole.trim() };
      if (soSave) {
        // save to the branch if it exists in the store, otherwise the agency (matches the prototype)
        const branchName = resolved.branch ? d.branch : null;
        addContact(d.agency, branchName, { name, email, phone: '', role: c.role, primary: false });
      }
    } else {
      const picked = eff.list[+sendSel];
      if (picked) c = { name: picked.name, email: picked.email, role: picked.role };
    }
    if (!c) return;
    setSendBusy(true);
    try {
      // The database re-checks canSendDeed; Referrers may only send to the resolved contact.
      if (isReferrer) await sendDeedToAgent(d.ref);
      else await sendDeedToAgent(d.ref, c.email, sendSel === 'other' ? soSave : false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not send the deed.', 'error');
      return;
    } finally {
      setSendBusy(false);
    }
    const who = role === 'superadmin' ? 'opndoor' : role === 'management' ? 'Management' : 'Referrer'; // #112
    setExtraActivity((prev) => [
      { color: 'var(--heliotrope)', text: <>Deed of Guarantee sent to <b>{c!.name}</b> ({c!.email})</>, time: `${SUPABASE_ENABLED ? fmtStamp(new Date()) : fmtShort(NOW)} · ${who}` },
      ...prev,
    ]);
    setSendOpen(false);
    toast(`Deed of Guarantee sent to ${c.name} at ${c.email}.`);
  }

  function openLandlord() {
    // Prefill from the last landlord we sent to, so a resend needs no retyping.
    setLlName(d.landlordName ?? '');
    setLlEmail(d.landlordEmail ?? '');
    setLlNote(`Please find attached the signed Deed of Guarantee for ${d.name}.`);
    setLandlordOpen(true);
  }

  async function confirmLandlord() {
    const name = llName.trim();
    const email = llEmail.trim();
    if (!name || !email) return;
    setLlBusy(true);
    try {
      await sendDeedToLandlord(d.ref, name, email, llNote.trim());
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not send the deed.', 'error');
      return;
    } finally {
      setLlBusy(false);
    }
    const who = role === 'management' ? 'Management' : 'Referrer';
    setExtraActivity((prev) => [
      { color: 'var(--heliotrope)', text: <>Deed of Guarantee sent to <b>{name}</b> ({email})</>, time: `${SUPABASE_ENABLED ? fmtStamp(new Date()) : fmtShort(NOW)} · ${who}` },
      ...prev,
    ]);
    setLandlordOpen(false);
    toast(`Deed of Guarantee sent to ${name} at ${email}.`);
  }

  // Honest not-found: the reference does not exist or is not accessible to this
  // viewer (RLS returned nothing). Never substitute another of their records.
  if (d.notFound) {
    return (
      <>
        <div className="backbar">
          <Link to="/applications"><Icon name="arrowLeft" /> All applications</Link>
        </div>
        <div className="notfound">
          <span className="notfound__ic"><Icon name="alert" strokeWidth={2} /></span>
          <h1 className="notfound__title">Application not found</h1>
          <p className="notfound__sub">
            {ref ? <>We couldn&rsquo;t find <b>{ref}</b>, or it isn&rsquo;t part of your portfolio.</> : <>No application reference was given.</>}
          </p>
          <Button to="/applications" variant="primary"><Icon name="arrowLeft" /> Back to applications</Button>
        </div>
      </>
    );
  }

  // The payment and deed blocks are extracted so they can render either as their
  // own right-rail cards (supplier rail) or threaded into the agent-rail journey
  // as the guarantee-fee (stage 8) and deed (stage 9) stages. Same JSX, same
  // behaviour, two placements.
  const paymentBadge = !isOpndoorStaff(role)
    ? null
    : stripeMode() === 'test'
      ? <span className="pay-badge pay-badge--test">Test mode</span>
      : stripeMode() === 'live'
        ? <span className="pay-badge">Live mode</span>
        : null;
  const deedBadge = SUPABASE_ENABLED && pandadocSandbox() ? <span className="pay-badge">Sandbox</span> : null;

  const paymentBody = (
    <>
      {paymentAnomaly && (
        <div className="pay-anomaly">
          <strong>A payment was taken on this withdrawn application.</strong>
          <p>
            The tenant was charged after it was withdrawn, so no guarantee was issued and no
            deed exists. <strong>This needs refunding in Stripe.</strong> Nothing refunds it
            automatically.
          </p>
          <p className="soft">
            Payment intent <code>{pi?.paymentRef}</code>. The tenant may have been shown a
            confirmation page at the time.
          </p>
        </div>
      )}
      {payWithdrawn && !paymentAnomaly && (
        <>
          <div className="pay-state pay-state--refunded"><span className="pay-dot" />{isExpired ? 'Expired' : 'Withdrawn'}</div>
          <div className="pay-note">{isExpired
            ? 'This application expired before payment, so no guarantee fee was collected. A late payment automatically reinstates it to Paid.'
            : 'This application was withdrawn before payment, so no guarantee fee was collected. It still counts as a referral sent, and receives no payment reminders.'}</div>
        </>
      )}
      {payPaid && (
        <>
          <div className="pay-state pay-state--paid"><span className="pay-dot" />Paid</div>
          {/* "27 Sep 2026", like every other date on the page. fmtInput is
              the dd/mm/yyyy an <input type="date"> parses back, which is
              what the amend form needs and is not a date to read. */}
          <div className="drow"><span className="drow__k">Paid on</span><span className="drow__v">{pi?.paidAt ? formatDate(pi.paidAt) : '-'}</span></div>
          {/* The FEE. paid_amount where Stripe wrote one, else the fee snapshotted
              on the application, never the rent. See paidAmountLabel above. */}
          <div className="drow"><span className="drow__k">Amount</span><span className="drow__v"><b>{paidAmountLabel}</b>{d.feeBasisLabel ? ` · ${d.feeBasisLabel}` : ''}</span></div>
          {/* OPNDOOR'S OWN PLUMBING. Matt, 2026-10-01: "Hide the Stripe
              reference and the Test mode label from agency and supplier
              users." The reference is the key to a record in an account
              they have no login for, and the mode label is a fact about
              our configuration, not about their referral. */}
          {isOpndoorStaff(role) && (
            <div className="drow"><span className="drow__k">Stripe reference</span><span className="drow__v pay-mono">{pi?.paymentRef ?? 'Seeded test record'}</span></div>
          )}
          {pi?.paymentRef == null && (
            // The parenthetical used to read "(one month's rent)" whatever the
            // basis was. The row states its own basis above, so this just names
            // where the figure came from.
            <div className="pay-note">Seeded/test record: no Stripe payment reference. The amount shown is the guarantee fee recorded against the application.</div>
          )}
        </>
      )}
      {payRefunded && (
        <>
          <div className="pay-state pay-state--refunded"><span className="pay-dot" />Refunded</div>
          {pi?.refundAfterStart && (
            <div className="pay-anomaly">
              <Icon name="alert" strokeWidth={2.2} />
              <span><b>Refunded after tenancy start, outside refund policy.</b> Review required. Recorded truthfully; nothing was reversed automatically.</span>
            </div>
          )}
          <div className="drow"><span className="drow__k">Refunded on</span><span className="drow__v">{pi?.refundedAt ? fmtInput(new Date(pi.refundedAt)) : '-'}</span></div>
          <div className="drow"><span className="drow__k">Refund reference</span><span className="drow__v pay-mono">{pi?.refundRef ?? '-'}</span></div>
          {/* THE ONE MENTION OF COMMISSION ON THIS PAGE, and it is not a
              commission surface: it names no figure and none can be worked out
              from it, it says a refund earns nobody anything, and a Negotiator
              (who sees no commission anywhere) has always read this line. Gating
              it would take the second sentence away too, which is the only thing
              on the card that explains why a refunded record still says Paid. */}
          <div className="pay-note">No commission or premium accrues on a refunded fee. The Sent to Paid transition is not reversed (by design).</div>
        </>
      )}
      {payAwaiting && (
        <>
          <div className="pay-state pay-state--awaiting"><span className="pay-dot" />Awaiting payment</div>
          {/* The FEE, which is one month's rent only at standard terms. */}
          <div className="drow"><span className="drow__k">Guarantee fee</span><span className="drow__v"><b>{d.feeGBP ?? d.rent}</b>{d.feeBasisLabel ? ` · ${d.feeBasisLabel}` : ''}</span></div>
          {pi?.paymentUrl && (
            <>
              <div className="pay-link">
                <input readOnly value={pi.paymentUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Payment link" />
                <Button variant="ghost" size="sm" onClick={copyLink}>{copied ? 'Copied' : 'Copy'}</Button>
              </div>
              <div style={{ marginTop: 10 }}>
                <Button variant="primary" size="sm" block onClick={doResend} disabled={resendBusy}><Icon name="mail" /> {resendBusy ? 'Sending…' : 'Resend payment email'}</Button>
              </div>
            </>
          )}
          {lastEmailLog && (
            <div className={`pay-note${lastEmailLog.kind === 'payment_email_failed' ? ' pay-note--warn' : ''}`}>
              {lastEmailLog.kind === 'payment_email_failed' && !isAdmin
                ? 'Payment email could not be sent. Use the copy link above to share it with the tenant; opndoor has been notified.'
                : isAdmin ? lastEmailLog.message : (BUSINESS_LABEL[lastEmailLog.kind] ?? lastEmailLog.message)}
            </div>
          )}
        </>
      )}
    </>
  );

  const deedBody = (
    isDeed ? (
      <>
        {/* Stacked, not a flex row: the filename gets its own line and the size
            and issue date sit beneath it in muted text, so it does not squash
            into one line in the narrow right rail. The action sits below. */}
        <div className="deed-file">
          <div className="deed-file__name">{deedName}</div>
          <div className="deed-file__meta">{deedMeta}</div>
        </div>
        <div style={{ marginTop: 12 }}>
          <Button variant="primary" block onClick={doDownloadDeed}><Icon name="download" /> Download deed</Button>
        </div>
        {canSend && (
          <div style={{ marginTop: 10 }}>
            {/* Agency staff are the agent, so they send to their client, the
                landlord. Opndoor staff keep the send-to-agent path. */}
            {isAdmin
              ? <Button variant="ghost" block onClick={openSend}><Icon name="send" /> Send deed to agent</Button>
              : <Button variant="ghost" block onClick={openLandlord}><Icon name="send" /> Send deed to landlord</Button>}
          </div>
        )}
      </>
    /* `pi.deedState` USED TO BE REQUIRED HERE, and that is why GR-20763 showed
       Rosa nothing at all. It paid on 20 September with deed_state null, because
       generation was never ATTEMPTED rather than having failed, so this whole
       branch was skipped and the reader got the bottom fallback: "Deed sent for
       signature shortly after payment", eight days after payment, with no control
       and nothing coming. Null deed_state is the state this card most needs to
       speak to, not the one it should fall silent on. deedIsOverdue decides which
       of the two true things to say. */
    ) : SUPABASE_ENABLED && pi && d.status === 'paid' && (pi.deedState || deedIsOverdue(pi)) ? (
      pi.deedState === 'awaiting_tenant' ? (
        <>
          <div className="deed" style={{ opacity: 0.95 }}>
            <span className="deed__ic" style={{ color: 'var(--sent)' }}><Icon name="clock" strokeWidth={1.8} /></span>
            <div className="grow">
              <div className="deed__t">Deed sent for signature, awaiting tenant</div>
              <div className="deed__s">The tenant's signing journey so far</div>
            </div>
          </div>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--sent)', flex: '0 0 auto' }} />
              <span style={{ fontWeight: 600 }}>Sent</span>
              <span style={{ marginLeft: 'auto', color: 'var(--ink-mute)' }}>{pi.deedSentAt ? fmtStamp(new Date(pi.deedSentAt)) : '-'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: pi.deedViewedAt ? 'var(--paid)' : 'rgba(39,29,95,0.18)', flex: '0 0 auto' }} />
              <span style={{ fontWeight: 600, color: pi.deedViewedAt ? undefined : 'var(--ink-mute)' }}>{pi.deedViewedAt ? 'Viewed by tenant' : 'Not yet viewed'}</span>
              {pi.deedViewedAt && <span style={{ marginLeft: 'auto', color: 'var(--ink-mute)' }}>{fmtStamp(new Date(pi.deedViewedAt))}</span>}
            </div>
          </div>
          {pi.paymentState !== 'refunded' && (
            <div style={{ marginTop: 12 }}>
              <Button variant="primary" size="sm" block onClick={doResendDeed} disabled={deedBusy}><Icon name="send" /> {deedBusy ? 'Sending…' : 'Resend signature request'}</Button>
            </div>
          )}
        </>
      ) : (
        /* WHAT THIS CARD SAYS WHEN THERE IS NO DEED YET, and it used to say one
           thing for three different situations.

           The condition was `deedState !== 'awaiting_tenant'`, a catch-all, and the
           copy under it asserted a generation FAILURE with a supplier-rail remedy:
           "Check the branch has an agent contact, then retry." Seen on GR-20846
           during the walk, where the deed had generated at 16:45, been signed, and
           delivered. Two things were wrong.

           First, the card reads a SNAPSHOT. loadPayment runs once on mount and only
           re-polls behind ?paid=1, so a page opened before the deed existed keeps
           showing the state it loaded with until somebody reloads. The remedy is
           not to guess from a stale field but to say only what the field supports.

           Second, "no deed yet" is not "generation failed". A paid application with
           no document and no error is simply being prepared, which is the common
           case in the seconds after payment, and it now says so instead of alleging
           a fault and offering a retry for something that is already in hand.

           And the agent-contact wording is gone for an agency user. On our own
           estate the recipient comes from the agency's own active people, not from
           an "agent contact" on a branch, so it named a thing their screens do not
           have and a remedy they could not carry out. */
        <>
          {(() => {
            const card = deedCardState(pi);
            const st = pi.deedState;
            if (card === 'preparing') {
              /* TWO TRUE THINGS, AND THE CLOCK DECIDES WHICH. Inside the window
                 the deed really is in flight and there is nothing to do. Past it
                 nothing is coming on its own until the hourly sweep, so saying
                 "being prepared" is the card asserting a process that is not
                 running. It says what it knows and offers the button instead. */
              if (deedIsOverdue(pi)) {
                return (
                  <div className="pay-anomaly">
                    <Icon name="alert" strokeWidth={2.2} />
                    <span>{agencyViewer
                      ? 'This deed has not been issued yet. Generate it below, or leave it and opndoor will pick it up.'
                      : 'Paid, but no deed has been issued. Generate it below; if that fails the reason is recorded on the application.'}</span>
                  </div>
                );
              }
              // Paid, no live document, nothing wrong: it is being prepared.
              return (
                <div className="deed" style={{ opacity: 0.95 }}>
                  <span className="deed__ic" style={{ color: 'var(--sent)' }}><Icon name="clock" strokeWidth={1.8} /></span>
                  <div className="grow">
                    <div className="deed__t">Deed being prepared</div>
                    <div className="deed__s">It is issued automatically and sent to the tenant to sign. Reload to see the latest.</div>
                  </div>
                </div>
              );
            }
            return (
              <div className="pay-anomaly">
                <Icon name="alert" strokeWidth={2.2} />
                <span>{st === 'declined'
                  ? 'Tenant declined to sign the deed. Review required.'
                  : st === 'voided'
                    ? 'Deed document voided in PandaDoc. Review required.'
                    : agencyViewer
                      ? 'This deed could not be issued. Opndoor has been notified and will sort it out.'
                      : 'Deed could not be generated. Check the branch has a deliverable contact, then retry.'}</span>
              </div>
            );
          })()}
          {/* GENERATE IS OFFERED ONLY WHERE IT CAN DO SOMETHING.
              It calls pandadoc-resend, whose generate branch runs generateDeed,
              which claims through claim_tenancy_deed. That RPC refuses when a
              document id is already present, so with a live document the button was
              an offer the database declines: nothing happens and the reader learns
              nothing. It also cannot create a second PandaDoc document, which is
              the guard, but an inert button is still a lie about what is available.
              With a document present the honest control is Resend. */}
          {/* AND NOT WHILE IT IS STILL IN FLIGHT. Offering Generate in the seconds
              after payment invites exactly the double-press the lease exists to
              refuse, and the presser would be told "a deed is already being
              generated", which reads as a fault. Past the window there is nothing
              in flight, so the button is the honest control.

              Directors and Managers only. A Negotiator sees their own referrals
              and does not run the agency's recovery; deedActor keeps the rule in
              one place. Opndoor staff and supplier management keep what they had. */}
          {pi.paymentState !== 'refunded' && mayRunDeedRecovery && (!mayGenerateDeed(pi) || deedIsOverdue(pi)) && (
            <div style={{ marginTop: 10 }}>
              {!mayGenerateDeed(pi) ? (
                <Button variant="primary" size="sm" block onClick={doResendDeed} disabled={deedBusy}><Icon name="send" /> {deedBusy ? 'Sending…' : 'Resend signature request'}</Button>
              ) : (
                <Button variant="primary" size="sm" block onClick={doResendDeed} disabled={deedBusy}><Icon name="file" /> {deedBusy ? 'Working…' : 'Generate deed'}</Button>
              )}
            </div>
          )}
        </>
      )
    ) : (
      <div className="deed" style={{ opacity: 0.85 }}>
        <span className="deed__ic" style={{ color: 'var(--ink-mute)' }}><Icon name="clock" strokeWidth={1.8} /></span>
        <div className="grow">
          <div className="deed__t">Deed not yet issued</div>
          <div className="deed__s">
            {d.status === 'paid' ? 'Deed sent for signature shortly after payment' : 'Issued once the guarantee fee is paid'}
          </div>
        </div>
      </div>
    )
  );

  /* ---- DELIVERY: did the deed get there? ---------------------------------
     TWO STATES, TWO AUDIENCES, and they were one thing called "delivery failed"
     until deliveryState.ts split them:

       CANNOT DELIVER  nobody on the rail's ladder can receive it. Nothing was
                       sent and nothing errored; it parks for a staff send. There
                       is nothing the agency can do about it (they cannot add a
                       person to their own org), and telling them their deed
                       failed when it is sitting in our queue is alarming and
                       untrue. Admin-facing only, which maySeeDeliveryState is
                       the single rule for.
       DELIVERY FAILED a send was attempted and errored. There is an address it
                       went to and a reason it did not arrive. The agency sees
                       this one, because they are who is waiting and who presses
                       Resend.

     The panel only has something to say once there is a deed, or once an attempt
     has actually been recorded; before that it would repeat the deed card. */
  const dlvState = delivery?.state ?? 'not_attempted';
  const showDelivery = !!delivery
    && (isDeed || dlvState !== 'not_attempted')
    && (dlvState !== 'cannot_deliver' || maySeeDeliveryState(role, 'cannot_deliver'));
  const dlvStateLabel = dlvState === 'failed' ? 'Delivery failed'
    : dlvState === 'cannot_deliver' ? 'Held for send'
      : dlvState === 'delivered' ? 'Delivered' : 'Not sent yet';
  const dlvStateMod = dlvState === 'failed' ? 'failed'
    : dlvState === 'cannot_deliver' ? 'held'
      : dlvState === 'delivered' ? 'delivered' : 'waiting';
  // Where it WOULD go, for a state that has not been anywhere yet. Where it DID
  // go for the rest: the ladder can have changed since the attempt, so the two
  // are different questions and the panel must not answer one with the other.
  const dlvWouldGo = [delivery?.toName, delivery?.toEmail].filter(Boolean).join(' · ');

  const deliveryBody = delivery && (
    <>
      <div className={`pay-state pay-state--${dlvStateMod}`}><span className="pay-dot" />{dlvStateLabel}</div>
      {dlvState === 'failed' && (
        <>
          <div className="drow"><span className="drow__k">Sent to</span><span className="drow__v pay-mono">{delivery.attemptedTo ?? 'Not recorded'}</span></div>
          {delivery.attemptedSource && <div className="drow"><span className="drow__k">Address from</span><span className="drow__v">{rungLabel(delivery.attemptedSource)}</span></div>}
          <div className="drow"><span className="drow__k">Failed</span><span className="drow__v">{delivery.failedAt ? fmtStamp(new Date(delivery.failedAt)) : '-'}</span></div>
          <div className="drow"><span className="drow__k">Reason</span><span className="drow__v">{delivery.reason ?? 'No reason was recorded'}</span></div>
          <div className="pay-note pay-note--warn">The deed is issued and stored. Only the email failed, so resending is safe.</div>
        </>
      )}
      {dlvState === 'cannot_deliver' && (
        <>
          <div className="pay-note">Nobody active could receive this deed automatically, so it is queued for a staff send. Nothing was sent and nothing has failed.</div>
          <div className="drow"><span className="drow__k">Would go to</span><span className="drow__v">{dlvWouldGo || 'No recipient could be resolved'}</span></div>
          {delivery.source && <div className="drow"><span className="drow__k">Address from</span><span className="drow__v">{rungLabel(delivery.source)}</span></div>}
        </>
      )}
      {dlvState === 'delivered' && (
        <>
          {/* THE RECORD, NEVER TODAY'S ANSWER. Matt, 2026-09-30: "the
              Delivery panel must show where the deed was actually sent
              and when, from the send record, never who it would go to
              under today's rules."

              This read `attemptedTo ?? (dlvWouldGo || '-')`. The fallback
              is the defect: with nothing recorded it printed whoever the
              ladder resolves to NOW, under the label "Sent to". The two
              diverge the moment anybody changes a deed recipient, a
              primary contact or a branch after a deed went out, and then
              the panel confidently names somebody who never received it.
              Twelve lines above, the comment already said the two are
              different questions and the panel must not answer one with
              the other; the code did it anyway.

              Nothing recorded now says so. That is a worse-looking panel
              and a truer one, and it is rare: every send since
              20261005100000 writes the address down, and the three dev
              rows that predated it were recovered from the activity log
              by 20261007110000. */}
          {/* EVERYONE IT WENT TO, which is what the email addressed: the
              referrer and their copies get one message, so naming the
              first of four was a quarter of an answer. */}
          <div className="drow"><span className="drow__k">Sent to</span><span className="drow__v pay-mono">{delivery.deliveredTo ?? delivery.attemptedTo ?? 'Not recorded'}</span></div>
          {/* AND THE RUNG IS THE ATTEMPT'S, or nothing. `?? delivery.source`
              was the same substitution one line down: it would explain
              where today's address comes from beside an address from
              months ago. */}
          {delivery.attemptedSource && <div className="drow"><span className="drow__k">Address from</span><span className="drow__v">{rungLabel(delivery.attemptedSource)}</span></div>}
          {/* THE SIGNED-DEED EMAIL, NOT THE SIGNATURE REQUEST. Matt,
              2026-10-01: the panel "says the deed was sent at 16:45, before
              the tenant signed at 16:49". It was reading deed_sent_at,
              which is when the deed went to the TENANT to be signed, so it
              claimed a delivery four minutes before the signature. */}
          <div className="drow"><span className="drow__k">Sent</span><span className="drow__v">{delivery.deliveredAt ? fmtStamp(new Date(delivery.deliveredAt)) : '-'}</span></div>
          {delivery.resentAt && (
            <div className="drow"><span className="drow__k">Resent</span><span className="drow__v">{fmtStamp(new Date(delivery.resentAt))}</span></div>
          )}
          {!delivery.attemptedTo && (
            <div className="pay-note">This deed was sent before we started recording the address, so we cannot say where from this screen. The activity feed below has it.</div>
          )}
        </>
      )}
      {dlvState === 'not_attempted' && (
        <>
          {/* WHAT IS HAPPENING NOW, WHERE A CORRECTION REPLACED THE DEED.
              Matt, 2026-10-03: "after a start-date correction it still shows
              the old deed's delivery while the corrected deed is unsigned.
              Show the current deed's state ... with the earlier delivery
              listed as superseded."

              20261007640000 stopped the panel claiming the archived deed's
              delivery, which left it saying only "Goes to: ..." -- true, and
              silent about why the delivery the reader remembers has gone.
              This is the sentence that was missing. */}
          {delivery.supersededAt && (
            <div className="pay-note">
              {delivery.deedState === 'awaiting_tenant'
                ? <>Corrected deed awaiting the tenant&rsquo;s signature; it will be sent to{' '}
                    <b>{dlvWouldGo || 'the agent'}</b> once signed.</>
                : <>The deed was replaced by a correction and has not been delivered yet.</>}
            </div>
          )}
          <div className="drow"><span className="drow__k">Goes to</span><span className="drow__v">{dlvWouldGo || 'No recipient could be resolved'}</span></div>
          {delivery.source && <div className="drow"><span className="drow__k">Address from</span><span className="drow__v">{rungLabel(delivery.source)}</span></div>}
          {/* THE EARLIER DELIVERY IS KEPT AND LABELLED, not dropped: the
              agent has that PDF in their inbox, and a panel that simply
              forgot it would leave them holding a document the portal
              denies sending. */}
          {delivery.supersededAt && (
            <div className="drow">
              <span className="drow__k">Superseded</span>
              <span className="drow__v">
                Sent to {delivery.supersededTo ?? 'the agent'} on{' '}
                {fmtStamp(new Date(delivery.supersededAt))}, before the correction
              </span>
            </div>
          )}
        </>
      )}
      {/* Automatic delivery being off is a fact about our own setup, not about
          this application, so it stays with the people who can change it. */}
      {!delivery.autoSend && isAdmin && (
        <div className="pay-note">This one is not sent automatically. It goes out when a member of staff sends it.</div>
      )}
      {canSend && isDeed && (
        <div style={{ marginTop: 12 }}>
          {dlvState === 'cannot_deliver'
            // Nothing to resend TO: a blind retry would resolve the same empty
            // ladder and fail again. The modal is where an address gets typed.
            ? <Button variant="primary" size="sm" block onClick={openSend}><Icon name="send" /> Send deed to agent</Button>
            : <Button variant={dlvState === 'delivered' ? 'ghost' : 'primary'} size="sm" block onClick={() => void doResendDelivery()} disabled={dlvBusy}>
                <Icon name="send" /> {dlvBusy ? 'Sending…' : dlvState === 'not_attempted' ? 'Send deed' : 'Resend deed'}
              </Button>}
        </div>
      )}
    </>
  );

  // Agent rail: thread the payment (stage 8) and deed (stage 9) blocks into the
  // journey. Payment only when there is a payment record to show. Delivery has
  // no stage of its own (there are nine and it is not one of them), so it sits
  // under the deed, which is the thing being delivered.
  const journeySlots: Record<number, ReactNode> | undefined = jview
    ? {
        ...(SUPABASE_ENABLED && pi ? { 8: <>{paymentBadge && <div style={{ marginBottom: 10 }}>{paymentBadge}</div>}{paymentBody}</> } : {}),
        9: (
          <>
            {deedBadge && <div style={{ marginBottom: 10 }}>{deedBadge}</div>}
            {deedBody}
            {showDelivery && (
              <div className="dlv dlv--threaded">
                <div className="dlv__head">Delivery</div>
                {deliveryBody}
              </div>
            )}
          </>
        ),
      }
    : undefined;

  return (
    <>
      <div className="backbar">
        <Link to="/applications"><Icon name="arrowLeft" /> All applications</Link>
      </div>

      <div className="rec-head">
        <div className="rec-head__id">
          <span className="rec-head__av">{d.initials}</span>
          <div>
            <div className="rec-head__name">{d.name}</div>
            <div className="rec-head__meta">
              <Pill variant={pillVariant}>{statusLabel}</Pill>
              {d.channel && <Pill variant={ROUTE_PILL[d.channel]}>{ROUTE_LABEL[d.channel]}</Pill>}
              <span>·</span><span>Reference {d.ref}</span>
              {/* NM-P. For a single-office agency this read "Bermondsey ·
                  Riverside Homes", naming an office the rest of the product
                  no longer mentions. Asked of THIS RECORD's agency, not of
                  the reader's book: the reader may hold several agencies of
                  both shapes at once. */}
              <span>·</span><span>{officeLabel(d.agency, d.branch, d.partner)}</span>
              {/* The supplier's own name, when there is one; hidden for house routes,
                  where partnerName is already the route label the badge shows. */}
              {maySeeRoute && d.partnerName && (!d.channel || d.partnerName !== ROUTE_LABEL[d.channel]) && <><span>·</span><span>{d.partnerName}</span></>}
            </div>
          </div>
        </div>
        <div className="rec-head__actions">
          {d.status === 'referencing' && isAdmin && <Button variant="primary" size="sm" onClick={doApprove} disabled={approveBusy || declineBusy}><Icon name="check" /> {approveBusy ? 'Approving…' : 'Approve'}</Button>}
          {d.status === 'referencing' && isAdmin && <Button variant="ghost" size="sm" className="btn--danger" onClick={() => { setDeclineReason(''); setDeclineOpen(true); }} disabled={approveBusy || declineBusy}><Icon name="x" /> Decline</Button>}
          {isDeed && <Button variant="dark" size="sm" onClick={doDownloadDeed}><Icon name="download" /> Download deed</Button>}
          {showWithdraw && <Button variant="ghost" size="sm" onClick={() => { setWReason(''); setWNote(''); setWithdrawOpen(true); }}><Icon name="ban" /> Withdraw</Button>}
        </div>
      </div>

      {isWithdrawn && (
        <div className="rec-withdrawn">
          <Icon name="ban" strokeWidth={2.2} />
          <div>
            {/* =====================================================================
                IT COUNTS AS SENT. Matt, 2026-10-03: "it says withdrawn
                referrals are 'excluded from conversion figures and Leagues',
                but they now count as sent. Make the text match what actually
                happens."

                CHECKED BEFORE CHANGING THE WORDS: `reachedPayment` answers
                TRUE for `withdrawn`, and its own test says why -- "a withdrawn
                referral reached the tenant". So the referral is in the sent
                column of every funnel, chart, export and League board. What it
                is NOT is a conversion: it never reached Paid, so it sits in the
                denominator and not the numerator, which is the honest thing to
                say and is what the old sentence got backwards.
                ===================================================================== */}
            <b>This application was withdrawn{withdrawnReason ? ` (${REASON_LABEL[withdrawnReason]})` : ''}.</b>{' '}
            It still counts as a referral sent, in Reporting and in the League, and it never converted. It receives no further payment reminders.
          </div>
        </div>
      )}
      {isExpired && (
        <div className="rec-withdrawn">
          <Icon name="clock" strokeWidth={2.2} />
          <div>
            <b>This application expired (guarantee fee unpaid 15 days after referral).</b>{' '}
            It still counts as a referral sent, in Reporting and in the League, and it never converted. It receives no further reminders, and a late payment automatically reinstates it to Paid.
          </div>
        </div>
      )}

      {/* Supplier rail: the three-stage strip keeps its full-width slot up top.
          The agent rail's nine-stage journey lives in the right rail instead
          (threaded with payment and the deed), so the details rise. */}
      {!agentRail && (
        <Card style={{ marginBottom: 18 }}>
          <CardHead title="Status timeline" sub="Sent to Paid to Deed Issued" />
          <CardBody>
            <StatusTimeline steps={timelineSteps} reached={timelineReached} terminated={timelineTerm} currentInProgress={timelineInProgress} />
          </CardBody>
        </Card>
      )}

      <div className="detail-grid">
        {/* LEFT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Card>
            <CardHead title="Tenant details" />
            <CardBody style={{ paddingTop: 6, paddingBottom: 6 }}>
              <div className="drow"><span className="drow__k">Full name</span><span className="drow__v"><b>{d.fullName}</b></span></div>
              <div className="drow"><span className="drow__k">Date of birth</span><span className="drow__v">{d.dob}</span></div>
              <div className="drow"><span className="drow__k">Email</span><span className="drow__v">{d.email}</span></div>
              <div className="drow"><span className="drow__k">Phone</span><span className="drow__v">{d.phone}</span></div>
            </CardBody>
          </Card>

          <Card>
            <CardHead title="Property" />
            <CardBody style={{ paddingTop: 6, paddingBottom: 6 }}>
              <div className="drow"><span className="drow__k">Address line 1</span><span className="drow__v">{titleCaseAddress(d.addr1)}</span></div>
              <div className="drow"><span className="drow__k">Address line 2</span><span className="drow__v">{d.addr2 ? titleCaseAddress(d.addr2) : '-'}</span></div>
              <div className="drow"><span className="drow__k">City / town</span><span className="drow__v">{titleCaseAddress(d.city)}</span></div>
              <div className="drow"><span className="drow__k">County</span><span className="drow__v">{titleCaseAddress(d.county)}</span></div>
              <div className="drow"><span className="drow__k">Postcode</span><span className="drow__v"><b>{d.postcode}</b></span></div>
              {/* MOVED HERE when the Referring agent card collapses, which it does
                  for a one-office agency. A row about the property belongs on the
                  Property card and is where it will be looked for; it only ever
                  sat on the agent card because that card was always drawn. Shown
                  in exactly one place: the agent card omits it whenever this
                  shows it. */}
              {!isDirect && referrerCard.deedRowMoves && (
                <div className="drow"><span className="drow__k">Deed in favour of</span><span className="drow__v">{titleCaseAddress(d.addr1)}, {d.postcode}</span></div>
              )}
            </CardBody>
          </Card>

          {isDirect ? (
            /* A direct tenant: nobody referred them. Show where the deed goes -- the
               agent or private landlord they named -- and, for staff, the inline
               agency match, so the "who's the agent" decision lives on the record
               rather than only in a queue tab. */
            <Card>
              <CardHead title="Delivery contact" sub="Nobody referred this tenant. The deed goes to the contact they named." />
              <CardBody style={{ paddingTop: 6, paddingBottom: 6 }}>
                {d.landlordName ? (
                  <>
                    <div className="drow"><span className="drow__k">Private landlord</span><span className="drow__v"><b>{d.landlordName}</b></span></div>
                    {d.landlordEmail && <div className="drow"><span className="drow__k">Email</span><span className="drow__v">{d.landlordEmail}</span></div>}
                  </>
                ) : (
                  <>
                    <div className="drow"><span className="drow__k">Letting agent</span><span className="drow__v"><b>{matchRow?.typedName || d.agency || 'Not given'}</b></span></div>
                    {!matchRow && d.branch && !isPlaceholderOrg(d.branch) && <div className="drow"><span className="drow__k">Branch</span><span className="drow__v">{d.branch}</span></div>}
                  </>
                )}
                <div className="drow"><span className="drow__k">Deed in favour of</span><span className="drow__v">{titleCaseAddress(d.addr1)}, {d.postcode}</span></div>

                {isAdmin && matchRow && (
                  <div style={{ marginTop: 10, padding: 12, border: '1px dashed var(--line-strong)', borderRadius: 'var(--r-md)', background: 'var(--app-bg-2)' }}>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Match to a branch in the network</div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 8 }}>The tenant typed “{matchRow.typedName}”. Point this application at a real branch, or mark it not in the network.</div>
                    <div className="field">
                      <select value={matchAgencyId} onChange={(e) => { setMatchAgencyId(e.target.value); setMatchBranchId(''); }}>
                        <option value="">Select an agency…</option>
                        {matchAgencyOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <select value={matchBranchId} onChange={(e) => setMatchBranchId(e.target.value)} disabled={!matchAgencyId}>
                        <option value="">{matchAgencyId ? 'Select a branch…' : 'Choose an agency first'}</option>
                        {matchBranches.map((b) => <option key={b.id} value={b.id}>{b.name}{b.area ? ` · ${b.area}` : ''}</option>)}
                      </select>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <Button variant="primary" size="sm" onClick={() => void doResolveMatch()} disabled={matchBusy || !matchBranchId}>Match to branch</Button>
                      <Button variant="ghost" size="sm" onClick={() => void doDismissMatch()} disabled={matchBusy}>Not in network</Button>
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          ) : referrerCard.show ? (
            <Card>
              {/* No sub. It read "Claim contact. The deed is in favour of the property.",
                  which stated a rule to an audience that does not need it: the agent
                  reading this card already knows whose property it is, and the card's
                  own "Deed in favour of" row below says so anyway. */}
              <CardHead title="Referring agent" />
              <CardBody style={{ paddingTop: 6, paddingBottom: 6 }}>
                {referrerCard.agency && <div className="drow"><span className="drow__k">Agency</span><span className="drow__v"><b>{d.agency}</b></span></div>}
                {referrerCard.branch && !isPlaceholderOrg(d.branch) && <div className="drow"><span className="drow__k">Branch</span><span className="drow__v">{d.branch}</span></div>}
                {/* ROUTE, NOT PARTNER. The value was always the route for one of
                    our agencies — partnerName maps a house slug to its route label,
                    so this row read "Partner: Agency referral" — and "partner" is our
                    word for a supplier, which an agency of ours is not. The key now
                    describes what the value actually is, on every screen, so there is
                    one label rather than two that can drift apart. */}
                {/* WHO SENT IT, which is what "Referring agent" says it is
                    about. Matt, 2026-10-01: "'Referring agent' shows the
                    referrer's name and office, not just the route; remove
                    the duplicate Referrer line under Tenancy."

                    The card named the agency, the branch and the route and
                    never the person, while the Tenancy card below named the
                    person and nothing else -- so the one fact the heading
                    promises was on the other card, under a heading about
                    the tenancy. */}
                {d.referrer && (
                  <div className="drow">
                    <span className="drow__k">Referred by</span>
                    <span className="drow__v">
                      {d.referrerRole === 'superadmin' ? 'opndoor' : d.referrer}
                      {d.branch && !isPlaceholderOrg(d.branch) && <span className="dt__sub">{d.branch}</span>}
                    </span>
                  </div>
                )}
                {maySeeRoute && d.partnerName && <div className="drow"><span className="drow__k">Route</span><span className="drow__v">{d.partnerName}</span></div>}
                {referrerCard.address && <div className="drow"><span className="drow__k">Address</span><span className="drow__v">{titleCaseAddress(d.agentAddr)}</span></div>}
                {!referrerCard.deedRowMoves && <div className="drow"><span className="drow__k">Deed in favour of</span><span className="drow__v">{titleCaseAddress(d.addr1)}, {d.postcode}</span></div>}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHead
              title="Tenancy"
              actions={
                canAmend && <Button variant="ghost" size="sm" onClick={openAmend}><Icon name="calendar" /> Amend start date</Button>
              }
            />
            <CardBody style={{ paddingTop: 6, paddingBottom: 6 }}>
              <div className="drow"><span className="drow__k">Monthly rent</span><span className="drow__v"><b style={{ fontFamily: 'var(--display)', fontSize: 16 }}>{d.rent}</b> per month{siblings.length > 1 && me?.sharePercent != null && <> · <b>{me.sharePercent}%</b> is this tenant’s share</>}</span></div>
              {/* BLANK WHILE IT IS A PLACEHOLDER. Matt, 2026-10-03: "Leave
                  Tenancy start blank until the tenant has given one; check the
                  screen and other exports for the same." `tenancy_start` is
                  NOT NULL and the direct rail's draft is born with
                  `current_date + 30` in it, which is where GR-20626's
                  04/10/2026 came from. See data/tenancyStartGiven.

                  "Not given yet" RATHER THAN AN EMPTY CELL, because this is a
                  labelled row on a card and a blank value beside a label reads
                  as a fault. The export is a spreadsheet cell and is genuinely
                  blank there. */}
              <div className="drow"><span className="drow__k">Tenancy start</span><span className="drow__v">{tenancyStartGiven(d) ? fmtLong(currentStart) : <span className="muted">Not given yet</span>}</span></div>

              {/* THE OTHER TENANTS. One property and one rent, but several
                  applications and several deeds, and this page is only ever
                  looking at one of them. Without this the reader has no way to
                  tell that the rent above is shared.

                  EVERY DEED FACT HERE IS THE ROW'S OWN. The panel used to close
                  with the LEAD's status stated as the tenancy's, which put
                  "issued" on a sibling's page three lines under a row that said
                  the sibling had nothing. Each tenant signs their own deed now
                  (20261005110000), so each row answers for itself and the
                  tenancy's figure is a count. */}
              {siblings.length > 1 && tenancyGroup && (
                <div className="jt-panel">
                  <div className="jt-panel__head">
                    <span>Joint tenancy · {countOf(siblings.length, 'tenant')}</span>
                    <span className="jt-panel__prog">
                      <span>{tenancyProgress(tenancyGroup)}</span>
                      <span>{tenancyDeedProgress(tenancyGroup)}</span>
                    </span>
                  </div>
                  {siblings.map((sib) => {
                    const m = tenancyGroup.members.find((x) => x.ref === sib.ref);
                    const isMe = sib.ref === d.ref;
                    const deed = m?.deed ?? 'none';
                    return (
                      <div className={`jt-panel__row${isMe ? ' is-me' : ''}`} key={sib.ref}>
                        <span className="jt-panel__who">
                          {isMe ? <b>{sib.tenant}</b> : <Link to={`/applications/${encodeURIComponent(sib.ref)}`}>{sib.tenant}</Link>}
                          {/* NO LEAD BADGE. It was kept for one revision as
                              "first tenant entered", which is true and is not
                              worth a badge: under per-tenant deeds the lead
                              carries no deed, no reminder and no expiry that
                              its co-tenants do not also carry, so the label
                              distinguished nothing a reader could act on. Gone
                              from the list rows too, in the same pass. */}
                          {isMe && <span className="jt-panel__you">this page</span>}
                        </span>
                        <span className="jt-panel__share">{m?.sharePercent != null ? `${m.sharePercent}%` : '-'}</span>
                        <span className={`jt-panel__paid${m?.paid ? ' is-paid' : ''}`}>{m?.paid ? 'Paid' : 'Not paid'}</span>
                        <span className={`jt-panel__ds jt-panel__ds--${memberDeedTone(deed)}`}>{MEMBER_DEED_LABEL[deed]}</span>
                        <span className="jt-panel__ref">{sib.ref}</span>
                      </div>
                    );
                  })}
                  <p className="jt-panel__deed">
                    Each tenant signs their own Deed of Guarantee. It covers their share of the
                    rent and names {allOf(siblings.length, 'tenant')}, and it is generated as soon as
                    that tenant has paid, so nobody waits on a co-tenant.
                  </p>
                </div>
              )}
            </CardBody>
          </Card>

          {/* The applicant's own files, which are NOT notes and are still
              Opndoor's alone (20261007310000). */}
          {showDocuments && (
            <Card>
              <CardHead title="Documents" sub="What the applicant uploaded on the Address and Financials steps." />
              <CardBody style={{ paddingTop: 6, paddingBottom: 6 }}>
                {docs.length === 0 ? (
                  <div className="drow__v" style={{ padding: '8px 0', color: 'var(--ink-mute)' }}>Nothing uploaded yet.</div>
                ) : (
                  docs.map((doc) => (
                    <div className="docrow" key={doc.id}>
                      <span className="docrow__ic"><Icon name="file" strokeWidth={1.8} /></span>
                      <div className="docrow__txt">
                        <div className="docrow__name">{doc.filename}</div>
                        <div className="docrow__meta">{doc.label}{doc.bytes ? ` · ${Math.max(1, Math.round(doc.bytes / 1024))} KB` : ''}</div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => void openDoc(doc.id)}><Icon name="download" /> Open</Button>
                    </div>
                  ))
                )}
              </CardBody>
            </Card>
          )}

          {maySeeNotes && (
            <Card>
              <CardHead title="Notes" sub="The shared record of this application. Everyone who can see it can read and add notes. Never shown to the tenant, and never exported." />
              <CardBody style={{ paddingTop: 8, paddingBottom: 12 }}>
                {notes.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--ink-mute)', padding: '4px 0 10px' }}>No notes yet.</div>
                ) : (
                  notes.map((n) => (
                    <div className="note-item" key={n.id}>
                      <span className="note-item__dot" style={{ background: 'var(--heliotrope)' }} />
                      <div>
                        <div className="note-item__t">{n.body}</div>
                        <div className="note-item__time">{fmtStamp(new Date(n.at))} · {n.author ?? 'System'}</div>
                      </div>
                    </div>
                  ))
                )}
                <div className="field" style={{ marginTop: 12 }}>
                  <label htmlFor="note-body">Add a note</label>
                  <textarea id="note-body" rows={3} placeholder="Operational notes only, no sensitive personal data." value={noteBody} onChange={(e) => setNoteBody(e.target.value)} />
                </div>
                <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                  <Button variant="primary" size="sm" onClick={() => void doAddNote()} disabled={noteBusy || !noteBody.trim()}><Icon name="plus" /> {noteBusy ? 'Adding…' : 'Add note'}</Button>
                </div>
              </CardBody>
            </Card>
          )}
        </div>

        {/* RIGHT */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {threaded && jview && (
            <Card>
              <CardHead title="Journey" sub="Invited to Deed signed" />
              <CardBody>
                <StatusTimeline steps={jview.steps} reached={jview.reached} terminated={jview.terminated} currentInProgress={jview.currentInProgress} groups={AGENT_JOURNEY_BANDS} slots={journeySlots} />
              </CardBody>
            </Card>
          )}
          {!threaded && SUPABASE_ENABLED && pi && (
            <Card>
              {/* The label now follows the key rather than being a fixed string
                  next to an inverted predicate. Test mode is the one worth
                  seeing, so it is the one that stands out. */}
              <CardHead title="Payment" actions={paymentBadge} />
              <CardBody style={{ paddingTop: 6, paddingBottom: 12 }}>{paymentBody}</CardBody>
            </Card>
          )}
          <Card className="gsum">
            <CardBody>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)' }}>Guarantee reference</div>
              <div className="gsum__ref">{d.ref}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 4, marginBottom: 14 }}>{gsumNote}</div>
              <div className="gsum__row"><span className="k">Issue date</span><span className="v">{gsumIssue}</span></div>
              <div className="gsum__row"><span className="k">Expiry date</span><span className="v">{gsumExpiry}</span></div>
              <div className="gsum__row"><span className="k">Guarantee period</span><span className="v">12 months</span></div>
              {/* NOTHING IS GUARANTEED UNTIL THE DEED IS. Matt, 2026-10-01:
                  "before the deed is issued, label the rent figure 'Rent to
                  be guaranteed' instead of 'Guaranteed annual rent'." The
                  figure is the same number throughout; what changes is
                  whether anybody has guaranteed it yet, and the deed is that
                  moment -- not the payment and not the signature, both of
                  which happen while the answer is still "nobody has". */}
              {/* AND NOT AT ALL ON A CLOSED ONE. Matt: "and no rent to be
                  guaranteed." The row is a figure about a guarantee that is
                  going to exist; on a withdrawn or expired referral there is
                  no such guarantee, and printing £12,000 against one reads
                  as cover somebody has. The row is DROPPED rather than
                  zeroed: £0 is a different claim and an equally wrong one. */}
              {!timelineTerminated && (
                <div className="gsum__row">
                  <span className="k">{isDeed ? 'Guaranteed annual rent' : 'Rent to be guaranteed'}</span>
                  <span className="v">{d.annual}</span>
                </div>
              )}
            </CardBody>
          </Card>

          {!threaded && (
            <Card>
              <CardHead title="Guarantee deed" actions={deedBadge} />
              <CardBody>{deedBody}</CardBody>
            </Card>
          )}

          {/* Its own card beside the deed on the supplier rail; threaded under
              the deed stage on the agent rail (see journeySlots). Same body. */}
          {!threaded && showDelivery && (
            <Card>
              <CardHead title="Delivery" sub="Where the deed goes, and what happened to the last send." />
              <CardBody style={{ paddingTop: 6, paddingBottom: 12 }}>{deliveryBody}</CardBody>
            </Card>
          )}

          <Card>
            <CardHead title="Activity" />
            <CardBody style={{ paddingTop: 8, paddingBottom: 8 }}>
              {(showAllActivity ? activity : activity.slice(0, 6)).map((a, i) => (
                <div className="note-item" key={i}>
                  <span className="note-item__dot" style={{ background: a.color }} />
                  <div>
                    <div className="note-item__t">{a.text}</div>
                    <div className="note-item__time">{a.time}</div>
                  </div>
                </div>
              ))}
              {activity.length > 6 && (
                <button
                  type="button"
                  onClick={() => setShowAllActivity((v) => !v)}
                  style={{ display: 'block', margin: '4px 0 2px', background: 'none', border: 'none', padding: 0, color: 'var(--heliotrope-deep, #6b3fa0)', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}
                >
                  {showAllActivity ? 'Show fewer' : `Show all (${activity.length})`}
                </button>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* AMEND MODAL */}
      <Modal
        open={amendOpen}
        onClose={() => setAmendOpen(false)}
        width={460}
        title="Amend tenancy start date"
        sub={reissues ? 'Amending the tenancy start date will reissue the Deed of Guarantee with the new date, and the expiry updates to 12 months on.' : 'Correct the tenancy start date. There is no deed yet, so this just updates the application.'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAmendOpen(false)}>Cancel</Button>
            {/* <Button variant="primary" onClick={() => saveAmend()} disabled={!canSave}>{executed ? 'Review consequences' : reissues ? 'Save and reissue deed' : 'Save start date'}</Button> */}
             {/* PRESSABLE WITH THE DATE EMPTY, so the refusal can be read.
                 Matt, 2026-10-03: "Same for every form in the portal." It was
                 `disabled={!canSave || !amendInput.trim()}`, so somebody who
                 opened the dialog and pressed Save was pressing nothing.
                 `canSave` is the PERMISSION half and stays in the gate: a
                 button the server will refuse outright should not be offered
                 at all, which is a different rule from a field left blank. */}
             <Button variant="primary" onClick={() => saveAmend()} disabled={!canSave}>{executed ? 'Review consequences' : reissues ? 'Save and reissue deed' : 'Save start date'}</Button>
          </>
        }
      >
        <div className="amend-facts">
          {PAYMENT && <div className="amend-fact"><div className="k">Payment date</div><div className="v">{fmtLong(PAYMENT)}</div></div>}
          <div className="amend-fact"><div className="k">Current start</div><div className="v">{fmtLong(currentStart)}</div></div>
        </div>
        <div className="field">
          <label htmlFor="amend-input">New tenancy start date</label>
          <input id="amend-input" type="text" inputMode="numeric" placeholder="dd/mm/yyyy" autoComplete="off" value={amendInput} onChange={(e) => setAmendInput(e.target.value)} />
        </div>
        <div className={`amend-msg${amendTone === 'ok' ? ' amend-msg--ok' : amendTone === 'err' ? ' amend-msg--err' : ''}`} style={amendTone === 'neutral' ? { color: 'var(--ink-mute)' } : undefined}>
          <Icon name={amendTone === 'err' ? 'info' : 'check'} strokeWidth={2.4} style={amendTone === 'neutral' ? { color: 'var(--ink-mute)' } : amendTone === 'ok' ? { color: 'var(--deed)' } : undefined} />
          {amendText}
        </div>
      </Modal>

      {/* #2 WITHDRAW APPLICATION (Sent, pre-payment only) */}
      <Modal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        width={460}
        title="Withdraw application"
        /* WHAT WITHDRAWING ACTUALLY DOES, which is the dialog's whole job and
           was wrong in its first clause. Matt, 2026-10-03: "it says withdrawn
           referrals are 'excluded from conversion figures and Leagues', but
           they now count as sent. Make the text match what actually happens."

           AND IT NOW SAYS WHAT HAPPENS TO THE TENANT, which it never did: the
           person pressing this is deciding something on somebody else's
           behalf, and the two consequences they most need to know are that
           the tenant's link stops working and that the tenant is told. Both
           are checked below rather than claimed: `getPayPageState` closes the
           page for a withdrawn application, and the withdrawal now emails
           them. */
        sub="Withdrawing closes this referral before payment. It still counts as a referral sent, and it never converted. The tenant's payment link stops working and they are emailed to say the agency has withdrawn it. No further payment reminders are sent. This cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setWithdrawOpen(false)} disabled={withdrawBusy}>Cancel</Button>
            <Button variant="primary" className="btn--danger" onClick={() => void doWithdraw()} disabled={withdrawBusy || !wReason || (wReason === 'other' && !wNote.trim())}>{withdrawBusy ? 'Withdrawing…' : 'Withdraw application'}</Button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="withdraw-reason">Reason</label>
          <select id="withdraw-reason" value={wReason} onChange={(e) => setWReason(e.target.value as WithdrawReason)}>
            <option value="" disabled>Select a reason…</option>
            {WITHDRAW_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="withdraw-note">Note{wReason === 'other' ? '' : ' (optional)'}</label>
          <textarea id="withdraw-note" rows={3} placeholder={wReason === 'other' ? 'Explain the reason for withdrawing' : 'Add any context (optional)'} value={wNote} onChange={(e) => setWNote(e.target.value)} />
        </div>
      </Modal>

      {/* Decision: decline an application awaiting the eligibility decision. */}
      <Modal
        open={declineOpen}
        onClose={() => setDeclineOpen(false)}
        width={460}
        title="Decline application"
        sub="This records the outcome as declined and notifies the referring agent. A staff decision is authoritative and is not overwritten by a later provider verdict. This cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeclineOpen(false)} disabled={declineBusy}>Cancel</Button>
            <Button variant="primary" className="btn--danger" onClick={() => void doDecline()} disabled={declineBusy}>{declineBusy ? 'Declining…' : 'Decline application'}</Button>
          </>
        }
      >
        <div className="field">
          <label htmlFor="decline-reason">Reason (optional)</label>
          <textarea id="decline-reason" rows={3} placeholder="A short reason, shown to the tenant" value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} />
        </div>
      </Modal>

      {/* #82 SIGNED-DEED CONSEQUENCE CONFIRMATION (stacked on the amend modal) */}
      <Modal
        open={confirmReissueOpen}
        onClose={() => setConfirmReissueOpen(false)}
        width={460}
        title="This deed is signed. Amend anyway?"
        sub="Deed and application data must never disagree, so amending the tenancy start on a signed deed replaces the deed."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmReissueOpen(false)}>Cancel</Button>
            <Button variant="primary" className="btn--danger" onClick={() => void saveAmend(true)}>Void, reissue and amend</Button>
          </>
        }
      >
        <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.6, margin: 0 }}>Proceeding will:</p>
        <ul style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.6, margin: '8px 0 0', paddingLeft: 20 }}>
          <li>void and archive the current signed deed;</li>
          <li>issue a corrected deed and send it to the tenant to sign again;</li>
          <li>re-notify the agent once the corrected deed is signed.</li>
        </ul>
      </Modal>

      {/* SEND DEED TO AGENT MODAL */}
      <Modal
        open={sendOpen}
        onClose={() => !sendBusy && setSendOpen(false)}
        width={460}
        title="Send deed to agent"
        sub="A copy of the Deed of Guarantee will be emailed to the agent contact for this branch."
        footer={
          <>
            <Button variant="ghost" onClick={() => !sendBusy && setSendOpen(false)} disabled={sendBusy}>Cancel</Button>
            <Button variant="primary" onClick={() => void confirmSend()} disabled={sendDisabled || sendBusy}>{sendBusy ? 'Sending…' : 'Send deed'}</Button>
          </>
        }
      >
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 8 }}>Send to</div>

          {isReferrer ? (
            // Referrers are send-only: send to the resolved recipient, with no one-off address or saving.
            resolved.contact ? (
              <>
                <div className="send-opt" style={{ cursor: 'default' }}>
                  <span className="send-opt__main">
                    <b>{resolved.contact.name}</b>{resolved.contact.role ? ` · ${resolved.contact.role}` : ''}
                    <br />
                    <span className="send-opt__email">{resolved.contact.email}{resolved.contact.phone ? ` · ${resolved.contact.phone}` : ''}</span>
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 6 }}>From the {sendSrc}.</div>
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
                No agent contact is saved for this branch or agency. Ask opndoor or your manager to add one before sending the deed.
              </div>
            )
          ) : (
            <>
              {eff.list.length > 0 ? (
                <>
                  <div className="send-opts">
                    {eff.list.map((c, i) => (
                      <label className="send-opt" key={i}>
                        <input type="radio" name="send-to" checked={sendSel === String(i)} onChange={() => setSendSel(String(i))} disabled={sendBusy} />
                        <span className="send-opt__main">
                          <b>{c.name}</b>{c.role ? ` · ${c.role}` : ''}
                          <br />
                          <span className="send-opt__email">{c.email}{c.phone ? ` · ${c.phone}` : ''}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 6 }}>From the {sendSrc}.</div>
                </>
              ) : (
                <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 6 }}>
                  No agent contact is saved for this branch or agency. Enter a recipient below, or add one on the{' '}
                  <Link to="/agencies" style={{ color: 'var(--heliotrope-deep)', fontWeight: 700 }}>Agencies and branches</Link> screen.
                </div>
              )}

              <label className="send-opt send-opt--other">
                <input type="radio" name="send-to" checked={sendSel === 'other'} onChange={() => setSendSel('other')} disabled={sendBusy} />
                <span className="send-opt__main">
                  <b>Send to another address</b>
                  <br />
                  <span className="send-opt__email">A one-off recipient, not saved to the agency</span>
                </span>
              </label>

              <div className={`send-other${sendSel === 'other' ? ' is-open' : ''}`}>
                <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="field"><label htmlFor="so-name">Name</label><input type="text" id="so-name" autoComplete="off" placeholder="Recipient name" value={soName} onChange={(e) => setSoName(e.target.value)} disabled={sendBusy} /></div>
                  <div className="field"><label htmlFor="so-role">Role <span className="hint">Optional</span></label><input type="text" id="so-role" autoComplete="off" placeholder="e.g. Property manager" value={soRole} onChange={(e) => setSoRole(e.target.value)} disabled={sendBusy} /></div>
                  <div className="field span-2"><label htmlFor="so-email">Email</label><input type="email" id="so-email" autoComplete="off" placeholder="name@example.co.uk" value={soEmail} onChange={(e) => setSoEmail(e.target.value)} disabled={sendBusy} /></div>
                </div>
                <label className="send-save-note"><input type="checkbox" checked={soSave} onChange={(e) => setSoSave(e.target.checked)} disabled={sendBusy} /> <span>Also save this contact to the {d.branch} branch</span></label>
              </div>
            </>
          )}

          {sendBusy && (
            <div className="send-busy" role="status" aria-live="polite">
              <span className="send-busy__spinner" />
              <span>Sending deed to the selected recipient…</span>
            </div>
          )}
          <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: '14px 0 0' }}>A copy of Guarantee_Deed_{d.ref}.pdf will be emailed to the {isReferrer ? 'recipient above' : 'selected recipient'}.</p>
        </div>
      </Modal>

      {/* SEND DEED TO LANDLORD MODAL (agency staff) */}
      <Modal
        open={landlordOpen}
        onClose={() => !llBusy && setLandlordOpen(false)}
        width={460}
        title="Send deed to landlord"
        sub="Email the signed Deed of Guarantee to your landlord as an attachment. Their details are saved so you can resend without retyping."
        footer={
          <>
            <Button variant="ghost" onClick={() => !llBusy && setLandlordOpen(false)} disabled={llBusy}>Cancel</Button>
            <Button variant="primary" onClick={() => void confirmLandlord()} disabled={llBusy || !llName.trim() || !llEmail.trim()}>{llBusy ? 'Sending…' : 'Send deed'}</Button>
          </>
        }
      >
        <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field"><label htmlFor="ll-name">Landlord name</label><input type="text" id="ll-name" autoComplete="off" placeholder="Full name" value={llName} onChange={(e) => setLlName(e.target.value)} disabled={llBusy} /></div>
          <div className="field"><label htmlFor="ll-email">Landlord email</label><input type="email" id="ll-email" autoComplete="off" placeholder="name@example.co.uk" value={llEmail} onChange={(e) => setLlEmail(e.target.value)} disabled={llBusy} /></div>
          <div className="field span-2"><label htmlFor="ll-note">Covering line <span className="hint">Optional</span></label><textarea id="ll-note" rows={2} value={llNote} onChange={(e) => setLlNote(e.target.value)} disabled={llBusy} /></div>
        </div>
        {llBusy && (
          <div className="send-busy" role="status" aria-live="polite">
            <span className="send-busy__spinner" />
            <span>Sending the signed deed to the landlord…</span>
          </div>
        )}
        <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: '14px 0 0' }}>Guarantee_Deed_{d.ref}.pdf will be attached.</p>
      </Modal>
      {confirmEl}
    </>
  );
}
