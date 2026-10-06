/* THE WARNING IS FOR THE SUPPLIER SIDE, AND SAYS WHAT IS MISSING.
 *
 * Matt, 2026-10-02: "For supplier-estate agencies with no agency email,
 * show a clear warning on the supplier's Agencies tab and list them on
 * Reconciliation so Opndoor can add one. No warnings for Opndoor's own
 * agencies without an email."
 *
 * TWO SCREENS, BECAUSE "the supplier's Agencies tab" is two things
 * depending on who is looking: the Agencies tab on that supplier's page,
 * which is where Opndoor sees it, and the supplier's own Agencies screen.
 * Both read `agencyContactState`, so this file renders the first and
 * checks the second stays silent about ours. The predicate itself is in
 * src/data/theDeedWarningFollowsTheBranch.test.ts and the Reconciliation
 * list is asserted in SQL.
 *
 * WHY THE WORDS MATTER. The warning this replaces said "No agent contact.
 * A deed cannot be issued" on an agency whose every office had a working
 * address, which is the complaint Matt raised the day before. The new one
 * is reported on that same shape, so if it kept the old sentence it would
 * be the same false alarm with a new trigger. It says "No agency email",
 * and then which of the two cases it is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { App } from '@/App';
import { hydrateOrg, hydrateGroups } from '@/data/orgService';
import { hydratePartners } from '@/data/partnersService';
import * as users from '@/data/usersService';
import type { Agency, Partner } from '@/data/types';
import { PartnerHome } from '@/pages/PartnerManagement/PartnerHome';

const SUPPLIER = 'zzz-rightmove';

const PARTNERS = [
  { id: SUPPLIER, name: 'ZZZ Rightmove', status: 'active', since: '2026-01-01',
    weight: 1, users: 1, apps: 2, referencingMode: 'pre_referenced_open',
    partnerRate: 0.25, agentRate: 0.1, primary: false, kind: 'supplier' },
] as unknown as Partner[];

const contact = (email: string) => ({ id: `c-${email}`, name: 'Desk', email, primary: true });

const AGENCIES = [
  /* A SUPPLIER'S AGENCY WITH NOTHING ANYWHERE: the sharp end. */
  { id: 'ag-bare', partner: SUPPLIER, name: 'ZZZ Bare Agents', users: 0, referrals: 0,
    guaranteed: '£0', fees: 0, contacts: [],
    branches: [{ id: 'b-bare', name: 'ZZZ Bare Office', referrals: 0, guaranteed: '£0', contacts: [] }] },
  /* AND THE QUIET ONE: no agency address, every office with its own. This
     is Kestrel's shape on dev, and the row must not cry that a deed is
     stranded when none is. */
  { id: 'ag-per', partner: SUPPLIER, name: 'ZZZ Per Office Agents', users: 0, referrals: 0,
    guaranteed: '£0', fees: 0, contacts: [],
    branches: [{ id: 'b-per', name: 'ZZZ Per Office', referrals: 0, guaranteed: '£0', contacts: [contact('office@zzz.test')] }] },
  /* ONE OF OURS WITH NOTHING AT ALL, which must be silent everywhere. */
  { id: 'ag-ours', partner: 'opndoor-agents', name: "ZZZ Regent's", users: 2, referrals: 3,
    guaranteed: '£0', fees: 0, contacts: [],
    branches: [{ id: 'b-ours', name: "ZZZ Regent's Park", referrals: 0, guaranteed: '£0', contacts: [] }] },
] as unknown as Agency[];

beforeEach(() => {
  sessionStorage.clear();
  localStorage.setItem('grp_role', 'superadmin');
  hydrateGroups([]);
  hydratePartners(PARTNERS);
  hydrateOrg(AGENCIES);
  vi.spyOn(users, 'getUsers').mockReturnValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function openSupplierAgencies() {
  const view = render(
    <MemoryRouter initialEntries={[`/partners/${SUPPLIER}`]}>
      <ToastProvider><SessionProvider><PageMetaProvider>
        <Routes><Route path="/partners/:key" element={<PartnerHome />} /></Routes>
      </PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('[role="tablist"]')) throw new Error('no tabs'); });
  const tab = [...view.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find((b) => (b.textContent ?? '').trim() === 'Agencies');
  if (!tab) throw new Error('no Agencies tab');
  await act(async () => { fireEvent.click(tab); });
  return view;
}

describe('the supplier’s Agencies tab', () => {
  it('says what is missing, not that a deed cannot be issued', async () => {
    const { container } = await openSupplierAgencies();
    const text = container.textContent ?? '';
    expect(text).toContain('No agency email');
    // The old sentence, which was the false alarm on this very shape.
    expect(text).not.toContain('No agent contact on');
  });

  it('and distinguishes the stranded case from the quiet one', async () => {
    const { container } = await openSupplierAgencies();
    const text = container.textContent ?? '';
    expect(text).toContain('1 of 1 branch cannot be sent a deed');
    expect(text).toContain('nothing stranded today, but the next office would inherit nothing');
  });

  it('and still prints an address where the agency has one', async () => {
    hydrateOrg([{
      id: 'ag-has', partner: SUPPLIER, name: 'ZZZ Has An Email', users: 0, referrals: 0,
      guaranteed: '£0', fees: 0, contacts: [contact('head@zzz.test')],
      branches: [{ id: 'b-has', name: 'ZZZ Office', referrals: 0, guaranteed: '£0', contacts: [] }],
    }] as unknown as Agency[]);
    const { container } = await openSupplierAgencies();
    const text = container.textContent ?? '';
    expect(text).toContain('head@zzz.test');
    expect(text).not.toContain('No agency email');
  });
});

describe('admin’s own Agencies screen', () => {
  async function openOurs() {
    const view = render(
      <MemoryRouter initialEntries={['/agencies']}>
        <SessionProvider><ToastProvider><App /></ToastProvider></SessionProvider>
      </MemoryRouter>,
    );
    await waitFor(() => { if (!view.container.querySelector('.org')) throw new Error('tree not ready'); });
    return view;
  }

  /* IT CARRIES OPNDOOR'S OWN ESTATE ONLY, since the separate-estates
     change, so the only agency it can warn about is one of ours -- and it
     must not. A bare Regent is the case: no contact on the agency, none
     on its office. */
  it('says nothing about one of ours with no email anywhere', async () => {
    const { container } = await openOurs();
    const text = container.textContent ?? '';
    expect(text).toContain("ZZZ Regent's");
    expect(text).not.toContain('No agency email');
    expect(text).not.toContain('No agent contact');
    expect(text).not.toContain('cannot issue a deed');
  });
});
