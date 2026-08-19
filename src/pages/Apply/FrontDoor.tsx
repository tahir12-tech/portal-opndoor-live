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
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHead } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { PasswordInput } from '@/components/ui/PasswordInput';
import * as auth from '@/tenant/tenantAuth';
import * as api from '@/tenant/tenantApi';
import { SUPABASE_ENABLED } from '@/lib/supabase';
import './Apply.css';

function Shell({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="ap ap--narrow">
      <header className="ap-head">
        <div>
          <div className="ap-brand">opndoor</div>
          <h1>{title}</h1>
          {sub && <p className="ap-sub">{sub}</p>}
        </div>
      </header>
      {children}
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
    return (
      <Shell title="Check your email">
        <Card><CardBody>
          <p className="ap-p">
            We have sent a confirmation link to <strong>{f.email}</strong>. Open it and we will take you
            straight to your application.
          </p>
          <p className="soft">
            Nothing arrived? Check your spam folder, or{' '}
            <button type="button" className="ap-link" onClick={() => void auth.resendVerification(f.email)}>
              send it again
            </button>.
          </p>
        </CardBody></Card>
      </Shell>
    );
  }

  return (
    <Shell title="Apply for an opndoor guarantee"
      sub="Create an account first, so nothing you type is ever lost.">
      <Card><CardBody>
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
      </CardBody></Card>
      <p className="ap-foot">
        Next: a few details about the property, then a £20 application fee, then the longer part.
        You can stop and come back at any point.
      </p>
      <p className="ap-foot">Already have an account? <a href="/apply/signin">Sign in</a>.</p>
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
async function afterSignIn(nav: (to: string) => void, invite?: string) {
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
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const invite = sp.get('invite') ?? undefined;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    setBusy(true); setErr(null);
    try {
      await auth.signIn(email, password);
      await afterSignIn(nav, invite);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not sign in.');
      setBusy(false);
    }
  };

  return (
    <Shell title="Sign in">
      <Card><CardBody>
        <div className="ap-grid">
          <Field label="Email address"><input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Password"><PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
        </div>
        {err && <div className="ap-alert" role="alert">{err}</div>}
        <div className="ap-actions">
          <Button variant="primary" disabled={busy || !email || !password} onClick={() => void go()}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
          <a className="ap-link" href="/apply/forgot">I have forgotten my password</a>
        </div>
      </CardBody></Card>
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
      <Card><CardBody>
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
      </CardBody></Card>
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
      <Card><CardBody>
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
      </CardBody></Card>
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
        <Card><CardBody>
          <div className="ap-alert" role="alert">{err}</div>
          <p className="ap-p">Links last 24 hours and can only be used once.</p>
          <a className="ap-link" href="/apply/signin">Sign in instead</a>
        </CardBody></Card>
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
    return <Shell title="That link did not work"><Card><CardBody>
      <div className="ap-alert" role="alert">{err}</div>
    </CardBody></Card></Shell>;
  }
  if (!info) return <Shell title="Just a moment…"><p className="soft">Checking your link.</p></Shell>;

  return (
    <Shell title="Your agent has started this for you"
      sub="Set a password and pick up where they left off.">
      <Card><CardHead title="What we already have" /><CardBody>
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
      </CardBody></Card>
    </Shell>
  );
}
