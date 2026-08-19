/* The three audience tabs on /login.

   WHY THIS EXISTS. Discovery found the tab strip had no test of any kind: not
   the tabs, not the ?tab= seeding, not either panel. smoke.test.tsx renders
   /login with no query string, so `audience` defaults to 'agent' and the other
   two panels were never mounted by anything.

   That is the same shape of gap as the Dev Centre vanishing from the nav: the
   boundary was covered and the thing the screen exists for was not. So these
   assert what each audience GETS, not only what it is denied.

   Deliberately shallow. The point is that each tab mounts and offers a way in. */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { Login } from './Login';

afterEach(() => cleanup());

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider><Login /></SessionProvider>
    </MemoryRouter>,
  );
}

describe('the three audiences', () => {
  it('offers all three tabs', () => {
    at('/login');
    for (const label of ['Tenant', 'Agent', 'Supplier']) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy();
    }
  });

  it('defaults to agent, because that is who has been signing in here for a year', () => {
    at('/login');
    expect(screen.getByRole('tab', { name: 'Agent' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByLabelText('Work email')).toBeTruthy();
  });

  it('seeds the tab from the URL, so ?tab= is a link somebody can be sent', () => {
    at('/login?tab=tenant');
    expect(screen.getByRole('tab', { name: 'Tenant' }).getAttribute('aria-selected')).toBe('true');
  });

  /* The defect this file was written for. */
  it('gives a tenant the form itself, not a button to another page', () => {
    at('/login?tab=tenant');
    expect(screen.getByLabelText('Email address')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
  });

  it('never shows a tenant an authenticator step', () => {
    at('/login?tab=tenant');
    expect(screen.queryByText('Credentials')).toBeNull();
    expect(screen.queryByText('Verify')).toBeNull();
  });

  /* A supplier is a partner who sends us referrals: staff, same credentials,
     same portal. The tab used to be a dead end saying sign-in was not open. */
  it('lets a supplier actually sign in', () => {
    at('/login?tab=supplier');
    expect(screen.getByLabelText('Work email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.queryByText(/not open yet/i)).toBeNull();
  });

  it('keeps two-factor on the supplier path, because a supplier is staff', () => {
    at('/login?tab=supplier');
    expect(screen.getByText('Credentials')).toBeTruthy();
    expect(screen.getByText('Verify')).toBeTruthy();
  });

  it('tells a supplier and an agent apart in the copy, not in the form', () => {
    at('/login?tab=supplier');
    const supplierSub = screen.getByText(/partners who send us referrals/i);
    expect(supplierSub).toBeTruthy();
    cleanup();
    at('/login?tab=agent');
    expect(screen.queryByText(/partners who send us referrals/i)).toBeNull();
    expect(screen.getByText(/your administrator registered/i)).toBeTruthy();
  });
});
