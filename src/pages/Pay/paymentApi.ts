/* =====================================================================
   Public tenant payment pages — the only client calls to the unauthenticated
   payment-confirmation Edge Function. Keyed to the Stripe Checkout session id.
   Mock/test mode returns a deterministic demo so the pages render with no back
   end (and the smoke test passes).
   ===================================================================== */
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';
import { gbpPence } from '@/lib/format';

export interface PaymentConfirmation {
  found: boolean;
  firstName?: string;
  reference?: string;
  amount?: number;
  /** What is still OWED, present only when the fee is unpaid. `amount` means
      what was PAID and is 0 before payment, which /pay/retry was rendering under
      the label "Amount due" to a tenant who owed the full fee. */
  amountDue?: number;
  paid?: boolean;
  deedReady?: boolean;
  deedSigned?: boolean;
  deedError?: boolean;
  /** The tenant's own Stripe checkout link, present only while unpaid (retry). */
  payUrl?: string | null;
  /** True on a network / 5xx / 429 failure: a transient blip, NOT a definitive
      "not found". Callers should keep the prior state and retry, never downgrade
      a confirmed payment to a not-found screen. */
  transient?: boolean;
  error?: string;
}

const DEMO: PaymentConfirmation = {
  found: true, firstName: 'Alex', reference: 'GR-20608', amount: 2200, paid: true, deedReady: true,
};

/** Fetch the minimal confirmation state for a Stripe Checkout session id. */
export async function getPaymentConfirmation(sessionId: string): Promise<PaymentConfirmation> {
  if (!SUPABASE_ENABLED) return DEMO;
  try {
    const { data, error } = await sb().functions.invoke('payment-confirmation', { body: { session_id: sessionId } });
    // A non-2xx (5xx, 429) or network error is transient — never a definitive
    // "not found". Only a real 200 body with { found: false } is definitive.
    if (error) return { found: false, transient: true, error: 'network' };
    return (data ?? { found: false, transient: true }) as PaymentConfirmation;
  } catch {
    return { found: false, transient: true, error: 'network' };
  }
}

/** Mint (on click) and return the PandaDoc signing-session link, or null. */
export async function requestSigningLink(sessionId: string): Promise<string | null> {
  if (!SUPABASE_ENABLED) return 'https://app.pandadoc.com/s/demo';
  try {
    const { data, error } = await sb().functions.invoke('payment-confirmation', { body: { session_id: sessionId, action: 'sign' } });
    if (error || !data) return null;
    return (data as { signingUrl?: string | null }).signingUrl ?? null;
  } catch {
    return null;
  }
}

/** £ amount, always to the penny.
 *
 *  "pence only when present" was the old rule and it is the one Matt has now
 *  corrected twice: "money always shows two decimal places (£34,545.60, not
 *  £34,545.6), everywhere" (2026-10-01) and "check every money figure on this
 *  page and the tenant pages" (2026-10-03). This is what a tenant is asked to
 *  pay, beside a figure on a statement that is always to the penny. */
export function fmtAmount(n: number | undefined): string {
  if (n == null) return '';
  return gbpPence(n);
}
