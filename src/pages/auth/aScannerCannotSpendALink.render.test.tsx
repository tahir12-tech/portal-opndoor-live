/* A SCANNER CANNOT SPEND AN EMAILED AUTH LINK.
 *
 * Matt, 2026-10-13, after fourteen Regent invites died inside twelve minutes:
 *
 *   "Regent's corporate email scanner opens each link to scan it, and our
 *    links verify the one-time token on page load, so the token is used up
 *    before the person clicks. ... The /auth/confirm page must do nothing
 *    with the token on load. It shows the branded 'Set your password' screen
 *    with a button, and only the button click calls
 *    supabase.auth.verifyOtp({ token_hash, type })."
 *
 * HIS EVIDENCE IS WHAT THESE PIN. 14 invites sent 07:45 to 07:50 UTC; by
 * 07:57 thirteen had `last_sign_in_at` set while `public.users.status` was
 * still pending. A scanner cannot set last_sign_in_at; GoTrue does, when the
 * verify endpoint is hit. So a session was minted for each of them and no
 * human was ever in it.
 *
 * WHY A RENDER TEST AND NOT A SOURCE MATCH. The thing being prevented is a
 * side effect on mount, and the only way to prove a component does not have
 * one is to mount it and look. Every assertion below mounts the real page.
 *
 * TWO LINK SHAPES, ONE CLICK. `?token=` is our own seven-day invitation token
 * (20261009100000), spent by accept-invite; `?token_hash=` is a GoTrue
 * one-time token straight from a reset email. Both are spent on the same
 * button, so a scanner reaches neither.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const openInvitation = vi.fn();
const confirmEmailLink = vi.fn();
const factorState = vi.fn();
const getSession = vi.fn();

vi.mock('@/lib/supabase', () => ({
  SUPABASE_ENABLED: true,
  sb: () => ({
    auth: {
      getSession: () => getSession(),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  }),
}));
vi.mock('@/session/SessionContext', () => ({
  useSession: () => ({ status: 'anon', markMfaVerified: () => {} }),
}));
vi.mock('@/data', () => ({
  authService: {
    openInvitation: (t: string) => openInvitation(t),
    confirmEmailLink: (h: string, k: string) => confirmEmailLink(h, k),
    factorState: () => factorState(),
  },
}));
vi.mock('@/data/authService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/authService')>();
  return { ...actual };
});

const { ResetPassword } = await import('./ResetPassword');

const TOKEN = '11111111-2222-3333-4444-555555555555';
const HASH = 'pkce_abc123hashedtoken';

beforeEach(() => {
  openInvitation.mockReset();
  confirmEmailLink.mockReset();
  factorState.mockReset();
  getSession.mockReset();
  getSession.mockResolvedValue({ data: { session: null } });
  factorState.mockResolvedValue({ hasVerifiedFactor: false, factorId: null, aal: 'aal1' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function open(url: string, mode: 'invite' | 'reset' = 'invite') {
  return render(
    <MemoryRouter initialEntries={[url]}><ResetPassword mode={mode} /></MemoryRouter>,
  );
}

const continueButton = () =>
  [...document.querySelectorAll<HTMLElement>('button')].find((b) => /continue|opening/i.test(b.textContent ?? ''));

// ===========================================================================
// 1. WHAT A SCANNER DOES: it loads the page and goes away.
// ===========================================================================
describe('loading the page spends nothing', () => {
  it('does not redeem our invitation token on mount', async () => {
    open(`/auth/confirm?token=${TOKEN}&type=invite&tab=agent`);
    await settle();
    expect(openInvitation).not.toHaveBeenCalled();
    expect(confirmEmailLink).not.toHaveBeenCalled();
  });

  it('and does not verify a GoTrue token_hash on mount', async () => {
    open(`/auth/confirm?token_hash=${HASH}&type=recovery&tab=supplier`, 'reset');
    await settle();
    expect(confirmEmailLink).not.toHaveBeenCalled();
    expect(openInvitation).not.toHaveBeenCalled();
  });

  /* AND IT NEVER CALLS THE LINK INVALID WHILE IT WAITS. The 1.5s fallback
     that exists for a session-bearing landing must not fire here, or a
     scanner's visit would leave the real person looking at "not valid"
     without anything having been spent. */
  it('and still offers the button after the session fallback would have fired', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    open(`/auth/confirm?token=${TOKEN}&type=invite`);
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.queryByText(/this link is not valid/i)).toBeNull();
    expect(continueButton()).toBeTruthy();
    expect(openInvitation).not.toHaveBeenCalled();
  });

  /* THE CARD'S OWN HEADING, not any of the three places the brand panel also
     says those words: `getByText` matches every element whose whole text is
     that string, and the flow list beside it carries the same sentence. */
  it('and shows the branded screen with a button, not a spinner', async () => {
    const view = open(`/auth/confirm?token=${TOKEN}&type=invite`);
    await settle();
    expect(view.container.querySelector('.auth__card .auth__title')!.textContent).toBe('Set your password');
    expect(continueButton()).toBeTruthy();
    expect(view.container.textContent).not.toContain('Checking your link');
  });
});

// ===========================================================================
// 2. WHAT A PERSON DOES: they press the button.
// ===========================================================================
describe('the button spends the token, and only the button', () => {
  it('redeems our invitation token and then verifies what it gets back', async () => {
    openInvitation.mockResolvedValue({ ok: true, tokenHash: HASH, type: 'recovery', tab: 'agent' });
    confirmEmailLink.mockResolvedValue({ ok: true });
    open(`/auth/confirm?token=${TOKEN}&type=invite&tab=agent`);
    await settle();
    fireEvent.click(continueButton()!);
    await waitFor(() => expect(confirmEmailLink).toHaveBeenCalledWith(HASH, 'recovery'));
    expect(openInvitation).toHaveBeenCalledWith(TOKEN);
  });

  /* A RESET CARRIES THE HASH ITSELF, so there is nothing to redeem first and
     the type off the URL is the one verifyOtp is given. */
  it('verifies a reset link’s own token_hash with the type from the link', async () => {
    confirmEmailLink.mockResolvedValue({ ok: true });
    open(`/auth/confirm?token_hash=${HASH}&type=recovery&tab=supplier`, 'reset');
    await settle();
    fireEvent.click(continueButton()!);
    await waitFor(() => expect(confirmEmailLink).toHaveBeenCalledWith(HASH, 'recovery'));
    expect(openInvitation).not.toHaveBeenCalled();
  });

  /* ONE ATTEMPT, however many times it is pressed. Two clicks must not spend
     two tokens, and the second would be refused anyway. */
  it('spends it once however many times the button is pressed', async () => {
    openInvitation.mockResolvedValue({ ok: true, tokenHash: HASH, type: 'recovery' });
    confirmEmailLink.mockResolvedValue({ ok: true });
    open(`/auth/confirm?token=${TOKEN}&type=invite`);
    await settle();
    const btn = continueButton()!;
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(confirmEmailLink).toHaveBeenCalled());
    expect(openInvitation).toHaveBeenCalledTimes(1);
    expect(confirmEmailLink).toHaveBeenCalledTimes(1);
  });

  /* AND THE JOURNEY CARRIES ON AS IT ALWAYS DID: a verified session hands
     over to the existing path, which for somebody with no factor is the
     password screen. */
  it('and hands over to the password screen once the session exists', async () => {
    openInvitation.mockResolvedValue({ ok: true, tokenHash: HASH, type: 'recovery' });
    confirmEmailLink.mockImplementation(async () => {
      getSession.mockResolvedValue({ data: { session: { access_token: 'x' } } });
      return { ok: true };
    });
    open(`/auth/confirm?token=${TOKEN}&type=invite`);
    await settle();
    fireEvent.click(continueButton()!);
    await waitFor(() => expect(screen.getByText('Set your password')).toBeTruthy());
    await waitFor(() => expect(document.querySelector('#pw')).toBeTruthy());
  });
});

// ===========================================================================
// 3. A USED OR EXPIRED TOKEN, which is Matt's point 3.
// ===========================================================================
describe('a spent link still says so', () => {
  it('shows the existing not-valid screen when verifyOtp refuses', async () => {
    openInvitation.mockResolvedValue({ ok: true, tokenHash: HASH, type: 'recovery' });
    confirmEmailLink.mockResolvedValue({ ok: false, error: 'Token has expired or is invalid' });
    open(`/auth/confirm?token=${TOKEN}&type=invite`);
    await settle();
    fireEvent.click(continueButton()!);
    await waitFor(() => expect(screen.getByText(/this link is not valid/i)).toBeTruthy());
    expect(screen.getByText(/ask your administrator to resend it/i)).toBeTruthy();
  });

  /* AND OUR OWN TOKEN'S REASON SURVIVES, which is the whole point of
     claim_staff_invite raising four different sentences: expired, already
     used, cancelled and never issued are four things to tell somebody and
     only one of them means "ask for another". */
  it('and shows the server’s own sentence when our invitation token is refused', async () => {
    openInvitation.mockResolvedValue({ ok: false, error: 'That invitation expired on 02 October 2026.' });
    open(`/auth/confirm?token=${TOKEN}&type=invite`);
    await settle();
    fireEvent.click(continueButton()!);
    await waitFor(() => expect(screen.getByText(/expired on 02 October 2026/)).toBeTruthy());
    expect(confirmEmailLink).not.toHaveBeenCalled();
  });

  /* GoTrue's OWN WORDING IS NOT SHOWN. "Token has expired or is invalid" is a
     developer's sentence; the mode's copy is the one written for a reader. */
  it('and does not print GoTrue’s own message at a person', async () => {
    confirmEmailLink.mockResolvedValue({ ok: false, error: 'Token has expired or is invalid' });
    open(`/auth/confirm?token_hash=${HASH}&type=recovery`, 'reset');
    await settle();
    fireEvent.click(continueButton()!);
    await waitFor(() => expect(screen.getByText(/this link is not valid/i)).toBeTruthy());
    expect(screen.queryByText(/Token has expired or is invalid/)).toBeNull();
  });
});

// ===========================================================================
// 4. AND A LANDING WITH NO LINK IS UNCHANGED.
// ===========================================================================
describe('a page with no token in it', () => {
  it('keeps the session path it always had, including the fallback', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    open('/reset-password?tab=supplier', 'reset');
    await vi.advanceTimersByTimeAsync(2000);
    await waitFor(() => expect(screen.getByText(/this link is not valid/i)).toBeTruthy());
    expect(openInvitation).not.toHaveBeenCalled();
    expect(confirmEmailLink).not.toHaveBeenCalled();
  });
});
