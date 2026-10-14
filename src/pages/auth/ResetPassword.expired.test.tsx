/* Where an EXPIRED staff reset link sends you.

   The CTA used to point at a bare /forgot-password, whose default tab is
   Tenant, so an agent was asked to reselect who they were. Hardcoding tab=agent
   fixed the agents and left the suppliers wrong. The audience now travels in
   the recovery link itself, so the page can read it back and land somebody
   where they started.

   Reaching this screen means driving the real component into its invalid phase:
   Supabase enabled, no session, and the 1.5s fallback timer fired. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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

const { ResetPassword } = await import('./ResetPassword');

afterEach(() => { cleanup(); vi.useRealTimers(); });

async function expired(url: string) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  render(<MemoryRouter initialEntries={[url]}><ResetPassword /></MemoryRouter>);
  await vi.advanceTimersByTimeAsync(2000);
  await waitFor(() => expect(screen.getByText(/this link is not valid/i)).toBeTruthy());
  return screen.getByRole('link', { name: /request a new link/i }).getAttribute('href');
}

describe('an expired staff reset link', () => {
  it('returns a supplier to the Supplier tab', async () => {
    expect(await expired('/reset-password?tab=supplier')).toBe('/forgot-password?tab=supplier');
  });

  it('returns an agent to the Agent tab', async () => {
    expect(await expired('/reset-password?tab=agent')).toBe('/forgot-password?tab=agent');
  });

  it('falls back to Agent for a link sent before the tab was carried', async () => {
    // Links already in inboxes have no tab, and must not land on Tenant.
    expect(await expired('/reset-password')).toBe('/forgot-password?tab=agent');
  });

  it('will not send a member of staff to the Tenant tab, however the URL is edited', async () => {
    // This page only ever serves staff; a tenant reset lands on /apply/reset.
    expect(await expired('/reset-password?tab=tenant')).toBe('/forgot-password?tab=agent');
  });
});

/* AND ONE WAY BACK, NOT THE SAME WAY TWICE (Matt, 2026-10-09, on live).

   The invite arm's primary button is itself "Back to sign in", so the footer
   link underneath it was the same words pointing at the same place. The reset
   arm offers two different things and must keep both, which is why these two
   assertions are a pair: deleting the footer outright passes the first and
   fails the second. */
describe('the invalid-link screen offers each way back once', () => {
  async function invalid(url: string, mode: 'reset' | 'invite') {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<MemoryRouter initialEntries={[url]}><ResetPassword mode={mode} /></MemoryRouter>);
    await vi.advanceTimersByTimeAsync(2000);
    await waitFor(() => expect(screen.getByText(/this link is not valid/i)).toBeTruthy());
    return screen.getAllByRole('link', { name: /back to sign in/i });
  }

  it('shows "Back to sign in" once on an expired invitation', async () => {
    const links = await invalid('/accept-invite?tab=supplier', 'invite');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/login?tab=supplier');
  });

  it('still shows it on an expired reset, where the button says something else', async () => {
    const links = await invalid('/reset-password?tab=supplier', 'reset');
    expect(links).toHaveLength(1);
    expect(screen.getByRole('link', { name: /request a new link/i })).toBeTruthy();
  });
});
