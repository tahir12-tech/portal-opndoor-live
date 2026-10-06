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

/** What the queues hold for a given test.
 *
 * ALL FIVE ARE MOCKED SINCE 2026-10-02, not two. The landing rule is now
 * "whichever tab has items, or All", so a test claiming "the only work is
 * matches" has to make that true -- and with three of the five falling
 * through to the mock book, it was not: the page had four items across
 * three tabs and correctly landed on All. */
let reviewQueue: unknown[] = [];
let matchQueue: unknown[] = [];
let refundQueue: unknown[] = [];
let noEmailQueue: unknown[] = [];
let notInNetworkQueue: unknown[] = [];

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return {
    ...actual,
    loadReconciliationQueue: async () => reviewQueue,
    loadAgencyMatchQueue: async () => matchQueue,
    loadRefundQuestions: async () => refundQueue,
    loadSupplierAgenciesWithoutAnEmail: async () => noEmailQueue,
    loadNotInNetworkAgencies: async () => notInNetworkQueue,
    triggerCrmSync: async () => {},
  };
});

/** Each tab's body is a separate component with its own loading, and since
    2026-10-02 the All tab renders every one of them that has items. This
    test is about which TAB the page lands on, not what those sections
    render, so all four are stubbed -- the real ones fetch their own data
    and this file's stub rows are not their shape. */
vi.mock('./AgencyMatchQueue', () => ({ AgencyMatchQueue: () => <div data-testid="matches-body" /> }));
vi.mock('./NotInNetwork', () => ({ NotInNetwork: () => <div data-testid="notinnetwork-body" /> }));
vi.mock('./NoAgencyEmail', () => ({ NoAgencyEmail: () => <div data-testid="noemail-body" /> }));
vi.mock('./RefundQuestions', () => ({ RefundQuestions: () => <div data-testid="refunds-body" /> }));

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

beforeEach(() => {
  reviewQueue = []; matchQueue = []; refundQueue = []; noEmailQueue = []; notInNetworkQueue = [];
  sessionStorage.clear();
});
afterEach(cleanup);

describe('which tab the page lands on', () => {
  it('opens on the matches tab when that is where the only work is', async () => {
    // `state` matters now: the count is of matches WAITING, which is how
    // Home has always counted them and how the tab counts them since the
    // two were made one number.
    matchQueue = [{ id: 'm1', state: 'needs_review' }, { id: 'm2', state: 'needs_review' }];
    const view = renderAt('/reconciliation');
    await waitFor(() => { if (!view.container.querySelector('.qstat')) throw new Error('not ready'); });
    await settle();
    /* The LABEL, renamed by walk fix 22a. The ?tab= id is still
       'matches' and must stay so: Home links here with it. */
    expect(currentTab(view)).toContain('Agents named by tenants');
  });

  /* SEVERAL TABS WITH WORK LANDS ON ALL, because All is where they can be
     seen together. Matt, 2026-10-02: "opens on whichever tab has items (or
     All)." This is dev's own state: two supplier agencies with no email
     and one agency not in network. */
  it('and on All when more than one tab has items', async () => {
    noEmailQueue = [{ agencyId: 'a1' }, { agencyId: 'a2' }];
    notInNetworkQueue = [{ nameKey: 'n1' }];
    const view = renderAt('/reconciliation');
    await waitFor(() => { if (!view.container.querySelector('.qstat')) throw new Error('not ready'); });
    await settle();
    expect(currentTab(view)).toContain('All');
    // And All counts all three, which is the other half of the instruction.
    expect(currentTab(view)).toContain('3');
  });

  it('stays on All when All has work', async () => {
    reviewQueue = [row('Kestrel Lettings', 'agency')];
    matchQueue = [{ id: 'm1', state: 'needs_review' }];
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
    matchQueue = [{ id: 'm1', state: 'needs_review' }];
    const view = renderAt('/reconciliation?tab=matches');
    await waitFor(() => { if (!view.container.querySelector('.qstat')) throw new Error('not ready'); });
    await settle();
    expect(currentTab(view)).toContain('Agents named by tenants');
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
