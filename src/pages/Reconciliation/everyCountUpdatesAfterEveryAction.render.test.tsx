/* EVERY COUNT, AFTER EVERY ACTION, WITHOUT A REFRESH.
 *
 * Matt, 2026-10-03, verbatim: "after pressing Ignore on a 'Not in network'
 * agency, the section empties but the tab count ('Not in network 1'), the
 * 'Waiting' tile and the sidebar badge stay at their old numbers until
 * refresh. Every count on the page, on Home and in the sidebar must update
 * straight after any action on this page (Ignore, Added to HubSpot, Add
 * email, confirm, dismiss)."
 *
 * =====================================================================
 * WHY FOUR OF THE SIX ACTIONS WERE WRONG, AND TWO OF THEM COMPLETELY
 * =====================================================================
 *
 * There are two sets of counts and they move on different levers:
 *
 *   the page's tab counts and tiles   `reload()` in Reconciliation.tsx
 *   Home's tile and the sidebar badge `dataVersion`, which only
 *                                     `refresh()` from the session bumps
 *
 * `<NotInNetwork />` was mounted with no `onChanged` prop AT ALL, and did
 * not accept one. Ignore and "Added to HubSpot" therefore reloaded that
 * component's own rows and moved nothing else: the section emptied under a
 * tab still claiming 1, a tile still claiming the old total, and a badge
 * still claiming it in the sidebar. That is exactly what Matt saw.
 *
 * The match and refund actions were half right -- `onChanged={reload}` --
 * so they moved the page and left the badge. Only `confirm` and Add email
 * moved both, and each did it by remembering two calls of its own.
 *
 * THE FIX IS ONE FUNCTION, `afterAction`, AND EVERY ACTION CALLS IT. So the
 * strongest test is not "Ignore now works": it is that the page and the
 * sidebar are rendered TOGETHER, in one session, and that one click moves
 * all three numbers. A test that only read the page would have passed on
 * the half-right version.
 *
 * WHY THE SERVICE IS MOCKED. In mock mode `decideNotInNetwork` is a no-op
 * and `loadNotInNetworkAgencies` returns the same frozen array every time,
 * so the list can never shrink and no count can ever move. The mock below
 * is the smallest thing that makes the question askable: one mutable list,
 * read by both the page and the sidebar through the same two functions the
 * real code uses.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';

/* ONE MUTABLE LIST, standing in for the server's. Two agencies, so the
   count after one Ignore is 1 and not 0: a drop to zero can be produced by
   a component that renders nothing on error, and 2 -> 1 cannot. */
const LIST = {
  rows: [
    { nameKey: 'frost', typedName: 'Frost Partnership', tenants: 2, lastNamedAt: 'today', contacts: [] },
    { nameKey: 'quill', typedName: 'Quill Estates', tenants: 1, lastNamedAt: 'today', contacts: [] },
  ] as { nameKey: string; typedName: string; tenants: number; lastNamedAt: string; contacts: [] }[],
};

const EMPTY_TOTALS = {
  all: 0, review: 0, matches: 0, refunds: 0, noEmail: 0, notInNetwork: 0,
};

vi.mock('@/data/reconciliationService', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/data/reconciliationService')>();
  return {
    ...real,
    loadReconciliationQueue: async () => [],
    loadAgencyMatchQueue: async () => [],
    loadRefundQuestions: async () => [],
    loadSupplierAgenciesWithoutAnEmail: async () => [],
    loadNotInNetworkAgencies: async () => LIST.rows.map((r) => ({ ...r })),
    /* THE ACTION ACTUALLY CHANGES THE WORLD, which is the point: a mock
       that returned success without removing the row would leave every
       count correct at its old value and the test would prove nothing. */
    decideNotInNetwork: async (nameKey: string) => {
      LIST.rows = LIST.rows.filter((r) => r.nameKey !== nameKey);
    },
    /* AND THE TOTALS READ THE SAME LIST. This is what Home and the sidebar
       call, and it is a DIFFERENT function from the five the page calls, so
       a fix that updated only one of them shows up here. */
    loadReconciliationTotals: async () => ({
      ...EMPTY_TOTALS, all: LIST.rows.length, notInNetwork: LIST.rows.length,
    }),
  };
});

// Imported after the mock, so the page and the sidebar both bind to it.
const { Reconciliation } = await import('./Reconciliation');
const { Sidebar } = await import('@/components/layout/Sidebar');

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('grp_role', 'superadmin');
  LIST.rows = [
    { nameKey: 'frost', typedName: 'Frost Partnership', tenants: 2, lastNamedAt: 'today', contacts: [] },
    { nameKey: 'quill', typedName: 'Quill Estates', tenants: 1, lastNamedAt: 'today', contacts: [] },
  ];
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/* THE PAGE AND THE SIDEBAR IN ONE SESSION, which is the whole method. They
   are separate components reading separate loaders, and the defect was that
   an action told one of them. Rendered together, nothing can be missed by
   asking only the component that was already right. */
async function openBoth() {
  const view = render(
    <MemoryRouter initialEntries={['/reconciliation?tab=notinnetwork']}>
      <ToastProvider><SessionProvider><PageMetaProvider>
        <Sidebar />
        <Reconciliation />
      </PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.rtabs')) throw new Error('no tabs'); });
  await waitFor(() => { if (!view.container.querySelector('.nin__card')) throw new Error('no rows'); });
  await act(async () => {});
  return view;
}

type View = Awaited<ReturnType<typeof openBoth>>;

/** The "Not in network" tab's own count, read off the tab strip. */
const tabCount = (v: View): string => {
  const tab = [...v.container.querySelectorAll('.rtabs button')]
    .find((b) => (b.textContent ?? '').includes('Not in network'));
  return (tab?.querySelector('.rtab__c')?.textContent ?? '').trim();
};

/** The "Waiting" tile: the page's own total. */
const waitingTile = (v: View): string => {
  const card = [...v.container.querySelectorAll('.qstat__card')]
    .find((c) => (c.querySelector('.qstat__l')?.textContent ?? '').trim() === 'Waiting');
  return (card?.querySelector('.qstat__n')?.textContent ?? '').trim();
};

/** The sidebar's Reconciliation badge, which reads loadReconciliationTotals. */
const sidebarBadge = (v: View): string => {
  const link = [...v.container.querySelectorAll('a, button')]
    .find((a) => (a.textContent ?? '').includes('Reconciliation'));
  return (link?.textContent ?? '').replace('Reconciliation', '').trim();
};

const rowCount = (v: View) => v.container.querySelectorAll('.nin__card').length;
const dialogBtn = (label: string) =>
  [...(document.querySelector('[role="dialog"]')?.querySelectorAll<HTMLElement>('button') ?? [])]
    .find((b) => (b.textContent ?? '').trim() === label);
const pageBtn = (v: View, label: string) =>
  [...v.container.querySelectorAll<HTMLElement>('button')]
    .find((b) => (b.textContent ?? '').trim() === label);

/** Press Ignore on the first row and confirm the dialog. */
async function ignoreFirst(v: View) {
  await act(async () => { fireEvent.click(pageBtn(v, 'Ignore')!); });
  await act(async () => { dialogBtn('Ignore')!.click(); });
  await act(async () => {});
}

describe('before the action', () => {
  it('all three numbers agree at two', async () => {
    const v = await openBoth();
    expect(rowCount(v)).toBe(2);
    expect(tabCount(v)).toBe('2');
    expect(waitingTile(v)).toBe('2');
    expect(sidebarBadge(v)).toBe('2');
  });
});

describe('straight after pressing Ignore, with no refresh', () => {
  it('the section loses the row', async () => {
    const v = await openBoth();
    await ignoreFirst(v);
    expect(rowCount(v)).toBe(1);
  });

  /* THE THREE MATT NAMED. Each asserted separately, so a half-fix names
     which half is still wrong rather than failing one opaque test. */
  it('and the tab count follows it', async () => {
    const v = await openBoth();
    await ignoreFirst(v);
    expect(tabCount(v)).toBe('1');
  });

  it('and the Waiting tile follows it', async () => {
    const v = await openBoth();
    await ignoreFirst(v);
    expect(waitingTile(v)).toBe('1');
  });

  /* THE ONE THAT NEEDED THE SESSION RE-HYDRATE, and so the one that stayed
     wrong on every version of this page that only called `reload()`. */
  it('and so does the sidebar badge', async () => {
    const v = await openBoth();
    await ignoreFirst(v);
    expect(sidebarBadge(v)).toBe('1');
  });

  /* ALL AT ONCE, as a reader sees them. Three numbers that are each
     individually right can still be read on screen at different moments;
     this asserts the page is never self-contradictory after an action. */
  it('so nothing on screen contradicts anything else', async () => {
    const v = await openBoth();
    await ignoreFirst(v);
    expect({ rows: rowCount(v), tab: tabCount(v), tile: waitingTile(v), badge: sidebarBadge(v) })
      .toEqual({ rows: 1, tab: '1', tile: '1', badge: '1' });
  });
});

/* =====================================================================
   AND THE OTHER ACTIONS GO THROUGH THE SAME DOOR.

   Matt listed five: "Ignore, Added to HubSpot, Add email, confirm,
   dismiss". Ignore is driven above, end to end. The rest are in three
   other components with their own fixtures, and the thing that was wrong
   was never the action: it was which callback it was given. So that is
   what is asserted, on the source, in one place.

   A SOURCE TEST HERE IS THE STRONGER ONE. Driving all five through the UI
   would prove five paths and still pass if a sixth mount were added with
   `onChanged={reload}` -- which is precisely the regression that happened.
   This fails on the mount, which is where the mistake is made.
   ===================================================================== */
describe('every mount on the page', () => {
  it('is given the handler that moves both halves, and none is given reload', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const raw = readFileSync(join(process.cwd(), 'src/pages/Reconciliation/Reconciliation.tsx'), 'utf8');
    /* COMMENTS STRIPPED FIRST, and found by the test failing on its own
       target: the comment above `afterAction` quotes `<NotInNetwork />` to
       say what was wrong, and a scan of the raw file reads that prose as a
       mount. A guard that cannot tell code from a sentence about code
       would be failed by the explanation of the fix. */
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    // Every child that takes onChanged gets afterAction.
    for (const c of ['AgencyMatchQueue', 'NotInNetwork', 'RefundQuestions', 'NoAgencyEmail']) {
      const mounts = [...src.matchAll(new RegExp(`<${c}([^>]*)>`, 'g'))].map((m) => m[1]);
      expect(mounts.length, `${c} is not mounted`).toBeGreaterThan(0);
      for (const props of mounts) {
        expect(props, `<${c}> without afterAction`).toContain('onChanged={afterAction}');
      }
    }

    // And nothing is still wired to the page-only reload.
    expect(src).not.toContain('onChanged={reload}');

    // afterAction does both, hydrate first. The order matters: the supplier
    // no-email list is computed from the hydrated org.
    expect(raw).toMatch(/const afterAction = useCallback\(async \(\) => \{\s*await refreshData\(\);\s*await reload\(\);/);
  });
});
