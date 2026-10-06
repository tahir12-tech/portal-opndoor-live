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
/** Open the picker and click the option with this exact label, TYPING
    first if it is a named party rather than a quick choice. Matt,
    2026-09-30: "individual agencies and suppliers appear only as search
    results, so the list never grows endless." The quick choices are
    still there on focus. */
/* THE PILL OPENS IT. Matt, 2026-10-01: the control is "a filter button
   ... opening the search and list when clicked. No bare text box." The
   search input only exists once the pill has been pressed, so every
   interaction below starts there. */
async function openPicker(v: View) {
  const btn = v.container.querySelector<HTMLButtonElement>('.scopepick__btn');
  expect(btn, 'no Origin picker on the page').toBeTruthy();
  if (!v.container.querySelector('.scopepick__pop')) {
    await act(async () => { fireEvent.click(btn!); });
  }
  const box = v.container.querySelector<HTMLInputElement>('.scopepick__pop input[role="combobox"]');
  expect(box, 'the pill did not open the search').toBeTruthy();
  return box!;
}

async function pick(v: View, label: string) {
  const box = await openPicker(v);
  await act(async () => { fireEvent.focus(box); });
  const find = () => [...v.container.querySelectorAll('.typeahead__opt')]
    .find((o) => o.querySelector('.typeahead__opt-main')?.textContent?.trim() === label);
  if (!find()) await act(async () => { fireEvent.change(box, { target: { value: label } }); });
  const opt = find();
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

/* =====================================================================
   THE BOX SHOWS WHAT IS APPLIED, 2026-09-30.

   Matt, verbatim: "Applications Origin filter: the box always shows what
   is actually applied, and choosing an option (Everything, Suppliers,
   Agencies, Direct, or a single agency, group or supplier) updates both
   the box and the list, with the status tab counts matching. Add a clear
   (x) to go back to Everything. Show only the quick choices and recent
   selections until the user types; individual agencies and suppliers
   appear only as search results, so the list never grows endless. No
   duplicate entries."
   ===================================================================== */
/** What the control READS at rest, which is now the pill and not a box. */
const pillOf = (v: View) =>
  (v.container.querySelector('.scopepick__text')?.textContent ?? '').trim();
const offered = (v: View) =>
  [...v.container.querySelectorAll('.typeahead__opt-main')].map((o) => (o.textContent ?? '').trim());

describe('the box and the list agree', () => {
  it('the button names the quick choice that is applied', async () => {
    const v = await openList();
    await pick(v, 'Suppliers');
    /* "Origin: Suppliers", which is Matt's wording and matches "Period:
       All time" in the same row. */
    expect(pillOf(v)).toBe('Origin: Suppliers');
  });

  it('and reads "Origin: Everything" before anything is chosen', async () => {
    const v = await openList();
    expect(pillOf(v)).toBe('Origin: Everything');
  });

  /* NO BARE TEXT BOX. The thing Matt actually reported: at rest there is
     no input on the page at all, only the button. */
  it('and shows no input at all until it is pressed', async () => {
    const v = await openList();
    expect(v.container.querySelector('.scopepick input')).toBeNull();
    await openPicker(v);
    expect(v.container.querySelector('.scopepick__pop input[role="combobox"]')).toBeTruthy();
  });

  it('and the counts move with the rows, not just the rows', async () => {
    const v = await openList();
    const [, beforeTotal] = showing(v);
    await pick(v, 'Suppliers');
    const [shownAfter, totalAfter] = showing(v);
    // The denominator comes from countByStatus, which filters separately
    // from the rows: a narrowing that moves one and not the other leaves
    // the tabs contradicting the list under them.
    expect(totalAfter).toBeLessThan(beforeTotal);
    expect(shownAfter).toBeLessThanOrEqual(totalAfter);
    expect(rows(v).length).toBe(shownAfter);
  });
});

describe('the clear (x)', () => {
  it('is absent when nothing is applied', async () => {
    const v = await openList();
    expect(v.container.querySelector('.scopepick__clear')).toBeNull();
  });

  it('appears once something is, and goes back to Everything', async () => {
    const v = await openList();
    await pick(v, 'Suppliers');
    const x = v.container.querySelector<HTMLButtonElement>('.scopepick__clear');
    expect(x, 'no clear button').toBeTruthy();
    await act(async () => { fireEvent.click(x!); });
    expect(pillOf(v)).toBe('Origin: Everything');
    expect(v.container.querySelector('.scopepick__clear')).toBeNull();
  });

  it('and the list comes back with it', async () => {
    const v = await openList();
    const before = rows(v).length;
    await pick(v, 'Suppliers');
    expect(rows(v).length).toBeLessThan(before);
    await act(async () => { fireEvent.click(v.container.querySelector<HTMLButtonElement>('.scopepick__clear')!); });
    expect(rows(v).length).toBe(before);
  });
});

describe('the list never grows endless', () => {
  it('offers only the quick choices before anybody types', async () => {
    const v = await openList();
    const box = await openPicker(v);
    await act(async () => { fireEvent.focus(box); });
    const labels = offered(v);
    expect(labels).toContain('Everything');
    expect(labels).toContain('Suppliers');
    expect(labels).toContain('Agencies');
    // Four quick choices at most on this book (Direct and Provider come
    // from the rows). No parade of agencies under them.
    expect(labels.length).toBeLessThanOrEqual(5);
  });

  it('and named parties only once something is typed', async () => {
    const v = await openList();
    const box = await openPicker(v);
    await act(async () => { fireEvent.focus(box); });
    const before = offered(v).length;
    await act(async () => { fireEvent.change(box, { target: { value: 'e' } }); });
    expect(offered(v).length).toBeGreaterThan(before);
  });

  /* NO DUPLICATE ENTRIES. The one that actually occurred: a recent
     selection that is also a quick choice appeared twice, once
     unlabelled and once under "Recent", reading as two different
     things. */
  it('and never offers the same option twice', async () => {
    const v = await openList();
    await pick(v, 'Suppliers');
    await pick(v, 'Agencies');
    const box = await openPicker(v);
    await act(async () => { fireEvent.focus(box); });
    const labels = offered(v);
    expect(labels.length).toBe(new Set(labels).size);
  });
});
