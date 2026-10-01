/* EVERY EMAIL LINK LANDS ON THE TAB THAT PERSON SIGNS IN ON.
 *
 * Matt, 2026-10-01, verbatim: "Password reset and invite links send each
 * person to the sign-in tab for their own type: supplier users to the
 * Supplier tab, agency users to the Agent tab, tenants to the Tenant tab.
 * Check every email link that lands on the sign-in page."
 *
 * WHERE EACH HALF LIVES. The reset already carried the tab, because the
 * person picked one on /forgot-password and send-password-reset puts it
 * in the link. The invite had none to read, so invite-user now decides it
 * from the rail it is inviting on to; that half is asserted by reading
 * the function, since it is Deno and cannot be imported here.
 *
 * This file is the landing page, which is where three of the four ways
 * back to sign in were a bare /login -- the Agent tab for everybody,
 * including the supplier who had just set their password on it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { ResetPassword } from './ResetPassword';
import { carriedStaffTab, signInHref } from './carry';

afterEach(cleanup);

/** The page in its "this link is not valid" state, which is the one that
    draws every way back without needing a live token. */
function landing(search: string, mode: 'reset' | 'invite') {
  return render(
    <MemoryRouter initialEntries={[`/accept-invite${search}`]}>
      <ToastProvider><SessionProvider>
        <Routes><Route path="/accept-invite" element={<ResetPassword mode={mode} />} /></Routes>
      </SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
}

const links = (v: { container: HTMLElement }) =>
  [...v.container.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? '');

describe('the page the links land on', () => {
  it('sends a supplier back to the Supplier tab', async () => {
    const v = landing('?tab=supplier', 'invite');
    const back = links(v).filter((h) => h.includes('/login'));
    expect(back.length, 'no way back to sign in').toBeGreaterThan(0);
    for (const h of back) expect(h).toContain('tab=supplier');
  });

  it('and an agency user back to the Agent tab', async () => {
    const v = landing('?tab=agent', 'invite');
    for (const h of links(v).filter((x) => x.includes('/login'))) expect(h).toContain('tab=agent');
  });

  /* A LINK FROM BEFORE THIS, or one whose tab the redirect allowlist made
     the sender drop, still has to work. Agent is the staff default and is
     what the page has always guessed. */
  it('and guesses Agent when the link carries no tab at all', async () => {
    const v = landing('', 'invite');
    for (const h of links(v).filter((x) => x.includes('/login'))) expect(h).toContain('tab=agent');
  });

  /* A TENANT NEVER REACHES THIS PAGE: their reset goes through tenant-auth
     and lands on /apply/reset. carriedStaffTab says so by refusing to
     return 'tenant' at all, and this is that rule rather than a hope. */
  it('and never sends anybody to the Tenant tab from the staff page', () => {
    expect(carriedStaffTab(new URLSearchParams('tab=tenant'))).toBe('agent');
    expect(signInHref('agent', '')).toBe('/login?tab=agent');
  });
});

describe('the senders put the tab in the link', () => {
  const fn = (name: string) =>
    readFileSync(`supabase/functions/${name}/index.ts`, 'utf8');

  it('send-password-reset carries the audience the person chose', () => {
    const src = fn('send-password-reset');
    expect(src).toContain('/reset-password?tab=${audience}');
  });

  /* THE INVITE DECIDES IT RATHER THAN READING IT, because nobody picked a
     tab: the server knows which rail it is inviting on to. */
  it('and invite-user decides it from the rail it is inviting on to', () => {
    const src = fn('invite-user');
    expect(src).toContain('inviteeOnOurEstate || !inviteePartnerId ? "agent" : "supplier"');
    expect(src).toContain('/accept-invite?tab=${tab}');
  });

  /* AND BOTH DEGRADE TO THE PLAIN LINK. GoTrue matches redirectTo against
     the project's Redirect URLs, and an entry without a wildcard stops
     matching once a query string is on the end: a cosmetic tab must not
     become no invite emails. */
  it('and both fall back to the plain link if the redirect is refused', () => {
    expect(fn('send-password-reset')).toContain('`${base}/reset-password`');
    expect(fn('invite-user')).toContain('`${base}/accept-invite`');
  });

  /* THE TENANT'S OWN DOOR, which was already right and must stay. */
  it('and the tenant link goes to the Tenant tab', () => {
    expect(fn('tenant-auth')).toContain('/login?tab=tenant');
  });
});
