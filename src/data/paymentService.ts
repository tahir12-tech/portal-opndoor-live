/* =====================================================================
   Payment service (Stripe, test mode).

   Reads live payment state for an application (used by the detail view so it
   reflects the webhook's Sent -> Paid flip), and calls the resend-payment-email
   Edge Function. Creation itself is the "send" and goes through the
   create-referral Edge Function (see applicationsService.createReferral).
   ===================================================================== */
import { sb } from '@/lib/supabase';
import type { DeedState, PaymentState } from './types';

const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

/**
 * Which Stripe mode the client is configured for, or null when it cannot tell.
 *
 * DEFECTS.md 3. This was `stripeTestMode()` returning true for a `pk_live_` key,
 * which is backwards, and it drove a badge labelled "Live Mode". So with a TEST
 * key the predicate was false and NO badge rendered at all: staff got no signal
 * in either direction, and with a LIVE key they got a badge whose name happened
 * to match by accident rather than by logic.
 *
 * Three states rather than two, because "no key configured" is a real case and
 * silently reporting it as either mode is how the original went wrong. A null
 * renders no badge, which is honest: we do not know.
 */
export function stripeMode(): 'live' | 'test' | null {
  if (typeof STRIPE_PK !== 'string') return null;
  if (STRIPE_PK.startsWith('pk_live_')) return 'live';
  if (STRIPE_PK.startsWith('pk_test_')) return 'test';
  return null;
}

/** True when PandaDoc deed generation is running in sandbox (drives the badge). */
export function pandadocSandbox(): boolean {
  return String(import.meta.env.VITE_PANDADOC_SANDBOX) === 'true';
}

export interface PaymentLogEntry {
  kind: string;
  message: string;
  actor: string | null;
  at: string;
  /** 'business' (partner-safe) or 'internal' (opndoor-admin-only technical detail). */
  visibility: string;
}

export interface PaymentInfo {
  status: string;
  paymentState: PaymentState | null;
  paymentUrl: string | null;
  paidAt: string | null;
  paidAmount: number | null;
  paymentRef: string | null;
  refundedAt: string | null;
  /** When the Deed of Guarantee was cancelled after a refund. Null on every
      other application, and on a refund that caught the deed before it was
      signed -- there was no instrument to cancel, so the refund date is
      what the screen shows instead. */
  deedCancelledAt: string | null;
  refundRef: string | null;
  /** True when the refund happened on or after the tenancy start (policy anomaly). */
  refundAfterStart: boolean;
  /** Deed sub-state while Paid, or null before a deed exists. */
  deedState: DeedState | null;
  deedSentAt: string | null;
  /** When the tenant first opened the deed to sign (null = not yet viewed). */
  deedViewedAt: string | null;
  pandadocDocumentId: string | null;
  hasExecutedPdf: boolean;
  log: PaymentLogEntry[];
}

/* =====================================================================
   WHAT THE GUARANTEE DEED CARD SHOULD SAY.

   Extracted from the JSX it used to be an inline conditional in, so that the rule
   can be asserted. The rule was `deedState !== 'awaiting_tenant'` used as a
   catch-all, under copy that asserted a generation FAILURE and offered a
   supplier-rail remedy. On GR-20846 that showed "Deed could not be generated.
   Check the branch has an agent contact" while the deed had in fact generated,
   been signed and been delivered.

   Two facts decide it and neither is a guess: whether a document exists, and what
   the deed state actually says. "No deed yet" is not "generation failed": a paid
   application with no document and no error is being prepared, which is the normal
   state in the seconds after payment.
   ===================================================================== */
export type DeedCard = 'awaiting_tenant' | 'preparing' | 'declined' | 'voided' | 'error' | 'cancelled';

/* A REFUND ENDS THE GUARANTEE, WHATEVER BECAME OF THE DOCUMENT.
 *
 * Matt, 2026-10-04 (az), items 1, 3 and 4 at once:
 *   - the timeline's last step says "Cancelled: fee refunded", not
 *     "Awaiting deed"
 *   - 'A deed that was never signed and got cancelled by a refund says
 *     "Signing cancelled: fee refunded", not "Deed document voided in
 *     PandaDoc. Review required." Only show "Review required" when something
 *     actually needs a person.'
 *   - 'Tenancy box: every refunded tenant shows "Cancelled: fee refunded"
 *     (not "Deed voided").'
 *
 * THE THREE COMPLAINTS ARE ONE CAUSE, which is why this is one function.
 * Every screen was reading `deed_state` and asking what happened to the
 * DOCUMENT. The reader's question is what happened to the GUARANTEE, and a
 * refund answers that identically whether the deed was signed and cancelled
 * (GR-23853), voided while still out for signature (GR-23854), or errored.
 * Three deed states, three different sentences, one outcome.
 *
 * WHY TWO LABELS AND NOT ONE. A signed deed that is cancelled and a signing
 * that is abandoned are different events for the tenant and for the
 * underwriter: the first had cover and lost it, the second never had any.
 * Matt's own wording keeps them apart, and the bordereau depends on the
 * difference.
 *
 * NULL WHERE NO DEED EXISTED. A tenant refunded before any document was
 * raised has nothing to say about signing, and "Signing cancelled" would
 * describe a signing that never started. The status pill says Refunded and
 * that is the whole story.
 */
export type CancelledByRefund = 'signed' | 'unsigned' | null;

export function cancelledByRefund(
  p: { refunded?: boolean | null; deedState?: string | null },
): CancelledByRefund {
  if (!p.refunded) return null;
  if (p.deedState === 'cancelled') return 'signed';
  // voided, awaiting_tenant, error: a document existed and will not be signed.
  if (p.deedState) return 'unsigned';
  return null;
}

/** Matt's words, kept together so no screen writes its own variant. */
export const CANCELLED_BY_REFUND_LABEL: Record<'signed' | 'unsigned', string> = {
  signed: 'Cancelled: fee refunded',
  unsigned: 'Signing cancelled: fee refunded',
};

export function deedCardState(pi: Pick<PaymentInfo, 'deedState' | 'pandadocDocumentId'>): DeedCard {
  /* FIRST, BECAUSE THE FALLBACK IS 'preparing'. A cancelled deed matches none
     of the tests below and would have fallen through to "the deed is being
     prepared" -- a guarantee that has ENDED, telling the agent one is on its
     way. The default being a hopeful state is exactly why a new state has to
     be added at the top rather than relied on to land somewhere sensible. */
  if (pi.deedState === 'cancelled') return 'cancelled';
  if (pi.deedState === 'declined') return 'declined';
  if (pi.deedState === 'voided') return 'voided';
  if (pi.deedState === 'error') return 'error';
  if (pi.deedState === 'awaiting_tenant' && pi.pandadocDocumentId) return 'awaiting_tenant';
  // Includes deedState null, and awaiting_tenant with no document id, which is a
  // half-written row rather than a signable deed.
  return 'preparing';
}

/** Is the Generate button able to do anything?

    It calls pandadoc-resend, whose generate branch runs generateDeed, which claims
    through claim_tenancy_deed. That RPC refuses when a document id is already
    present, so with a live document the button is an offer the database declines:
    the guard against a second PandaDoc document, and an inert control. */
export function mayGenerateDeed(pi: Pick<PaymentInfo, 'pandadocDocumentId'>): boolean {
  return !pi.pandadocDocumentId;
}

/* HOW LONG "BEING PREPARED" IS ALLOWED TO LAST.

   The same 30 minutes deeds_awaiting_generation uses, and the two must stay equal:
   this decides when a person is offered the button, that decides when the cron
   does it for them. If the card were more patient than the sweep it would tell a
   Director to wait while a robot was already retrying; if it were less patient it
   would invite a second presser into the window the lease exists to protect. */
export const DEED_PREPARING_WINDOW_MIN = 30;

/** A paid application whose deed has not turned up, past the window in which it
    could still legitimately be in flight.

    WHY THE WINDOW MATTERS RATHER THAN JUST "no document". In the seconds after
    payment there is genuinely nothing wrong: stripe-webhook is generating it. The
    card said so and stopped there, which was right for those seconds and wrong for
    ever afterwards. GR-20763 paid on 20 September and still read "Deed sent for
    signature shortly after payment" eight days later, because deed_state was null
    and the card's whole branch required it to be set. Nothing was coming: the only
    automatic generation was the webhook at the moment of payment. */
export function deedIsOverdue(
  pi: Pick<PaymentInfo, 'status' | 'paymentState' | 'pandadocDocumentId' | 'paidAt'>,
  now: Date = new Date(),
): boolean {
  if (pi.status !== 'paid') return false;
  if (pi.pandadocDocumentId) return false;
  if (pi.paymentState === 'refunded') return false;
  if (!pi.paidAt) return false;
  const paid = new Date(pi.paidAt).getTime();
  if (Number.isNaN(paid)) return false;
  return now.getTime() - paid > DEED_PREPARING_WINDOW_MIN * 60_000;
}

/** Extract a readable message from a Supabase Functions error. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function functionErrorMessage(error: any, fallback: string): Promise<string> {
  try {
    const ctx = await error?.context?.json?.();
    if (ctx?.error) return ctx.error as string;
  } catch { /* ignore */ }
  return (error?.message as string) || fallback;
}

/** Live payment state + payment activity for an application, by reference. */
export async function getPaymentInfo(ref: string): Promise<PaymentInfo | null> {
  const client = sb();
  const { data, error } = await client
    .from('applications')
    .select('id, status, payment_state, payment_url, paid_at, paid_amount, stripe_payment_intent_id, refunded_at, deed_cancelled_at, stripe_refund_id, refund_after_start, deed_state, deed_sent_at, deed_viewed_at, pandadoc_document_id, executed_pdf_path')
    .eq('guarantee_ref', ref)
    .maybeSingle();
  if (error || !data) return null;
  const { data: log } = await client
    .from('activity_log')
    .select('kind, message, actor, at, visibility')
    .eq('application_id', data.id)
    .order('at', { ascending: false });
  // The copy-link is the durable /pay?token page (mints a fresh Stripe session on
  // click), never the raw Stripe URL that expires in 30 minutes. Only fetched for
  // a payable application; the card hides the link otherwise.
  let paymentUrl: string | null = null;
  if (data.status === 'sent' || data.status === 'expired') {
    const { data: token } = await client.rpc('staff_payment_page_token', { p_ref: ref });
    if (token) paymentUrl = `${window.location.origin}/pay?token=${token}`;
  }
  return {
    status: data.status,
    paymentState: data.payment_state ?? null,
    paymentUrl,
    paidAt: data.paid_at ?? null,
    paidAmount: data.paid_amount != null ? Number(data.paid_amount) : null,
    paymentRef: data.stripe_payment_intent_id ?? null,
    refundedAt: data.refunded_at ?? null,
    deedCancelledAt: data.deed_cancelled_at ?? null,
    refundRef: data.stripe_refund_id ?? null,
    refundAfterStart: !!data.refund_after_start,
    deedState: data.deed_state ?? null,
    deedSentAt: data.deed_sent_at ?? null,
    deedViewedAt: data.deed_viewed_at ?? null,
    pandadocDocumentId: data.pandadoc_document_id ?? null,
    hasExecutedPdf: !!data.executed_pdf_path,
    log: (log ?? []) as PaymentLogEntry[],
  };
}

/** Resend the branded payment email for a Sent application. */
export async function resendPaymentEmail(ref: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await sb().functions.invoke('resend-payment-email', { body: { ref } });
  if (error) return { ok: false, error: await functionErrorMessage(error, 'Could not resend the email.') };
  if (!data?.ok) return { ok: false, error: data?.error || 'Could not resend the email.' };
  return { ok: true };
}

/** Nudge the tenant to sign (state-aware), or regenerate if errored/declined/voided. */
export async function resendDeed(ref: string): Promise<{ ok: boolean; message?: string; error?: string }> {
  const { data, error } = await sb().functions.invoke('pandadoc-resend', { body: { ref } });
  if (error) return { ok: false, error: await functionErrorMessage(error, 'Could not send the deed.') };
  if (!data?.ok) return { ok: false, error: data?.error || 'Could not send the deed.' };
  return { ok: true, message: data.message };
}

/** Approve a direct application awaiting the decision (status 'referencing'): sets
    it to 'sent' and emails the tenant the portal payment link. Staff only, enforced
    by set_application_status inside the function. The interim manual stand-in for
    the Lettings verdict handover (ASK-THE-DEVELOPER.md item 1). */
export async function approveApplication(ref: string): Promise<{ ok: boolean; emailError?: string | null; error?: string }> {
  const { data, error } = await sb().functions.invoke('approve-application', { body: { ref } });
  if (error) return { ok: false, error: await functionErrorMessage(error, 'Could not approve the application.') };
  if (!data?.ok) return { ok: false, error: data?.error || 'Could not approve the application.' };
  return { ok: true, emailError: data.emailError ?? null };
}

/** Decline an application awaiting the decision (status 'referencing'): sets it to
    'declined' with an optional reason and emails the referring agent. Staff only,
    enforced by decline_application inside the function. Companion to approveApplication. */
export async function declineApplication(ref: string, reason?: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await sb().functions.invoke('decline-application', { body: { ref, reason: reason?.trim() || null } });
  if (error) return { ok: false, error: await functionErrorMessage(error, 'Could not decline the application.') };
  if (!data?.ok) return { ok: false, error: data?.error || 'Could not decline the application.' };
  return { ok: true };
}

/** Void the outstanding deed and generate a fresh one (Management / opndoor admin). */
export async function voidRegenerateDeed(ref: string): Promise<{ ok: boolean; message?: string; error?: string }> {
  const { data, error } = await sb().functions.invoke('pandadoc-void-regenerate', { body: { ref } });
  if (error) return { ok: false, error: await functionErrorMessage(error, 'Could not void and regenerate the deed.') };
  if (!data?.ok) return { ok: false, error: data?.error || 'Could not void and regenerate the deed.' };
  return { ok: true, message: data.message };
}

/** Get a short-lived signed URL for the executed deed PDF. */
export async function deedDownloadUrl(ref: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  const { data, error } = await sb().functions.invoke('deed-download', { body: { ref } });
  if (error) return { ok: false, error: await functionErrorMessage(error, 'Could not open the deed.') };
  if (!data?.ok) return { ok: false, error: data?.error || 'Could not open the deed.' };
  return { ok: true, url: data.url };
}

export interface ReminderRunResult { ok: boolean; fired?: number; emailed?: number; emailFailed?: number; date?: string; error?: string }

/**
 * Manually run the expiry-reminder job in test mode (opndoor admin only), so its
 * behaviour can be verified today without waiting for the 08:00 schedule. Fires
 * the same idempotent pass; { reset: true } clears the windowed history first so
 * the run can be repeated. Optional { date } overrides "today".
 */
export async function runExpiryReminders(opts?: { date?: string; reset?: boolean }): Promise<ReminderRunResult> {
  const { data, error } = await sb().functions.invoke('expiry-reminders', { body: { test: true, date: opts?.date, reset: opts?.reset } });
  if (error) return { ok: false, error: await functionErrorMessage(error, 'Could not run the expiry reminders.') };
  if (!data?.ok) return { ok: false, error: data?.error || 'Could not run the expiry reminders.' };
  return { ok: true, fired: data.fired, emailed: data.emailed, emailFailed: data.emailFailed, date: data.date };
}
