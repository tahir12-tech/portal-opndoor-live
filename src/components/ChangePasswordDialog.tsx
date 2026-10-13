/* =====================================================================
   CHANGE YOUR OWN PASSWORD, WITH NO EMAIL IN IT.

   Matt, 2026-10-13: "check whether a signed-in user can change their own
   password anywhere in the portal (account menu or settings). If not, add
   'Change password' for every signed-in user: current password, new password
   twice, at least 8 characters, using supabase.auth.updateUser. No email
   involved."

   THE ANSWER TO HIS QUESTION WAS NO, and it had already come up: on
   2026-10-09, explaining how Ethan Li would replace the temporary password I
   had him set by hand, the only routes were /forgot-password and an admin
   pressing Reset password on his row. Both go through email, and an emailed
   link is the thing that had just been eaten by a scanner for fourteen people.

   FOR EVERY SIGNED-IN USER, which is why it sits in the account menu beside
   Sign out rather than on a settings page some roles cannot reach. Nothing
   here is gated on a role: the password belongs to the person.

   THE CURRENT PASSWORD IS CHECKED FIRST, and on a throwaway client, so a
   wrong one costs nothing and a right one does not disturb the session.
   changeOwnPassword carries that reasoning.
   ===================================================================== */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { PasswordInput } from '@/components/ui/PasswordInput';
import { authService } from '@/data';
import type { PasswordChangeProblem } from '@/data/authService';

export function ChangePasswordDialog({ open, onClose, onDone, onSignInAgain }: {
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
  /* WHAT TO DO WHEN THE SESSION IS THE PROBLEM. Passed in rather than reached
     for: a dialog about a password has no business holding the router and the
     session just to offer one button, and the caller already has both. */
  onSignInAgain?: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /* WHICH problem, not only its sentence. Matt, 2026-10-13: "make the dialog
     show a specific message for each case". One of the four needs more than a
     sentence -- a dead session cannot be fixed from inside this dialog -- so
     the kind is kept and not just the words. */
  const [problem, setProblem] = useState<PasswordChangeProblem | null>(null);
  const [done, setDone] = useState(false);
  const currentRef = useRef<HTMLInputElement>(null);

  /* EMPTIED WHENEVER IT OPENS. A password left in React state behind a closed
     dialog is a password sitting in memory for the rest of the session, and
     the next person to open it would find the last one typed. */
  useEffect(() => {
    if (!open) return;
    setCurrent(''); setNext(''); setAgain(''); setError(''); setProblem(null); setDone(false); setBusy(false);
  }, [open]);

  /* THE TWO RULES MATT GAVE, CHECKED HERE SO THEY READ AS SENTENCES rather
     than arriving from Supabase as a refusal. The 8 is checked again inside
     changeOwnPassword, because a rule the screen owns alone is a rule a
     different caller does not have. */
  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = again.length > 0 && next !== again;
  const ready = current.length > 0 && next.length >= 8 && next === again;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    setProblem(null);
    try {
      const r = await authService.changeOwnPassword(current, next);
      if (!r.ok) {
        setError(r.error ?? 'We could not change your password.');
        setProblem(r.problem ?? 'failed');
        /* THE WRONG ONE IS CLEARED AND REFOCUSED, because the next thing
           somebody does is type it again, and leaving it there invites them
           to press the button a second time instead. The two NEW boxes are
           left alone: they were fine, and making somebody retype a password
           they got right is its own small insult. */
        if (r.problem === 'wrong_current') {
          setCurrent('');
          currentRef.current?.focus();
        }
        return;
      }
      /* THE PASSWORDS GO THE MOMENT IT WORKS, not when the dialog closes. */
      setCurrent(''); setNext(''); setAgain('');
      setDone(true);
      onDone?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change password"
      sub={done ? undefined : 'You stay signed in. No email is sent.'}
      width={440}
    >
      {done ? (
        <div>
          <p>Your password has been changed. Use the new one next time you sign in.</p>
          <div className="auth__form" style={{ marginTop: 16 }}>
            <Button variant="primary" block onClick={onClose}>Close</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="cp-current">Current password</label>
            <PasswordInput
              ref={currentRef}
              id="cp-current" autoComplete="current-password" value={current}
              onChange={(e) => setCurrent(e.target.value)} required
            />
          </div>
          <div className="field">
            <label htmlFor="cp-next">New password</label>
            <PasswordInput
              id="cp-next" autoComplete="new-password" placeholder="At least 8 characters"
              value={next} onChange={(e) => setNext(e.target.value)} required
            />
            {tooShort && <span className="field__hint">Use at least 8 characters.</span>}
          </div>
          <div className="field">
            <label htmlFor="cp-again">Confirm new password</label>
            <PasswordInput
              id="cp-again" autoComplete="new-password" value={again}
              onChange={(e) => setAgain(e.target.value)} required
            />
            {mismatch && <span className="field__hint">Those passwords do not match.</span>}
          </div>
          {error && <p role="alert" style={{ color: 'var(--danger, #c0392b)', margin: '8px 0 0' }}>{error}</p>}
          {/* THE ONE CASE A SENTENCE CANNOT FIX. A revoked, expired or
              below-AAL2 session cannot change a password, and nothing inside
              this dialog will mend it: the person has to sign in again. So
              the dialog offers that rather than telling them to go and find
              it. */}
          {problem === 'needs_sign_in' && onSignInAgain && (
            <div className="auth__form" style={{ marginTop: 12 }}>
              <Button
                variant="ghost" block
                onClick={onSignInAgain}
              >
                Sign in again
              </Button>
            </div>
          )}
          <div className="auth__form" style={{ marginTop: 16 }}>
            <Button variant="primary" block type="submit" disabled={!ready || busy}>
              {busy ? 'Changing…' : 'Change password'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
