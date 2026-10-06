/* THE ADMIN REPORTING COPY FIXES, 2026-09-30.
 *
 * Matt, verbatim: "Admin Reporting fixes: remove 'All partners' from the
 * page header. Direct signups never appear in Volume by branch, Volume by
 * agency or any agency chart (no 'Unattached' row); this answers Q3.
 * Rename 'Commission by partner' to 'Commission by route' and replace
 * 'Partner' wording in it with 'Supplier' or 'Route' as appropriate. On
 * the admin view, retitle 'Your commission' to 'Commission owed'. Update
 * the bordereau description to say it lists guarantees in force during
 * the month."
 *
 * FOUR OF THE FIVE ARE COPY, AND COPY IS WHERE A RENDER TEST EARNS ITS
 * KEEP: each of these is a string that was true once and stopped being
 * true, and nothing in a type or a query notices that. Q3 is the one with
 * teeth and is asserted in directIsNobodysAgency.test.ts, against the
 * function rather than the page.
 *
 * "COMMISSION OWED" IS ADMIN-ONLY, which is the half worth protecting.
 * A Director still reads "Your commission" about their own money, because
 * for them it is exactly that. Retitling both would tell an agency that
 * Opndoor owes them a figure they are already owed.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const flags = vi.hoisted(() => ({ live: true }));
vi.mock('@/lib/supabase', () => ({
  get SUPABASE_ENABLED() { return flags.live; },
  supabase: null,
  sb: () => { throw new Error('This test runs with no Supabase client.'); },
}));

import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { Dashboard } from './Dashboard';

afterAll(() => hydrateFull([]));

const AGENCY = 'northwind';

const PAID: FullApp[] = [{
  ref: 'GR-COPY-1', tenant: 'C Tenant', prop: '1 Copy Street', branch: 'North Office',
  agency: 'Northwind Lettings', ben: '', rent: 1200, status: 'paid',
  date: '2026-09-02', eventTs: '2026-09-02T10:00:00Z', owner: 1, partner: AGENCY,
} as unknown as FullApp];

beforeEach(() => {
  flags.live = true;
  localStorage.clear();
  hydrateFull(PAID);
});
afterEach(() => cleanup());

async function open(role: string) {
  localStorage.setItem('grp_role', role);
  const view = render(
    <MemoryRouter initialEntries={['/']}>
      <SessionProvider><ToastProvider><PageMetaProvider><Dashboard /></PageMetaProvider></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.herorow')) throw new Error('not ready'); });
  return view;
}
type View = Awaited<ReturnType<typeof open>>;
const text = (v: View) => v.container.textContent ?? '';

describe('the page header', () => {
  /* "All partners" said only that nothing was filtered, which the reader
     can already see. The label earns its place when it names the one
     party the page has been narrowed to. */
  it('no longer says "All partners" when nothing is narrowed', async () => {
    const v = await open('superadmin');
    expect(text(v)).not.toMatch(/All partners/);
  });

  it('and still says what it is', async () => {
    const v = await open('superadmin');
    expect(text(v)).toMatch(/Performance/);
  });
});

describe('the commission table', () => {
  it('is Commission by route, because the rows are routes and one is the house', async () => {
    const v = await open('superadmin');
    expect(text(v)).toMatch(/Commission by route/);
    expect(text(v)).not.toMatch(/Commission by partner/);
  });

  /* The money in it is a SUPPLIER's cut, so the column says supplier.
     "Partner comm" read as though the house route were a customer. */
  it('and its money columns say supplier, not partner', async () => {
    const v = await open('superadmin');
    expect(text(v)).toMatch(/Supplier comm/);
    expect(text(v)).not.toMatch(/Partner comm/);
  });
});

describe('the commission statement heading', () => {
  it('reads "Commission owed" for Opndoor, who are owed nothing and owe it', async () => {
    const v = await open('superadmin');
    expect(text(v)).toMatch(/Commission owed/);
    expect(text(v)).not.toMatch(/Your commission/);
  });

  /* THE HALF THAT MUST NOT MOVE WITH IT. */
  it('and stays "Your commission" for a Director reading their own', async () => {
    const v = await open('management');
    expect(text(v)).toMatch(/Your commission/);
    expect(text(v)).not.toMatch(/Commission owed/);
  });
});

describe('the Net fees description', () => {
  /* THE DENOMINATOR DID NOT PRODUCE THE NUMERATOR. Matt, 2026-09-30: "it
     currently says fees were collected 'across 5 issued deeds' when they
     came from all paid referrals." A referral pays BEFORE its deed is
     issued, and some paid referrals never get one, so a reader dividing
     the figure by that count got a fee per referral that is not one. */
  it('counts paid referrals, which is where the money came from', async () => {
    const v = await open('superadmin');
    expect(text(v)).toMatch(/paid referral/);
  });

  it('and no longer counts issued deeds, which is a different and smaller set', async () => {
    const v = await open('superadmin');
    expect(text(v)).not.toMatch(/fees collected across .{0,12} issued deed/);
  });
});

describe('the bordereau', () => {
  /* The description said "by tenancy start date", which is the behaviour
     that was FIXED: asking when cover was WRITTEN meant a guarantee still
     running from an earlier month appeared on no bordereau at all. The
     copy was describing the bug. */
  it('says it lists cover in force during the month, which is what it does', async () => {
    const v = await open('superadmin');
    expect(text(v)).toMatch(/in force during the month/);
    expect(text(v)).not.toMatch(/for one calendar month by tenancy start date/);
  });
});
