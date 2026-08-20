/* =====================================================================
   The front door: everything that happens before the form.

   THE ORDER IS DELIBERATE. Prequalification comes first, before an account and
   long before a payment, because the worst version of this journey is one where
   somebody registers, verifies an email, fills in three years of address
   history and only then finds out the numbers were never going to work. Four
   questions and thirty seconds is the cheapest possible way to say that.

   WHAT THE PREQUALIFICATION IS ALLOWED TO SAY. Never "you qualify". It sees
   four self-reported numbers and no credit file, and the credit file is the
   most common reason a marginal applicant actually fails. So the good answer is
   "nothing here rules you out", which is true, and the bad answer says plainly
   that it is unlikely to work while still letting them continue, because the
   referencing provider makes the decision and not us.
   ===================================================================== */
import { useCallback, useEffect, useState } from 'react';
import { useTenantDocumentTitle } from '@/hooks/useDocumentTitle';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { PasswordInput } from '@/components/ui/PasswordInput';
import * as auth from '@/tenant/tenantAuth';
import * as api from '@/tenant/tenantApi';
import { SUPABASE_ENABLED } from '@/lib/supabase';
import '@/pages/auth/auth.css';
import './Apply.css';

/* The SAME split-panel shell the portal's own sign-in uses: auth.css, the same
   brand panel on the left, the same card on the right. Not a lookalike, the
   actual stylesheet.

   The existing tenant site is a separate marketing-styled sign-in with its own
   navy hero and its own type. It is deliberately NOT reproduced: a tenant who
   is later shown a deed, a receipt and a guarantee should not feel handed
   between two companies, and maintaining two design systems for one product is
   how they drift.

   What the left panel says is the only thing that changes, because a tenant is
   not a partner and "Refer with confidence" means nothing to them. */
function Shell({
  title, sub, children, eyebrow = 'Tenant sign in',
}: {
  title: string; sub?: string; children: React.ReactNode; eyebrow?: string;
}) {
  // The tab said "Guarantee Referral Portal" on a page branded "guarantor
  // application", which tells an applicant they are on the wrong site.
  useTenantDocumentTitle(title);
  return (
    <div className="auth">
      <aside className="auth__brand">
        <div className="auth__brand-top">
          <span className="wordmark">opndoor</span>
          <span className="auth__cobrand">Guarantor<br />application</span>
        </div>
        <div className="auth__brand-mid">
          <span className="auth__eyebrow">{eyebrow}</span>
          <h1 className="auth__brand-h1">A guarantor, without asking a family member.</h1>
          <p className="auth__brand-copy">
            opndoor stands as guarantor on your tenancy, so a failed reference does not cost you
            the property. Apply online, and we deal with your letting agent.
          </p>
        </div>
        <div className="auth__flow">
          <div className="auth__flow-item">
            <span className="auth__flow-ic"><Icon name="edit" /></span>
            <div>
              <div className="auth__flow-t">Apply in about fifteen minutes</div>
              <div className="auth__flow-s">Stop and come back whenever you like</div>
            </div>
          </div>
          <div className="auth__flow-item">
            <span className="auth__flow-ic"><Icon name="clock" /></span>
            <div>
              <div className="auth__flow-t">Everything saves as you go</div>
              <div className="auth__flow-s">Nothing you type is ever lost</div>
            </div>
          </div>
          <div className="auth__flow-item">
            <span className="auth__flow-ic"><Icon name="shield" /></span>
            <div>
              <div className="auth__flow-t">Your details stay yours</div>
              <div className="auth__flow-s">Shared only with your eligibility check</div>
            </div>
          </div>
        </div>
      </aside>

      <section className="auth__form-wrap">
        <div className="auth__card">
          <h2 className="auth__title">{title}</h2>
          {sub && <p className="auth__sub">{sub}</p>}
          {/* The heading sat flush on the first field label. */}
          <div className="ap-shell-body">{children}</div>
        </div>
      </section>
    </div>
  );
}

const money = (n: number) => `£${n.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;

/* ---------------------------------------------------------------------------
   1. Register. THE FRONT DOOR.

   WHAT WAS HERE BEFORE, AND WHY IT IS GONE. A standalone prequalification
   screen sat in front of this: four questions, answered before any account, to
   say "nothing here rules you out" early. It was the wrong shape for this
   product. A tenant arrives from a link their agent or our site gave them,
   having already decided to apply, and putting a quiz in front of the thing
   they came to do adds a step without removing one. The judgement it made was
   also weak, since it cannot see a credit file, so it spent a screen to say
   very little.

   The eligibility rules it used are NOT gone: they still gate the screened
   partner rail in SQL, and they still tell a tenant inside the form whether
   their income looks short. Only the screen went.
   --------------------------------------------------------------------------- */
export function Register() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const invite = sp.get('invite') ?? undefined;
  const [f, setF] = useState({ first_name: '', last_name: '', email: '', phone: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ready = f.first_name && f.last_name && f.email.includes('@') && f.password.length >= 10;

  const go = async () => {
    setBusy(true); setErr(null);
    try {
      await auth.register({ ...f, invite });
      if (!SUPABASE_ENABLED) { await afterSignIn(nav, invite); return; }
      setSent(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create the account.');
    } finally { setBusy(false); }
  };

  if (sent) {
    return <CodeStep email={f.email} invite={invite} onBack={() => setSent(false)} />;
  }

  return (
    <Shell title="Apply for an opndoor guarantee"
      sub="Create an account first, so nothing you type is ever lost.">
        <div className="ap-grid">
          <Field label="First name"><input className="input" value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} /></Field>
          <Field label="Last name"><input className="input" value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></Field>
          <Field label="Email address"><input className="input" type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Mobile number"><input className="input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Password" hint="At least 10 characters. Longer is better than complicated.">
            <PasswordInput value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
          </Field>
        </div>
        {err && <div className="ap-alert" role="alert">{err}</div>}
        <div className="ap-actions">
          <Button variant="primary" disabled={!ready || busy} onClick={() => void go()}>
            {busy ? 'Creating…' : 'Create my account'}
          </Button>
        </div>
      <p className="ap-foot">
        Next: a few details about the property, then a £20 application fee, then the longer part.
        You can stop and come back at any point.
      </p>
      <p className="ap-foot">Already have an account? <a href="/apply/signin">Sign in</a>.</p>
    </Shell>
  );
}


/* ---------------------------------------------------------------------------
   The code step. Shown straight after registering, and after a resend.

   A CODE RATHER THAN A LINK because a tenant applying on a laptop reads their
   email on a phone. A link strands them on the wrong device; six digits cross
   the gap by being typed.
   --------------------------------------------------------------------------- */
function CodeStep({ email, invite, onBack, purpose = 'verify_email' }: {
  email: string; invite?: string; onBack: () => void;
  /** Which code this is. A registration code confirms the address; a sign-in
      code proves possession of one already confirmed. The server verifies the
      purpose too, so one cannot be spent as the other. */
  purpose?: 'verify_email' | 'sign_in';
}) {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  const go = async () => {
    setBusy(true); setErr(null);
    try {
      await auth.verifyCode(email, code, purpose);
      await afterSignIn(nav, invite);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That code is not right.');
      setBusy(false);
    }
  };

  return (
    <Shell title="Check your email"
      eyebrow={purpose === 'sign_in' ? 'Two-factor' : 'Confirm your address'}
      sub={`We have sent a six-digit code to ${email}. It lasts ten minutes.`}>
      <form className="auth__form" onSubmit={(e) => { e.preventDefault(); void go(); }} noValidate>
        <div className="field">
          <label htmlFor="code">Confirmation code</label>
          <input
            id="code" className="ap-code" inputMode="numeric" autoComplete="one-time-code"
            maxLength={6} placeholder="000000" value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            autoFocus />
        </div>
        {err && <p className="auth__error" style={{ color: 'var(--danger)' }} role="alert">{err}</p>}
        <Button variant="primary" block type="submit" arrow disabled={busy || code.length !== 6}>
          {busy ? 'Checking…' : 'Confirm and continue'}
        </Button>
      </form>

      {!SUPABASE_ENABLED && (
        <p className="ap-p" style={{ marginTop: 14 }}>
          <strong>Demo:</strong> there is no email here, so any six digits will do.
        </p>
      )}

      <p className="auth__foot">
        Nothing arrived? Check your spam folder, or{' '}
        <button type="button" className="ap-link"
          onClick={() => { void auth.resendCode(email, purpose); setResent(true); }}>
          send a new code
        </button>.
        {resent && <> A new one is on its way. The previous code has stopped working.</>}
      </p>
      <p className="auth__foot">
        <button type="button" className="ap-link" onClick={onBack}>Use a different email address</button>
      </p>
    </Shell>
  );
}

/**
 * Shared landing after any successful authentication.
 *
 * An invite means an agent already created the application, so it is claimed
 * rather than created and the property comes with it. Otherwise a fresh draft
 * is opened, empty, and the Property step is the first thing they see.
 */
export async function afterSignIn(nav: (to: string) => void, invite?: string) {
  try {
    if (invite) {
      await api.claimInvite(invite);
    } else {
      await api.startApplication({});
    }
  } catch { /* a failure here must not strand somebody who just signed in */ }
  nav('/apply');
}

/* ---------------------------------------------------------------------------
   2. Sign in.
   --------------------------------------------------------------------------- */
export function SignIn() {
  // No useNavigate here any more: signing in is two steps, and the navigation
  // belongs to CodeStep, which is what completes it.
  const [sp] = useSearchParams();
  const invite = sp.get('invite') ?? undefined;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Two steps, not one. The password goes to the server, which checks it and
  // throws the session away; nothing usable reaches this browser until the code
  // is right.
  const [sent, setSent] = useState(false);

  const go = async () => {
    setBusy(true); setErr(null);
    try {
      await auth.signInStart(email, password);
      setSent(true);
      setBusy(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not sign in.');
      setBusy(false);
    }
  };

  if (sent) return <CodeStep email={email} invite={invite} purpose="sign_in" onBack={() => setSent(false)} />;

  return (
    <Shell title="Sign in">
        {/* Stacked, not side by side, and shaped like the portal's own sign-in:
            the forgotten-password link sits right aligned above a full-width
            pill, so the two products do not look like two products. */}
        <form className="ap-stack" onSubmit={(e) => { e.preventDefault(); void go(); }} noValidate>
          {/* htmlFor and id, so the label is actually tied to its control.
              Without it a screen reader announces an unlabelled box and clicking
              the label does nothing. Field supports it; this form was not using
              it. */}
          <Field label="Email address" htmlFor="ap-email">
            <input id="ap-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password" htmlFor="ap-password">
            <PasswordInput id="ap-password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          {err && <div className="ap-alert" role="alert">{err}</div>}
          <div className="ap-row-end">
            <a href="/apply/forgot">Forgot password?</a>
          </div>
          <Button variant="primary" block type="submit" arrow disabled={busy || !email || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      <p className="ap-foot">No account yet? <a href="/apply/register">Create one</a>.</p>
    </Shell>
  );
}

/* ---------------------------------------------------------------------------
   3. Forgot, and 4. Reset.
   --------------------------------------------------------------------------- */
export function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  return (
    <Shell title="Set a new password">
        {sent ? (
          <p className="ap-p">
            If there is an account for <strong>{email}</strong>, we have sent it a link. It lasts an hour.
          </p>
        ) : (
          <>
            <Field label="Email address">
              <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <div className="ap-actions">
              <Button variant="primary" disabled={!email.includes('@')}
                onClick={() => { void auth.requestReset(email); setSent(true); }}>
                Send me a link
              </Button>
            </div>
          </>
        )}
      <p className="ap-foot"><a href="/apply/signin">Back to sign in</a></p>
    </Shell>
  );
}

export function ResetPassword() {
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    auth.exchangeLinkToken()
      .then(() => setReady(true))
      .catch((e) => setErr(e instanceof Error ? e.message : 'That link is not valid.'));
  }, []);

  return (
    <Shell title="Choose a new password">
        {err && <div className="ap-alert" role="alert">{err} <a href="/apply/forgot">Ask for a new link</a>.</div>}
        {ready && !err && (
          <>
            <Field label="New password" hint="At least 10 characters.">
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </Field>
            <div className="ap-actions">
              <Button variant="primary" disabled={password.length < 10}
                onClick={async () => { await auth.setPassword(password); nav('/apply'); }}>
                Save and continue
              </Button>
            </div>
          </>
        )}
    </Shell>
  );
}

/* ---------------------------------------------------------------------------
   5. Verify, which is also where a new account lands.
   --------------------------------------------------------------------------- */
export function Verify() {
  const nav = useNavigate();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const invite = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('invite') ?? undefined;
    auth.exchangeLinkToken()
      .then(() => afterSignIn(nav, invite))
      .catch((e) => setErr(e instanceof Error ? e.message : 'That link is not valid.'));
  }, [nav]);

  return (
    <Shell title={err ? 'That link did not work' : 'Confirming your email…'}>
      {err && (
        <>
          <div className="ap-alert" role="alert">{err}</div>
          <p className="ap-p">Links last 24 hours and can only be used once.</p>
          <a className="ap-link" href="/apply/signin">Sign in instead</a>
        </>
      )}
    </Shell>
  );
}

/* ---------------------------------------------------------------------------
   6. The agent's invite. Same journey, different entry.
   --------------------------------------------------------------------------- */
export function InviteLanding() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const token = sp.get('token') ?? '';
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await auth.inviteInfo(token);
      if (!r.valid) { setErr('This link has expired. Ask your agent to send a new one.'); return; }
      setInfo(r);
      // Already signed in as the right person: skip straight through.
      const me = await auth.currentTenant();
      if (me) { await api.claimInvite(token); nav('/apply'); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'This link is not valid.');
    }
  }, [token, nav]);

  useEffect(() => { void load(); }, [load]);

  if (err) {
    return <Shell title="That link did not work">
      <div className="ap-alert" role="alert">{err}</div>
    </Shell>;
  }
  if (!info) return <Shell title="Just a moment…"><p className="soft">Checking your link.</p></Shell>;

  return (
    <Shell title="Your agent has started this for you"
      sub="Set a password and pick up where they left off.">
        <h3 className="ap-h3" style={{ marginTop: 0 }}>What we already have</h3>
        <dl className="ap-summary">
          <div><dt>Property</dt><dd>{info.prop_addr1}{info.prop_postcode ? `, ${info.prop_postcode}` : ''}</dd></div>
          {info.monthly_rent != null && <div><dt>Monthly rent</dt><dd>{money(Number(info.monthly_rent))}</dd></div>}
          {info.tenancy_start && <div><dt>Tenancy starts</dt><dd>{String(info.tenancy_start)}</dd></div>}
          <div><dt>Your email</dt><dd>{info.email}</dd></div>
        </dl>
        <p className="ap-p">
          You will not have to enter any of that again. We need your address history, your income and a
          couple of documents. About fifteen minutes, and you can stop and come back.
        </p>
        <div className="ap-actions">
          <Button variant="primary" onClick={() => nav(`/apply/register?invite=${encodeURIComponent(token)}`)}>
            Set up my account
          </Button>
          <a className="ap-link" href={`/apply/signin?invite=${encodeURIComponent(token)}`}>
            I already have an account
          </a>
        </div>
    </Shell>
  );
}
