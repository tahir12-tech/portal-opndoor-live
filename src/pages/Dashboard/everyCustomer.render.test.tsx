/* WALK FIX 20, ON THE PAGE. EVERY CUSTOMER, SIDE BY SIDE.
 *
 * "Reporting for Opndoor admin should show volume broken down by partner:
 * every supplier and every agency, side by side (referrals sent, fees
 * collected, deeds issued, commission payable). Suppliers are currently
 * left out of the breakdowns entirely (Kestrel appears nowhere)."
 *
 * The rule is tested in src/data/byCustomer.test.ts. This is the page
 * showing it, and the two assertions that only a rendered page can make:
 * that the table is there for Opndoor and not for a customer, and that a
 * reader who may not see commission does not get the column.
 *
 * WHY THE OLD TABLE IS NOT REMOVED. "Commission by partner" answers a
 * different question -- what the split is -- and it is right about it. The
 * fault was that nothing answered "how is each customer doing", and a
 * partner-grouped table cannot: on the agency rail every agency of ours is
 * carried by one house partner.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { Dashboard } from './Dashboard';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { hydrateCommissionVisibility } from '@/data';
import { CustomersTable } from '@/components/CustomersTable';

const D = (y: number, m: number, d: number) => new Date(y, m, d);

const app = (over: Partial<FullApp>): FullApp => ({
  ref: 'GR-EC-1', partner: 'opndoor-agents', agency: 'Regent’s Lettings',
  branch: "Regent's Park", agencyId: 'ag-1', branchId: 'br-1',
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

/* An agency and a supplier, which is the whole point of the item: they
   have to appear side by side, and the supplier is the one that did not
   appear at all. */
const BOOK = [
  app({ ref: 'GR-AG', agency: 'Regent’s Lettings' }),
  app({ ref: 'GR-SUP', partner: 'harbourside', agency: 'Harbourside Homes' }),
];

beforeEach(() => { localStorage.clear(); hydrateFull(BOOK); hydrateCommissionVisibility(true); });
afterEach(() => { cleanup(); hydrateFull([]); hydrateCommissionVisibility(true); });

async function openReporting(role: string) {
  localStorage.setItem('grp_role', role);
  const view = render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <ToastProvider><SessionProvider><PageMetaProvider><Dashboard /></PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.page-head')) throw new Error('not ready'); });
  await act(async () => {});
  return view;
}

type View = Awaited<ReturnType<typeof openReporting>>;
const table = (v: View) => v.container.querySelector('.custtab');
const customerNames = (v: View) =>
  [...(table(v)?.querySelectorAll('tbody tr td:first-child a') ?? [])].map((a) => a.textContent ?? '');
const headers = (v: View) =>
  [...(table(v)?.querySelectorAll('thead th') ?? [])].map((th) => th.textContent ?? '');

describe('an Opndoor admin', () => {
  it('gets a table of every customer', async () => {
    const v = await openReporting('superadmin');
    expect(table(v), 'no per-customer table on the page').toBeTruthy();
  });

  /* THE DEFECT, AS REPORTED: the supplier appeared nowhere, because the
     only breakdown grouped by partner and the agency rail is one partner. */
  it('with the supplier and the agency side by side', async () => {
    const v = await openReporting('superadmin');
    expect(customerNames(v).sort()).toEqual(['Harbourside Homes', 'Regent’s Lettings']);
  });

  it('and Matt’s four measures as the columns', async () => {
    const v = await openReporting('superadmin');
    expect(headers(v)).toEqual([
      'Customer', 'Referrals sent', 'Fees collected', 'Deeds issued', 'Commission payable',
    ]);
  });

  /* AND EACH NAME OPENS THAT CUSTOMER'S OWN PAGE, which is where item 15
     puts the rest of their report. A name that cannot be clicked is a
     lookup exercise. */
  it('and each name opens that customer’s own page', async () => {
    const v = await openReporting('superadmin');
    const links = [...(table(v)?.querySelectorAll('tbody a') ?? [])]
      .map((a) => a.getAttribute('href') ?? '');
    expect(links.some((h) => h.startsWith('/partners/'))).toBe(true);
    expect(links.some((h) => h.startsWith('/agencies/'))).toBe(true);
  });
});

describe('a customer reading their own Reporting', () => {
  /* NM-F, verbatim: "the per-customer Reporting tab is Opndoor-only;
     agencies and suppliers keep their own Reporting page as it is." A
     customer has one customer to look at, and a list of the others is
     somebody else's book. */
  it('does not get the table at all', async () => {
    const v = await openReporting('management');
    expect(table(v)).toBeNull();
  });
});

describe('commission payable is a commission figure', () => {
  /* THE COLUMN IS DROPPED, NOT ZEROED. A column of £0.00 reads as "they are
     owed nothing", which is a different statement and a false one.

     ASSERTED ON THE COMPONENT, NOT THE PAGE, and the reason is a defect
     found while trying to write it the other way. The only Opndoor reader
     who may NOT see commission is an `opndoor_manager`, and
     `paymentMetrics.scopeFull` has a positive allowlist naming only
     'referrer', 'superadmin' and 'management' -- so an opndoor_manager is
     handed an EMPTY set and every live figure on their Reporting page is
     blank. The role was added later (20260922090000) and that allowlist
     was never widened.

     So the page-level version of this assertion cannot be written today:
     the table is absent for that reader for an unrelated reason, and a
     test asserting "no commission column" would pass on an absent table.
     Recorded for Matt rather than fixed here -- it is not in the queue and
     no walk item reports it. */
  it('so a reader who may not see commission gets no such column', () => {
    const rows = [{ key: 'agency:A', name: 'A', kind: 'agency' as const, sent: 1, fees: 10, deeds: 1, payable: 5 }];
    cleanup();
    const v = render(<MemoryRouter><CustomersTable rows={rows} seesCommission={false} /></MemoryRouter>);
    const th = [...v.container.querySelectorAll('thead th')].map((x) => x.textContent ?? '');
    expect(th).not.toContain('Commission payable');
    expect(th).toContain('Referrals sent');
  });

  it('and does get it when they may', () => {
    const rows = [{ key: 'agency:A', name: 'A', kind: 'agency' as const, sent: 1, fees: 10, deeds: 1, payable: 5 }];
    cleanup();
    const v = render(<MemoryRouter><CustomersTable rows={rows} seesCommission /></MemoryRouter>);
    expect([...v.container.querySelectorAll('thead th')].map((x) => x.textContent ?? ''))
      .toContain('Commission payable');
  });
});
