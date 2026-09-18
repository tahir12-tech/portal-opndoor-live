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
    .select('id, status, payment_state, payment_url, paid_at, paid_amount, stripe_payment_intent_id, refunded_at, stripe_refund_id, refund_after_start, deed_state, deed_sent_at, deed_viewed_at, pandadoc_document_id, executed_pdf_path')
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
