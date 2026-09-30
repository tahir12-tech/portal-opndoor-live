/* WALK FIX 7, ON THE PAGE. "Applications, Origin picker: choosing an option
   does nothing, the list doesn't change."

   The predicate is tested in src/data/origin.test.ts. This is the other half,
   and it is the half that actually broke: the page had a working predicate
   available to it (`originMatches`, which Reporting narrows by) and asked a
   different, incomplete one (`originToFilter`). Nothing about the data layer
   was wrong; the wiring chose the wrong question.

   So these assertions all go through the CONTROL, not the service. They open
   the picker, click an option, and count the rows and the "Showing X of Y"
   denominator afterwards. A test that called getApplications directly would
   have passed on the day of the defect.

   THE TWO IT WAS TRUE OF are Suppliers and Agencies, the second and third
   entries in the picker. They are rails rather than parties, so they are not
   in the book and `originOptions` never produces them; the picker adds them
   from its own QUICK list. That is why every existing test walked straight
   past the bug. */
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { KEYS } from '@/data/storage';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { Applications } from './Applications';

afterEach(() => {
  cleanup();
  // The scope selection is remembered and shared with Reporting, so it
  // outlives the component and would hand the next test a narrowed book.
  localStorage.removeItem(KEYS.scopeSel);
  localStorage.removeItem(KEYS.scopeRecents);
});

async function openList() {
  localStorage.setItem('grp_role', 'superadmin');
  const view = render(
    <MemoryRouter initialEntries={['/applications']}>
      <SessionProvider><ToastProvider><PageMetaProvider><Applications /></PageMetaProvider></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!document.querySelector('table.dt tbody tr')) throw new Error('no rows'); });
  return view;
}

type View = Awaited<ReturnType<typeof openList>>;
const rows = (v: View) => [...v.container.querySelectorAll('table.dt tbody tr')]
  .filter((tr) => tr.querySelectorAll('td').length > 1);
/** The Origin COLUMN, found by its header rather than by position: the page
    drops columns for a narrower viewer, so a fixed index would read whichever
    cell happened to land there. */
function originCol(v: View): number {
  const heads = [...v.container.querySelectorAll('table.dt thead th')]
    .map((th) => (th.textContent ?? '').trim());
  const i = heads.indexOf('Origin');
  expect(i, 'no Origin column on the page').toBeGreaterThan(-1);
  return i;
}
const originCells = (v: View) => {
  const i = originCol(v);
  return rows(v).map((tr) => tr.querySelectorAll('td')[i]);
};
/** The kind line under the party's name, which is what a rail selects on. */
const originKinds = (v: View) =>
  [...new Set(originCells(v).map((td) => td?.querySelector('.dt__sub')?.textContent ?? ''))];
/** The party's name itself. */
const originNames = (v: View) =>
  [...new Set(originCells(v).map((td) => td?.querySelector('.dt__name')?.textContent ?? ''))];

/** Open the picker and click the option with this exact label. */
async function pick(v: View, label: string) {
  const box = v.container.querySelector<HTMLInputElement>('.scopepick input[role="combobox"]')!;
  expect(box, 'no Origin picker on the page').toBeTruthy();
  await act(async () => { fireEvent.focus(box); });
  const opt = [...v.container.querySelectorAll('.typeahead__opt')]
    .find((o) => o.querySelector('.typeahead__opt-main')?.textContent?.trim() === label);
  expect(opt, `no option labelled "${label}"`).toBeTruthy();
  await act(async () => { fireEvent.mouseDown(opt!); fireEvent.click(opt!); });
}

/** "Showing 5 of 5" -> [5, 5]. The denominator comes from countByStatus, which
    filters separately from the rows, so it can disagree with them. */
function showing(v: View): [number, number] {
  const m = (v.container.textContent ?? '').match(/Showing\s+(\d+)[^\d]+(\d+)/);
  expect(m, 'no "Showing X of Y" on the page').toBeTruthy();
  return [Number(m![1]), Number(m![2])];
}

describe('choosing an origin', () => {
  /* THE DEFECT, AS REPORTED. Not "wrong rows": the SAME rows. */
  it('narrows the list when Suppliers is chosen', async () => {
    const v = await openList();
    const before = rows(v).length;
    expect(before).toBeGreaterThan(0);
    await pick(v, 'Suppliers');
    const after = rows(v).length;
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
    expect(originKinds(v)).toEqual(['Supplier']);
  });

  it('and again, differently, when Agencies is chosen', async () => {
    const v = await openList();
    const before = rows(v).length;
    await pick(v, 'Agencies');
    expect(rows(v).length).toBeLessThan(before);
    expect(originKinds(v)).toEqual(['Agency']);
  });

  /* THE COUNT HAS TO MOVE WITH THE ROWS. "Showing 5 of 21" would be the same
     complaint one line further down the page: the tabs and the denominator
     read countByStatus, which filters separately from the list. */
  it('and the "Showing X of Y" total narrows with them, not just X', async () => {
    const v = await openList();
    const [, totalBefore] = showing(v);
    await pick(v, 'Suppliers');
    const [shown, total] = showing(v);
    expect(total).toBeLessThan(totalBefore);
    expect(shown).toBeLessThanOrEqual(total);
    expect(total).toBe(rows(v).length);
  });

  /* AND BACK. A filter you cannot undo is the other half of one that does
     nothing, and Everything is the way back that the picker keeps visible
     while you type for exactly this reason. */
  it('and Everything puts the whole book back', async () => {
    const v = await openList();
    const before = rows(v).length;
    await pick(v, 'Suppliers');
    expect(rows(v).length).toBeLessThan(before);
    await pick(v, 'Everything');
    expect(rows(v).length).toBe(before);
  });

  /* ONE NAMED PARTY, which is the arm that always worked, asserted through
     the control rather than through the service: the fix moved which
     question the page asks, so the arms that were already right have to be
     proved still right at the same place. */
  it('and a single named agency narrows to that agency alone', async () => {
    const v = await openList();
    await pick(v, 'Foxglove Residential');
    expect(rows(v).length).toBeGreaterThan(0);
    expect(originNames(v)).toEqual(['Foxglove Residential']);
  });
});
