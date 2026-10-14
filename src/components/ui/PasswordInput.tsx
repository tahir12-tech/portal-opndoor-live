/* =====================================================================
   Password input with a show/hide (eye) toggle (#78). Drops into the same
   .field wrapper as a plain input: keep the surrounding <div class="field">
   and <label>, and use this in place of the <input type="password">.
   Used on login, accept-invite and reset-password.
   ===================================================================== */
import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Icon } from './Icon';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/* FORWARDS ITS REF, so a caller can put the cursor back in it. Added
   2026-10-13 for the Change password dialog, which clears and refocuses the
   current-password box when that is the one that was wrong: the next thing
   somebody does is type it again, and leaving it filled invites them to press
   the button a second time instead. The toggle button is deliberately NOT the
   ref target -- a caller asking for this input means the input. */
export const PasswordInput = forwardRef<HTMLInputElement, Props>(function PasswordInput(props, ref) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-input">
      <input {...props} ref={ref} type={show ? 'text' : 'password'} />
      <button
        type="button"
        className="pw-input__toggle"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Hide password' : 'Show password'}
        aria-pressed={show}
        title={show ? 'Hide password' : 'Show password'}
      >
        <Icon name={show ? 'eyeOff' : 'eye'} />
      </button>
    </div>
  );
});
