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
import '../auth/auth.css';
import './Login.css';




type Step = 'creds' | '2fa' | 'enrol' | 'verify';

export function Login() {
  useDocumentTitle('Sign in');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Seeded from the URL so ?tab=supplier is a link somebody can be sent. Agent
  // is the default: it is who has been signing in here for a year, and it is now
  // the only other value.
  const tabParam = searchParams.get('tab');
  const [audience, setAudience] = useState<Audience>(tabParam === 'supplier' ? 'supplier' : 'agent');
  const { status, markMfaVerified } = useSession();
  const [step, setStep] = useState<Step>('creds');
  const [email, setEmail] = useState('');
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

  /* This portal is for partner staff. Tenants sign in at /apply/signin, which
     runs the same two-step email code this tab used to. Old links and
     bookmarks still exist, so ?tab=tenant is forwarded rather than silently
     showing somebody the wrong form. The invite token travels with it, because
     dropping it opens an empty draft instead of the application their agent
     already built. */
  useEffect(() => {
    if (tabParam !== 'tenant') return;
    const invite = searchParams.get('invite');
    window.location.replace(`/apply/signin${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`);
  }, [tabParam, searchParams]);

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

          {/* One wrapper, so both tabs share a skeleton and therefore a
              geometry. Every variable-height block inside it is a stack, which
              is what lets the card be centred without the tabs moving. */}
          <div className="auth__pane">
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
                  {/* Carry the typed email over so the reset form is prefilled (#60). */}
                  <Link to={`/forgot-password${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ''}`}>Forgot password?</Link>
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
const HELPER: Record<Audience, ReactNode> = {
  agent: <>Not set up yet? Ask your administrator for access, or use the contact details on this screen.</>,
  supplier: <>Not set up yet? Ask your administrator for access, or use the contact details on this screen.</>,
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

type Audience = 'agent' | 'supplier';

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
  const tabs: { id: Audience; label: string }[] = [
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
            // Shareable: ?tab=supplier is a link
            // somebody can be sent, not internal state.
            nav(`/login?tab=${t.id}`, { replace: true });
          }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

