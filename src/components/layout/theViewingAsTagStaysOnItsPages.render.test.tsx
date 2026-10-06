/* THE "VIEWING AS" TAG STAYS ON THE PAGES THAT ARE THAT PARTY'S VIEW.
 *
 * Matt, 2026-10-01, verbatim: "the 'Viewing as' tag must not show on any
 * page that isn't showing that party's view; it's appearing on admin pages
 * after View as was used."
 *
 * TWO FAULTS. The Topbar derived its own answer -- `role === 'superadmin'
 * && selectedPartner !== ALL_PARTNERS` -- which is a third derivation of a
 * question SessionContext already answers, and answers more narrowly
 * (`figuresFollow`). And the Topbar is on every page, while
 * `selectedPartner` persists, so once View as had been used the pill sat on
 * Suppliers, Agencies, Health and the Dev Centre: pages that are Opndoor's
 * own view of the estate, claiming to be somebody else's.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider, usePageMeta } from './pageMeta';
import { Topbar } from './Topbar';
import { KEYS } from '@/data/storage';

/** A stand-in for whichever page is open, declaring only its identity. */
function Page({ active }: { active: string }) {
  usePageMeta(active, 'A page', ['Home']);
  return null;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(KEYS.role, 'superadmin');
});
afterEach(() => { cleanup(); localStorage.clear(); });

async function topbar(active: string, opts: { viewingAs?: string } = {}) {
  if (opts.viewingAs) {
    // The state View as leaves behind, and which outlives the page.
    localStorage.setItem(KEYS.partner, opts.viewingAs);
    localStorage.setItem(KEYS.scopeSel, `partner:${opts.viewingAs}`);
  }
  const v = render(
    <MemoryRouter>
      <ToastProvider><SessionProvider><PageMetaProvider>
        <Page active={active} />
        <Topbar onMenu={() => {}} />
      </PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!v.container.querySelector('.topbar__actions')) throw new Error('nr'); });
  await act(async () => {});
  return v;
}
type View = Awaited<ReturnType<typeof topbar>>;
const pill = (v: View) => v.container.querySelector('.viewas-pill');

describe('on a page that IS that party’s view', () => {
  it('Reporting shows the tag', async () => {
    expect(pill(await topbar('dashboard', { viewingAs: 'harbourside' }))).toBeTruthy();
  });
  it('and Applications, which shares the same remembered scope', async () => {
    expect(pill(await topbar('applications', { viewingAs: 'harbourside' }))).toBeTruthy();
  });
  it('and it names the party', async () => {
    expect(pill(await topbar('dashboard', { viewingAs: 'harbourside' }))?.textContent)
      .toMatch(/Viewing as/);
  });
});

describe('on a page that is Opndoor’s own', () => {
  /* THE BUG, on four of the pages it appeared on. Each is an admin screen
     about the estate: a tag claiming one party is simply false there. */
  for (const [active, what] of [
    ['partners', 'the Suppliers list'],
    ['partner-home', 'a supplier’s own admin page'],
    ['agencies', 'the Agencies list'],
    ['health', 'Health'],
    ['devcentre', 'the Dev Centre'],
    ['users', 'User management'],
  ] as [string, string][]) {
    it(`no tag on ${what}`, async () => {
      expect(pill(await topbar(active, { viewingAs: 'harbourside' }))).toBeNull();
    });
  }
});

describe('with nobody being viewed as', () => {
  it('there is no tag anywhere', async () => {
    expect(pill(await topbar('dashboard'))).toBeNull();
    cleanup();
    expect(pill(await topbar('partners'))).toBeNull();
  });
});

describe('stopping', () => {
  /* IT CLEARS THE SELECTION View as IS SET BY, not just the partner
     scope. Clearing `selectedPartner` alone left `scopeSel` behind, so
     the page's own banner stayed up after the pill said it had stopped
     -- two controls disagreeing about whether you were still viewing as
     anybody. */
  it('clears the shared scope selection, not just the partner', async () => {
    const v = await topbar('dashboard', { viewingAs: 'harbourside' });
    await act(async () => { fireEvent.click(pill(v)!); });
    expect(pill(v)).toBeNull();
    expect(localStorage.getItem(KEYS.scopeSel)).not.toMatch(/harbourside/);
  });
});
