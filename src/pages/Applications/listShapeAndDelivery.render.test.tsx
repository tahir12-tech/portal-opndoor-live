/* WHAT THE LIST DRAWS, AND FOR WHOM.

   Two rulings meet on this page.

   1. A viewer inside one agency was given a Route column reading the same word
      on every row, an Agency column reading their own name, a Branch column
      under it reading their one branch, and a filter for each offering a single
      choice. viewerShape measures the book; the page has to act on the answer.

   2. Delivery is TWO states. A send that errored is the agency's business and
      they can resend it; nobody to send to is an ops queue and is ours. The
      list has to show each to the right people, on the row and on the chips,
      because "Deed Issued" reads identically whether or not the deed arrived.

   The shape is stubbed rather than staged: the mock book holds seven agencies,
   and what is under test here is what the PAGE does with the answer, not
   viewerShape's counting. The delivery rows are real, hydrated through the same
   working copy live mode fills, so deliveryStateOf and countByStatus are doing
   the deciding exactly as they do in the app. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEYS } from '@/data/storage';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { Applications } from './Applications';
import { hydrateApplications } from '@/data';
import type { ApplicationSummary } from '@/data';
import type { ViewerShape } from '@/data/viewerShape';

const ESTATE: ViewerShape = {
  agencies: 7, branches: 12, referrers: 5, routes: 3, oneAgency: false, oneBranch: false, oneRoute: false,
};
/** Rosa: one agency, one branch, one rail, and several people under her. */
const ONE_SHOP: ViewerShape = {
  agencies: 1, branches: 1, referrers: 3, routes: 1, oneAgency: true, oneBranch: true, oneRoute: true,
};
let shape: ViewerShape = ESTATE;

vi.mock('@/data/viewerShape', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/viewerShape')>();
  return { ...actual, viewerShape: () => shape };
});

const FAILED = 'GR-DF01';
const HELD = 'GR-HS01';
const FINE = 'GR-OK01';

function row(o: Partial<ApplicationSummary> & { ref: string; tenant: string }): ApplicationSummary {
  return {
    prop: '14 Thistle Row, SW6 2QT',
    branch: 'Chelsea',
    agency: 'Foxglove Residential',
    ben: '',
    rent: 2400,
    status: 'deed',
    // Inside the demo book's "all time", which ends where the seed data does:
    // a row dated after it is filtered out by the period chip before it can be
    // filtered by anything this test is about.
    date: '2026-05-12',
    // owner 1 so a referrer can see them too: that is the whole point of one
    // of these tests.
    owner: 1,
    partner: 'northwind',
    referrer: 'Priya Nair',
    ...o,
  };
}

/** Three deeds in the same state as far as `status` is concerned, and in three
    different states as far as the tenant waiting for one is concerned. */
function seedDeliveryBook(): void {
  hydrateApplications([
    row({ ref: FAILED, tenant: 'Ada Lovelace', deliveryFailedAt: new Date('2026-05-14T09:00:00Z') }),
    row({ ref: HELD, tenant: 'Grace Hopper', awaitingStaffSend: true }),
    row({ ref: FINE, tenant: 'Alan Turing' }),
  ], []);
}

afterEach(() => {
  cleanup();
  shape = ESTATE;
  /* THE SCOPE SELECTION IS REMEMBERED NOW, which is the point of it: Matt's
     answer of 2026-09-29 is that Reporting and Applications share one
     remembered choice. It therefore persists in localStorage where this
     page's own `origin` state used to die with the component, and a test
     that narrowed to one party would hand the next test an empty list. */
  localStorage.removeItem(KEYS.scopeSel);
  localStorage.removeItem(KEYS.scopeRecents);
});

/* The page on its own rather than through <App />: this is a test about one
   screen's columns, and routing the whole shell in to reach them only makes the
   run depend on every other page compiling. */
async function openList(role: string, path = '/applications') {
  localStorage.setItem('grp_role', role);
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider><ToastProvider><PageMetaProvider><Applications /></PageMetaProvider></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!document.querySelector('table.dt thead')) throw new Error('list not ready'); });
  return view;
}

type View = Awaited<ReturnType<typeof openList>>;
const headers = (v: View) => [...v.container.querySelectorAll('table.dt thead th')].map((th) => (th.textContent ?? '').trim());
/** Every filter chip, by the label its select is announced as. */
/* The filter bar's controls, whichever element each one is. Origin became a
   searchable combobox when it became the shared scope picker; the rest are
   still native selects, and the assertions here are about WHICH filters the
   bar offers, not about what they are made of. */
const chips = (v: View) => [
  ...v.container.querySelectorAll('.fchip select, .fchip input[role="combobox"]'),
].map((s) => s.getAttribute('aria-label') ?? '');
const tabs = (v: View) => [...v.container.querySelectorAll('.ftab')].map((b) => b.textContent ?? '');
const rowFor = (v: View, ref: string) => [...v.container.querySelectorAll<HTMLElement>('table.dt tbody tr')]
  .find((tr) => (tr.textContent ?? '').includes(ref));

describe('the columns and filters a one-agency viewer gets', () => {
  it('drops Route, Agency and Branch, and keeps Referrer', async () => {
    shape = ONE_SHOP;
    const view = await openList('management');
    expect(headers(view)).not.toContain('Route');
    expect(headers(view)).not.toContain('Branch');
    expect(headers(view)).not.toContain('Agency');
    // Origin is Route and Partner merged, so it collapses where they did: one
    // rail and one agency is one origin on every row.
    expect(headers(view)).not.toContain('Origin');
    expect(chips(view)).not.toContain('Origin:');
    // What is left still has to be a list of applications. The date column is
    // headed "Last activity": the cell is the row's most recent event rather than
    // the date it was created, and the old "Date" said neither.
    expect(headers(view)).toEqual(expect.arrayContaining(['Tenant', 'Property', 'Status', 'Last activity']));
    expect(chips(view)).not.toContain('Agency:');
    expect(chips(view)).not.toContain('Branch:');
    expect(chips(view)).not.toContain('Route:');
    // People are the one dimension a single shop still has several of.
    expect(chips(view)).toContain('Referrer:');
  });

  it('stops the intro offering filters that are not on the page', async () => {
    shape = ONE_SHOP;
    const view = await openList('management');
    const sub = view.container.querySelector('.page-head__sub')!.textContent ?? '';
    expect(sub).toMatch(/Filter by status or referrer, or search by tenant\./);
    expect(sub).not.toMatch(/agency or branch/i);
  });

  /* AND AN ADMIN GETS ORIGIN, WHICH IS ONE COLUMN WHERE THERE WERE TWO.
     Route said which rail and never whose; Partner said which partner record,
     and on the agency rail that record is house plumbing. Neither answered
     "where did this come from", so they are one column now and one filter. */
  it('gives an opndoor admin one Origin column in place of Route and Partner', async () => {
    const view = await openList('superadmin');
    expect(headers(view)).toEqual(expect.arrayContaining(['Tenant', 'Origin', 'Property', 'Branch', 'Status']));
    expect(headers(view)).not.toContain('Route');
    expect(headers(view)).not.toContain('Partner');
    // One filter, not two. The Agency chip goes with them: the Origin selector
    // lists every agency and group in the book, and two chips both offering
    // agencies is the same word twice.
    expect(chips(view)).toEqual(expect.arrayContaining(['Origin', 'Branch:', 'Referrer:']));
    expect(chips(view)).not.toContain('Route:');
    expect(chips(view)).not.toContain('Partner:');
    expect(chips(view)).not.toContain('Agency:');
    expect(view.container.querySelector('.page-head__sub')!.textContent)
      .toMatch(/Filter by status, origin or branch, or search by tenant\./);
  });

  /* THE CELL NAMES THE PARTY, not the rail and not the plumbing. Every row in
     this book is an agency row carried by the seed's agency-rail partner. */
  it('names the agency in the Origin cell, with the kind under it', async () => {
    seedDeliveryBook();
    const view = await openList('superadmin');
    const cell = rowFor(view, FINE)!.querySelectorAll('td')[1];
    expect(cell.querySelector('.dt__name')!.textContent).toBe('Foxglove Residential');
    expect(cell.querySelector('.dt__sub')!.textContent).toBe('Agency');
    expect(cell.textContent).not.toMatch(/Opndoor/);
  });

  /* AND THE BRANCH CELL STOPS REPEATING IT. The agency used to sit under the
     branch; with the origin naming the same agency two columns along, that is
     the repetition this page takes whole columns off to avoid. */
  it('drops the agency line under the branch when the origin has just said it', async () => {
    seedDeliveryBook();
    const view = await openList('superadmin');
    const orgCell = rowFor(view, FINE)!.querySelectorAll('td')[3];
    expect(orgCell.textContent).toContain('Chelsea');
    expect(orgCell.querySelector('.dt__sub')).toBeNull();
  });
});

/* ONE FILTER OVER FOUR KINDS OF PARTY, and the two links that predate it.

   The book here is deliberately mixed, because the whole point of the column is
   that a list can hold rows from an agency, a supplier and a tenant who came to
   us directly, and the old pair of columns could not name all three. */
const A_FOX = 'GR-AG01';
const A_MARY = 'GR-AG02';
const A_SUPP = 'GR-SU01';
const A_DIRECT = 'GR-DI01';

function seedMixedBook(): void {
  hydrateApplications([
    row({ ref: A_FOX, tenant: 'Ada Lovelace' }),
    row({ ref: A_MARY, tenant: 'Grace Hopper', agency: 'Marylebone & Co', branch: 'Marylebone' }),
    row({ ref: A_SUPP, tenant: 'Alan Turing', partner: 'harbourside', agency: 'Cityscape Lettings', branch: 'City' }),
    // The direct rail hangs off a placeholder agency in the database, which is
    // exactly the kind of internal name that must never reach a screen.
    row({ ref: A_DIRECT, tenant: 'Katherine Johnson', partner: 'opndoor-direct', agency: 'Unattached', branch: 'Unattached' }),
  ], []);
}

/* Read off the tenant cell's own sub-line rather than out of the row's text: the
   Origin column sits right after it and textContent runs the two together. */
const refs = (v: View) => [...v.container.querySelectorAll('table.dt tbody tr')]
  .map((tr) => tr.querySelector('.who .dt__sub')?.textContent ?? '').filter(Boolean);
/* THE ORIGIN CONTROL IS NOW THE SHARED ScopePicker, a searchable combobox
   rather than a native select, so these drive it the way a person does:
   focus it, then click the row. Choosing by the LABEL a user reads rather
   than by the value underneath it also makes these assertions say what they
   mean. */
const originInput = (v: View) =>
  v.container.querySelector<HTMLInputElement>('.scopepick input[role="combobox"]')!;

function chooseOrigin(v: View, label: string) {
  const input = originInput(v);
  fireEvent.focus(input);
  const row = [...v.container.querySelectorAll('.typeahead__opt')]
    .find((o) => o.querySelector('.typeahead__opt-main')?.textContent === label);
  if (!row) {
    const seen = [...v.container.querySelectorAll('.typeahead__opt-main')].map((o) => o.textContent);
    throw new Error(`no origin option "${label}". Offered: ${seen.join(' | ')}`);
  }
  fireEvent.mouseDown(row);
}

describe('the Origin filter', () => {
  it('names all four kinds of party in the one column', async () => {
    seedMixedBook();
    const view = await openList('superadmin');
    const cellFor = (ref: string) => rowFor(view, ref)!.querySelectorAll('td')[1];
    expect(cellFor(A_FOX).querySelector('.dt__name')!.textContent).toBe('Foxglove Residential');
    expect(cellFor(A_SUPP).querySelector('.dt__name')!.textContent).toBe('Harbourside Homes');
    expect(cellFor(A_SUPP).querySelector('.dt__sub')!.textContent).toBe('Supplier');
    expect(cellFor(A_DIRECT).querySelector('.dt__name')!.textContent).toBe('Direct');
    // Never the placeholder the direct rail hangs off, and never the house
    // partner that carries it.
    expect(cellFor(A_DIRECT).textContent).not.toMatch(/Unattached|Opndoor/);
  });

  it('offers each party in the book once, and nothing the book has no rows from', async () => {
    seedMixedBook();
    const view = await openList('superadmin');
    fireEvent.focus(originInput(view));
    const labels = [...view.container.querySelectorAll('.typeahead__opt-main')].map((o) => o.textContent);
    expect(labels).toContain('Everything');
    expect(labels).toContain('Direct');
    expect(labels).toContain('Harbourside Homes');
    expect(labels).toContain('Foxglove Residential');
    expect(labels).toContain('Marylebone & Co');
    // Meridian is a supplier in the seed directory with no row in THIS book, and
    // a choice that selects nothing is a thing to read past.
    expect(labels).not.toContain('Meridian Lettings');
    // The agency rail's partner record is not a supplier, wherever it is listed.
    expect(labels).not.toContain('Northwind Property');
  });

  it('narrows the list to the party chosen', async () => {
    seedMixedBook();
    const view = await openList('superadmin');
    expect(refs(view)).toHaveLength(4);
    // Chosen by the label a person reads, which is what the picker offers.
    chooseOrigin(view, 'Marylebone & Co');
    expect(refs(view)).toEqual([A_MARY]);
    chooseOrigin(view, 'Harbourside Homes');
    expect(refs(view)).toEqual([A_SUPP]);
    chooseOrigin(view, 'Direct');
    expect(refs(view)).toEqual([A_DIRECT]);
    chooseOrigin(view, 'Everything');
    expect(refs(view)).toHaveLength(4);
  });

  /* THE LINKS THAT PREDATE THE CONTROL still have to land. Home's Direct tiles
     link with ?route= and a supplier's own page with ?partner=; both are
     translated rather than dropped, or the buttons that send people here would
     quietly start showing the whole book. */
  it('lands a ?route=Direct link on the Direct rows', async () => {
    seedMixedBook();
    const view = await openList('superadmin', '/applications?route=Direct');
    expect(refs(view)).toEqual([A_DIRECT]);
    expect(originInput(view).value).toBe('Direct');
  });

  it('lands a supplier page\'s ?partner= link on that supplier\'s rows', async () => {
    seedMixedBook();
    const view = await openList('superadmin', '/applications?partner=harbourside');
    expect(refs(view)).toEqual([A_SUPP]);
    expect(originInput(view).value).toBe('Harbourside Homes');
  });

  it('opens the whole book on a stale ?partner=, rather than an empty list', async () => {
    seedMixedBook();
    const view = await openList('superadmin', '/applications?partner=no-such-partner');
    expect(refs(view)).toHaveLength(4);
    expect(originInput(view).value).toBe('Everything');
  });
});

describe('delivery on the row', () => {
  it('says so on the row whose deed did not arrive, and only that row', async () => {
    seedDeliveryBook();
    const view = await openList('management');
    expect(rowFor(view, FAILED)!.querySelector('.delivery-tag')!.textContent).toBe('Delivery failed');
    expect(rowFor(view, FINE)!.querySelector('.delivery-tag')).toBeNull();
    // Every one of the three says "Deed Issued", which is why the badge had to
    // be there: the status cell alone cannot tell them apart.
    expect(rowFor(view, FAILED)!.querySelector('.status-cell')!.textContent).toMatch(/Deed Issued/);
  });

  it('keeps the ops state off the agency’s screen and on the admin’s', async () => {
    seedDeliveryBook();
    const asAgency = await openList('management');
    expect(rowFor(asAgency, HELD)!.querySelector('.delivery-tag')).toBeNull();
    cleanup();
    const asAdmin = await openList('superadmin');
    expect(rowFor(asAdmin, HELD)!.querySelector('.delivery-tag')!.textContent).toBe('Held for send');
  });

  it('shows a referrer their own failed delivery, because they can resend it', async () => {
    seedDeliveryBook();
    const view = await openList('referrer');
    expect(rowFor(view, FAILED)!.querySelector('.delivery-tag')!.textContent).toBe('Delivery failed');
    expect(rowFor(view, HELD)!.querySelector('.delivery-tag')).toBeNull();
  });
});

describe('the two delivery chips', () => {
  it('offers Delivery failed to the agency and Held for send to nobody but ops', async () => {
    seedDeliveryBook();
    const view = await openList('management');
    expect(tabs(view).some((t) => /Delivery failed/.test(t))).toBe(true);
    expect(tabs(view).some((t) => /Held for send/.test(t))).toBe(false);
  });

  it('offers both to an opndoor admin, each counting its own state', async () => {
    seedDeliveryBook();
    const view = await openList('superadmin');
    expect(tabs(view).find((t) => /Delivery failed/.test(t))).toMatch(/1$/);
    expect(tabs(view).find((t) => /Held for send/.test(t))).toMatch(/1$/);
  });

  it('shows a deep-linked chip even at zero, and refuses the ops one to an agency', async () => {
    // Nothing is held in the seed book, so these two chips are here on the
    // strength of the deep link alone: the filter is active and must be visible
    // to be cleared.
    const admin = await openList('superadmin', '/applications?deed=cannot-deliver');
    expect(tabs(admin).some((t) => /Held for send/.test(t))).toBe(true);
    cleanup();
    const agency = await openList('management', '/applications?deed=cannot-deliver');
    expect(tabs(agency).some((t) => /Held for send/.test(t))).toBe(false);
  });
});
