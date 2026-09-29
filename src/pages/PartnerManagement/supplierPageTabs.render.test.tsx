/* THE SUPPLIER PAGE MIRRORS THE AGENCY PAGE.
 *
 * Q-06 item A: "Supplier detail page mirrors the agency page: tabs Overview
 * ... People ... Commission ... Referrals, and Integration ... Regent's
 * agency page is the template."
 *
 * It was four flat cards in document order, so an admin scrolled past the
 * commission rates to reach the people, the People table was read-only with
 * no row actions at all, there was no Referrals tab of any kind, and the
 * Overview said nothing about who a deed would actually reach.
 *
 * WHAT IS DELIBERATELY NOT HERE. The Commission tab shows today's two rate
 * figures and today's read-only form; the EDITOR's shape is NM-C questions 3
 * and 4 and is not mine to decide. And "Manage" still exists on the
 * suppliers list, because the same modal is the only way to CREATE a
 * supplier -- deleting it without separating those two is how the Add button
 * stops working.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { hydratePartners } from '@/data/partnersService';
import { hydrateOrg } from '@/data/orgService';
import * as users from '@/data/usersService';
import type { ManagedUser } from '@/data/usersService';
import type { Partner } from '@/data/types';
import { PartnerHome } from './PartnerHome';

const SUPPLIER = 'zzz-supplier';

const PARTNERS = [{
  id: SUPPLIER, name: 'ZZZ Supplier Co', status: 'active', since: '2026-01-01',
  weight: 1, users: 1, apps: 3,
  referencingMode: 'pre_referenced_open', partnerRate: 0.25, agentRate: 0.1,
  apiAccessEnabled: true, portalReferralsEnabled: true, primary: false,
}] as unknown as Partner[];

/* One agency WITH a contact and one WITHOUT, because the useful half of the
   Overview change is the second: a supplier agency with nowhere to send an
   executed deed said nothing at all before. */
const ORG = [
  { id: 'ag-with', partner: SUPPLIER, name: 'ZZZ With Contact', referrals: 3, guaranteed: '0',
    contacts: [{ id: 'c1', name: 'Ada Contact', email: 'ada@zzz.test', primary: true }],
    branches: [{ id: 'br-1', name: 'ZZZ Office', referrals: 3, guaranteed: '0' }] },
  { id: 'ag-none', partner: SUPPLIER, name: 'ZZZ No Contact', referrals: 0, guaranteed: '0',
    branches: [] },
] as never[];

const PEOPLE: ManagedUser[] = [
  { id: 'u-1', name: 'Sam Supplier', email: 'sam@zzz.test', role: 'management',
    seesCommission: false, partner: SUPPLIER, status: 'active', lastActive: 'today' },
] as unknown as ManagedUser[];

beforeEach(() => {
  localStorage.setItem('grp_role', 'superadmin');
  hydratePartners(PARTNERS);
  hydrateOrg(ORG);
  vi.spyOn(users, 'getUsers').mockReturnValue(PEOPLE);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function open() {
  const view = render(
    <MemoryRouter initialEntries={[`/partners/${SUPPLIER}`]}>
      <ToastProvider><SessionProvider><PageMetaProvider>
        {/* Through a Route, because the page reads its subject from
            useParams; mounted bare it finds no key and renders not-found. */}
        <Routes><Route path="/partners/:key" element={<PartnerHome />} /></Routes>
      </PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('[role="tablist"]')) throw new Error('no tabs'); });
  await act(async () => {});
  return view;
}

type View = Awaited<ReturnType<typeof open>>;
const tabNames = (v: View) =>
  [...v.container.querySelectorAll('[role="tab"]')].map((b) => (b.textContent ?? '').trim());
async function openTab(v: View, name: string) {
  const b = [...v.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find((x) => (x.textContent ?? '').trim() === name);
  if (!b) throw new Error(`no ${name} tab. Have: ${tabNames(v).join(', ')}`);
  await act(async () => { fireEvent.click(b); });
}

describe('the supplier detail page', () => {
  it('has the five tabs the agency page has', async () => {
    const v = await open();
    expect(tabNames(v)).toEqual(['Overview', 'People', 'Commission', 'Referrals', 'Integration']);
  });

  it('opens on Overview, and does not show the commission rates until asked', async () => {
    const v = await open();
    // The rates were the first card on the page. A reader looking for the
    // people scrolled past what a supplier earns to reach them.
    expect(v.container.textContent).not.toMatch(/snapshotted onto each referral/);
  });
});

describe('the Overview tab', () => {
  it('says who an executed deed would actually reach', async () => {
    const v = await open();
    expect(v.container.textContent).toMatch(/ada@zzz\.test/);
  });

  /* THE HALF THAT MATTERS. */
  it('and says so plainly where there is nobody, which it did not before', async () => {
    const v = await open();
    expect(v.container.textContent).toMatch(/No agent contact/);
  });
});

describe('the People tab', () => {
  it('carries the same row actions as the agency page, rather than being read-only', async () => {
    const v = await open();
    await openTab(v, 'People');
    const acts = v.container.querySelector('.ah-rowacts');
    expect(acts, 'no row actions on the supplier People tab').toBeTruthy();
    const labels = [...acts!.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('Send password reset');
    expect(labels).toContain('Remove access');
  });

  it('and says "Change role", not "Change level", because this rail has no levels', async () => {
    const v = await open();
    await openTab(v, 'People');
    const labels = [...v.container.querySelectorAll('.ah-rowacts button')].map((b) => b.textContent);
    expect(labels).toContain('Change role');
    expect(labels).not.toContain('Change level');
  });

  it('and offers no Position, because positions are an agency-estate thing', async () => {
    const v = await open();
    await openTab(v, 'People');
    const labels = [...v.container.querySelectorAll('.ah-rowacts button')].map((b) => b.textContent);
    expect(labels).not.toContain('Position');
  });
});

describe('the Referrals tab', () => {
  it('exists at all, which it did not', async () => {
    const v = await open();
    await openTab(v, 'Referrals');
    expect(v.container.textContent).toMatch(/Referrals/);
  });
});

describe('the Integration tab', () => {
  it('holds the API access card, and no longer points at a Manage page', async () => {
    const v = await open();
    await openTab(v, 'Integration');
    expect(v.container.textContent).toMatch(/API access/);
    // Two dead pointers told the reader to go somewhere item A removes.
    expect(v.container.textContent).not.toMatch(/Manage on the Suppliers list/);
  });
});
