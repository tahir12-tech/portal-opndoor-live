/* WHAT THE TWO ADMIN SCREENS SHOW WHEN ONE COMPANY IS IN BOTH ESTATES.
 *
 * Matt, 2026-10-01: "Admin's Agencies tab lists only these [Opndoor's own
 * clients] ... [a supplier's agencies] appear in an 'Agencies' tab on that
 * supplier's page, not in admin's main Agencies tab ... The same real
 * company can exist in both estates (Frost as Opndoor's client and Frost
 * under Rightmove). They are two separate records that never link, share
 * nothing, and never show each other's data."
 *
 * The fixture is the one that is on dev: a "Frost Partnership" in each
 * estate, deliberately identical in name and told apart only by their
 * branches. If a screen ever reads an agency by name alone, the wrong
 * branches appear under it and these fail.
 *
 * WHAT IS ASSERTED ELSEWHERE. The rules behind the two lists, and the
 * estate separation in the data, are in src/data/twoEstatesNeverMeet.test.ts
 * and supabase/tests/two_estates_never_meet.test.sql. This file is the
 * screens: what an admin actually sees on each of them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { hydrateOrg, hydrateGroups } from '@/data/orgService';
import { hydratePartners } from '@/data/partnersService';
import * as users from '@/data/usersService';
import type { Agency, Partner } from '@/data/types';
import { App } from '@/App';
import { PartnerHome } from '@/pages/PartnerManagement/PartnerHome';

/** The house partner every agency of Opndoor's own hangs off. */
const OURS = 'opndoor-agents';
/** The supplier, standing in for Rightmove. */
const THEIRS = 'zzz-rightmove';

const PARTNERS = [
  { id: THEIRS, name: 'ZZZ Rightmove', status: 'active', since: '2026-01-01',
    weight: 1, users: 1, apps: 2, referencingMode: 'pre_referenced_open',
    partnerRate: 0.25, agentRate: 0.1, primary: false },
] as unknown as Partner[];

/* ONE NAME, TWO RECORDS, DIFFERENT OFFICES. The offices are the tell: a
   screen that resolved the agency by name would draw the other estate's. */
const AGENCIES = [
  { id: 'ag-ours', partner: OURS, name: 'Frost Partnership',
    users: 1, referrals: 1, guaranteed: '£0', fees: 0,
    branches: [{ id: 'br-ours', name: 'Frost Mayfair', area: 'W1K', referrers: 1, referrals: 1, guaranteed: '£0', fees: 0 }] },
  { id: 'ag-theirs', partner: THEIRS, name: 'Frost Partnership',
    users: 0, referrals: 1, guaranteed: '£0', fees: 0,
    contacts: [{ id: 'c-theirs', name: 'Frost via Rightmove', email: 'mayfair@frost-via-rightmove.test', primary: true }],
    branches: [
      { id: 'br-theirs-1', name: 'Frost Soho', area: 'W1D', referrers: 0, referrals: 1, guaranteed: '£0', fees: 0 },
      { id: 'br-theirs-2', name: 'Frost Chelsea', area: 'SW3', referrers: 0, referrals: 0, guaranteed: '£0', fees: 0 },
    ] },
  // One agency of ours that is nobody's namesake, so "Frost appears once"
  // is a filter result and not an empty list with one row left in it.
  { id: 'ag-regent', partner: OURS, name: "Regent's Lettings",
    users: 3, referrals: 5, guaranteed: '£0', fees: 0,
    branches: [{ id: 'br-regent', name: "Regent's Park", area: 'NW1', referrers: 2, referrals: 5, guaranteed: '£0', fees: 0 }] },
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

/* ---------------------------------------------------------------------- */
/* SCREEN 1: admin's own Agencies list                                     */
/* ---------------------------------------------------------------------- */
async function openAgencies() {
  const view = render(
    <MemoryRouter initialEntries={['/agencies']}>
      <SessionProvider><ToastProvider><App /></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.org')) throw new Error('tree not ready'); });
  return view;
}
/** Scoped to the tree: the page also carries banners that name agencies. */
const tree = (c: HTMLElement) => c.querySelector('.org')?.textContent ?? '';

describe('admin’s Agencies list is Opndoor’s own estate', () => {
  it('shows Frost once, and shows the one that is ours', async () => {
    const { container } = await openAgencies();
    const t = tree(container);
    expect(t).toContain('Frost Partnership');
    expect(t.match(/Frost Partnership/g)).toHaveLength(1);
    // Ours has one office; the other estate's has two. A screen reading by
    // name alone would say "2 branches" on this row.
    expect(t).toContain("Regent's Lettings");
  });

  it('and nothing from the supplier’s estate is on it', async () => {
    const { container } = await openAgencies();
    const t = tree(container);
    expect(t).not.toContain('Frost Soho');
    expect(t).not.toContain('Frost Chelsea');
  });
});

/* ---------------------------------------------------------------------- */
/* SCREEN 2: the supplier's own page, Agencies tab                         */
/* ---------------------------------------------------------------------- */
async function openSupplier() {
  const view = render(
    <MemoryRouter initialEntries={[`/partners/${THEIRS}`]}>
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

describe('the supplier’s page carries the supplier’s estate', () => {
  it('its Agencies tab shows its own Frost, with its own offices', async () => {
    const { container } = await openSupplier();
    const text = container.textContent ?? '';
    expect(text).toContain('Frost Partnership');
    expect(text).toContain('Frost Soho');
    expect(text).toContain('Frost Chelsea');
  });

  it('and not the Frost that is Opndoor’s own client', async () => {
    const { container } = await openSupplier();
    const text = container.textContent ?? '';
    expect(text).not.toContain('Frost Mayfair');
    expect(text).not.toContain("Regent's Lettings");
  });
});
