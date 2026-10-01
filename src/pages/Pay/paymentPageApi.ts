/* =====================================================================
   #1 Public tenant payment confirmation page (/pay?token=...). The only client
   calls to the unauthenticated payment-page Edge Function (view / checkout /
   decline), keyed to an application-scoped token. Mock/test mode returns a
   deterministic demo so the page renders with no back end (smoke test passes).
   ===================================================================== */
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';

export interface PayPageData {
  ok: boolean;
  ref?: string;
  partnerName?: string;
  tenantName?: string;
  tenantTitle?: string;
  addr1?: string;
  postcode?: string;
  propFull?: string;
  tenancyStart?: string | null;
  guaranteeExpiry?: string | null;
  monthlyRent?: number;
  feeGBP?: string;
  /* WHAT THE FEE IS MEASURED AGAINST, and the five fields below it.

     payment-page has returned all of these since the fee became a concept, and
     this interface stopped at feeGBP, so they were dropped at the type boundary
     and no part of the page could render them. That is the whole reason a Regent
     tenant read "Guarantee fee £692.31" under "Monthly rent £1,000" with nothing
     joining the two: not a missing string, a missing declaration. TypeScript
     could not report the absence of a field the contract never mentioned. */

  /** "one month's rent", "3 weeks of rent". Absent when it cannot be worked out. */
  feeBasis?: string | null;
  /** THIS tenant's share of the rent. On a joint tenancy monthlyRent is the whole
      tenancy's and the fee is only this applicant's share, so printing the two
      side by side contradicts its own arithmetic. */
  rentShare?: number;
  /** Which rail, for the opening line. */
  rail?: 'agency' | 'supplier' | 'direct';
  referencingMode?: string | null;
  /** agencies.name, the agency the tenant actually dealt with, never the group. */
  agencyName?: string | null;
  /** The agency arranged this and opndoor made no decision about this tenant, so
      the agency is the subject of the opening line. */
  agencyArranged?: boolean;
  /** How many tenants share this tenancy's fee. 1 for a sole referral. A joint
      tenancy is priced once and charged by share, so every figure on the page is a
      share and the basis beside it is a fact about the whole tenancy. */
  tenantCount?: number;
  status?: string;
  isPaid?: boolean;
  isExpired?: boolean;
  isClosed?: boolean;
  payable?: boolean;
  /** True on a network / 5xx / 429 blip — keep the prior state, never a hard error. */
  transient?: boolean;
  error?: string;
}

export function getPayPageState(status: string | null | undefined, paymentState: string | null | undefined) {
  const normalizedStatus = status ?? '';
  const normalizedPaymentState = paymentState ?? '';
  const isRefunded = normalizedPaymentState === 'refunded';
  const isPaid = !isRefunded && (normalizedStatus === 'paid' || normalizedStatus === 'deed' || normalizedPaymentState === 'paid');
  const isExpired = normalizedStatus === 'expired';
  const isClosed = normalizedStatus === 'withdrawn' || isRefunded;
  const payable = !isRefunded && (normalizedStatus === 'sent' || normalizedStatus === 'expired');
  return { isPaid, isExpired, isClosed, payable };
}

/* The demo priced the fee AT THE RENT, £2,200 against £2,200, which is the exact
   shape of the defect this page was fixed for. A fixture that models the bug
   teaches the bug: anybody reading it, or screenshotting the page with no back
   end, learns that the fee is a month of rent. It is now an agency referral on a
   three-week agreement, so the demo exercises the basis line and the
   agency-arranged opening rather than the two paths that need no explaining. */
const DEMO: PayPageData = {
  ok: true, ref: 'GR-20608', partnerName: 'Acme Property Group', tenantName: 'Mr Alex Turner', tenantTitle: 'Mr',
  addr1: '12 Sydney Street', postcode: 'SW3 6PU', propFull: '12 Sydney Street, London, SW3 6PU',
  tenancyStart: '1 Sep 2026', guaranteeExpiry: '31 Aug 2027', monthlyRent: 2200, feeGBP: '£1,523.08',
  feeBasis: '3 weeks of rent', rentShare: 2200, tenantCount: 1,
  rail: 'agency', referencingMode: 'pre_referenced_open',
  agencyName: 'Marylebone & Co', agencyArranged: true,
  status: 'sent', isPaid: false, isExpired: false, isClosed: false, payable: true,
};

/** Load the public-safe payment data for a token (also logs the first view). */
export async function getPayPage(token: string): Promise<PayPageData> {
  if (!SUPABASE_ENABLED) return DEMO;
  try {
    const { data, error } = await sb().functions.invoke('payment-page', { body: { token, action: 'view' } });
    if (error) {
      // A definitive 4xx is an answer about the link itself: 410 expired, 404/400
      // invalid. Stop retrying and let the page show the expired/invalid state.
      // Only a 5xx, a 429 or a network failure is a blip worth retrying, so the
      // tenant no longer watches an endless spinner over a dead link.
      const status = (error as { context?: { status?: number } })?.context?.status;
      const definitive = typeof status === 'number' && status >= 400 && status < 500 && status !== 429;
      return { ok: false, transient: !definitive, error: definitive ? 'link' : 'network' };
    }
    return (data ?? { ok: false, transient: true }) as PayPageData;
  } catch {
    return { ok: false, transient: true, error: 'network' };
  }
}

/** Create a fresh Stripe Checkout session and return its URL to redirect to. */
export async function startCheckout(token: string, utm: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!SUPABASE_ENABLED) return { ok: false, error: 'Payments are not available in preview mode.' };
  try {
    const { data, error } = await sb().functions.invoke('payment-page', { body: { token, action: 'checkout', utm_source: utm } });
    if (error) return { ok: false, error: 'We could not start the payment. Please try again.' };
    return (data ?? { ok: false }) as { ok: boolean; url?: string; error?: string };
  } catch {
    return { ok: false, error: 'We could not start the payment. Please try again.' };
  }
}

/** #14 Record a tenant self-decline; returns the resulting application status. */
export async function declineApplication(token: string, reason: string): Promise<{ ok: boolean; status?: string; error?: string }> {
  if (!SUPABASE_ENABLED) return { ok: true, status: 'withdrawn' };
  try {
    const { data, error } = await sb().functions.invoke('payment-page', { body: { token, action: 'decline', reason } });
    if (error) return { ok: false, error: 'Could not record that. Please contact support@opndoor.co.' };
    return (data ?? { ok: false }) as { ok: boolean; status?: string; error?: string };
  } catch {
    return { ok: false, error: 'Could not record that. Please contact support@opndoor.co.' };
  }
}
