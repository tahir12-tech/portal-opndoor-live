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
import { forgotHref, signInHref } from '@/pages/auth/carry';
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
  // No misleading default. Every caller states its own, because a shared
  // default reading "Tenant sign in" is how a registration page ended up
  // labelled as a sign-in.
  title, sub, children, eyebrow = 'Your application',
}: {
  title: string; sub?: string; children: React.ReactNode; eyebrow?: string;
}) {
  // The tab said "Guarantee Referral Portal" on a page branded "guarantor
  // application", which tells an applicant they are on the wrong site.
  useTenantDocumentTitle(title);
  return (
    <div className="auth auth--doc">
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
            the property. Apply online, and we deal with whoever manages the property.
          </p>
        </div>
        <div className="auth__flow">
          <div className="auth__flow-item">
            <span className="auth__flow-ic"><Icon name="edit" /></span>
            <div>
              <div className="auth__flow-t">Do it in your own time</div>
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
  // The address already has an account, and we say so. A deliberate trade: the
  // neutral answer kept the address private and left a real person waiting for
  // a code that was never sent.
  const [existing, setExisting] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ready = f.first_name && f.last_name && f.email.includes('@') && f.password.length >= 10;

  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await auth.register({ ...f, invite }) as { sent?: boolean; exists?: boolean } | undefined;
      if (r?.exists) { setExisting(true); return; }
      if (!SUPABASE_ENABLED) {
        const failed = await afterSignIn(nav, invite);
        if (failed) setErr(failed);
        return;
      }
      // ok with sent:false means the account is real and the code is not. Go to
      // the verification screen and say so, rather than back to a form that
      // would tell them the address is already taken.
      setSendFailed(r?.sent === false);
      setSent(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create the account.');
    } finally { setBusy(false); }
  };

  if (existing) return (
    <Shell eyebrow="Create an account" title="You already have an account"
      sub={`There is already an opndoor account for ${f.email}.`}>
      <p className="ap-p">
        Sign in to pick up where you left off. We have emailed you as well, in case
        it was not you who tried.
      </p>
      <div className="ap-actions">
        {/* Both carry the address. This screen is literally displaying it back
            to them, so sending them on to an empty field was the same "retype
            what you just typed" as the sign-in page had. */}
        <Button variant="primary" onClick={() => { window.location.href = signInHref('tenant', f.email); }}>
          Sign in
        </Button>
        <a className="ap-link" href={forgotHref('tenant', f.email)}>I have forgotten my password</a>
      </div>
      <p className="ap-foot">
        Wrong address?{' '}
        <button type="button" className="ap-link"
          onClick={() => { setExisting(false); setF({ ...f, email: '' }); }}>
          Use a different one
        </button>.
      </p>
    </Shell>
  );

  if (sent) {
    return <CodeStep email={f.email} invite={invite} onBack={() => setSent(false)} sendFailed={sendFailed} />;
  }

  return (
    <Shell eyebrow="Create an account" title="Apply for an opndoor guarantee"
      sub="Create an account first, so nothing you type is ever lost.">
        <div className="ap-grid">
          <Field label="First name" htmlFor="ap-first"><input id="ap-first" className="input" value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} /></Field>
          <Field label="Last name" htmlFor="ap-last"><input id="ap-last" className="input" value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></Field>
          <Field label="Email address" htmlFor="ap-reg-email"><input id="ap-reg-email" className="input" type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Mobile number" htmlFor="ap-phone"><input id="ap-phone" className="input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Password" htmlFor="ap-reg-password" hint="At least 10 characters. Longer is better than complicated.">
            <PasswordInput id="ap-reg-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
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
      {/* The address is in f.email, three lines from the sibling screen that
          already carries it. Dropping it here asked for it twice. */}
      <p className="ap-foot">Already have an account? <a href={signInHref('tenant', f.email)}>Sign in</a>.</p>
    </Shell>
  );
}


/* ---------------------------------------------------------------------------
   The code step. Shown straight after registering, and after a resend.

   A CODE RATHER THAN A LINK because a tenant applying on a laptop reads their
   email on a phone. A link strands them on the wrong device; six digits cross
   the gap by being typed.
   --------------------------------------------------------------------------- */
function CodeStep({ email, invite, onBack, purpose = 'verify_email', sendFailed = false }: {
  email: string; invite?: string; onBack: () => void;
  /** The first code did not go out. The account exists; only delivery failed,
      so the way forward is another code rather than starting again. */
  sendFailed?: boolean;
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

  /* Resend used to be `void auth.resendCode(...)` with setResent(true) on the
     next statement. request_reset's sibling actions can now answer 503 when the
     limiter cannot reach the database, so a dropped promise is an unhandled
     rejection AND a screen claiming a code was sent that never was. That is the
     original defect, one action along. */
  async function resend() {
    setErr(null);
    try {
      await auth.resendCode(email, purpose);
      setResent(true);
      setCode('');
    } catch (e) {
      setResent(false);
      setErr(e instanceof Error && e.message
        ? e.message
        : 'We could not send a new code just now. Try again in a moment.');
    }
  }

  const go = async () => {
    setBusy(true); setErr(null);
    try {
      await auth.verifyCode(email, code, purpose);
      const failed = await afterSignIn(nav, invite);
      if (failed) { setErr(failed); setBusy(false); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That code is not right.');
      setBusy(false);
    }
  };

  return (
    <Shell title="Check your email"
      eyebrow={purpose === 'sign_in' ? 'Two-factor' : 'Confirm your address'}
      sub={`We have sent a six-digit code to ${email}. It lasts ten minutes.`}>
      {sendFailed && (
        <div className="ap-alert" role="alert" style={{ marginBottom: 14 }}>
          Your account was created, but we could not send the code just now.
          Use <b>send a new code</b> below to try again.
        </div>
      )}
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
          onClick={() => { void resend(); }}>
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
export async function afterSignIn(nav: (to: string) => void, invite?: string): Promise<string | null> {
  try {
    if (invite) {
      await api.claimInvite(invite);
    } else {
      await api.startApplication({});
    }
  } catch (e) {
    /* THE SWALLOW WAS THE WORST PART OF THE WORST FAILURE.
       This used to catch and carry on to /apply, which finds no application and
       sends them back to the registration form. A tenant who has just created
       an account, verified a code and been returned to "Create an account
       first" has no way to read that as anything but the account not saving.

       They stay signed in, which is true and is why the catch existed. But they
       are TOLD, and the caller decides where to put them, rather than being
       shown the form they just completed. */
    return e instanceof Error && e.message ? e.message : 'We could not open your application.';
  }
  nav('/apply');
  return null;
}


/* ---------------------------------------------------------------------------
   3. Reset.

   Forgot lived here too, a second reset screen with its own copy and its own
   state. Nothing imported it: /apply/forgot has redirected to
   /forgot-password?tab=tenant since /apply/signin was deleted, so it was
   unreachable and had been for a while. It was also still carrying the defect
   this commit exists to fix, `void auth.requestReset(email)` followed by an
   unconditional setSent(true), which is what an unreachable copy of a screen
   does: it stops being fixed when the real one is. Deleted rather than
   repaired. There is one reset page and it is /forgot-password.
   --------------------------------------------------------------------------- */
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
    <Shell eyebrow="Reset your password" title="Choose a new password">
        {err && <div className="ap-alert" role="alert">{err} <a href="/forgot-password?tab=tenant">Ask for a new link</a>.</div>}
        {ready && !err && (
          <>
            <Field label="New password" htmlFor="ap-new-password" hint="At least 10 characters.">
              <PasswordInput id="ap-new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
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
    <Shell eyebrow="Confirm your email" title={err ? 'That link did not work' : 'Confirming your email…'}>
      {err && (
        <>
          <div className="ap-alert" role="alert">{err}</div>
          <p className="ap-p">Links last 24 hours and can only be used once.</p>
          <a className="ap-link" href="/login?tab=tenant">Sign in instead</a>
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
      if (!r.valid) { setErr('This link has expired. Ask whoever referred you to send a new one.'); return; }
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
    <Shell title={info.referrer_name ? `${info.referrer_name} has started this for you` : 'This application has been started for you'}
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
          couple of documents. Everything saves as you go, so you can stop and come back whenever you like.
        </p>
        <div className="ap-actions">
          <Button variant="primary" onClick={() => nav(`/apply/register?invite=${encodeURIComponent(token)}`)}>
            Set up my account
          </Button>
          <a className="ap-link" href={`/login?tab=tenant&invite=${encodeURIComponent(token)}`}>
            I already have an account
          </a>
        </div>
    </Shell>
  );
}
