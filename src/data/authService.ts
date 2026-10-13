/* =====================================================================
   Auth service.

   Mock mode (no Supabase / tests): login/verify2fa are always-ok stubs so the
   two-step form and the render smoke test work with no back end.

   Supabase mode: real email/password + native TOTP MFA. Password sign-in gives
   an AAL1 session; enrolling or verifying a TOTP factor steps up to AAL2, which
   the database requires before it returns any data.
   ===================================================================== */
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';
import { portalEnvironment } from './devCentreService';

export interface LoginResult {
  ok: boolean;
  requires2fa: boolean;
  /** Masked email for the "we sent a code to…" line. */
  maskedEmail: string;
}

/** Mask an email for the 2FA step: "p••••@domain". */
export function maskEmail(email: string): string {
  const parts = email.split('@');
  if (!parts[0]) return email;
  return `${parts[0].charAt(0)}••••@${parts[1] || ''}`;
}

/* -------------------- mock mode (SUPABASE_ENABLED === false) -------------------- */

/** Mocked as always-ok. */
export function login(email: string, _password: string): LoginResult {
  return { ok: true, requires2fa: true, maskedEmail: maskEmail(email) };
}

/** Mocked as always-ok. */
export function verify2fa(_code: string): { ok: boolean } {
  return { ok: true };
}

/**
 * Self-service password reset. In Supabase mode this invokes the
 * send-password-reset Edge Function, which generates a recovery link and emails
 * it via the branded Resend template (redirected to the review address in this
 * test build). It never reveals whether the address has an account (the function
 * answers ok either way), so the UI keeps its neutral "if an account exists"
 * confirmation. It DOES reject when the send failed or the function is down, so
 * the caller can say so instead of promising an email nobody will get.
 * No-op in mock mode.
 */
export async function requestPasswordReset(
  email: string, audience: 'agent' | 'supplier' = 'agent',
): Promise<{ ok: boolean }> {
  if (!SUPABASE_ENABLED) return { ok: true };
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  // The tab travels with the request so it can travel back in the link.
  const { data, error } = await sb().functions
    .invoke('send-password-reset', { body: { email: email.trim(), origin, audience } });
  // Whether the address has an account is still invisible: the function answers
  // ok for both. What is no longer invisible is a send we failed to make.
  if (error || (data && data.ok === false)) {
    throw new Error((data && data.error) || 'We could not send that just now. Try again in a moment.');
  }
  return { ok: true };
}

/**
 * Spend a seven-day staff invitation token and get back the short-lived
 * Supabase link that signs the invitee in.
 *
 * An invitation email carries the portal's OWN token, not a GoTrue action
 * link, because GoTrue's expiry is one project-wide number shared with
 * password resets, whose copy promises thirty minutes. accept-invite checks
 * the token under the service role and mints the sign-in link at the moment
 * the person clicks.
 *
 * IT RETURNS THE SERVER'S SENTENCE RATHER THAN THROWING. Expired, already
 * used, cancelled and never issued are four different things to tell
 * somebody, and only one of them means "ask your administrator for another",
 * so the screen shows the reason instead of replacing it with "not valid".
 *
 * Mock mode cannot mint anything, so it refuses in the same shape.
 */
export async function openInvitation(
  token: string,
): Promise<{ ok: boolean; tokenHash?: string; type?: EmailOtpKind; tab?: string; error?: string }> {
  if (!SUPABASE_ENABLED) return { ok: false, error: 'Invitations cannot be opened in this environment.' };
  const { data, error } = await sb().functions.invoke('accept-invite', { body: { token } });
  if (data && data.ok && typeof data.token_hash === 'string') {
    return { ok: true, tokenHash: data.token_hash, type: (data.type as EmailOtpKind) ?? 'recovery', tab: data.tab };
  }
  return { ok: false, error: (data && data.error) || error?.message || 'We could not open your invitation. Please ask for a new one.' };
}

/** The GoTrue one-time-token kinds any of our emails can carry. */
export type EmailOtpKind = 'invite' | 'recovery' | 'signup' | 'magiclink' | 'email_change' | 'email';

const OTP_KINDS: EmailOtpKind[] = ['invite', 'recovery', 'signup', 'magiclink', 'email_change', 'email'];

/** Narrow a `type` off a URL to something verifyOtp will accept, or null. */
export function asOtpKind(v: string | null | undefined): EmailOtpKind | null {
  return v && (OTP_KINDS as string[]).includes(v) ? (v as EmailOtpKind) : null;
}

/**
 * Spend a one-time token from an emailed link and sign the holder in.
 *
 * THE POINT IS WHEN THIS IS CALLED, not what it does. Matt, 2026-10-13, after
 * fourteen Regent invites died inside twelve minutes: a corporate mail scanner
 * opened each link, and our links verified the token on page LOAD, so it was
 * spent before the person clicked. Every emailed auth link now carries a
 * `token_hash` to a page of ours that does nothing until a button is pressed,
 * and this is what the button calls.
 *
 * verifyOtp is a POST. A scanner fetching the page cannot reach it.
 */
export async function confirmEmailLink(
  tokenHash: string, type: EmailOtpKind,
): Promise<{ ok: boolean; error?: string }> {
  if (!SUPABASE_ENABLED) return { ok: false, error: 'Links cannot be confirmed in this environment.' };
  const { error } = await sb().auth.verifyOtp({ token_hash: tokenHash, type });
  if (!error) return { ok: true };
  return { ok: false, error: error.message };
}

/* -------------------- Supabase mode -------------------- */

export interface AuthResult {
  ok: boolean;
  error?: string;
}

/** Step 1: email + password. Establishes an AAL1 session. A deactivated (banned)
    account is blocked here; we surface a clean, partner-safe message and never
    the raw GoTrue error. */
export async function signIn(email: string, password: string): Promise<AuthResult> {
  const { error } = await sb().auth.signInWithPassword({ email: email.trim(), password });
  if (!error) return { ok: true };
  const msg = (error.message || '').toLowerCase();
  const code = ((error as { code?: string }).code || '').toLowerCase();
  if (code === 'user_banned' || msg.includes('banned')) {
    return { ok: false, error: 'This account has been deactivated. Contact your administrator.' };
  }
  return { ok: false, error: 'Wrong email or password.' };
}

/** What stopped a password change, so a screen can say the right sentence. */
export type PasswordChangeProblem =
  | 'wrong_current'      // the current password they typed is not theirs
  | 'rejected'           // the new one broke a rule; `error` says which
  | 'same_as_old'        // it is the password they already have
  | 'needs_sign_in'      // the session is too old, too weak, or gone
  | 'not_signed_in'
  | 'failed';            // anything else, and it is reported as itself

export interface PasswordChangeResult {
  ok: boolean;
  problem?: PasswordChangeProblem;
  error?: string;
}

/** GoTrue's own code for a failure, which is stable where the message is not. */
const codeOf = (e: unknown): string =>
  String((e as { code?: string; error_code?: string } | null)?.code
    ?? (e as { error_code?: string } | null)?.error_code ?? '').toLowerCase();

/**
 * CHANGE YOUR OWN PASSWORD, WITHOUT AN EMAIL IN IT.
 *
 * Matt, 2026-10-13: "add 'Change password' for every signed-in user: current
 * password, new password twice, at least 8 characters, using
 * supabase.auth.updateUser. No email involved."
 *
 * WHY THE CURRENT PASSWORD IS CHECKED BY SIGNING IN WITH IT, on a client of
 * its own. `updateUser` takes no current password, so proving the holder knows
 * it means using it. Two things follow and both are deliberate:
 *
 *   * IT MUST NOT BE THE LIVE CLIENT. `signInWithPassword` REPLACES the
 *     session, and a fresh password sign-in has not seen a second factor, so a
 *     member of staff would be dropped from AAL2 to AAL1 -- whereupon Supabase
 *     refuses to change an MFA user's password at all. The check would break
 *     the thing it guards, and only for people with MFA, which here is
 *     everybody.
 *   * AND IT KEEPS GoTrue's RATE LIMIT, which is worth having. The threat this
 *     guards against is an unattended tab: somebody who has the session and
 *     wants the password. Unlimited guesses would help them. A sign-in attempt
 *     is throttled by GoTrue; a hand-rolled hash comparison in SQL would not
 *     be.
 *
 * THE BUG THIS REPLACES, FOUND BY MATT ON DEV AND THEN MEASURED.
 * The probe used to end with `probe.auth.signOut()`, and signOut defaults to
 * `scope: 'global'`, which revokes EVERY session the user has -- including the
 * one the person is sitting in. Demonstrated against dev: session A returned
 * 200 from /auth/v1/user, a second sign-in B then signed out globally, and A
 * returned 403, `session_not_found`. `updateUser` was then being called on a
 * session that no longer existed, which is why it failed and why the message
 * was the generic one. `scope: 'local'` touches no server at all.
 *
 * THE PROBE'S OWN SESSION IS LEFT TO EXPIRE, which is the one loose end and is
 * cheaper than the alternatives: 'others' would revoke the real session (the
 * same bug from the other side) and 'global' is what just broke it. It holds
 * no storage, refreshes nothing, and its access token lasts an hour.
 */
export async function changeOwnPassword(
  currentPassword: string, newPassword: string,
): Promise<PasswordChangeResult> {
  if (newPassword.length < 8) {
    return { ok: false, problem: 'rejected', error: 'Use at least 8 characters.' };
  }
  if (!SUPABASE_ENABLED) return { ok: true };

  const { data: me } = await sb().auth.getUser();
  const email = me.user?.email ?? '';
  if (!email) {
    return { ok: false, problem: 'not_signed_in', error: 'You are not signed in. Sign in and try again.' };
  }

  const probe = createClient(
    import.meta.env.VITE_SUPABASE_URL as string,
    import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    {
      auth: {
        // The three that keep it out of the way of the real session.
        storageKey: 'opndoor.password-check',
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  const { error: wrong } = await probe.auth.signInWithPassword({ email, password: currentPassword });
  /* LOCAL, NOT GLOBAL. See the note above: the default revokes every session
     the user has, which is the bug this function was reported for. Local calls
     no endpoint and only clears this client, which holds nothing anyway. */
  await probe.auth.signOut({ scope: 'local' }).catch(() => {});
  if (wrong) {
    /* A THROTTLE IS NOT A WRONG PASSWORD, and telling somebody their own
       password is wrong when the server simply refused to look is how an
       afternoon gets lost. */
    if (codeOf(wrong) === 'over_request_rate_limit' || /rate limit|too many/i.test(wrong.message || '')) {
      return { ok: false, problem: 'failed', error: 'Too many attempts just now. Wait a minute and try again.' };
    }
    return { ok: false, problem: 'wrong_current', error: 'That is not your current password.' };
  }

  const { error } = await sb().auth.updateUser({ password: newPassword });
  if (!error) return { ok: true };

  const code = codeOf(error);
  const msg = error.message || '';

  /* SAME AS THE OLD ONE. GoTrue: same_password, "New password should be
     different from the old password." */
  if (code === 'same_password' || /different from the old password/i.test(msg)) {
    return { ok: false, problem: 'same_as_old', error: 'That is the password you already have. Choose a different one.' };
  }

  /* A RULE, AND IT SAYS WHICH. GoTrue: weak_password, with a message that
     names the rule it broke -- "Password should be at least 6 characters", or
     the character classes, or that it has been found in a breach. Matt asked
     for "say which", and GoTrue's own sentence is the only thing that knows:
     the policy lives on the project, not in this code, so a hardcoded
     sentence here would be wrong the day somebody raises the minimum. */
  if (code === 'weak_password' || /weak|pwned|breach|leaked|should be at least|required characters/i.test(msg)) {
    return { ok: false, problem: 'rejected', error: msg || 'That password does not meet the rules.' };
  }

  /* THE SESSION, in all four ways it can be unusable: revoked, expired, below
     AAL2, or wanting a fresh reauthentication. Signing in again is the one
     thing that fixes every one of them. */
  if (['session_not_found', 'session_expired', 'insufficient_aal', 'reauthentication_needed', 'reauthentication_not_valid']
        .includes(code)
      || /session.*not exist|session.*expired|aal|assurance|factor|mfa|insufficient|reauthentication|nonce/i.test(msg)) {
    return { ok: false, problem: 'needs_sign_in', error: 'Your session has expired. Sign in again, then change your password.' };
  }

  /* AND ANYTHING ELSE IS REPORTED AS ITSELF. The generic sentence is what hid
     this bug for a day: "We could not change your password" told Matt nothing,
     and the real answer was sitting in `error.message`. */
  return { ok: false, problem: 'failed', error: msg ? `We could not change your password: ${msg}` : 'We could not change your password. Please try again.' };
}

export interface FactorState {
  aal: string;
  hasVerifiedFactor: boolean;
  factorId: string | null;
  /** #92 False when the factor read failed (no/expired session/token). Callers must
      NOT treat this as "zero verified factors" and must not start enrolment. */
  ok: boolean;
}

/** Assurance level + whether the user already has a verified TOTP factor. */
export async function factorState(): Promise<FactorState> {
  const { data: aalData, error: aalErr } = await sb().auth.mfa.getAuthenticatorAssuranceLevel();
  const { data: fData, error: listErr } = await sb().auth.mfa.listFactors();
  const verified = (fData?.totp ?? []).filter((f) => f.status === 'verified');
  return {
    aal: aalData?.currentLevel ?? 'aal1',
    hasVerifiedFactor: verified.length > 0,
    factorId: verified[0]?.id ?? null,
    // #92 A read failure (missing/expired token) must be distinguishable from a
    // genuine "no factors", so callers never start a bogus enrolment.
    ok: !aalErr && !listErr,
  };
}

export interface EnrolResult extends AuthResult {
  factorId?: string;
  /** SVG markup for the QR code. */
  qr?: string;
  secret?: string;
  uri?: string;
}

/** Begin TOTP enrolment: returns a QR code + secret to add to an authenticator.
    Robust against a stale factor left by an abandoned attempt (which otherwise
    surfaced a raw "a factor with the friendly name '' already exists" error): we
    drop unverified factors first, and if enrolment still collides we clear every
    TOTP factor and retry once. Any failure returns a clean, mapped message. */
/* =====================================================================
   WHICH OPNDOOR THE PHONE IS SHOWING YOU.

   Matt, 2026-10-01: "Authenticator labels: on dev, the issuer shows as
   'opndoor DEV' so dev and live entries can't be confused. On live it
   stays 'opndoor'."

   An authenticator entry is labelled issuer + account, and the account
   half is the person's email -- the same email on both projects. So
   somebody who holds an account on dev and on live had two entries
   reading "opndoor (rosa@regents.co.uk)", identical, six digits each,
   and no way to tell which one the sign-in screen in front of them
   wants.

   THE EXISTING PREDICATE, NOT A SECOND ONE. `portalEnvironment()`
   already answers "which project is this" from the Supabase URL's ref,
   against the same list the Stripe key guard uses, and its own comment
   is emphatic that there must not be two answers to that question. Its
   rule that an UNRECOGNISED project counts as production applies here
   too, and is the right way round for the same reason: a live entry is
   the one that must be labelled plainly.
   ===================================================================== */
export function totpIssuer(): string {
  return portalEnvironment().id === 'development' ? 'opndoor DEV' : 'opndoor';
}

export async function enrolTotp(): Promise<EnrolResult> {
  // enrolTotp is only reached when the user has NO verified factor, so any
  // factors present are stale unverified attempts. Clear them all (best effort),
  // then enrol with a UNIQUE friendly name. The unique name is what makes this
  // bulletproof: the default empty name collides ("a factor with the friendly
  // name '' already exists") whenever a stale factor lingers, which previously
  // stranded invitees at the two-factor step. On failure we surface the real
  // GoTrue message rather than a blanket one.
  /* UNVERIFIED ONLY, WHICH THE COMMENT ABOVE ALWAYS ASSUMED AND THE CODE
     DID NOT. This looped every TOTP factor and unenrolled it, verified
     ones included, on the strength of "enrolTotp is only reached when the
     user has NO verified factor". Both callers do check that first -- so
     it has never fired on a live factor -- but a guard that holds only
     while every caller remembers is the kind this codebase keeps having
     to fix. A third caller, or a stale read of `hasVerifiedFactor`,
     would have had this silently destroy somebody's working
     authenticator and lock them out of their own account.

     Raised while reading this path for Matt's reset-two-factor report,
     2026-10-01. It is not that bug -- see the queue -- but it is the
     same shape of hazard and a line to fix while it is in front of me. */
  try {
    const { data } = await sb().auth.mfa.listFactors();
    for (const f of (data?.totp ?? [])) {
      if (f.status === 'verified') continue;
      try { await sb().auth.mfa.unenroll({ factorId: f.id }); } catch { /* best effort */ }
    }
  } catch { /* best effort */ }
  const friendlyName = `opndoor ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  /* ISSUER, so the entry in the authenticator app says who it is for.

     Without it GoTrue labels the entry with the project reference, so a person
     who holds accounts on more than one opndoor environment, or who has any
     other Supabase-backed app, sees a list of indistinguishable six-digit codes
     labelled with opaque strings. The account half of the label is the user's
     own email, which GoTrue takes from the session, so the entry reads
     "opndoor (rosa@regents.co.uk)".

     friendlyName stays unique and separate: it is our own handle for the factor
     row and is what stops the duplicate-name collision that used to strand
     invitees. It is not what the phone displays. */
  const res = await sb().auth.mfa.enroll({ factorType: 'totp', friendlyName, issuer: totpIssuer() });
  if (res.error || !res.data) {
    const detail = res.error?.message ?? '';
    // #92/#73 Never surface a raw server-ism. A session/token error means the
    // session lapsed, so ask the user to sign in again rather than echoing GoTrue.
    if (/bearer|not authenticated|unauthorized|session|jwt|expired/i.test(detail)) {
      return { ok: false, error: 'Your session has expired. Please sign in again.' };
    }
    return { ok: false, error: detail ? `We could not start two-factor setup: ${detail}` : 'We could not start two-factor setup. Please try again, or ask your administrator to reset your 2FA.' };
  }
  return { ok: true, factorId: res.data.id, qr: res.data.totp.qr_code, secret: res.data.totp.secret, uri: res.data.totp.uri };
}

/* WHAT THE PHONE WILL DISPLAY, read back off the otpauth URI.

   An otpauth URI is otpauth://totp/LABEL?secret=...&issuer=ISSUER, where LABEL
   is either "account" or "issuer:account". Both halves matter and they are
   carried twice, in the path and in the query, so a URI can disagree with
   itself; the query parameter is the authoritative issuer per the Key Uri
   Format, and the path is what older apps read.

   Exported so the labelling can be ASSERTED rather than eyeballed on a phone,
   which is the only reason it exists as a function. */
export function otpauthParts(uri: string): { issuer: string; account: string } {
  try {
    const u = new URL(uri);
    // The pathname is '/' + the label, percent-encoded.
    const label = decodeURIComponent(u.pathname.replace(/^\/+/, ''));
    const colon = label.indexOf(':');
    const pathIssuer = colon > -1 ? label.slice(0, colon) : '';
    const account = colon > -1 ? label.slice(colon + 1) : label;
    return { issuer: u.searchParams.get('issuer') || pathIssuer, account: account.trim() };
  } catch {
    return { issuer: '', account: '' };
  }
}

/** Verify a 6-digit code against a factor (enrolment or step-up). Reaches AAL2.
    Returns clean, mapped messages (never the raw GoTrue error). */
export async function verifyCode(factorId: string, code: string): Promise<AuthResult> {
  const { data: challenge, error: cErr } = await sb().auth.mfa.challenge({ factorId });
  if (cErr || !challenge) return { ok: false, error: 'We could not verify that code. Please try again.' };
  const { error } = await sb().auth.mfa.verify({ factorId, challengeId: challenge.id, code });
  return error ? { ok: false, error: 'That code was not right. Try again.' } : { ok: true };
}

export async function signOut(): Promise<void> {
  await sb().auth.signOut();
}
