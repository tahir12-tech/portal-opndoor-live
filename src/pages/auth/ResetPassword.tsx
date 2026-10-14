/* =====================================================================
   Set-password landing screen for BOTH the password-reset link
   (send-password-reset) and the team-invite link (invite-user). Supabase's
   detectSessionInUrl turns the recovery/invite token in the URL into a session;
   this screen runs the WHOLE completion here, on the single recovery session, so
   there is no /login handoff and the single-use link is never re-consumed.

   Proven server-side: a recovery session sets the password at AAL1, enrols a
   TOTP factor, verifies it to AAL2, and the new password signs in. So the flow:

   invite (new user, no factor):  password -> enrol QR -> verify -> dashboard.
   reset  (user with a factor):   verify existing TOTP (step up to AAL2, required
                                   to change an MFA user's password) -> password
                                   -> sign out -> "back to sign in".

   The route is PUBLIC (outside RequireAuth), so the AAL1 session never routes
   the user into the app before they finish.
   ===================================================================== */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { carriedStaffTab, forgotHref, signInHref } from './carry';
import { authService } from '@/data';
import { asOtpKind } from '@/data/authService';
import { SUPABASE_ENABLED, sb } from '@/lib/supabase';
import { useSession } from '@/session/SessionContext';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { AuthenticatorAppHelp } from '@/components/auth/AuthenticatorAppHelp';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import './auth.css';
import '../ForgotPassword/ForgotPassword.css';

type Phase = 'confirm' | 'checking' | 'redeeming' | 'stepup' | 'password' | 'enrol' | 'done' | 'invalid';

const COPY = {
  reset: { title: 'Set a new password', eyebrow: 'Account recovery', brandH1: 'Choose a new password.', invalidLead: 'Your reset link may have expired or already been used. Request a new one and we will email you a fresh link.', invalidCta: { to: '/forgot-password?tab=agent', label: 'Request a new link' } },
  invite: { title: 'Set your password', eyebrow: 'Welcome to opndoor', brandH1: 'Set your password to get started.', invalidLead: 'Your invitation may have expired or already been used. Ask your administrator to resend it.', invalidCta: { to: '/login', label: 'Back to sign in' } },
} as const;

/** Honest, distinct error mapping (#73). */
function mapUpdateError(msg: string): string {
  const m = (msg || '').toLowerCase();
  if (/reauthentication|nonce/.test(m)) return 'For your security, verify your authenticator code and try again.';
  if (/aal|assurance|factor|mfa|insufficient/.test(m)) return 'Please verify your authenticator code first, then set your password.';
  if (/expired|already|token|invalid|no.*session|session.*missing|not authenticated|unauthorized/.test(m)) return 'This link has expired or was already used. Ask for a fresh one.';
  if (/password|weak|character|length|pwned|breach|strength|at least/.test(m)) return `That password was rejected: ${msg}`;
  return msg ? `We could not set your password: ${msg}` : 'We could not set your password. Please try again.';
}

export function ResetPassword({ mode = 'reset' }: { mode?: 'reset' | 'invite' }) {
  const c = COPY[mode];
  const [sp] = useSearchParams();
  /* The audience rides in the recovery link, so an expired one puts somebody
     back on the tab they started from instead of guessing Agent for everybody.
     Falls back to the hardcoded default when the link predates this, or when
     the allowlist made the sender drop the parameter. */
  const invalidCta = mode === 'reset'
    ? { ...c.invalidCta, to: forgotHref(carriedStaffTab(sp), '') }
    : { ...c.invalidCta, to: signInHref(carriedStaffTab(sp), '') };
  /* AND EVERY WAY BACK TO SIGN IN, not only the one on the expired-link
     screen. Matt, 2026-10-01: "Password reset and invite links send each
     person to the sign-in tab for their own type ... Check every email
     link that lands on the sign-in page." There are four of them on this
     page and three were a bare /login, which is the Agent tab for
     everybody -- so a supplier who had just set their password was sent
     to the wrong door, by the page that knew which door they came from.
     A tenant never reaches this page: their reset lands on /apply/reset. */
  const backToSignIn = signInHref(carriedStaffTab(sp), '');
  useDocumentTitle(c.title);
  const navigate = useNavigate();
  const { status, markMfaVerified } = useSession();
  /* A LINK IN THE URL OPENS ON THE BUTTON, not on a spinner: the page has
     nothing to check until somebody asks it to. */
  const [phase, setPhase] = useState<Phase>(
    !SUPABASE_ENABLED ? 'password'
      : (sp.get('token') || sp.get('token_hash')) ? 'confirm'
      : 'checking',
  );
  const [hadFactor, setHadFactor] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /* The server's own sentence for a refused invitation, which is more use
     than "not valid": it says expired, used, cancelled or never issued. */
  const [tokenError, setTokenError] = useState('');

  // Once TOTP is verified (invite completion) the session reaches AAL2 and
  // SessionContext resolves to 'ready'; route on to the app then (mirrors Login).
  useEffect(() => {
    if (SUPABASE_ENABLED && status === 'ready') navigate('/home', { replace: true });
  }, [status, navigate]);

  /* THE SEVEN-DAY TOKEN, REDEEMED BEFORE ANYTHING ELSE.
     Matt, 2026-10-09: "7-day links, Accept invite page, sent date, expiry,
     resend and cancel."

     An invitation email now carries OUR token, because GoTrue's expiry is one
     project-wide number shared with password resets. Landing here with
     ?token= means the person has not been signed in yet: accept-invite spends
     the token, mints a short-lived Supabase link and hands it back, and we
     navigate to it. That link comes straight back to this page with the usual
     fragment, where detectSessionInUrl takes over and the effect below runs
     exactly as it always has.

     WHY A POST AND NOT A REDIRECT, which is the half that fixes what Matt
     watched happen: a mail gateway pre-fetching the old email's button spent
     the invitation at delivery. Loading this page does nothing; only this
     call spends anything.

     ONE ATTEMPT. The ref, not the state, because two renders must not spend
     two tokens, and a spent token refuses the second time with its own
     sentence. */
  const inviteToken = sp.get('token');
  const tokenHash = sp.get('token_hash');
  const linkType = asOtpKind(sp.get('type'));
  /* A LINK IN HAND, EITHER SHAPE. `token` is our own seven-day invitation
     token; `token_hash` is a GoTrue one-time token straight from an email.
     Both mean "somebody is holding a credential and has not been signed in
     yet", and both are spent on the SAME click. */
  const hasLink = Boolean(inviteToken || tokenHash);
  const spent = useRef(false);

  /* NOTHING HAPPENS ON LOAD. THIS IS THE WHOLE FIX.
     Matt, 2026-10-13: "The /auth/confirm page must do nothing with the token
     on load. It shows the branded 'Set your password' screen with a button,
     and only the button click calls supabase.auth.verifyOtp."

     WHY, in his own evidence: fourteen Regent invites went out between 07:45
     and 07:50 UTC and by 07:57 thirteen had `last_sign_in_at` set while
     `public.users.status` was still pending. A scanner cannot set
     last_sign_in_at; GoTrue does, when the verify endpoint is hit. So a
     session was minted for every one of them and no human was ever in it.

     THE OLD CODE REDEEMED IN AN EFFECT, which was safe against a plain fetch
     and NOT against a scanner that renders the page: an effect runs in a
     headless browser exactly as it does in a real one. A button does not.

     ONE ATTEMPT, by a ref rather than state, because two clicks must not
     spend two tokens and a spent token refuses the second time. */
  async function submitConfirm() {
    if (spent.current || busy) return;
    spent.current = true;
    setBusy(true);
    setTokenError('');
    try {
      let hash = tokenHash;
      let kind = linkType ?? 'recovery';
      /* OUR SEVEN-DAY TOKEN FIRST, where there is one: accept-invite spends it
         and hands back a short-lived GoTrue token_hash. Both halves happen on
         this click, so a scanner reaches neither. */
      if (inviteToken) {
        const r = await authService.openInvitation(inviteToken);
        if (!r.ok || !r.tokenHash) {
          /* THE REASON IS THE POINT. Expired, already used, cancelled and
             never issued are four different things, and only one of them
             means "ask your administrator for another". The server writes the
             sentence; this screen shows it rather than replacing it with
             "not valid". */
          spent.current = false;
          setTokenError(r.error ?? '');
          setPhase('invalid');
          return;
        }
        hash = r.tokenHash;
        kind = r.type ?? 'recovery';
      }
      if (!hash) { setPhase('invalid'); return; }
      const v = await authService.confirmEmailLink(hash, kind);
      if (!v.ok) {
        /* A USED OR EXPIRED TOKEN STILL SHOWS THE EXISTING SCREEN, which is
           Matt's point 3. GoTrue's own wording for a spent token is not a
           sentence to show somebody, so this falls back to the mode's copy. */
        setTokenError('');
        setPhase('invalid');
        return;
      }
      /* THE SESSION EXISTS NOW, so the effect below takes over and decides
         between step-up, password and enrolment exactly as it always has. */
      setPhase('checking');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!SUPABASE_ENABLED) return;
    /* A LINK WAITING TO BE CONFIRMED MEANS NO SESSION YET, so the 1.5s
       fallback below must not fire and call it invalid while the page is
       sitting there waiting for a click. The button owns the screen until it
       hands over, and it hands over by setting 'checking'. */
    if (hasLink && phase === 'confirm') return;
    let settled = false;
    const decide = async () => {
      if (settled) return;
      const { data } = await sb().auth.getSession();
      if (!data.session) return;
      settled = true;
      try {
        const fs = await authService.factorState();
        // A verified factor means AAL2 is required to change the password, so we
        // step up first. No verified factor -> straight to setting the password.
        if (fs.hasVerifiedFactor && fs.factorId && fs.aal !== 'aal2') { setHadFactor(true); setFactorId(fs.factorId); setPhase('stepup'); }
        else { setHadFactor(fs.hasVerifiedFactor); setPhase('password'); }
      } catch {
        setPhase('password');
      }
    };
    const { data: sub } = sb().auth.onAuthStateChange((_evt, session) => { if (session) void decide(); });
    void decide();
    const t = setTimeout(() => {
      if (settled) return;
      sb().auth.getSession().then(({ data }) => { if (!settled) { if (data.session) void decide(); else { settled = true; setPhase('invalid'); } } });
    }, 1500);
    return () => { sub.subscription.unsubscribe(); clearTimeout(t); };
  }, [hasLink, phase]);

  // Step up an existing MFA user's session to AAL2 before the password change.
  async function submitStepup(e: FormEvent) {
    e.preventDefault();
    setError('');
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6 || !factorId) { setError('Enter the 6-digit code from your authenticator.'); return; }
    if (busy) return;
    setBusy(true);
    try {
      const r = await authService.verifyCode(factorId, digits);
      if (!r.ok) { setError(r.error ?? 'That code was not right. Try again.'); setCode(''); return; }
      setCode('');
      setPhase('password'); // now AAL2
    } finally { setBusy(false); }
  }

  async function submitPassword(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (pw.length < 8) { setError('Use at least 8 characters.'); return; }
    if (pw !== pw2) { setError('Those passwords do not match.'); return; }
    if (busy) return;
    setBusy(true);
    try {
      if (SUPABASE_ENABLED) {
        const { error: upErr } = await sb().auth.updateUser({ password: pw });
        if (upErr) {
          // If the password write is refused for AAL reasons (an MFA user whose
          // factor we did not detect up front), recover into the step-up flow
          // rather than stranding on the password screen with a dead-end message.
          if (/aal|assurance|factor|mfa|insufficient/i.test(upErr.message)) {
            const fs = await authService.factorState();
            if (fs.hasVerifiedFactor && fs.factorId && fs.aal !== 'aal2') {
              setHadFactor(true); setFactorId(fs.factorId); setCode(''); setPhase('stepup');
              setError('Please verify your authenticator code, then set your password.');
              return;
            }
          }
          setError(mapUpdateError(upErr.message));
          return;
        }
      }
      if (mode === 'reset') {
        if (SUPABASE_ENABLED) await sb().auth.signOut(); // fresh sign-in next.
        setPhase('done');
        return;
      }
      // invite: an existing MFA user is already AAL2 -> straight in; a new user
      // enrols their authenticator here (one unbroken journey).
      if (!SUPABASE_ENABLED) { setPhase('done'); return; }
      if (hadFactor) { markMfaVerified(); return; } // the status->ready effect routes to the app
      const en = await authService.enrolTotp();
      if (!en.ok || !en.factorId) { setError(en.error ?? 'We could not start two-factor setup.'); return; }
      setFactorId(en.factorId);
      setQr(en.qr ?? '');
      setSecret(en.secret ?? '');
      setPhase('enrol');
    } catch (e2) {
      setError(mapUpdateError(e2 instanceof Error ? e2.message : ''));
    } finally { setBusy(false); }
  }

  // Verify the freshly enrolled factor -> AAL2 -> the status->ready effect routes on.
  async function submitEnrol(e: FormEvent) {
    e.preventDefault();
    setError('');
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 6 || !factorId) { setError('Enter the 6-digit code from your authenticator app.'); return; }
    if (busy) return;
    setBusy(true);
    try {
      const r = await authService.verifyCode(factorId, digits);
      if (!r.ok) { setError(r.error ?? 'That code was not right. Try again.'); setCode(''); return; }
      markMfaVerified();
    } finally { setBusy(false); }
  }

  const codeField = (onSubmit: (e: FormEvent) => void, label: string, cta: string) => (
    <form className="auth__form" onSubmit={onSubmit} noValidate>
      <div className="field">
        <label htmlFor="code">{label}</label>
        <input id="code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} required />
      </div>
      {error && <p className="auth__error" role="alert" style={{ color: 'var(--danger, #c0392b)' }}>{error}</p>}
      <Button variant="primary" block type="submit" arrow disabled={busy}>{busy ? 'Verifying…' : cta}</Button>
    </form>
  );

  return (
    <div className="auth">
      <aside className="auth__brand">
        <div className="auth__brand-top">
          <span className="wordmark">opndoor</span>
          <span className="auth__cobrand">Guarantee<br />Referral Portal</span>
        </div>
        <div className="auth__brand-mid">
          <span className="auth__eyebrow">{c.eyebrow}</span>
          <h1 className="auth__brand-h1">{c.brandH1}</h1>
          <p className="auth__brand-copy">Set a strong password, then confirm your identity with an authenticator app. Two-factor authentication is required on every sign in.</p>
        </div>
        <div className="auth__flow">
          <div className="auth__flow-item"><span className="auth__flow-ic"><Icon name="lock" /></span><div><div className="auth__flow-t">{mode === 'invite' ? 'Set your password' : 'Set a new password'}</div><div className="auth__flow-s">At least 8 characters</div></div></div>
          <div className="auth__flow-item"><span className="auth__flow-ic"><Icon name="shield" /></span><div><div className="auth__flow-t">Two-factor authentication</div><div className="auth__flow-s">Verify with your authenticator code</div></div></div>
        </div>
      </aside>

      <section className="auth__form-wrap">
        <div className="auth__card">
          {phase === 'checking' && (<div><h2 className="auth__title">Checking your link…</h2><p className="auth__sub">One moment while we verify your link.</p></div>)}

          {phase === 'redeeming' && (<div><h2 className="auth__title">Opening your invitation…</h2><p className="auth__sub">One moment while we check your invitation.</p></div>)}

          {/* THE BUTTON THAT SPENDS THE TOKEN, and the only thing that does.
              Matt, 2026-10-13: "It shows the branded 'Set your password'
              screen with a button, and only the button click calls
              supabase.auth.verifyOtp."

              THE COPY IS THE MODE'S OWN, so an invitation says "Set your
              password to get started" and a reset says "Choose a new
              password", which is what the brand panel beside it already
              says. The button is the one new sentence. */}
          {phase === 'confirm' && (
            <div>
              <h2 className="auth__title">{c.title}</h2>
              <p className="auth__sub">
                {mode === 'invite'
                  ? 'Your invitation is ready. Continue to choose a password and set up two-factor authentication.'
                  : 'Your reset link is ready. Continue to choose a new password.'}
              </p>
              <div className="auth__form">
                <Button variant="primary" block arrow disabled={busy} onClick={() => void submitConfirm()}>
                  {busy ? 'Opening…' : (mode === 'invite' ? 'Continue' : 'Continue')}
                </Button>
              </div>
              <p className="auth__foot"><Link to={backToSignIn}>Back to sign in</Link></p>
            </div>
          )}

          {phase === 'invalid' && (
            <div>
              <div className="confirm-ic"><Icon name="alert" strokeWidth={2.4} /></div>
              <h2 className="auth__title">This link is not valid</h2>
              <p className="auth__sub">{tokenError || c.invalidLead}</p>
              <div className="auth__form"><Button variant="primary" block to={invalidCta.to}>{invalidCta.label}</Button></div>
              {/* ONE WAY BACK, NOT THE SAME WAY TWICE. Matt, 2026-10-09, on
                  live: "The 'This link is not valid' page shows 'Back to sign
                  in' twice, as a button and as a link."

                  He is reading the INVITE arm, where the button already IS
                  "Back to sign in": an expired invitation has no self-service
                  retry, because only an administrator can send another, which
                  is what invalidLead says. The RESET arm has two genuinely
                  different offers, "Request a new link" and a way out of it,
                  and keeps both. So the test is the destination rather than
                  the mode: a footer that repeats the button is not a footer. */}
              {invalidCta.to !== backToSignIn && (
                <p className="auth__foot"><Link to={backToSignIn}>Back to sign in</Link></p>
              )}
            </div>
          )}

          {phase === 'stepup' && (
            <div>
              <h2 className="auth__title">Confirm it is you</h2>
              <p className="auth__sub">Enter the current 6-digit code from your authenticator app before setting a new password.</p>
              {codeField(submitStepup, 'Authenticator code', 'Verify and continue')}
              <p className="auth__foot">Lost your authenticator? Ask your Opndoor contact to reset it.</p>
            </div>
          )}

          {phase === 'password' && (
            <div>
              <h2 className="auth__title">{c.title}</h2>
              <p className="auth__sub">Choose a strong password you do not use elsewhere.</p>
              <form className="auth__form" onSubmit={submitPassword} noValidate>
                <div className="field"><label htmlFor="pw">{mode === 'invite' ? 'Password' : 'New password'}</label><PasswordInput id="pw" autoComplete="new-password" placeholder="At least 8 characters" value={pw} onChange={(e) => setPw(e.target.value)} required /></div>
                <div className="field"><label htmlFor="pw2">Confirm password</label><PasswordInput id="pw2" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></div>
                {error && <p className="auth__error" role="alert" style={{ color: 'var(--danger, #c0392b)' }}>{error}</p>}
                <Button variant="primary" block type="submit" arrow disabled={busy || !pw || !pw2}>{busy ? 'Saving…' : (mode === 'invite' ? 'Set password' : 'Save new password')}</Button>
              </form>
              <p className="auth__foot"><Link to={backToSignIn}>Back to sign in</Link></p>
            </div>
          )}

          {phase === 'enrol' && (
            <div>
              <h2 className="auth__title">Set up two-factor authentication</h2>
              <p className="auth__sub">Scan this QR code with an authenticator app, then enter the 6-digit code it shows.</p>
              {/* THE SAME BLOCK AS THE SIGN-IN PAGE, and it matters more here:
                  this is the invite landing, so it is the first thing a brand new
                  person ever sees of the portal, and it is the screen that spent
                  months recommending a paid app after the other one was fixed. */}
              <AuthenticatorAppHelp />
              {qr && <div className="twofa-qr"><img className="twofa-qr__img" src={qr} alt="Authenticator setup QR code" width={160} height={160} /></div>}
              {secret && <div className="twofa-key"><span className="twofa-key__label">Can't scan? Enter this key manually.</span><code className="twofa-key__code">{secret}</code></div>}
              {codeField(submitEnrol, '6-digit code', 'Verify and finish')}
            </div>
          )}

          {phase === 'done' && (
            <div>
              <div className="confirm-ic"><Icon name="check" strokeWidth={2.4} /></div>
              <h2 className="auth__title">Password updated</h2>
              <p className="auth__sub">Your password has been changed. Sign in with your new password, then verify with your authenticator code.</p>
              <div className="auth__form"><Button variant="primary" block to={backToSignIn}>Back to sign in</Button></div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
