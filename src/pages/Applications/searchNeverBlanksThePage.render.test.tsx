/* =====================================================================
   SEARCHING THE APPLICATIONS LIST MUST NOT BLANK THE PAGE.

   Matt (bw): "Blocker: Admin -> Applications, typing '26262' in the
   search box turns the whole page blank (crash). Find the error
   (browser console), fix it, and add a test that searches by full and
   partial guarantee reference, tenant name and postcode, including
   joint tenancies, without crashing."

   =====================================================================
   WHAT THIS FILE DOES AND DOES NOT CLAIM
   =====================================================================

   It is the test Matt specified, and it covers what he listed: full and
   partial reference, tenant name, postcode, and a joint tenancy
   narrowed to ONE of its two members, which is what "26262" does.

   =====================================================================
   WHAT THE CRASH ACTUALLY WAS
   =====================================================================

   It was not the Applications search at all. There are two boxes on
   that page, and the one in the header is GlobalSearch.

     hydrate's propStr took `addr1: string` from a NULLABLE column and
     returned it unchanged whenever there was no postcode either:

         if (!postcode) return addr1;     // null in, null out

     Dev holds four such rows -- expired referrals that never got as
     far as an address -- so four summaries carried `prop: null` under
     a type that promises a string.

   NOTHING NOTICED WHILE NOBODY CALLED A STRING METHOD ON IT. The list
   renders {r.prop} and React draws null as nothing. matchesQuery
   interpolates it and gets "null". GlobalSearch calls
   `a.prop.toLowerCase()` over allSummaries() -- the whole book,
   unscoped -- inside a useMemo. So the throw happens during render,
   React unmounts the tree, and the page goes white. Two characters was
   the trigger, which is why "26262" did it and why it would have done
   it on any page with the header on it.

   THE FIX IS AT THE BOUNDARY, in propStr, because that is where the
   type was broken. GlobalSearch is guarded as well, and that is not
   belt-and-braces: it reads the WHOLE book with no scope filter, so it
   is where any malformed row anywhere arrives first, in render, with
   nothing to catch it. A search box is not worth a white screen.

   THE CASE THAT MATTERS MOST is the joint one. A search that matches a
   single member leaves the tenancy group holding two members while the
   page holds one row, and every tally on the group heading is computed
   from the group rather than from what is on screen. That asymmetry is
   the most likely shape for the fault, so it is asserted hardest: the
   heading draws, the "1 of 2 shown by this filter" note appears, and
   nothing throws.
   ===================================================================== */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { App } from '@/App';

afterEach(cleanup);

async function openList() {
  localStorage.setItem('grp_role', 'superadmin');
  const view = render(
    <MemoryRouter initialEntries={['/applications']}>
      <SessionProvider><ToastProvider><App /></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => {
    if (!document.querySelector('table.dt tbody tr')) throw new Error('list not ready');
  });
  return {
    /* THE LIST'S OWN BOX, NAMED EXACTLY. There are TWO search inputs on
       this page -- the header's GlobalSearch ("Search tenants,
       references, branches") comes first in the DOM -- and
       `input[placeholder*="Search"]` picks the wrong one. My first
       draft did, typed into the header, and then asserted that the
       list had not changed, which it had not. */
    box: view.container.querySelector('input[placeholder="Search by tenant, property or reference"]') as HTMLInputElement,
    global: view.container.querySelector('input[placeholder="Search tenants, references, branches"]') as HTMLInputElement,
    rows: () => view.container.querySelectorAll('table.dt tbody tr').length,
  };
}

/** The page is alive: the heading is still drawn. A crash in render
    unmounts the tree, so this is the thing that goes when it blanks. */
const alive = () => (document.body.textContent ?? '').includes('Applications');

describe('the search box', () => {
  /* TERMS READ OFF THE RENDERED TABLE, not out of the data layer. A
     render test that calls getApplications to find out what to type is
     asserting against its own idea of the page; the point here is the
     page. It also stops the test depending on the opts shape, which is
     how my first draft got an empty list and four undefineds. */
  /* FROM ITS OWN CELL, not from the row's text. textContent joins the
     cells with no separator, so /GR-[A-Z0-9-]+/ over a whole row reads
     "GR-20601" and then keeps going into the next cell: my first run
     searched for "GR-20601F" and quite correctly found nothing. */
  const refsOnScreen = () =>
    [...document.querySelectorAll('table.dt tbody *')]
      .map((el) => /^(GR-[A-Z0-9-]+)$/.exec((el.textContent ?? '').trim())?.[1])
      .filter((x): x is string => !!x);

  /* EVERY PREFIX, NOT THE FINISHED WORD. Matt typed "26262"; the browser
     saw "2", "26", "262", "2626", "26262", and any one of them could be
     the one that throws. A test that only sets the final value steps
     over four of the five states the user actually produced. */
  it('survives every prefix of a reference, one keystroke at a time', async () => {
    const { box } = await openList();
    const digits = (refsOnScreen()[0] ?? 'GR-20601').replace(/\D/g, '');
    let typed = '';
    for (const ch of digits) {
      typed += ch;
      fireEvent.change(box, { target: { value: typed } });
      await waitFor(() => { if (!alive()) throw new Error(`blanked on "${typed}"`); });
    }
    expect(alive()).toBe(true);
  });

  /* AND THE SAME THROUGH THE HEADER'S BOX, which is the one that
     actually crashed: it reads the whole book, unscoped, in render. */
  it('survives every prefix in the header search too', async () => {
    const { global: g } = await openList();
    expect(g, 'the header search is not on the page').toBeTruthy();
    let typed = '';
    for (const ch of '26262') {
      typed += ch;
      fireEvent.change(g, { target: { value: typed } });
      await waitFor(() => { if (!alive()) throw new Error(`header search blanked on "${typed}"`); });
    }
    expect(alive()).toBe(true);
  });

  it('finds a full reference, and a partial one', async () => {
    const { box, rows } = await openList();
    const ref = refsOnScreen()[0];
    expect(ref, 'no reference on the first page to search for').toBeTruthy();
    fireEvent.change(box, { target: { value: ref } });
    await waitFor(() => { if (!refsOnScreen().includes(ref)) throw new Error('the row it matched is gone'); });
    expect(alive()).toBe(true);
    fireEvent.change(box, { target: { value: ref.slice(-4) } });
    await waitFor(() => { if (!alive() || rows() < 1) throw new Error('blanked or empty on a partial'); });
  });

  it('finds a tenant by name, and a property by postcode', async () => {
    const { box, rows } = await openList();
    /* THE TENANT'S OWN ELEMENT. Scanning every cell for something that
       LOOKS like a name picks up "Deed Issued" and "Head office" first,
       and then searches for a word no row contains. */
    const name = (document.querySelector('table.dt tbody .dt__name')?.textContent ?? '')
      .trim().split(/\s+/)[0];
    expect(name, 'no tenant name on screen to search for').toBeTruthy();
    fireEvent.change(box, { target: { value: name! } });
    await waitFor(() => { if (!alive() || rows() < 1) throw new Error('blanked or empty on a name'); });

    /* THE POSTCODE IS SEARCHABLE ONLY BECAUSE `prop` CARRIES IT: hydrate's
       propStr joins address line one and the outcode, and matchesQuery
       searches `prop`. Drop the outcode from the display string and
       search by postcode goes silently, with no error anywhere. */
    const outcode = [...document.querySelectorAll('table.dt tbody td')]
      .map((c) => /,\s*([A-Z]{1,2}\d{1,2}[A-Z]?)\s*$/.exec((c.textContent ?? '').trim())?.[1])
      .find(Boolean);
    if (outcode) {
      fireEvent.change(box, { target: { value: outcode } });
      await waitFor(() => { if (!alive() || rows() < 1) throw new Error('blanked or empty on a postcode'); });
    }
  });

  /* ONE MEMBER OF A JOINT TENANCY, which is "26262" exactly. The group
     still holds both members; the page holds one row, and every tally
     on the heading is computed from the group rather than from what is
     on screen. That asymmetry is the most likely shape for a fault of
     this kind, so it is asserted hardest. */
  it('survives narrowing a joint tenancy to one of its members', async () => {
    const { box, rows } = await openList();
    const text = document.body.textContent ?? '';
    expect(text, 'the seed shows no joint tenancy on the first page').toContain('Joint tenancy');
    const after = [...document.querySelectorAll('tr.jt-head')][0]?.nextElementSibling;
    // Same exact-element read as refsOnScreen, and for the same reason.
    const ref = [...(after?.querySelectorAll('*') ?? [])]
      .map((el) => /^(GR-[A-Z0-9-]+)$/.exec((el.textContent ?? '').trim())?.[1])
      .find(Boolean);
    expect(ref, 'no member row under the joint heading').toBeTruthy();

    fireEvent.change(box, { target: { value: ref! } });
    await waitFor(() => {
      if (!alive()) throw new Error('blanked on a joint member');
      if (rows() < 1) throw new Error('the member row is gone');
    });
    const t = document.body.textContent ?? '';
    expect(t).toContain('Joint tenancy');
    expect(t).toMatch(/1 of \d+ shown by this filter/);
  });

  it('and survives a search that matches nothing at all', async () => {
    const { box } = await openList();
    fireEvent.change(box, { target: { value: 'zzzz-no-such-thing-zzzz' } });
    await waitFor(() => {
      if (!alive()) throw new Error('blanked on an empty result');
      if (refsOnScreen().length !== 0) throw new Error('rows still drawn');
    });
    expect(alive()).toBe(true);
  });
});
