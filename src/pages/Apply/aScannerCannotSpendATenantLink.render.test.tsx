/* A SCANNER CANNOT SPEND A TENANT LINK EITHER.
 *
 * Matt, 2026-10-13: "fix the tenant link too: the same /auth/confirm-style
 * pattern for tenant-auth's reset (and any other tenant emailed link), token
 * in a query parameter, nothing spent on load, a button that spends it. Same
 * curl-as-scanner test, including a scanner that renders the page."
 *
 * WHY THE TENANT RAIL LOOKED SAFE FOR FOUR DAYS while the staff rail burned:
 * its token rode in the URL FRAGMENT, which is never sent in an HTTP request,
 * so a mail scanner that merely FETCHES the link cannot see it. What a
 * fragment does not survive is a scanner that RENDERS the page, because the
 * exchange sat in a mount effect and an effect runs in a headless browser
 * exactly as it does in a real one.
 *
 * MEASURED BOTH WAYS WITH REAL HEADLESS CHROME against dev, on a real
 * recovery token_hash:
 *   the OLD page, rendered -> the password form appeared and the token was
 *                             REFUSED afterwards: the render SPENT it
 *   the NEW page, rendered -> the button only, and the token still signed in
 * These assertions are the repeatable form of that.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const verifyOtp = vi.fn();
const setPassword = vi.fn();

vi.mock('@/lib/supabase', () => ({ SUPABASE_ENABLED: true, sb: () => ({}) }));
vi.mock('@/tenant/tenantApi', () => ({
  claimInvite: vi.fn(), currentDraft: vi.fn(async () => null), startApplication: vi.fn(),
}));

/* WHAT IS MOCKED, AND WHY THAT IS THE RIGHT LINE.
   The claim under test is WHEN exchangeLinkToken is called, not what it does,
   so counting calls to it is exactly the measurement -- and `exchange` below
   delegates to the REAL linkTokenInUrl, so the arguments it is called with are
   still produced by the code that reads the URL.

   Mocking `tsb` would have proved nothing: exchangeLinkToken calls tsb()
   inside its own module, so replacing the export leaves the real one in use.
   I tried that first and the test failed for that reason. The URL reading
   itself is tested as the pure function it is, at the bottom. */
vi.mock('@/tenant/tenantAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/tenant/tenantAuth')>();
  return {
    ...actual,
    exchangeLinkToken: async (where?: 'query-or-fragment' | 'fragment-only') => {
      const found = actual.linkTokenInUrl(where);
      if (!found) return null;
      const r = await verifyOtp(found);
      if (r?.error) throw new Error('That link has expired or has already been used.');
      return found.type;
    },
    setPassword: (p: string) => setPassword(p),
    currentTenant: async () => null,
  };
});

const { ResetPassword } = await import('./FrontDoor');
const { linkTokenInUrl } = await import('@/tenant/tenantAuth');

const HASH = 'pkce_tenanthashedtoken123';

function at(url: string) {
  window.history.replaceState({}, '', url);
  return render(<MemoryRouter initialEntries={[url]}><ResetPassword /></MemoryRouter>);
}
async function settle() { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
const continueButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => /continue|opening/i.test(b.textContent ?? ''));

beforeEach(() => {
  verifyOtp.mockReset(); setPassword.mockReset();
  verifyOtp.mockResolvedValue({ error: null });
  setPassword.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); window.history.replaceState({}, '', '/'); });

// ===========================================================================
// 1. A SCANNER THAT RENDERS THE PAGE. The headless-Chrome run, in miniature.
// ===========================================================================
describe('rendering the page spends nothing', () => {
  it('does not verify a token in the query string on mount', async () => {
    at(`/apply/reset?token_hash=${HASH}&type=recovery`);
    await settle();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  /* AND NOT A FRAGMENT EITHER, because links already in inboxes carry one and
     a scanner that renders can read a fragment perfectly well. */
  it('and does not verify one in the fragment either', async () => {
    at(`/apply/reset#token_hash=${HASH}&type=recovery`);
    await settle();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  /* THE SHAPE OF THE PROOF. A rendered page that shows the password field has
     exchanged the token; one that shows the button has not. This is exactly
     what the Chrome run looked for in the DOM. */
  it('shows a button and no password field', async () => {
    at(`/apply/reset?token_hash=${HASH}&type=recovery`);
    await settle();
    expect(continueButton()).toBeTruthy();
    expect(document.querySelector('#ap-new-password')).toBeNull();
  });
});

// ===========================================================================
// 2. A PERSON, WHO PRESSES THE BUTTON.
// ===========================================================================
describe('the button spends it', () => {
  it('verifies the query-string token and then offers the password field', async () => {
    at(`/apply/reset?token_hash=${HASH}&type=recovery`);
    await settle();
    fireEvent.click(continueButton()!);
    await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith({ token_hash: HASH, type: 'recovery' }));
    await waitFor(() => expect(document.querySelector('#ap-new-password')).toBeTruthy());
  });

  /* A LINK ALREADY IN AN INBOX STILL WORKS. The week this was written is the
     week fourteen people lost their links; breaking the ones that still work
     to tidy a parameter would be its own small disaster. */
  it('and a fragment link from before the change works the same way', async () => {
    at(`/apply/reset#token_hash=${HASH}&type=recovery`);
    await settle();
    fireEvent.click(continueButton()!);
    await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith({ token_hash: HASH, type: 'recovery' }));
  });

  it('spends it once however many times the button is pressed', async () => {
    at(`/apply/reset?token_hash=${HASH}&type=recovery`);
    await settle();
    const b = continueButton()!;
    fireEvent.click(b); fireEvent.click(b); fireEvent.click(b);
    await waitFor(() => expect(verifyOtp).toHaveBeenCalled());
    expect(verifyOtp).toHaveBeenCalledTimes(1);
  });

  it('and a spent link says so, with a way to ask for another', async () => {
    verifyOtp.mockResolvedValue({ error: { message: 'Email link is invalid or has expired' } });
    at(`/apply/reset?token_hash=${HASH}&type=recovery`);
    await settle();
    fireEvent.click(continueButton()!);
    await waitFor(() => expect(screen.getByText(/expired or has already been used/i)).toBeTruthy());
    expect(document.querySelector('a[href="/forgot-password?tab=tenant"]')).toBeTruthy();
  });

  /* A LINK WITH NO TOKEN AT ALL offers no button, because there is nothing to
     open and a button that cannot work is worse than a sentence. */
  it('and a link with no token offers no button', async () => {
    at('/apply/reset');
    await settle();
    expect(continueButton()).toBeUndefined();
    expect(screen.getByText(/missing its code/i)).toBeTruthy();
  });
});

// ===========================================================================
// 3. THE SENDERS, AND THE ONE ROUTE THAT STILL SPENDS ON MOUNT.
// ===========================================================================
describe('what the tenant senders put in an email', () => {
  const src = readFileSync('supabase/functions/tenant-auth/index.ts', 'utf8');

  it('both tenant reset links carry the token in a query parameter', () => {
    const built = [...src.matchAll(/\/apply\/reset\?token_hash=/g)];
    expect(built.length).toBe(2);
  });

  it('and neither carries it in a fragment any more', () => {
    expect(src).not.toContain('/apply/reset#');
  });

  /* /apply/verify STILL SPENDS ON MOUNT, and nothing emails or navigates to
     it. Caught by an adversarial review of this very change, which also
     caught that reading the query string there would have widened a
     mount-effect consumer to accept the exact shape the new emails carry.
     It is narrowed to fragment-only, and this is the guard that stops a
     future sender making it reachable without gating it first. */
  it('and nothing builds a link to /apply/verify, which still spends on mount', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name);
        if (e.isDirectory()) return walk(p);
        return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
      });
    /* COMMENTS STRIPPED FIRST. The point is a sender that BUILDS the URL, and
       the narrowing note in tenantAuth.ts explains the route by name -- prose
       about a risk must not read as the risk. */
    const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const senders = [...walk('supabase/functions'), ...walk('src')].filter((f) => {
      if (f.endsWith('src/App.tsx')) return false;       // the route map itself
      if (f.endsWith('src/pages/Apply/FrontDoor.tsx')) return false;  // the component
      return /apply\/verify/.test(code(readFileSync(f, 'utf8')));
    });
    expect(senders).toEqual([]);
  });

  it('and that route reads the fragment only, so the new shape cannot reach it', () => {
    expect(readFileSync('src/pages/Apply/FrontDoor.tsx', 'utf8'))
      .toContain("auth.exchangeLinkToken('fragment-only')");
  });
});

// ===========================================================================
// 4. THE URL READER, as the pure function it is.
// ===========================================================================
describe('where the token is read from', () => {
  const at = (url: string) => { window.history.replaceState({}, '', url); };

  it('reads a query parameter, which is what the new emails carry', () => {
    at('/apply/reset?token_hash=abc&type=recovery');
    expect(linkTokenInUrl()).toEqual({ token_hash: 'abc', type: 'recovery' });
  });

  it('and a fragment, which is what the ones already sent carry', () => {
    at('/apply/reset#token_hash=def&type=recovery');
    expect(linkTokenInUrl()).toEqual({ token_hash: 'def', type: 'recovery' });
  });

  it('preferring the query where somehow both are present', () => {
    at('/apply/reset?token_hash=query&type=recovery#token_hash=frag&type=recovery');
    expect(linkTokenInUrl()!.token_hash).toBe('query');
  });

  /* THE NARROWING THE REVIEW ASKED FOR. /apply/verify spends on mount, so it
     must not see the shape the new emails carry. */
  it('and ignores the query entirely when the caller asks for fragment-only', () => {
    at('/apply/reset?token_hash=query&type=recovery');
    expect(linkTokenInUrl('fragment-only')).toBeNull();
    at('/apply/reset#token_hash=frag&type=recovery');
    expect(linkTokenInUrl('fragment-only')).toEqual({ token_hash: 'frag', type: 'recovery' });
  });

  it.each(['/apply/reset', '/apply/reset?type=recovery', '/apply/reset?token_hash=abc'])(
    'and answers nothing for %s', (url) => {
      at(url);
      expect(linkTokenInUrl()).toBeNull();
    });
});
