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
import { cleanup, render, waitFor } from '@testing-library/react';
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
const chips = (v: View) => [...v.container.querySelectorAll('.fchip select')].map((s) => s.getAttribute('aria-label') ?? '');
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
    // What is left still has to be a list of applications.
    expect(headers(view)).toEqual(expect.arrayContaining(['Tenant', 'Property', 'Status', 'Date']));
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

  it('leaves an opndoor admin across every partner exactly as it was', async () => {
    const view = await openList('superadmin');
    expect(headers(view)).toEqual(expect.arrayContaining(['Tenant', 'Route', 'Partner', 'Property', 'Branch', 'Status']));
    expect(chips(view)).toEqual(expect.arrayContaining(['Agency:', 'Branch:', 'Route:', 'Referrer:']));
    expect(view.container.querySelector('.page-head__sub')!.textContent)
      .toMatch(/Filter by status, agency or branch, or search by tenant\./);
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
