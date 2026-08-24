/* =====================================================================
   Reset password. ONE page for all three audiences.

   WHY ONE. There used to be two, /forgot-password for staff and /apply/forgot
   for tenants, which is the same duplication /apply/signin had. The audience
   picker is what removes the need for a second page: it decides which backend
   the request goes to, and that is the only thing that actually differs.

   A tenant reset goes to tenant-auth's request_reset; an agent or supplier
   reset goes to the send-password-reset Edge Function. Both are deliberately
   silent about whether the address exists, so this screen shows the identical
   confirmation either way and never reveals it either.

   BACK TO SIGN IN CARRIES THE TAB. Somebody who picked Agent here is an agent
   when they arrive at /login, and making them pick twice is the kind of small
   rudeness that reads as the software not paying attention.
   ===================================================================== */
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { authService } from '@/data';
import * as tenantAuth from '@/tenant/tenantAuth';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import '../auth/auth.css';
import '../Login/Login.css';

type Audience = 'tenant' | 'agent' | 'supplier';

const TABS: { id: Audience; label: string }[] = [
  { id: 'tenant', label: 'Tenant' },
  { id: 'agent', label: 'Agent' },
  // Supplier, not Operator. The site this replaces says Operator; the portal
  // says Supplier, and /login is the one to match.
  { id: 'supplier', label: 'Supplier' },
];

export function ForgotPassword() {
  useDocumentTitle('Reset password');
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const [audience, setAudience] = useState<Audience>(
    tabParam === 'agent' || tabParam === 'supplier' ? tabParam : 'tenant',
  );
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    // A tenant and a member of staff are different principals in different
    // tables, so the request goes to a different place. Nothing else differs.
    try {
      if (audience === 'tenant') await tenantAuth.requestReset(email.trim());
      else await authService.requestPasswordReset(email.trim());
      setSent(true);
    } catch (e) {
      /* THREE CONDITIONS USED TO ARRIVE HERE AND LEAVE AS ONE SENTENCE:
         the address has no account, the send failed, and we are down. Only the
         first is a secret worth keeping, and the server keeps it by answering
         ok for a hit and a miss alike. The other two are ours, and saying "a
         reset link is on its way" over the top of them is the one claim we
         already know to be false. */
      setErr(e instanceof Error && e.message
        ? e.message
        : 'We could not send that just now. Try again in a moment.');
    }
    setBusy(false);
  }

  return (
    <div className="auth">
      <aside className="auth__brand">
        <div className="auth__brand-top">
          <span className="wordmark">opndoor</span>
          <span className="auth__cobrand">Guarantee<br />Referral Portal</span>
        </div>
        <div className="auth__brand-mid">
          <span className="auth__eyebrow">Reset password</span>
          <h1 className="auth__brand-h1">Forgot your password?</h1>
          <p className="auth__brand-copy">
            Tell us which side of opndoor you sign in on, give us the email on your
            account, and we will send a reset link. Links expire after 30 minutes
            for your security.
          </p>
        </div>
        <div className="auth__flow">
          <div className="auth__flow-item">
            <span className="auth__flow-ic"><Icon name="shield" /></span>
            <div>
              <div className="auth__flow-t">One link, thirty minutes</div>
              <div className="auth__flow-s">It expires, and it works once</div>
            </div>
          </div>
          <div className="auth__flow-item">
            <span className="auth__flow-ic"><Icon name="send" /></span>
            <div>
              <div className="auth__flow-t">Check your spam folder</div>
              <div className="auth__flow-s">It arrives within a minute or two</div>
            </div>
          </div>
        </div>
      </aside>

      <section className="auth__form-wrap">
        <div className="auth__card">
          <div className="aud" role="tablist" aria-label="Which account are you resetting">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={t.id === audience}
                className={`aud__tab${t.id === audience ? ' is-active' : ''}`}
                onClick={() => {
                  setAudience(t.id);
                  // A failure, and a confirmation, belong to the audience that
                  // produced them. Leaving `sent` set showed "a reset link is on
                  // its way for sam@x.com" under the Agent tab, and hid the form
                  // so no agent reset could be asked for at all.
                  setErr(null);
                  setSent(false);
                  // Shareable, like /login: ?tab= is a link somebody can be sent.
                  setParams({ tab: t.id }, { replace: true });
                }}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="auth__pane">
            <div className="auth__pane-body">
              {/* The same stack as /login. The copy does not currently differ by
                  audience, so nothing shifts today; the structure is here so
                  that it still cannot shift on the day it does. */}
              <div className="auth__stack">
                <div className="auth__stack-v">
                  <h2 className="auth__title">Reset your password.</h2>
                  {/* One "Back to sign in", at the bottom. The screenshot had it
                      twice, once here and once in the footer. */}
                  <p className="auth__sub">
                    Choose your account type and enter the email you used to register.
                  </p>
                </div>
              </div>

              {sent ? (
                <>
                  <p className="auth__sub" role="status" style={{ marginTop: 4 }}>
                    If an account exists for <b>{email.trim()}</b>, a reset link is on
                    its way. It expires in 30 minutes and can be used once.
                  </p>
                  <Button variant="quiet" block onClick={() => { setSent(false); setEmail(''); setErr(null); }}>
                    Send another
                  </Button>
                </>
              ) : (
                <>
                {err && (
                  <p className="auth__error" role="alert"
                     style={{ color: 'var(--danger, #c0392b)', marginTop: 4 }}>{err}</p>
                )}
                <form className="auth__form" onSubmit={submit} noValidate>
                  <div className="field">
                    <label htmlFor="reset-email">Email</label>
                    <input id="reset-email" type="email" autoComplete="email"
                           placeholder="you@example.co.uk" value={email}
                           onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                  <Button variant="primary" block type="submit" arrow
                          disabled={busy || !email.includes('@')}>
                    {busy ? 'Sending…' : 'Send reset link'}
                  </Button>
                </form>
                </>
              )}

              <p className="auth__foot auth__stack--foot">
                Remembered it? <Link to={`/login?tab=${audience}`}>Back to sign in</Link>
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
