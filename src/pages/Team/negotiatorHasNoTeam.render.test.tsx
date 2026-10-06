/* A NEGOTIATOR HAS NO TEAM, AND EVERYBODY IS CALLED BY THEIR LEVEL.

   Two rulings, one file, because both are about what the shell says about the
   person signed into it.

   TEAM. A Negotiator's level is their own referrals only, so the team is somebody
   else's list of people: the manager who invited them and colleagues they do not
   manage. It came off the nav item and off the /team route in the same change,
   because an item hidden by a role whose route still renders is not a hidden
   screen, it is an unlisted one, and this repo's own nav comments are a record of
   that distinction being got wrong before.

   THE LABEL. The sidebar footer read ROLES[role].label, which is OUR vocabulary:
   "Management" and "Referrer". Nobody at an agency holds either. They hold one of
   three levels, Director, Manager or Negotiator, which is what the invite dialog
   offers and what Team prints beside each person, so the sidebar was the last
   surface naming them by the role underneath.

   A note on staging: maySeeCommission defaults TRUE (see src/data/types.ts), so a
   management user with no hydration is a DIRECTOR. The Manager case calls
   hydrateCommissionVisibility(false) and resets after, or it would leak into the
   next file to run in this worker. */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { hydrateCommissionVisibility } from '@/data';
import { App } from '@/App';

afterEach(() => { cleanup(); hydrateCommissionVisibility(true); });

async function open(role: 'management' | 'referrer', path = '/dashboard') {
  localStorage.setItem('grp_role', role);
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider><SessionProvider><App /></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.sb__user-role')) throw new Error('shell not ready'); });
  return view;
}

const navLabels = (v: { container: HTMLElement }) =>
  [...v.container.querySelectorAll('.sb__nav a, nav a')].map((a) => (a.textContent ?? '').trim());
const levelLabel = (v: { container: HTMLElement }) =>
  v.container.querySelector('.sb__user-role')?.textContent?.trim() ?? '';

describe('Team, for a Negotiator', () => {
  it('is not in the navigation', async () => {
    const v = await open('referrer');
    expect(navLabels(v)).not.toContain('Team');
  });

  it('is not reachable by typing the URL either', async () => {
    // The half that matters. A hidden nav item over a live route is an unlisted
    // screen, not a closed one.
    const v = await open('referrer', '/team');
    // Team's heading is the org name it is showing; the page also sets a crumb.
    expect(v.container.textContent ?? '').not.toMatch(/Invite|positions|Your people/i);
    // Redirected to the dashboard rather than looping: /agencies would have sent
    // an agency user back to /team for ever.
    await waitFor(() => expect(v.container.querySelector('.herorow')).toBeTruthy());
  });

  it('but a Manager still has it', async () => {
    // Without this the test above passes against a Team page that is broken for
    // everybody.
    const v = await open('management');
    expect(navLabels(v)).toContain('Team');
  });
});

describe('the name in the sidebar footer', () => {
  it('calls a Director a Director, not Management', async () => {
    hydrateCommissionVisibility(true);
    const v = await open('management');
    expect(levelLabel(v)).toBe('Director');
  });

  it('calls a Manager a Manager', async () => {
    hydrateCommissionVisibility(false);
    const v = await open('management');
    expect(levelLabel(v)).toBe('Manager');
  });

  it('calls a Negotiator a Negotiator, not Referrer', async () => {
    const v = await open('referrer');
    expect(levelLabel(v)).toBe('Negotiator');
  });

  it('never shows our own words for an agency person', async () => {
    for (const role of ['management', 'referrer'] as const) {
      const v = await open(role);
      expect(levelLabel(v)).not.toMatch(/Management|Referrer/);
      cleanup();
    }
  });
});
