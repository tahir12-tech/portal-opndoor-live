/* =====================================================================
   Tenant sessions.

   A SEPARATE SUPABASE CLIENT, WITH ITS OWN STORAGE KEY. This is the important
   line in the file. The staff client uses the default key, and SessionContext
   reacts to whatever session it finds by looking the user up in public.users. A
   tenant has no row there, so sharing one client would mean a signed-in tenant
   putting the staff app into a permanent "could not load your profile" state,
   and a signed-in member of staff being treated as a half-loaded tenant. Two
   keys, two sessions, neither aware of the other, and a laptop can hold both.

   STAYING SIGNED IN ACROSS DEVICES is what persistSession plus autoRefreshToken
   already give: each device holds its own refresh token and renews it silently.
   There is no server-side session list to sync, and there should not be, because
   the alternative is inventing one for a screen a tenant visits four times.
   ===================================================================== */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ENABLED } from '@/lib/supabase';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const tenantClient: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: {
          // The one thing that keeps the two apps apart.
          storageKey: 'opndoor.tenant.auth',
          persistSession: true,
          autoRefreshToken: true,
          // The verify and reset links carry their token in the fragment and
          // are exchanged explicitly on those pages, so the client must not
          // race us to consume it.
          detectSessionInUrl: false,
        },
      })
    : null;

export function tsb(): SupabaseClient {
  if (!tenantClient) throw new Error('Tenant auth is not configured.');
  return tenantClient;
}

/* ---------------------------------------------------------------------------
   Mock mode: a session is a flag. Enough to walk the journey, and it says so.
   --------------------------------------------------------------------------- */
const MOCK_SESSION = 'opndoor.tenant.demo.session';

export interface TenantIdentity { email: string; first_name: string; last_name: string }

export function mockSignedIn(): TenantIdentity | null {
  try {
    const raw = localStorage.getItem(MOCK_SESSION);
    return raw ? (JSON.parse(raw) as TenantIdentity) : null;
  } catch { return null; }
}
export function mockSignIn(id: TenantIdentity) {
  try { localStorage.setItem(MOCK_SESSION, JSON.stringify(id)); } catch { /* session only */ }
}
export function mockSignOut() {
  try { localStorage.removeItem(MOCK_SESSION); } catch { /* nothing to clear */ }
}

/* ---------------------------------------------------------------------------
   The public front-door calls. None of these needs a session.
   --------------------------------------------------------------------------- */
async function publicCall(action: string, payload: Record<string, unknown> = {}) {
  const res = await fetch(`${url}/functions/v1/tenant-auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key ?? '', Authorization: `Bearer ${key ?? ''}` },
    body: JSON.stringify({ action, origin: window.location.origin, ...payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (data?.ok === false) throw new Error(data.error ?? 'Request failed.');
  return data;
}

export interface PrequalAnswers {
  monthly_rent: number;
  share_amount?: number | null;
  annual_income: number;
  is_student: boolean;
  adverse_credit: boolean;
}
export interface PrequalResult {
  outcome: 'not_ruled_out' | 'ruled_out' | null;
  reason: string | null;
  rent_basis: number | null;
  income_needed_monthly: number | null;
  declared_adverse_credit: boolean;
}

export async function prequalifyAnon(a: PrequalAnswers): Promise<PrequalResult> {
  if (!SUPABASE_ENABLED) {
    // The same rules as assess_eligibility. Kept beside the SQL on purpose: if
    // these drift the demo is lying about the product.
    const basis = a.share_amount && a.share_amount > 0 ? a.share_amount : a.monthly_rent;
    const needed = Math.round(basis * 1.5 * 100) / 100;
    const ruledOut = !a.is_student && a.annual_income / 12 < needed;
    return {
      outcome: ruledOut ? 'ruled_out' : 'not_ruled_out',
      reason: ruledOut ? 'affordability_below_threshold' : null,
      rent_basis: basis, income_needed_monthly: needed,
      declared_adverse_credit: a.adverse_credit,
    };
  }
  return await publicCall('prequalify', { ...a });
}

export async function register(input: {
  email: string; password: string; first_name: string; last_name: string;
  phone?: string; invite?: string;
}) {
  if (!SUPABASE_ENABLED) {
    mockSignIn({ email: input.email, first_name: input.first_name, last_name: input.last_name });
    return { ok: true, mock: true };
  }
  return await publicCall('register', input);
}

export async function requestReset(email: string) {
  if (!SUPABASE_ENABLED) return { ok: true };
  return await publicCall('request_reset', { email });
}
export async function resendVerification(email: string) {
  if (!SUPABASE_ENABLED) return { ok: true };
  return await publicCall('resend_verification', { email });
}
export async function inviteInfo(token: string) {
  if (!SUPABASE_ENABLED) {
    return { ok: true, valid: true, email: 'demo.tenant@example.invalid',
             prop_addr1: '12 Bramble Court', prop_postcode: 'S7 1FD',
             monthly_rent: 1450, tenancy_start: null, already_claimed: false };
  }
  return await publicCall('invite_info', { token });
}

export async function signIn(email: string, password: string) {
  if (!SUPABASE_ENABLED) {
    mockSignIn({ email, first_name: 'Sam', last_name: 'Okafor' });
    return;
  }
  const { error } = await tsb().auth.signInWithPassword({ email, password });
  // One message for a wrong password and an unknown address, so the form is not
  // an oracle for which addresses have accounts.
  if (error) throw new Error('That email address and password do not match.');
}

export async function signOut() {
  if (!SUPABASE_ENABLED) { mockSignOut(); return; }
  await tsb().auth.signOut();
}

/**
 * Exchange a six-digit code for a session.
 *
 * The code proves the address; the SESSION still comes from Supabase Auth. The
 * function returns a one-time token which is redeemed here, so the code is
 * never itself a credential the browser holds on to.
 */
export async function verifyCode(email: string, code: string): Promise<void> {
  if (!SUPABASE_ENABLED) {
    // Mock mode has no mail. Any six digits sign you in, and the screen says so,
    // rather than inventing a code the walker has no way to receive.
    if (code.replace(/\D/g, '').length !== 6) throw new Error('Enter the six digits from your email.');
    mockSignIn({ email, first_name: 'Sam', last_name: 'Okafor' });
    return;
  }
  const r = await publicCall('verify_code', { email, code });
  const { error } = await tsb().auth.verifyOtp({ token_hash: r.token_hash, type: 'magiclink' });
  if (error) throw new Error('Could not sign you in. Try signing in with your password.');
}

/** Exchange the token in a reset link for a session. */
export async function exchangeLinkToken(): Promise<'signup' | 'recovery' | null> {
  if (!SUPABASE_ENABLED) return null;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const token_hash = hash.get('token_hash');
  const type = hash.get('type') as 'signup' | 'recovery' | null;
  if (!token_hash || !type) return null;
  const { error } = await tsb().auth.verifyOtp({ token_hash, type });
  if (error) throw new Error('That link has expired or has already been used.');
  return type;
}

export async function setPassword(password: string) {
  if (!SUPABASE_ENABLED) return;
  const { error } = await tsb().auth.updateUser({ password });
  if (error) throw new Error(error.message);
}

export async function currentTenant(): Promise<TenantIdentity | null> {
  if (!SUPABASE_ENABLED) return mockSignedIn();
  const { data } = await tsb().auth.getUser();
  if (!data?.user) return null;
  return { email: data.user.email ?? '', first_name: '', last_name: '' };
}

/** The bearer the tenant-portal function expects. */
export async function tenantAccessToken(): Promise<string | null> {
  if (!SUPABASE_ENABLED) return null;
  const { data } = await tsb().auth.getSession();
  return data.session?.access_token ?? null;
}
