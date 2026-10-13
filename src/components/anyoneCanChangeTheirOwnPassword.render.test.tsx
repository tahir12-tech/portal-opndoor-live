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

  /* THE ONE THING THAT COULD QUIETLY UNDO IT. updateUser takes no current
     password, so proving the holder knows it means signing in with it -- and
     signInWithPassword on the LIVE client would replace the session and drop
     a member of staff from AAL2 to AAL1, whereupon Supabase refuses to change
     an MFA user's password at all. The check would break the thing it guards.
     So it runs on a throwaway client that persists nothing. */
  it('verifies the current password on a client that persists nothing', () => {
    const fn = SERVICE.slice(SERVICE.indexOf('export async function changeOwnPassword'));
    const body = fn.slice(0, fn.indexOf('\nexport '));
    expect(body).toContain('persistSession: false');
    expect(body).toContain("storageKey: 'opndoor.password-check'");
    expect(body).toContain('autoRefreshToken: false');
    // The real client is used for the write, and only for the write.
    expect(body).toContain('sb().auth.updateUser({ password: newPassword })');
    // And the probe is signed out whatever happened.
    expect(body).toContain('probe.auth.signOut()');
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
    expect(SERVICE).toContain("if (newPassword.length < 8) return { ok: false, error: 'Use at least 8 characters.' };");
  });
});
