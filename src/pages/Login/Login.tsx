/* =====================================================================
   Login.

   Mock mode (tests / no env): the original always-ok two-step form.

   Supabase mode: step 1 is email + password (AAL1); step 2 is TOTP. First-time
   users enrol (QR + code); returning users are challenged for their code. A
   verified code steps the session up to AAL2, which the database requires
   before returning any data. SessionContext then loads the profile + data and
   this page routes on to the dashboard.
   ===================================================================== */
import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '@/data';
import { SUPABASE_ENABLED } from '@/lib/supabase';
import { useSession } from '@/session/SessionContext';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import '../auth/auth.css';
import './Login.css';




type Step = 'creds' | '2fa' | 'enrol' | 'verify';

export function Login() {
  useDocumentTitle('Sign in');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Seeded from the URL so ?tab=tenant is a link somebody can be sent. Agent is
  // the default because that is who has been signing in here for a year.
  const tabParam = searchParams.get('tab');
  const [audience, setAudience] = useState<Audience>(
    tabParam === 'tenant' || tabParam === 'supplier' ? tabParam : 'agent',
  );
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
        <div className="auth__brand-mid">
          <span className="auth__eyebrow">Partner sign in</span>
          <h1 className="auth__brand-h1">Refer with confidence. Track every step.</h1>
          <p className="auth__brand-copy">
            The white-labelled referral and tracking tool for partner teams. Refer failed-referencing tenants to opndoor's professional guarantor service, where opndoor provides a Deed of Guarantee in favour of the property, then follow them from sent through to deed issued.
          </p>
        </div>
        <div className="auth__flow">
          <div className="auth__flow-item">
            <span className="auth__flow-ic"><Icon name="send" /></span>
            <div><div className="auth__flow-t">Refer in seconds</div><div className="auth__flow-s">Add a tenant and send the application</div></div>
          </div>
          <div className="auth__flow-item">
            <span className="auth__flow-ic"><Icon name="trend" /></span>
            <div><div className="auth__flow-t">Track to deed issued</div><div className="auth__flow-s">Live funnel and commission earned</div></div>
          </div>
          <div className="auth__flow-item">
            <span className="auth__flow-ic"><Icon name="shield" /></span>
            <div><div className="auth__flow-t">Secure by design</div><div className="auth__flow-s">Two-factor authentication on every sign in</div></div>
          </div>
        </div>
      </aside>

      <section className="auth__form-wrap">
        <div className="auth__card">
          {/* WHO IS SIGNING IN.
              opndoor serves three parties and they do not share a sign-in: an
              agent is staff with two-factor, a tenant is an applicant with no
              portal role at all, and a supplier is neither. Sending all three
              at one form and hoping the email resolves it is how a tenant ends
              up staring at an authenticator prompt.

              The agent path below this is UNCHANGED. Switching audience renders
              a different component rather than branching inside the staff flow,
              because that flow carries AAL2 enrolment and is not somewhere to
              add conditionals. */}
          <AudienceTabs value={audience} onChange={setAudience} />

          {audience === 'tenant' && <TenantSignInPanel />}
          {audience === 'supplier' && <SupplierPanel />}

          {audience === 'agent' && (<>
          <div className="auth__steps">
            <div className={`auth__step-dot${step === 'creds' ? ' is-active' : ' is-done'}`}>
              <span className="n">1</span><span>Credentials</span>
            </div>
            <span className="auth__step-line" />
            <div className={`auth__step-dot${onCode ? ' is-active' : ''}`}>
              <span className="n">2</span><span>Verify</span>
            </div>
          </div>


          {step === 'creds' ? (
            <div>
              <h2 className="auth__title">Sign in to the portal</h2>
              <p className="auth__sub">Use the work email your administrator registered for you.</p>
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
              <p className="auth__foot">Not set up yet? Ask your administrator for access, or use the contact details on this screen.</p>
            </div>
          ) : (
            <div>
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
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   The three audiences.
   --------------------------------------------------------------------------- */
type Audience = 'tenant' | 'agent' | 'supplier';

function AudienceTabs({ value, onChange }: { value: Audience; onChange: (a: Audience) => void }) {
  const nav = useNavigate();
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
            // Shareable, like the site it replaces: ?tab=tenant is a link
            // somebody can be sent, not internal state.
            nav(`/login?tab=${t.id}`, { replace: true });
          }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function TenantSignInPanel() {
  return (
    <div>
      <h2 className="auth__title">Sign in to your application</h2>
      <p className="auth__sub">
        For tenants applying for an opndoor guarantee. No authenticator app, just your
        email and password.
      </p>
      <Button variant="primary" block arrow onClick={() => { window.location.href = '/apply/signin'; }}>
        Continue
      </Button>
      <p className="auth__foot">
        Not started yet? <a href="/apply/register">Apply for a guarantee</a>.
      </p>
    </div>
  );
}

/* Supplier is a REAL third audience on the site this replaces, where it reads
   "BTR / PBSA operator". It has no role, no table and no policies in this
   codebase, and inventing one would mean guessing what a supplier is allowed to
   see, which is a commercial question rather than a technical one. So the tab
   is honest about it rather than absent, because absent looks like an oversight
   and a dead form looks broken. */
function SupplierPanel() {
  return (
    <div>
      <h2 className="auth__title">Supplier access</h2>
      <p className="auth__sub">
        Supplier sign-in is not open yet. If you supply referencing, identity or
        financial checks to opndoor and you need access, talk to your opndoor
        contact and we will set you up.
      </p>
      <p className="auth__foot">
        Looking for the partner API instead? Your developers can reach the
        documentation from the Dev Centre once your account is enabled.
      </p>
    </div>
  );
}
