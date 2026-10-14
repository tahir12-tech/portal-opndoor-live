/* THE ACCEPT INVITE PAGE REDEEMS THE PORTAL'S OWN SEVEN-DAY TOKEN.
 *
 * Matt, 2026-10-09: "7-day links, Accept invite page, sent date, expiry,
 * resend and cancel."
 *
 * WHY THE TOKEN IS OURS. A GoTrue action link lives for `mailer_otp_exp`,
 * one project-wide number shared with password resets, whose copy promises
 * thirty minutes in three places. So the email carries our token and the
 * short-lived Supabase link is minted at the moment the person clicks.
 *
 * AND WHY REDEEMING IS A POST. The old email's button was a bare GET on
 * /auth/v1/verify, so a mail gateway that pre-fetches links at delivery
 * spent the invitation before the human read it. Loading this page does
 * nothing; the call below is the only thing that spends anything, which is
 * why these tests count the calls as well as reading the screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const openInvitation = vi.fn();
const replace = vi.fn();

vi.mock('@/lib/supabase', () => ({
  SUPABASE_ENABLED: true,
  sb: () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  }),
}));
vi.mock('@/session/SessionContext', () => ({
  useSession: () => ({ status: 'anon', markMfaVerified: () => {} }),
}));
vi.mock('@/data', () => ({ authService: { openInvitation: (t: string) => openInvitation(t) } }));

const { ResetPassword } = await import('./ResetPassword');

beforeEach(() => {
  openInvitation.mockReset();
  replace.mockReset();
  Object.defineProperty(window, 'location', {
    configurable: true, value: { ...window.location, replace },
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const TOKEN = '11111111-2222-3333-4444-555555555555';

function open(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}><ResetPassword mode="invite" /></MemoryRouter>,
  );
}

describe('a seven-day invitation link', () => {
  it('is redeemed, and sends the invitee on to the link it gets back', async () => {
    openInvitation.mockResolvedValue({ ok: true, link: 'https://ref.supabase.co/auth/v1/verify?token=x' });
    open(`/accept-invite?token=${TOKEN}`);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('https://ref.supabase.co/auth/v1/verify?token=x'));
    expect(openInvitation).toHaveBeenCalledWith(TOKEN);
  });

  /* ONE ATTEMPT, EVER. React renders a component more than once, and a
     second POST would spend a second token and then be told the first had
     already been used. The guard is a ref rather than state for exactly
     that reason, so this assertion is about the ref. */
  it('is spent once however many times the component renders', async () => {
    openInvitation.mockResolvedValue({ ok: true, link: 'https://ref.supabase.co/x' });
    const { rerender } = open(`/accept-invite?token=${TOKEN}`);
    rerender(<MemoryRouter initialEntries={[`/accept-invite?token=${TOKEN}`]}><ResetPassword mode="invite" /></MemoryRouter>);
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(openInvitation).toHaveBeenCalledTimes(1);
  });

  /* THE REASON IS THE POINT, and it is the whole of what Matt was missing:
     he spent two days behind "This link is not valid" with nothing to tell
     him which of four things had happened. The server writes the sentence
     and the screen must show it rather than replacing it with the generic
     one. */
  it('shows the server’s own reason rather than "may have expired"', async () => {
    openInvitation.mockResolvedValue({ ok: false, error: 'That invitation expired on 02 October 2026.' });
    open(`/accept-invite?token=${TOKEN}`);
    await waitFor(() => expect(screen.getByText(/this link is not valid/i)).toBeTruthy());
    expect(screen.getByText(/expired on 02 October 2026/)).toBeTruthy();
    expect(screen.queryByText(/may have expired or already been used/i)).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('and still falls back to the generic sentence when the server gave none', async () => {
    openInvitation.mockResolvedValue({ ok: false });
    open(`/accept-invite?token=${TOKEN}`);
    await waitFor(() => expect(screen.getByText(/this link is not valid/i)).toBeTruthy());
    expect(screen.getByText(/ask your administrator to resend it/i)).toBeTruthy();
  });

  /* A LINK WITH NO TOKEN IS THE OLD PATH, untouched: the GoTrue fragment
     lands here, detectSessionInUrl picks it up, and the 1.5s fallback calls
     it invalid if no session appears. The two must not interfere, and the
     way they could is the fallback firing while a token is still in flight. */
  it('leaves a link with no token to the session path it always used', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    open('/accept-invite?tab=supplier');
    await vi.advanceTimersByTimeAsync(2000);
    await waitFor(() => expect(screen.getByText(/this link is not valid/i)).toBeTruthy());
    expect(openInvitation).not.toHaveBeenCalled();
  });

  /* AND THE FALLBACK DOES NOT RACE THE REDEMPTION. A slow accept-invite call
     must not have the page declare the link invalid underneath it: the
     invitee would be told to ask for another while the one they have is
     being honoured. */
  it('does not call a token invalid while it is still being redeemed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    openInvitation.mockReturnValue(new Promise(() => {}));   // never settles
    open(`/accept-invite?token=${TOKEN}`);
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.queryByText(/this link is not valid/i)).toBeNull();
    expect(screen.getByText(/opening your invitation/i)).toBeTruthy();
  });
});
