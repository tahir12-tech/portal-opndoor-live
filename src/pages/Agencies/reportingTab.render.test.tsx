/* WALK FIX 15. A REPORT PER CUSTOMER, ON THAT CUSTOMER'S OWN PAGE.
 *
 * Item 15: "Matt finds the picker confusing as hell. What he wants is to
 * see the reports for each customer: each supplier and each agency. Don't
 * build a fix to the picker; write a short proposal under 'Needs Matt'."
 *
 * NM-F, Matt's answer: "yes to both halves. The per-customer Reporting tab
 * is Opndoor-only; agencies and suppliers keep their own Reporting page as
 * it is."
 *
 * THIS IS THE TAB THE PICKER IS REPLACED BY, and it is built before the
 * picker is removed rather than after. Same order as the notifications
 * panel: the replacement exists, then the thing it replaces goes. The
 * deletion and the "view as" assertions that move with it are the next
 * commit.
 *
 * THE FOUR MEASURES COME FROM THE SAME FUNCTION as the estate-wide table,
 * which is the point of CustomerReport taking rows rather than computing
 * its own: a customer's own page and the table that lists them cannot
 * disagree about their numbers.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { AgencyHome } from './AgencyHome';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { hydrateCommissionVisibility, getAgencies, ALL_PARTNERS } from '@/data';

const D = (y: number, m: number, d: number) => new Date(y, m, d);

/** The first agency in the mock book, so the route resolves to a real one. */
const AGENCY = getAgencies(ALL_PARTNERS).filter((a) => !a.isPlaceholder)[0];

const app = (over: Partial<FullApp>): FullApp => ({
  ref: 'GR-RT-1', partner: 'opndoor-agents', agency: AGENCY?.name ?? 'Foxglove Residential',
  branch: 'Chelsea', agencyId: AGENCY?.id, branchId: 'br-1',
  referrer: 'Tom Reeve', referrerId: 'u-tom', referrerRole: 'referrer',
  referrerSeesCommission: false, owner: 1,
  rent: 2000, fee: 2000, agentRate: 0.25, partnerRate: 0.25,
  status: 'deed', deedState: 'executed',
  sentAt: D(2026, 3, 10), paidAt: D(2026, 3, 20), deedAt: D(2026, 4, 1),
  tenancyStart: D(2026, 4, 2), expiry: D(2027, 4, 1),
  refunded: false, partiallyRefunded: false, withdrawn: false, expired: false,
  refundedAt: null, refundedAmount: null, refundAfterStart: false,
  deedSentAt: null, deedViewedAt: null,
  ...over,
} as unknown as FullApp);

beforeEach(() => {
  localStorage.clear();
  hydrateFull([app({ ref: 'A' }), app({ ref: 'B' })]);
  hydrateCommissionVisibility(true);
});
afterEach(() => { cleanup(); hydrateFull([]); hydrateCommissionVisibility(true); });

async function openAgency(role: string) {
  localStorage.setItem('grp_role', role);
  const view = render(
    <MemoryRouter initialEntries={[`/agencies/${encodeURIComponent(AGENCY.name)}`]}>
      <ToastProvider><SessionProvider><PageMetaProvider>
        <Routes><Route path="/agencies/:key" element={<AgencyHome />} /></Routes>
      </PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('[role="tab"]')) throw new Error('no tabs'); });
  await act(async () => {});
  return view;
}

type View = Awaited<ReturnType<typeof openAgency>>;
const tabNames = (v: View) =>
  [...v.container.querySelectorAll('[role="tab"]')].map((b) => (b.textContent ?? '').trim());
async function openTab(v: View, name: string) {
  const b = [...v.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find((x) => (x.textContent ?? '').trim() === name);
  expect(b, `no ${name} tab. Have: ${tabNames(v).join(', ')}`).toBeTruthy();
  await act(async () => { fireEvent.click(b!); });
}
const tiles = (v: View) =>
  [...v.container.querySelectorAll('.custrep__tile')].map((t) => (t.querySelector('.custrep__l')?.textContent ?? ''));

describe('an Opndoor admin on an agency page', () => {
  it('is offered a Reporting tab', async () => {
    const v = await openAgency('superadmin');
    expect(tabNames(v)).toContain('Reporting');
  });

  it('and it shows Opndoor’s four measures for that customer', async () => {
    const v = await openAgency('superadmin');
    await openTab(v, 'Reporting');
    expect(tiles(v)).toEqual(['Referrals sent', 'Fees collected', 'Deeds issued', 'Commission payable']);
  });

  /* THE NUMBERS ARE THAT CUSTOMER'S, not the estate's. Two applications
     were hydrated against this agency, so the count is a real check and not
     a "some number is present" one. */
  it('and the numbers are that customer’s own', async () => {
    const v = await openAgency('superadmin');
    await openTab(v, 'Reporting');
    const values = [...v.container.querySelectorAll('.custrep__tile')]
      .map((t) => t.querySelector('.custrep__v')?.textContent ?? '');
    expect(values[0]).toBe('2');
  });

  /* AND IT CAN BE ASKED ABOUT A DIFFERENT PERIOD, which is most of what
     makes it a report rather than a tile. */
  it('and carries its own period control', async () => {
    const v = await openAgency('superadmin');
    await openTab(v, 'Reporting');
    expect(v.container.querySelector('select[aria-label="Report period"]')).toBeTruthy();
  });
});

describe('the agency’s own people', () => {
  /* NM-F, verbatim: "the per-customer Reporting tab is Opndoor-only;
     agencies and suppliers keep their own Reporting page as it is." Unlike
     the supplier page, this route is reachable by an agency's own
     management, so the gate is doing real work here. */
  it('are not offered the tab at all', async () => {
    const v = await openAgency('management');
    expect(tabNames(v)).not.toContain('Reporting');
  });
});
