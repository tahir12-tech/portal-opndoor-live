/* =====================================================================
   Login.

   Mock mode (tests / no env): the original always-ok two-step form.

   Supabase mode: step 1 is email + password (AAL1); step 2 is TOTP. First-time
   users enrol (QR + code); returning users are challenged for their code. A
   verified code steps the session up to AAL2, which the database requires
   before returning any data. SessionContext then loads the profile + data and
   this page routes on to the dashboard.
   ===================================================================== */
import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '@/data';
import { SUPABASE_ENABLED } from '@/lib/supabase';
import { useSession } from '@/session/SessionContext';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { carriedEmail, carriedTab, forgotHref, type Audience } from '@/pages/auth/carry';
// Namespaced as tenantAuth, never as auth. It exposes signIn(email, password)
// with the same arity as authService.signIn above and the opposite meaning:
// this one is terminal, that one is step one of two.
import * as tenantAuth from '@/tenant/tenantAuth';
import { afterSignIn } from '@/pages/Apply/FrontDoor';
import '../auth/auth.css';
import './Login.css';




type Step = 'creds' | '2fa' | 'enrol' | 'verify';

export function Login() {
  useDocumentTitle('Sign in');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Seeded from the URL so ?tab=tenant is a link somebody can be sent. Agent is
  // the default because that is who has been signing in here for a year, so a
  // missing or unknown tab lands there rather than on tenant.
  const [audience, setAudience] = useState<Audience>(carriedTab(searchParams) ?? 'agent');
  const { status, markMfaVerified } = useSession();
  const [step, setStep] = useState<Step>('creds');
  // Carried back from /forgot-password, so "Back to sign in" returns somebody
  // to a filled field rather than an empty one.
  const [email, setEmail] = useState(() => carriedEmail(searchParams));
  /* The TENANT address lives up here for the same reason the staff one does:
     TenantSignInPanel is mounted conditionally, so state inside it dies on every
     tab click. It used to re-seed from the URL on remount, which looked fine
     until the tab strip below started stripping the URL, at which point tapping
     Agent and back emptied a field somebody had just been handed. */
  const [tenantEmail, setTenantEmail] = useState(() => carriedEmail(searchParams));
  const [password, setPassword] = useState('');
  const [masked, setMasked] = useState('');
  const [codes, setCodes] = useState<string[]>(['', '', '', '', '', '']);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const mfaSetup = useRef(false);

  // Already authenticated (AAL2) -> straight to the app.
  useEffect(() => {
    if (SUPABASE_ENABLED && status === 'ready') navigate('/dashboard', { replace: true });
  }, [status, navigate]);

  const focusFirst = () => setTimeout(() => inputs.current[0]?.focus(), 0);

  // Move from a valid AAL1 session to the correct TOTP step (enrol or verify).
  async function advanceToMfa() {
    const fs = await authService.factorState();
    // #92 If the factor read failed (missing/expired token, e.g. the reset-then-
    // sign-in handoff transiently landing here) do NOT start an unauthenticated
    // enrolment; ask the user to sign in again.
    if (!fs.ok) { setError('Your session has expired. Please sign in again.'); return; }
    if (fs.hasVerifiedFactor && fs.factorId) {
      setFactorId(fs.factorId);
      setStep('verify');
      focusFirst();
    } else {
      const en = await authService.enrolTotp();
      if (!en.ok || !en.factorId) {
        setError(en.error ?? 'Could not start authenticator setup.');
        return;
      }
      setFactorId(en.factorId);
      setQr(en.qr ?? '');
      setSecret(en.secret ?? '');
      setStep('enrol');
      focusFirst();
    }
  }

  // A refreshed password-only session lands here: resume the TOTP step.
  // useEffect(() => {
  //   if (!SUPABASE_ENABLED || mfaSetup.current) return;
  //   if (status === 'needsMfa' && step === 'creds') {
  //     mfaSetup.current = true;
  //     setMasked(authService.maskEmail(email));
  //     void advanceToMfa();
  //   }
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [status]);

  async function submitCreds(e: FormEvent) {
    e.preventDefault();
    setError('');
    setMasked(authService.maskEmail(email.trim()));
    if (!SUPABASE_ENABLED) {
      authService.login(email.trim(), password);
      setStep('2fa');
      focusFirst();
      return;
    }
    setBusy(true);
    const r = await authService.signIn(email, password);
    if (!r.ok) {
      setError(r.error ?? 'Wrong email or password.');
      setBusy(false);
      return;
    }
    mfaSetup.current = true;
    await advanceToMfa();
    setBusy(false);
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setError('');
    const code = codes.join('');
    if (!SUPABASE_ENABLED) {
      authService.verify2fa(code);
      navigate('/dashboard');
      return;
    }
    if (!factorId) return;
    setBusy(true);
    const r = await authService.verifyCode(factorId, code);
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? 'That code was not right. Try again.');
      setCodes(['', '', '', '', '', '']);
      focusFirst();
      return;
    }
    // TOTP verified in THIS runtime: grant the in-memory AAL2 trust BEFORE the
    // onAuthStateChange-driven resolve() runs, so it routes on rather than
    // bouncing back to the (restored-session) needsMfa gate.
    markMfaVerified();
    // AAL2 reached; SessionContext resolves to "ready" and the effect above routes on.
  }

  function setDigit(i: number, value: string) {
    const digit = value.replace(/[^0-9]/g, '').slice(-1);
    setCodes((prev) => prev.map((c, j) => (j === i ? digit : c)));
    if (digit && i < 5) inputs.current[i + 1]?.focus();
  }
  function onKeyDown(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !codes[i] && i > 0) inputs.current[i - 1]?.focus();
  }
  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const digits = (e.clipboardData.getData('text') || '').replace(/[^0-9]/g, '').slice(0, 6).split('');
    if (!digits.length) return;
    setCodes((prev) => prev.map((c, j) => digits[j] ?? c));
    inputs.current[Math.min(digits.length, 5)]?.focus();
  }

  const onCode = step === 'enrol' || step === 'verify' || step === '2fa';

  return (
    <div className="auth">
      <aside className="auth__brand">
        <div className="auth__brand-top">
          <span className="wordmark">opndoor</span>
          <span className="auth__cobrand">Guarantee<br />Referral Portal</span>
        </div>
        {/* THE THIRD VARIABLE-HEIGHT BLOCK, and the last one.

            The headline is two lines for a tenant and an agent and three for a
            supplier, so a centred block put the eyebrow at 624, 624 and 591.
            Same stack as the right pane: all three rendered, one visible, the
            row sized by the tallest. */}
        {/* Stacked PER ELEMENT, not per block.

            Stacking the whole block lined up the eyebrow and the heading and
            left the paragraph at 499, 499 and 551, because the supplier's own
            three-line headline pushes its own paragraph down inside its own
            variant. Giving each of the three elements its own cell means each
            is as tall as its tallest variant, so every line starts level. */}
        <div className="auth__brand-mid">
          <BrandLine audience={audience} el="eyebrow" />
          <BrandLine audience={audience} el="h1" />
          <BrandLine audience={audience} el="copy" />
        </div>
        <div className="auth__flow">
          {BRAND[audience].flow.map((f) => (
            <div className="auth__flow-item" key={f.t}>
              <span className="auth__flow-ic"><Icon name={f.icon} /></span>
              <div><div className="auth__flow-t">{f.t}</div><div className="auth__flow-s">{f.s}</div></div>
            </div>
          ))}
        </div>
      </aside>

      <section className="auth__form-wrap">
        <div className="auth__card">
          {/* WHO IS SIGNING IN.
              Two sign-ins, three doors.

              A TENANT is an applicant with no portal role, on a separate
              Supabase client and no authenticator app, so that is a genuinely
              different form and gets its own component below.

              An AGENT and a SUPPLIER are both staff: a row in public.users with
              a role and a partner_id, email plus password plus TOTP, landing on
              the same dashboard. A supplier is a partner who sends us
              referrals, which is a commercial distinction and not an
              authentication one, so wiring it to its own form would have been
              inventing a difference that does not exist. What they see is
              decided by their role and their partner row. The tab is
              wayfinding, and only the subtitle changes.

              The staff flow itself is UNCHANGED. The audience switch never
              reaches inside it, because it carries AAL2 enrolment and is not
              somewhere to add conditionals. */}
          <AudienceTabs value={audience} onChange={setAudience} />

          {/* One wrapper for every audience, so the pane can be a flex column
              and pin its footer to the bottom of the card. Without it the tabs
              lined up and the panes still ended at different heights, which is
              the same complaint one level down. */}
          <div className="auth__pane">

          {audience === 'tenant' && (
            <TenantSignInPanel email={tenantEmail} setEmail={setTenantEmail} />
          )}

          {audience !== 'tenant' && (<>
          <Steps onSecond={onCode} />


          {step === 'creds' ? (
            <div className="auth__pane-body">
              <Intro audience={audience} />
              {error && <p className="auth__error" style={{ color: 'var(--danger, #c0392b)' }}>{error}</p>}
              <form className="auth__form" onSubmit={submitCreds} noValidate>
                <div className="field">
                  <label htmlFor="email">Work email</label>
                  <input id="email" type="email" placeholder="you@company.com" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div className="field">
                  <label htmlFor="pass">Password</label>
                  <PasswordInput id="pass" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
                <div className="auth__row auth__row--end">
                  {/* Carry BOTH. This passed the email and not the tab, so an
                      agent landed on the reset page's tenant tab and had to
                      reselect who they were. */}
                  <Link to={forgotHref(audience, email)}>Forgot password?</Link>
                </div>
                <Button variant="primary" block type="submit" arrow disabled={busy}>{busy ? 'Signing in…' : 'Continue'}</Button>
              </form>
              <Helper audience={audience} />
            </div>
          ) : (
            <div className="auth__pane-body">
              <button className="back-link" type="button" onClick={() => { setStep('creds'); setError(''); }}>
                <Icon name="arrowLeft" /> Back
              </button>

              {step === 'enrol' ? (
                <>
                  <h2 className="auth__title" style={{ marginTop: 16 }}>Set up your authenticator</h2>
                  <p className="auth__sub">Scan this QR code with an authenticator app (Google Authenticator, 1Password, Authy), then enter the 6-digit code it shows.</p>
                  {qr && (
                    <div className="twofa-qr">
                      <img className="twofa-qr__img" src={qr} alt="Authenticator setup QR code" width={160} height={160} />
                    </div>
                  )}
                  {secret && (
                    <div className="twofa-key">
                      <span className="twofa-key__label">Can't scan? Enter this key manually.</span>
                      <code className="twofa-key__code">{secret}</code>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <h2 className="auth__title" style={{ marginTop: 16 }}>Enter your verification code</h2>
                  <p className="auth__sub">Open your authenticator app for <b style={{ color: 'var(--ink)' }}>{masked}</b> and enter the current 6-digit code.</p>
                  <div style={{ marginTop: 18 }}>
                    <span className="twofa-chip"><Icon name="phone" /> From your authenticator app</span>
                  </div>
                </>
              )}

              {error && <p className="auth__error" style={{ color: 'var(--danger, #c0392b)', marginTop: 12 }}>{error}</p>}
              <form className="auth__form" onSubmit={submitCode} noValidate>
                <div className="field">
                  <label>6-digit code</label>
                  <div className="codes">
                    {codes.map((c, i) => (
                      <input
                        key={i}
                        ref={(el) => { inputs.current[i] = el; }}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        aria-label={`Digit ${i + 1}`}
                        className={c ? 'filled' : ''}
                        value={c}
                        onChange={(e) => setDigit(i, e.target.value)}
                        onKeyDown={(e) => onKeyDown(i, e)}
                        onPaste={onPaste}
                      />
                    ))}
                  </div>
                </div>
                <Button variant="primary" block type="submit" arrow disabled={busy}>{busy ? 'Verifying…' : 'Verify and sign in'}</Button>
              </form>
            </div>
          )}
          </>)}
          </div>
        </div>
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   The three audiences.
   --------------------------------------------------------------------------- */

/* The two steps, shared by all three audiences.

   A tenant's second factor arrives by email and staff read theirs from an
   authenticator app. That is a difference in DELIVERY, not in what is being
   promised: a password on its own is not enough for anybody here. Showing the
   strip to staff and hiding it from tenants made the tenant path read as the
   lesser one, and left the two panes different heights. */

/* The heading and paragraph for the three tabs, all rendered, one visible.

   WHY A STACK RATHER THAN A RESERVED HEIGHT. The previous attempt measured the
   tallest variant and hard-coded it, which is a magic number that goes stale the
   moment a copy line grows, and was measurably too small for the supplier's
   three lines. All three variants now sit in the same grid cell, so the row
   sizes itself to whichever is tallest and keeps doing so as the copy changes.

   The two inactive ones are visibility:hidden, which reserves their space, and
   aria-hidden, so a screen reader is not read three headings for one form. */
const INTRO: Record<Audience, { title: string; sub: string }> = {
  tenant: {
    title: 'Sign in to your application',
    sub: 'For tenants applying for an opndoor guarantee. We will email you a code to confirm it is you. No authenticator app needed.',
  },
  agent: {
    title: 'Sign in to the portal',
    sub: 'Use the work email your administrator registered for you.',
  },
  supplier: {
    title: 'Sign in to the portal',
    sub: 'For partner teams referring on behalf of the agencies they work with. Use the work email your administrator registered for you.',
  },
};


/* One line of the left panel, all three variants in one cell.

   The row is as tall as the tallest variant of THAT line, so the next line
   starts at the same y on every tab. */
function BrandLine({ audience, el }: { audience: Audience; el: 'eyebrow' | 'h1' | 'copy' }) {
  const cls = { eyebrow: 'auth__eyebrow', h1: 'auth__brand-h1', copy: 'auth__brand-copy' }[el];
  return (
    <div className={`auth__stack auth__stack--${el}`}>
      {(Object.keys(BRAND) as Audience[]).map((a) => {
        const on = a === audience;
        const style = on ? undefined : { visibility: 'hidden' as const };
        const text = el === 'eyebrow' ? BRAND[a].eyebrow : el === 'h1' ? BRAND[a].h1 : BRAND[a].copy;
        const hidden = on ? undefined : true;
        if (el === 'h1') return <h1 key={a} className={`${cls} auth__stack-v`} aria-hidden={hidden} style={style}>{text}</h1>;
        if (el === 'copy') return <p key={a} className={`${cls} auth__stack-v`} aria-hidden={hidden} style={style}>{text}</p>;
        return <span key={a} className={`${cls} auth__stack-v`} aria-hidden={hidden} style={style}>{text}</span>;
      })}
    </div>
  );
}

function Intro({ audience }: { audience: Audience }) {
  return (
    <div className="auth__stack">
      {(Object.keys(INTRO) as Audience[]).map((a) => {
        const on = a === audience;
        return (
          <div key={a} className="auth__stack-v" aria-hidden={on ? undefined : true}
               style={on ? undefined : { visibility: 'hidden' }}>
            <h2 className="auth__title">{INTRO[a].title}</h2>
            <p className="auth__sub">{INTRO[a].sub}</p>
          </div>
        );
      })}
    </div>
  );
}


/* The closing line under the button, all three rendered, one visible.

   THE SECOND VARIABLE-HEIGHT BLOCK, and the one that survived the intro fix.
   Tenant's is one line, Agent's and Supplier's are two. With the card centred
   that difference splits in two and moves everything ABOVE it as well, which is
   how a line under the button ends up moving the tab pill.

   Same treatment as Intro, for the same reason: the row sizes itself to the
   tallest and keeps doing so when the copy changes. */
/** Where somebody with no account goes. Off-platform, so it opens as a normal
    link rather than a route. */
const DEMO_URL = 'https://meetings-eu1.hubspot.com/matthew-dwyer';

const HELPER: Record<Audience, ReactNode> = {
  tenant: <>Not started yet? <a href="/apply/register">Apply for a guarantee</a>.</>,
  // TWO ROUTES, because two different people read this line. Somebody at a
  // partner we already work with needs their own administrator, who can invite
  // them. Somebody from an agency we have never met needs us, and telling them
  // to ask an administrator they do not have is a dead end.
  //
  // The old second half, "or use the contact details on this screen", pointed at
  // contact details that are not on the screen and never were.
  agent: <>Not set up yet? Ask your administrator for access. New to opndoor? <a href={DEMO_URL}>Book a demo</a>.</>,
  supplier: <>Not set up yet? Ask your administrator for access. New to opndoor? <a href={DEMO_URL}>Book a demo</a>.</>,
};

function Helper({ audience }: { audience: Audience }) {
  return (
    <div className="auth__stack auth__stack--foot">
      {(Object.keys(HELPER) as Audience[]).map((a) => {
        const on = a === audience;
        return (
          <p key={a} className="auth__stack-v auth__foot" aria-hidden={on ? undefined : true}
             style={on ? undefined : { visibility: 'hidden' }}>
            {HELPER[a]}
          </p>
        );
      })}
    </div>
  );
}

function Steps({ onSecond }: { onSecond: boolean }) {
  return (
    <div className="auth__steps">
      <div className={`auth__step-dot${onSecond ? ' is-done' : ' is-active'}`}>
        <span className="n">1</span><span>Credentials</span>
      </div>
      <span className="auth__step-line" />
      <div className={`auth__step-dot${onSecond ? ' is-active' : ''}`}>
        <span className="n">2</span><span>Verify</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   The left panel, per audience.

   It used to be one block of agent copy shown to all three. A tenant is not
   referring anybody, earns no commission and has no authenticator app, so two
   of the three promises on it were false for them and the third was wrong about
   how they sign in. Whoever is signing in should see what THEY get.
   --------------------------------------------------------------------------- */
const BRAND: Record<Audience, {
  eyebrow: string; h1: string; copy: string;
  flow: { icon: IconName; t: string; s: string }[];
}> = {
  tenant: {
    eyebrow: 'Tenant sign in',
    h1: 'Your application, start to finish.',
    copy: "Apply for an opndoor guarantee when referencing has not gone your way. opndoor stands as your guarantor so the landlord can let to you, and you can see exactly where your application is at any point.",
    flow: [
      { icon: 'send',   t: 'Pick up where you left off', s: 'Every answer is saved as you type' },
      { icon: 'trend',  t: 'See where you are',          s: 'From submitted through to approved' },
      { icon: 'shield', t: 'Secure by design',           s: 'A six-digit code to your email every sign in' },
    ],
  },
  agent: {
    eyebrow: 'Agent sign in',
    h1: 'Let the property. We guarantee the tenant.',
    copy: "Refer a tenant who could not pass referencing and opndoor stands as guarantor, with a Deed of Guarantee in favour of the property. Track every one of your branches from sent through to deed issued.",
    flow: [
      { icon: 'send',   t: 'Refer in seconds',   s: 'Add a tenant and send the application' },
      { icon: 'trend',  t: 'Track to deed issued', s: 'Live funnel and commission earned' },
      { icon: 'shield', t: 'Secure by design',   s: 'Two-factor authentication on every sign in' },
    ],
  },
  supplier: {
    eyebrow: 'Supplier sign in',
    h1: 'Refer with confidence. Track every step.',
    copy: "The white-labelled referral and tracking tool for partner teams. Refer failed-referencing tenants on behalf of the agencies you work with, then follow them from sent through to deed issued.",
    flow: [
      { icon: 'send',   t: 'Refer for any agency', s: 'Add an agency or a branch as you go' },
      { icon: 'trend',  t: 'Track to deed issued', s: 'Live funnel and commission earned' },
      { icon: 'shield', t: 'Secure by design',     s: 'Two-factor authentication on every sign in' },
    ],
  },
};



function AudienceTabs({ value, onChange }: { value: Audience; onChange: (a: Audience) => void }) {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const tabs: { id: Audience; label: string }[] = [
    { id: 'tenant', label: 'Tenant' },
    { id: 'agent', label: 'Agent' },
    { id: 'supplier', label: 'Supplier' },
  ];
  return (
    <div className="aud" role="tablist" aria-label="Who is signing in">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === value}
          className={`aud__tab${t.id === value ? ' is-active' : ''}`}
          onClick={() => {
            onChange(t.id);
            /* MERGE, never rebuild. Building the query string from `tab` alone
               dropped every other parameter with it:

                 ?email=  the address just carried back from the reset page, so
                          touching the tabs reproduced the exact retyping this
                          was written to remove.
                 ?invite= worse and silent. A tenant holding an application their
                          agent already filled in would sign in and open an empty
                          draft instead of claiming it, with nothing on screen to
                          say anything had been lost.

               Shareable either way: ?tab=tenant is still a link somebody can be
               sent, it just no longer costs the rest of the URL. */
            const next = new URLSearchParams(sp);
            next.set('tab', t.id);
            nav(`/login?${next}`, { replace: true });
          }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* The tenant sign-in, ON the tab rather than behind it.

   This was a button that sent the browser to a second sign-in page. There was
   no reason for it. The form is an email and a password, and making somebody
   click through to another page to type them buys nothing. That second page is
   now gone: there is one sign-in page and this is it.

   Safe because tenant auth is a SEPARATE Supabase client keyed on
   'opndoor.tenant.auth', so signing in here cannot touch a staff session in the
   same browser and the staff SessionContext this page watches never sees it.

   Everything that used to link to /apply/signin now points here, including the
   invite landing and where tenant sign-out lands. /apply/signin redirects, so
   an invite email already delivered still arrives at the right tab with its
   token intact. */
function TenantSignInPanel(
  { email: tEmail, setEmail: setTEmail }: { email: string; setEmail: (v: string) => void },
) {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  // An invite means an agent already built the application and the property
  // came with it, so it is claimed rather than created. Carried through here so
  // /login?tab=tenant&invite=... does not silently open an empty draft instead.
  const invite = sp.get('invite') ?? undefined;
  const [tPassword, setTPassword] = useState('');
  const [tBusy, setTBusy] = useState(false);
  const [tErr, setTErr] = useState<string | null>(null);
  const [tSent, setTSent] = useState(false);
  const [tCode, setTCode] = useState('');
  // Tapping resend here used to do its work in silence, so the only evidence
  // was a second identical email. The register screen already confirms; this
  // says the same thing in the same words.
  const [tResent, setTResent] = useState(false);

  /* Same fix as the register screen: the promise was dropped and the
     confirmation printed regardless, so a 503 from the limiter became "a new
     one is on its way" with nothing sent and an unhandled rejection behind it. */
  async function tResend() {
    setTErr(null);
    try {
      await tenantAuth.resendCode(tEmail, 'sign_in');
      setTResent(true);
      setTCode('');
    } catch (e) {
      setTResent(false);
      setTErr(e instanceof Error && e.message
        ? e.message
        : 'We could not send a new code just now. Try again in a moment.');
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setTErr(null);
    if (tCode.length !== 6) { setTErr('Enter all six digits of the code we emailed you.'); return; }
    setTBusy(true);
    try {
      await tenantAuth.verifyCode(tEmail, tCode, 'sign_in');
      // afterSignIn is imported rather than reimplemented: it decides between
      // claiming an invite and opening a draft, and two copies would drift.
      const failed = await afterSignIn(nav, invite);
      if (failed) { setTErr(failed); setTBusy(false); return; }
      // busy stays true through the navigation, blocking a double submit.
    } catch (err) {
      setTErr(err instanceof Error ? err.message : 'That code is not right.');
      setTBusy(false);
    }
  }

  async function go(e: FormEvent) {
    e.preventDefault();
    setTBusy(true);
    setTErr(null);
    try {
      // Step one only. The password goes to the server, which checks it and
      // discards the session it produced, so nothing usable is in this browser
      // until the code is right.
      await tenantAuth.signInStart(tEmail, tPassword);
      setTSent(true);
      setTBusy(false);
      return;
    } catch (err) {
      setTErr(err instanceof Error ? err.message : 'Could not sign in.');
      setTBusy(false);
    }
  }

  if (tSent) return (
    <>
      <Steps onSecond />
      <div className="auth__pane-body">
      <div className="auth__stack">
        <div className="auth__stack-v">
          <h2 className="auth__title">Check your email</h2>
          <p className="auth__sub">
            We have sent a six-digit code to {tEmail}. It lasts ten minutes.
          </p>
        </div>
      </div>
      {tErr && <p className="auth__error" style={{ color: 'var(--danger, #c0392b)' }}>{tErr}</p>}
      <form className="auth__form" onSubmit={confirm} noValidate>
        <div className="field">
          <label htmlFor="t-code">Confirmation code</label>
          <input id="t-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                 placeholder="000000" value={tCode} autoFocus
                 onChange={(e) => setTCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
        </div>
        <Button variant="primary" block type="submit" arrow disabled={tBusy}>
          {tBusy ? 'Checking\u2026' : 'Confirm and continue'}
        </Button>
      </form>
      <p className="auth__foot">
        Nothing arrived? Check your spam folder, or{' '}
        <button type="button" className="linkish" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'var(--heliotrope-deep, #5b3fd9)', textDecoration: 'underline', cursor: 'pointer' }}
          onClick={() => { void tResend(); }}>send a new one</button>.
        {tResent && <> A new one is on its way. The previous code has stopped working.</>}
      </p>
      <p className="auth__foot">
        <button type="button" className="linkish" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'var(--heliotrope-deep, #5b3fd9)', textDecoration: 'underline', cursor: 'pointer' }}
          onClick={() => { setTSent(false); setTCode(''); setTErr(null); setTResent(false); }}>Use a different email address</button>
      </p>
      </div>
    </>
  );

  return (
    <>
      <Steps onSecond={false} />
      <div className="auth__pane-body">
      <Intro audience="tenant" />
      {tErr && <p className="auth__error" style={{ color: 'var(--danger, #c0392b)' }}>{tErr}</p>}
      <form className="auth__form" onSubmit={go} noValidate>
        <div className="field">
          <label htmlFor="t-email">Email address</label>
          <input id="t-email" type="email" placeholder="you@example.com" autoComplete="email"
                 value={tEmail} onChange={(e) => setTEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="t-pass">Password</label>
          <PasswordInput id="t-pass" autoComplete="current-password"
                         value={tPassword} onChange={(e) => setTPassword(e.target.value)} required />
        </div>
        <div className="auth__row auth__row--end">
          {/* A Link, not an anchor. This was a full page reload that threw away
              the typed address along with everything else in the SPA. */}
          <Link to={forgotHref('tenant', tEmail)}>Forgot password?</Link>
        </div>
        <Button variant="primary" block type="submit" arrow disabled={tBusy || !tEmail || !tPassword}>
          {tBusy ? 'Signing in\u2026' : 'Sign in'}
        </Button>
      </form>
      <Helper audience="tenant" />
      </div>
    </>
  );
}
