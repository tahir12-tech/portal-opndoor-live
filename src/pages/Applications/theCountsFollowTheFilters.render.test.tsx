/* EVERY TAB COUNT FOLLOWS EVERY FILTER, AND A PLACEHOLDER IS NOT A BRANCH.
 *
 * Matt, 2026-10-01, verbatim: "Applications: every status tab count follows
 * the current filters (origin, period, branch, referrer, search), so with
 * Origin set to Direct, In progress and Fee unpaid count only direct
 * applications. For a direct signup with no agency, the Branch column shows
 * '-' instead of 'Unattached Unattached', everywhere that label appears."
 *
 * WHAT WAS ACTUALLY BROKEN, measured through the page before anything was
 * changed. Four of the five filters were already shared between the rows and
 * the counts, because `countByStatus` and `getApplications` are handed the
 * same `filterOpts`. SEARCH was not in it: typing a reference narrowed the
 * list to one row while every tab above went on counting the whole book, and
 * "Showing 1 of 4" kept a denominator the search had already excluded.
 *
 * So the origin assertions below did not fail before the fix. They are here
 * because Matt's sentence names origin as the example, and a rule that is
 * only tested where it happened to break is a rule that breaks again
 * somewhere else.
 *
 * THROUGH THE CONTROLS, NOT THE SERVICE. The defect was the page handing one
 * reader a filter and the other not; a test calling countByStatus directly
 * would have passed on the day of it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { KEYS } from '@/data/storage';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { Applications } from './Applications';
import { hydrateApplications } from '@/data/applicationsService';
import type { ApplicationSummary } from '@/data/types';

const row = (o: Partial<ApplicationSummary>): ApplicationSummary => ({
  ref: 'X', tenant: 'A Tenant', prop: '1 Road', branch: "Regent's Park",
  agency: 'Regent’s Lettings', ben: '', rent: 2000, status: 'sent',
  date: '2026-09-20', owner: 0, partner: 'opndoor-agents',
  referrer: 'Tom Reeve', sentAtTs: new Date('2026-09-20').getTime(),
  registered: true, feePaid: true, ...o,
} as ApplicationSummary);

/* TWO RAILS, AND A DRAFT ON EACH. The drafts matter: "In progress" and "Fee
   unpaid" are the two tabs Matt names, and they are the only ones computed
   from the pre-Sent sub-states rather than from `status` alone. A fixture
   without them would test every tab except the two in the instruction.

   The direct rows carry agency and branch "Unattached", which is what dev
   actually holds: all ten direct applications point at the house rail's
   placeholder, created by migration so a NOT NULL foreign key resolves. */
const BOOK: ApplicationSummary[] = [
  row({ ref: 'AG-1', status: 'sent' }),
  row({ ref: 'AG-2', status: 'paid' }),
  row({ ref: 'AG-3', status: 'draft', registered: false, feePaid: false }),
  row({ ref: 'AG-4', status: 'draft', registered: true, feePaid: false }),
  row({ ref: 'DI-1', partner: 'opndoor-direct', agency: 'Unattached', branch: 'Unattached', status: 'sent' }),
  row({ ref: 'DI-2', partner: 'opndoor-direct', agency: 'Unattached', branch: 'Unattached', status: 'paid' }),
  row({ ref: 'DI-3', partner: 'opndoor-direct', agency: 'Unattached', branch: 'Unattached', status: 'draft', registered: false, feePaid: false }),
  row({ ref: 'DI-4', partner: 'opndoor-direct', agency: 'Unattached', branch: 'Unattached', status: 'draft', registered: true, feePaid: false }),
];

afterEach(() => {
  cleanup();
  // Shared with Reporting and remembered, so it would narrow the next test.
  localStorage.removeItem(KEYS.scopeSel);
  localStorage.removeItem(KEYS.scopeRecents);
});

async function openList() {
  localStorage.setItem('grp_role', 'superadmin');
  hydrateApplications(BOOK, []);
  const v = render(
    <MemoryRouter initialEntries={['/applications']}>
      <SessionProvider><ToastProvider><PageMetaProvider><Applications /></PageMetaProvider></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!document.querySelector('table.dt tbody tr')) throw new Error('no rows'); });
  await act(async () => {});
  return v;
}
type View = Awaited<ReturnType<typeof openList>>;

/** Every tab and the number on it, read off the strip the user sees. */
function tabCounts(v: View): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of v.container.querySelectorAll('[role="tab"], .tabs button, .seg button')) {
    const m = (t.textContent ?? '').trim().match(/^(.*?)(\d+)$/);
    if (m) out[m[1].trim()] = Number(m[2]);
  }
  return out;
}
const rowsOf = (v: View) => [...v.container.querySelectorAll('table.dt tbody tr')]
  .filter((tr) => tr.querySelectorAll('td').length > 1);
/** "Showing 1 of 4" -> [1, 4]. The denominator comes from the counts. */
function showing(v: View): [number, number] {
  const m = (v.container.textContent ?? '').match(/Showing\s+(\d+)[^\d]+(\d+)/);
  expect(m, 'no "Showing X of Y" on the page').toBeTruthy();
  return [Number(m![1]), Number(m![2])];
}
async function search(v: View, text: string) {
  const box = v.container.querySelector<HTMLInputElement>('input[type="search"], input[placeholder*="Search" i]');
  expect(box, 'no search box on the page').toBeTruthy();
  await act(async () => { fireEvent.change(box!, { target: { value: text } }); });
}
async function pickOrigin(v: View, label: string) {
  const btn = v.container.querySelector<HTMLButtonElement>('.scopepick__btn');
  expect(btn, 'no Origin picker on the page').toBeTruthy();
  if (!v.container.querySelector('.scopepick__pop')) await act(async () => { fireEvent.click(btn!); });
  const box = v.container.querySelector<HTMLInputElement>('.scopepick__pop input[role="combobox"]')!;
  await act(async () => { fireEvent.focus(box); });
  const find = () => [...v.container.querySelectorAll('.typeahead__opt')]
    .find((o) => o.querySelector('.typeahead__opt-main')?.textContent?.trim() === label);
  if (!find()) await act(async () => { fireEvent.change(box, { target: { value: label } }); });
  expect(find(), `no origin option "${label}"`).toBeTruthy();
  await act(async () => { fireEvent.mouseDown(find()!); fireEvent.click(find()!); });
}

describe('the tab counts before any filter', () => {
  it('count the whole book', async () => {
    expect(tabCounts(await openList())).toMatchObject({
      All: 4, 'In progress': 4, 'Invited, not registered': 2, 'Fee unpaid': 4, Sent: 2, Paid: 2,
    });
  });
});

describe('the tab counts follow the Origin filter', () => {
  /* MATT'S OWN EXAMPLE, named in the instruction. */
  it('so In progress and Fee unpaid count only direct applications', async () => {
    const v = await openList();
    await pickOrigin(v, 'Direct');
    expect(tabCounts(v)).toMatchObject({ 'In progress': 2, 'Fee unpaid': 2 });
  });

  it('and so does every other tab', async () => {
    const v = await openList();
    await pickOrigin(v, 'Direct');
    expect(tabCounts(v)).toMatchObject({ All: 2, Sent: 1, Paid: 1, 'Invited, not registered': 1 });
  });
});

describe('the tab counts follow the search', () => {
  /* THE ONE THAT WAS BROKEN. Before this, the list showed one row and the
     tabs went on counting four. */
  it('so searching a reference leaves one on every tab that still matches', async () => {
    const v = await openList();
    await search(v, 'DI-1');
    expect(tabCounts(v)).toMatchObject({ All: 1, Sent: 1, Paid: 0 });
  });

  it('and the rows agree with them', async () => {
    const v = await openList();
    await search(v, 'DI-1');
    expect(rowsOf(v)).toHaveLength(1);
  });

  /* THE DENOMINATOR IS A COUNT TOO, and read off the same function, so it
     was wrong in the same way: "Showing 1 of 4" over a list of one. */
  it('and so does the "Showing X of Y" denominator', async () => {
    const v = await openList();
    await search(v, 'DI-1');
    expect(showing(v)).toEqual([1, 1]);
  });

  /* A SEARCH THAT MATCHES NOTHING must take the counts to zero, not leave
     them stating the size of the book. */
  it('and a search that matches nothing counts nothing', async () => {
    const v = await openList();
    await search(v, 'zzzz-no-such-tenant');
    expect(tabCounts(v).All).toBe(0);
    expect(rowsOf(v)).toHaveLength(0);
  });

  /* AND THE TWO FILTERS COMPOSE, which is the case the instruction
     describes: an origin AND a search, both narrowing the same counts. */
  it('and a search composes with the origin rather than replacing it', async () => {
    const v = await openList();
    await pickOrigin(v, 'Direct');
    await search(v, 'AG-1');            // an AGENCY row, excluded by the origin
    expect(tabCounts(v).All ?? 0).toBe(0);
  });
});

/* ===========================================================================
   AND THE PLACEHOLDER IS NOT A BRANCH.

   "Unattached" is the agency AND branch the house rails hang off, created by
   migration so an application's NOT NULL foreign keys resolve. The Branch
   cell prints the branch over the agency, and for a direct signup both were
   the placeholder, so the column read "Unattached Unattached" -- our own
   internal word, twice, where the answer is that there is no agency.
   =========================================================================== */
describe('a direct signup has no branch', () => {
  const branchCells = (v: View) => {
    const heads = [...v.container.querySelectorAll('table.dt thead th')]
      .map((th) => (th.textContent ?? '').trim());
    const i = heads.indexOf('Branch');
    expect(i, 'no Branch column on the page').toBeGreaterThan(-1);
    return rowsOf(v).map((tr) => (tr.querySelectorAll('td')[i]?.textContent ?? '').trim());
  };

  it('so its Branch cell reads "-"', async () => {
    const v = await openList();
    await pickOrigin(v, 'Direct');
    expect([...new Set(branchCells(v))]).toEqual(['-']);
  });

  it('and never the placeholder, on either line of the cell', async () => {
    const v = await openList();
    await pickOrigin(v, 'Direct');
    expect(v.container.textContent).not.toContain('Unattached');
  });

  /* AND A REAL BRANCH IS STILL NAMED, so the fix is not "stop showing
     branches". */
  it('while an agency row still names its office', async () => {
    const v = await openList();
    await pickOrigin(v, 'Agencies');
    expect(branchCells(v).every((c) => c.includes("Regent's Park"))).toBe(true);
  });
});
