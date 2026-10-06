/* A FILTER BELONGS TO THE VISIT, AND A LINK DECIDES IT.
 *
 * Matt, 2026-10-02, twice in one afternoon and about two different
 * pages:
 *
 *   "Home's 'View all applications' link opens /applications still
 *    filtered to Origin: Direct, remembered from the previous visit. Any
 *    link that opens Applications sets exactly the filters it names and
 *    clears the rest; 'View all applications' clears them all. Filters
 *    chosen on the page itself can still be remembered while you stay on
 *    it."
 *
 *   "League has also picked up Origin: Direct from Applications, so the
 *    Agencies table shows 'No matches'. Filters must not carry between
 *    pages: League, Applications and Reporting each open with their own
 *    defaults (Origin: Everything) unless a link sets a filter."
 *
 * THIS REVERSES A RULING OF 2026-09-29 -- "Reporting and Applications
 * share one remembered scope choice" -- which is why the selection was
 * on the session and in localStorage in the first place. It still is:
 * `setScopeSel` also moves `partnerScope`, which mirrors the server's
 * isolation rule, and `viewingAs`, which the Reporting banner reads.
 * What changed is that each page now DECIDES the value on arrival
 * instead of inheriting whatever was left there, so the plumbing stays
 * and the leak closes.
 *
 * AND VIEW AS IS A LINK. It used to set the session value and navigate
 * bare, which arriving now clears, so it carries the selection in the
 * URL. That also makes the view shareable and survive a reload, which
 * the session value never did honestly.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { hydrateApplications } from '@/data';
import { KEYS } from '@/data/storage';
import type { ApplicationSummary } from '@/data';
import { Applications } from './Applications';
import { readFileSync } from 'node:fs';

const row = (ref: string, partner: string, status: ApplicationSummary['status']): ApplicationSummary => ({
  ref, tenant: `Tenant ${ref}`, prop: '1 Example Road, N1 1AA', branch: 'Main', agency: 'ZZZ Agency',
  ben: '', rent: 1500, status, date: '2026-05-10', owner: 0, partner, referrer: null,
} as unknown as ApplicationSummary);

const BOOK = [
  row('GR-DIRECT', 'opndoor-direct', 'deed'),
  row('GR-AGENCY1', 'opndoor-agents', 'paid'),
  // A second branch, so a branch filter has something to narrow TO and
  // its clearing has something to widen back to.
  { ...row('GR-AGENCY2', 'opndoor-agents', 'sent'), branch: 'Other' } as ApplicationSummary,
];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('grp_role', 'superadmin');
  hydrateApplications(BOOK, []);
});
afterEach(() => { cleanup(); hydrateApplications([], []); });

async function openApplications(path: string) {
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider><SessionProvider><PageMetaProvider><Applications /></PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.dt, .empty')) throw new Error('not ready'); });
  await act(async () => {});
  return view;
}

/** What the Origin chip says it is filtering by. */
const originChip = (c: HTMLElement) =>
  [...c.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim())
    .find((t) => t.startsWith('Origin:')) ?? '';

describe('a link that names an origin', () => {
  it('sets it, which is Home’s "View all Direct"', async () => {
    const { container } = await openApplications('/applications?route=Direct');
    expect(originChip(container)).toContain('Direct');
    expect(container.textContent).toContain('GR-DIRECT');
    expect(container.textContent).not.toContain('GR-AGENCY1');
  });
});

describe('a link that names none', () => {
  /* THE REPORTED BUG. The previous visit's selection is in localStorage,
     exactly as it would be after following "View all Direct", and the
     bare link must not inherit it. */
  it('clears it, which is Home’s "View all applications"', async () => {
    localStorage.setItem(KEYS.scopeSel, 'direct');
    const { container } = await openApplications('/applications');
    expect(originChip(container)).toContain('Everything');
    expect(container.textContent).toContain('GR-AGENCY1');
  });

  /* AND THE OTHER THREE FILTERS WITH IT. Arriving at the same route from
     a link that names a branch and then one that does not -- an agency
     chip, then "View all applications" -- does not REMOUNT this page, so
     a `useState` initialiser reading the URL runs only the first time
     and the branch stayed in the box. */
  /* FOLLOWED AS A LINK, not re-rendered. `MemoryRouter`'s initialEntries
     only apply on mount, so swapping that prop changes nothing the page
     can see; a real navigation is the only way to exercise the case
     Matt hit, which is one address on this route replacing another
     WITHOUT a remount. */
  it('and clears the branch a previous link set, without a remount', async () => {
    const view = render(
      <MemoryRouter initialEntries={['/applications?branch=Other']}>
        <ToastProvider><SessionProvider><PageMetaProvider>
          <Link to="/applications">View all applications</Link>
          <Routes><Route path="/applications" element={<Applications />} /></Routes>
        </PageMetaProvider></SessionProvider></ToastProvider>
      </MemoryRouter>,
    );
    await waitFor(() => { if (!view.container.querySelector('.dt, .empty')) throw new Error('not ready'); });
    await act(async () => {});
    expect(view.container.textContent).toContain('GR-AGENCY2');
    expect(view.container.textContent).not.toContain('GR-AGENCY1');

    const link = [...view.container.querySelectorAll('a')]
      .find((a) => a.textContent === 'View all applications')!;
    await act(async () => { fireEvent.click(link); });
    await waitFor(() => {
      if (!(view.container.textContent ?? '').includes('GR-AGENCY1')) throw new Error('branch not cleared');
    });
  });
});

/* AND THE TWO OTHER PAGES RUN THE SAME EFFECT. Rendering League and
   Reporting here would pull two more page trees into this file for one
   assertion each; what matters is that the rule is present and keyed the
   same way, and each page's own tests cover what it draws. */
describe('the same rule on the other two pages', () => {
  const src = (p: string) => readFileSync(p, 'utf8');

  it('League decides its origin on arrival', () => {
    const s = src('src/pages/League/League.tsx');
    expect(s).toContain('originFromParams({');
    expect(s).toContain('if (fromLink !== scopeSel) setScopeSel(fromLink);');
  });

  it('and so does Reporting', () => {
    const s = src('src/pages/Dashboard/Dashboard.tsx');
    expect(s).toContain('originFromParams({');
    expect(s).toContain('if (fromLink !== scopeSel) setScopeSel(fromLink);');
  });

  /* THE CLEARING IS `!==`, NOT TRUTHINESS, and that is the whole fix:
     `originFromParams` answers '' for a link that names nothing, so
     `if (fromLink)` -- which is what Applications had -- set the
     selection from a link and never unset it. */
  it('and none of the three guards on truthiness, which is what let it leak', () => {
    for (const p of ['src/pages/Applications/Applications.tsx', 'src/pages/League/League.tsx', 'src/pages/Dashboard/Dashboard.tsx']) {
      expect(src(p), p).not.toContain('if (fromLink && fromLink !== scopeSel)');
    }
  });

  /* VIEW AS HAD TO BECOME A LINK, or arriving would clear what it set. */
  it('and View as carries its selection in the URL', () => {
    expect(src('src/components/ViewAsButton.tsx'))
      .toContain('navigate(`/dashboard?origin=${encodeURIComponent(scope)}`)');
  });
});
