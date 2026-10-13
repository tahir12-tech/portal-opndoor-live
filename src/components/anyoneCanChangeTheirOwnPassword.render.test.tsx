/* ANYONE SIGNED IN CAN CHANGE THEIR OWN PASSWORD, WITH NO EMAIL IN IT.
 *
 * Matt, 2026-10-13: "check whether a signed-in user can change their own
 * password anywhere in the portal (account menu or settings). If not, add
 * 'Change password' for every signed-in user: current password, new password
 * twice, at least 8 characters, using supabase.auth.updateUser. No email
 * involved."
 *
 * The answer was no. These pin the four rules he gave, the place it lives,
 * and the one thing that could quietly undo it: verifying the current
 * password must not disturb the session it is guarding.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const changeOwnPassword = vi.fn();

vi.mock('@/data', () => ({ authService: { changeOwnPassword: (a: string, b: string) => changeOwnPassword(a, b) } }));

const { ChangePasswordDialog } = await import('./ChangePasswordDialog');

const field = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!;
const submit = () =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => /change password|changing/i.test(b.textContent ?? ''))!;

function openIt() {
  return render(<ChangePasswordDialog open onClose={() => {}} />);
}
async function settle() { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }

function type(id: string, v: string) { fireEvent.change(field(id), { target: { value: v } }); }

beforeEach(() => { changeOwnPassword.mockReset(); changeOwnPassword.mockResolvedValue({ ok: true }); });
afterEach(() => cleanup());

describe('the three boxes Matt asked for', () => {
  it('asks for the current password and the new one twice', async () => {
    openIt();
    await settle();
    expect(field('cp-current')).toBeTruthy();
    expect(field('cp-next')).toBeTruthy();
    expect(field('cp-again')).toBeTruthy();
  });

  it('and says no email is involved, because that is the point of it', async () => {
    const view = openIt();
    await settle();
    expect(view.baseElement.textContent).toContain('No email is sent');
  });
});

describe('the two rules', () => {
  it('refuses fewer than 8 characters, and says so before you submit', async () => {
    openIt();
    await settle();
    type('cp-current', 'whatever');
    type('cp-next', 'short');
    type('cp-again', 'short');
    expect(screen.getByText('Use at least 8 characters.')).toBeTruthy();
    expect(submit().disabled).toBe(true);
  });

  it('and refuses two that do not match', async () => {
    openIt();
    await settle();
    type('cp-current', 'whatever');
    type('cp-next', 'longenough1');
    type('cp-again', 'longenough2');
    expect(screen.getByText('Those passwords do not match.')).toBeTruthy();
    expect(submit().disabled).toBe(true);
  });

  /* AND THE CURRENT PASSWORD IS NOT OPTIONAL. Without it there is nothing
     between a borrowed tab and somebody's account. */
  it('and will not submit without the current password', async () => {
    openIt();
    await settle();
    type('cp-next', 'longenough1');
    type('cp-again', 'longenough1');
    expect(submit().disabled).toBe(true);
  });

  it('submits when all three are right', async () => {
    openIt();
    await settle();
    type('cp-current', 'theoldone');
    type('cp-next', 'longenough1');
    type('cp-again', 'longenough1');
    expect(submit().disabled).toBe(false);
    fireEvent.click(submit());
    await waitFor(() => expect(changeOwnPassword).toHaveBeenCalledWith('theoldone', 'longenough1'));
  });
});

describe('what it says afterwards', () => {
  it('confirms, and says you are still signed in', async () => {
    const view = openIt();
    await settle();
    type('cp-current', 'theoldone');
    type('cp-next', 'longenough1');
    type('cp-again', 'longenough1');
    fireEvent.click(submit());
    await waitFor(() => expect(view.baseElement.textContent).toContain('Your password has been changed'));
  });

  it('and shows the server’s reason when it is refused', async () => {
    changeOwnPassword.mockResolvedValue({ ok: false, error: 'That is not your current password.' });
    openIt();
    await settle();
    type('cp-current', 'wrong');
    type('cp-next', 'longenough1');
    type('cp-again', 'longenough1');
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getByText('That is not your current password.')).toBeTruthy());
  });

  /* THE PASSWORDS DO NOT LINGER. A password left in React state behind a
     closed dialog is a password in memory for the rest of the session. */
  it('and empties the boxes the moment it works', async () => {
    openIt();
    await settle();
    type('cp-current', 'theoldone');
    type('cp-next', 'longenough1');
    type('cp-again', 'longenough1');
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getByText('Close')).toBeTruthy());
    expect(document.querySelector('#cp-current')).toBeNull();
  });
});

describe('where it lives, and what guards it', () => {
  const SIDEBAR = readFileSync('src/components/layout/Sidebar.tsx', 'utf8');
  const SERVICE = readFileSync('src/data/authService.ts', 'utf8');

  /* IN THE ACCOUNT MENU, FOR EVERYONE. Not behind a role: the password belongs
     to the person. The assertion is that the button has no condition on it. */
  it('is in the account menu beside Sign out, with nothing gating it', () => {
    expect(SIDEBAR).toContain('<Icon name="lock" /> Change password');
    expect(SIDEBAR).toContain('onClick={() => { setMenuOpen(false); setChangePw(true); }}');
    expect(SIDEBAR).not.toMatch(/\{\s*(isAdmin|role ===|canSee)[^}]*&&[^}]*Change password/);
  });

  /* THE ONE THING THAT COULD QUIETLY UNDO IT, AND DID.
     updateUser takes no current password, so proving the holder knows it
     means signing in with it -- and signInWithPassword on the LIVE client
     would replace the session and drop a staff user from AAL2 to AAL1,
     whereupon Supabase refuses to change an MFA user's password at all. So
     the check runs on a throwaway client. */
  it('verifies the current password on a client that persists nothing', () => {
    const fn = SERVICE.slice(SERVICE.indexOf('export async function changeOwnPassword'));
    const body = fn.slice(0, fn.indexOf('\nexport '));
    expect(body).toContain('persistSession: false');
    expect(body).toContain("storageKey: 'opndoor.password-check'");
    expect(body).toContain('autoRefreshToken: false');
    expect(body).toContain('sb().auth.updateUser({ password: newPassword })');
  });

  /* AND THE SCOPE, WHICH IS THE BUG MATT REPORTED ON DEV.
     signOut() defaults to scope: 'global', which revokes EVERY session the
     user has -- including the one they are sitting in. Measured against dev:
     an AAL2 session answered 200 from /auth/v1/user, a second sign-in then
     signed out globally, and the first answered 403 session_not_found.
     updateUser was then being called on a session that no longer existed.

     TWO ASSERTIONS, because the positive one alone would pass if somebody
     added a second, bare signOut() beside it. */
  it('and signs the probe out LOCALLY, never globally', () => {
    const fn = SERVICE.slice(SERVICE.indexOf('export async function changeOwnPassword'));
    const body = fn.slice(0, fn.indexOf('\nexport '));
    expect(body).toContain("probe.auth.signOut({ scope: 'local' })");
    // No bare signOut() anywhere in it: that is the default, and the default
    // is global.
    expect(body).not.toMatch(/signOut\(\s*\)/);
    expect(body).not.toContain("scope: 'global'");
    expect(body).not.toContain("scope: 'others'");
  });

  /* AND NO EMAIL. Supabase's own answer to "check the current password" is
     reauthenticate(), which sends a nonce by email. Matt asked for none. */
  it('and never asks Supabase to email anything', () => {
    const fn = SERVICE.slice(SERVICE.indexOf('export async function changeOwnPassword'));
    const body = fn.slice(0, fn.indexOf('\nexport '));
    expect(body).not.toContain('reauthenticate');
    expect(body).not.toContain('resetPasswordForEmail');
    expect(body).not.toContain('send-password-reset');
  });

  it('and checks the 8 characters in the service too, not only on the screen', () => {
    expect(SERVICE).toContain("if (newPassword.length < 8) {");
    expect(SERVICE).toContain("error: 'Use at least 8 characters.'");
  });

  /* EACH OF MATT'S FOUR CASES IS KEYED ON GoTrue's CODE, not on its message.
     The codes were read off dev by driving each refusal for real:
       invalid_credentials  wrong current password
       weak_password        "Password should be at least 6 characters."
       same_password        "New password should be different from the old..."
       session_not_found    "Session from session_id claim in JWT does not exist"
     A message is prose and changes between releases; a code does not. */
  it('maps each of the four refusals by its code', () => {
    for (const code of ['same_password', 'weak_password', 'session_not_found',
                        'insufficient_aal', 'reauthentication_needed']) {
      expect(SERVICE).toContain(code);
    }
  });

  /* AND THE GENERIC SENTENCE CARRIES THE REAL ONE. "We could not change your
     password. Please try again." is what hid this bug for a day: it told Matt
     nothing while the answer sat in error.message. */
  it('and reports an unrecognised failure as itself', () => {
    expect(SERVICE).toContain('`We could not change your password: ${msg}`');
  });
});
