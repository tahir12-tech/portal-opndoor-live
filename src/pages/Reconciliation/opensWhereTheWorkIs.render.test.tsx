/* RECONCILIATION OPENS WHERE THE WORK IS.

   Two faults, one symptom: a count you click takes you to a list that does not
   contain it.

   Home's "Agency matches" card counts the Direct matches tab and linked at the
   page, which opens on All. All counts the review queue, not the match queue,
   so a reader who clicked "3" landed on "Nothing awaiting review".

   And the page itself opened on All whatever it held, so an admin whose only
   outstanding work was a direct match saw an empty page with the number one
   tab away.

   The landing is decided ONCE, on the first load that has counts. Re-deciding
   on every render would drag the reader off a tab the moment they cleared its
   last row. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { Reconciliation } from './Reconciliation';

/** What the two queues hold for a given test. */
let reviewQueue: unknown[] = [];
let matchQueue: unknown[] = [];

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return {
    ...actual,
    loadReconciliationQueue: async () => reviewQueue,
    loadAgencyMatchQueue: async () => matchQueue,
    triggerCrmSync: async () => {},
  };
});

/** The match tab's own body is a separate component with its own loading; this
    test is about which TAB the page lands on, not what that tab renders. */
vi.mock('./AgencyMatchQueue', () => ({ AgencyMatchQueue: () => <div data-testid="matches-body" /> }));

function row(name: string, type: 'agency' | 'branch') {
  return { id: `r-${name}`, entityId: `e-${name}`, type, name, parent: null, createdBy: 'Rosa', createdAt: '2026-09-01', referrals: 0, match: null };
}

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function renderAt(path: string) {
  localStorage.setItem('grp_role', 'superadmin');
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider><ToastProvider><PageMetaProvider><Reconciliation /></PageMetaProvider></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
}

type View = ReturnType<typeof renderAt>;
/** The tab currently selected, by the class the strip marks it with. */
const currentTab = (v: View) =>
  (v.container.querySelector('.rtab.is-active')?.textContent ?? '').trim();

beforeEach(() => { reviewQueue = []; matchQueue = []; sessionStorage.clear(); });
afterEach(cleanup);

describe('which tab the page lands on', () => {
  it('opens on the matches tab when that is where the only work is', async () => {
    matchQueue = [{ id: 'm1' }, { id: 'm2' }];
    const view = renderAt('/reconciliation');
    await waitFor(() => { if (!view.container.querySelector('.qstat')) throw new Error('not ready'); });
    await settle();
    expect(currentTab(view)).toContain('Direct matches');
  });

  it('stays on All when All has work', async () => {
    reviewQueue = [row('Kestrel Lettings', 'agency')];
    matchQueue = [{ id: 'm1' }];
    const view = renderAt('/reconciliation');
    await waitFor(() => { if (!view.container.querySelector('.qstat')) throw new Error('not ready'); });
    await settle();
    expect(currentTab(view)).toContain('All');
  });

  it('stays on All when there is nothing anywhere, rather than inventing a tab', async () => {
    const view = renderAt('/reconciliation');
    await waitFor(() => { if (!view.container.querySelector('.qstat')) throw new Error('not ready'); });
    await settle();
    expect(currentTab(view)).toContain('All');
  });

  /* HOME'S CARD LANDS ON ITS OWN QUEUE. The link carries ?tab=matches, and an
     explicit ask always wins over the empty-default rule. */
  it('honours ?tab= from the card that linked here', async () => {
    reviewQueue = [row('Kestrel Lettings', 'agency')];
    matchQueue = [{ id: 'm1' }];
    const view = renderAt('/reconciliation?tab=matches');
    await waitFor(() => { if (!view.container.querySelector('.qstat')) throw new Error('not ready'); });
    await settle();
    expect(currentTab(view)).toContain('Direct matches');
  });

  it('ignores a ?tab= that is not a tab', async () => {
    reviewQueue = [row('Kestrel Lettings', 'agency')];
    const view = renderAt('/reconciliation?tab=nonsense');
    await waitFor(() => { if (!view.container.querySelector('.qstat')) throw new Error('not ready'); });
    await settle();
    expect(currentTab(view)).toContain('All');
  });
});

describe('who the page says it is for', () => {
  /* "Partner super-admins" is the schema's word for a role, not a party the
     reader recognises. The product names them suppliers and agencies. */
  it('names suppliers and agencies, not a role from the schema', async () => {
    const view = renderAt('/reconciliation');
    await waitFor(() => { if (!view.container.querySelector('.opbar')) throw new Error('not ready'); });
    const note = view.container.querySelector('.opbar')!.textContent ?? '';
    expect(note).toContain('Supplier and agency users');
    expect(note).not.toContain('Partner super-admins');
  });
});
