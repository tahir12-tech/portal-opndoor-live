/* ?route=Direct IS IGNORED. THE SECOND TIME OF ASKING.
 *
 * Matt, 2026-10-01, verbatim: "Steps: signed in as Opndoor admin on dev,
 * on Home I click 'View all Direct'. It opens /applications?route=Direct,
 * but the Origin box doesn't show Direct and the list shows every
 * application, not just direct ones. Same after a hard refresh.
 * Reproduce this through the browser path, fix it, deploy to dev and
 * check there."
 *
 * =====================================================================
 * I REPORTED THIS AS NOT REPRODUCIBLE ON 30 SEPTEMBER AND I WAS WRONG
 * =====================================================================
 *
 * The sweep I built then, everyFilteredLinkArrives.render.test.tsx,
 * rendered <Applications /> at each URL and asserted the Origin box said
 * Direct. It passed, and it still passes, and it was never capable of
 * catching this: it did not wrap anything in StrictMode, and
 * src/main.tsx wraps the entire app in it.
 *
 * WHAT STRICTMODE DOES, and why a test without it proves less than it
 * looks. React 18 double-invokes every effect on mount -- run, clean up,
 * run again -- with the component instance and its REFS preserved. The
 * reset effect in Applications guarded itself with `useRef(true)` and
 * "skip the first run". The first invocation spent the guard; the second
 * ran the body and cleared origin, agency, branch and referrer. So the
 * arrival effect took 'direct' out of ?route= and the reset threw it away
 * a moment later, on every single mount.
 *
 * That is the whole bug, and it is why it happened both on the click from
 * Home and on a hard refresh: both mount the page.
 *
 * A ref that counts invocations cannot be made correct under StrictMode.
 * A guard that compares the VALUE is idempotent, which is the fix.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StrictMode } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { KEYS } from '@/data/storage';
import { SessionProvider, useSession } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { Applications } from './Applications';

beforeEach(() => { localStorage.setItem('grp_role', 'superadmin'); });
afterEach(() => {
  cleanup();
  // Shared with Reporting and League, and remembered, so it leaks between cases.
  localStorage.removeItem(KEYS.scopeSel);
  localStorage.removeItem(KEYS.scopeRecents);
});

/* READ OFF THE PILL, not an input. The control became a filter button
   that opens the search on 2026-10-01; at rest there is no text box on
   the page at all, which was the point of the change. */
const originBox = (c: HTMLElement) => {
  const t = c.querySelector('.scopepick__text')?.textContent?.trim();
  return t ? t.replace(/^Origin:\s*/, '') : '(no picker)';
};

let api: ReturnType<typeof useSession> | null = null;
function Grab() { api = useSession(); return null; }

/** Rendered the way main.tsx renders it: inside StrictMode. */
async function open(url: string) {
  const v = render(
    <StrictMode>
      <MemoryRouter initialEntries={[url]}>
        <SessionProvider><ToastProvider><PageMetaProvider>
          <Grab /><Applications />
        </PageMetaProvider></ToastProvider></SessionProvider>
      </MemoryRouter>
    </StrictMode>,
  );
  await waitFor(() => { if (!v.container.querySelector('.ftabs')) throw new Error('page did not draw'); });
  await act(async () => {});
  return v;
}

describe('a deep link survives the mount', () => {
  /* THE REPORTED CASE. Before the fix this read "Everything". */
  it('?route=Direct arrives with the Origin box showing Direct', async () => {
    const v = await open('/applications?route=Direct');
    expect(originBox(v.container)).toBe('Direct');
  });

  it('and ?origin= does too, which is the same mechanism', async () => {
    const v = await open('/applications?origin=direct');
    expect(originBox(v.container)).toBe('Direct');
  });

  /* AND THE OTHER THREE THE SAME EFFECT CLEARED. origin was the one that
     showed, because it is the only one of the four with a visible box on
     an admin's screen; agency, branch and referrer were being wiped on
     every mount too and nothing said so. */
  it('and a deep-linked branch is not thrown away either', async () => {
    const v = await open('/applications?branch=South%20Kensington');
    const chips = v.container.textContent ?? '';
    expect(chips).toContain('South Kensington');
  });
});

describe('and a role change still clears the filters, which is what the reset is for', () => {
  /* THE FIX MUST NOT TURN THE GUARD OFF. A seat that swaps role must not
     keep the last one's filters: that is partner isolation, and it is why
     the effect exists at all. The value-based guard keeps it. */
  it('switching role after arrival clears a deep-linked origin', async () => {
    const v = await open('/applications?route=Direct');
    expect(originBox(v.container)).toBe('Direct');
    await act(async () => { api!.setRole('opndoor_manager'); });
    await act(async () => {});
    expect(originBox(v.container)).toBe('Everything');
  });
});

/* =====================================================================
   AND THE GUARD ITSELF, so the pattern cannot come back.
   ===================================================================== */
describe('the reset guard', () => {
  it('compares the role rather than counting invocations', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(process.cwd(), 'src/pages/Applications/Applications.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/[^\n]*$/gm, ' ');
    /* `useRef(true)` next to a role effect is the exact shape that broke.
       Asserted on the code with comments stripped, because the comment
       above the fix necessarily describes the thing it replaced. */
    expect(src).not.toMatch(/const firstRole = useRef\(true\)/);
    expect(src).toMatch(/actedOnRole\.current === role/);
  });
});
