/* Who gets the New application button on the Applications header.

   It admitted superadmin and referrer while the sidebar admitted management
   too, so a partner manager — the role Regent's staff hold — saw the page they
   refer from with no way to start one, and had to know to use the sidebar.

   opndoor_manager is the one that must stay out, and not for tidiness:
   create_referral refuses it in SQL, so a button would be a promise the
   database breaks. */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { App } from '@/App';

afterEach(cleanup);

async function headerButtonFor(role: string) {
  localStorage.setItem('grp_role', role);
  const view = render(
    <MemoryRouter initialEntries={['/applications']}>
      <SessionProvider><ToastProvider><App /></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!document.querySelector('.page-head')) throw new Error('page not ready'); });
  const head = view.container.querySelector('.page-head')!;
  return [...head.querySelectorAll('a,button')]
    .some((el) => /new application/i.test(el.textContent ?? ''));
}

describe('the New application button', () => {
  it('is there for a partner manager, who is allowed to create referrals', async () => {
    expect(await headerButtonFor('management')).toBe(true);
  });

  it('is there for a referrer and for an opndoor admin, as before', async () => {
    expect(await headerButtonFor('referrer')).toBe(true);
    cleanup();
    expect(await headerButtonFor('superadmin')).toBe(true);
  });
});
