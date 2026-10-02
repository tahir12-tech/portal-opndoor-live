/* THE SUPPLIER PAGE'S FOUR, 2026-10-02.
 *
 * Matt:
 *   1. "Overview tab is blank. Give it a short summary: the commission
 *      deal in one line (as on the Commission tab), who gets the
 *      statements, any warnings (e.g. an agency with no agency email,
 *      linking to it), and the supplier's Recent changes."
 *   2. "fix 'Kestrel Lettings's agencies' to 'Kestrel Lettings'
 *      agencies' (use the shared possessive helper everywhere)."
 *   3. "next to 'No agency email', an 'Add email' button that sets the
 *      agency's email in place, with a confirmation, recorded in Recent
 *      changes."
 *   4. "the '-' after each branch name is an empty address. Show the
 *      branch address when there is one, and nothing when there isn't."
 *
 * ITEM 1 WAS LITERAL. There was no `tab === 'overview'` branch at all,
 * so the tab everybody lands on drew nothing. The cases below check the
 * four things are each there, not how they are laid out.
 *
 * ITEM 4 WAS NOT A RENDER BUG. `hydrate.ts` mapped a null address to
 * the string "-", which is truthy, so every `b.area &&` guard printed
 * it. The dash belonged to one table cell and was applied to the field.
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
import { PartnerHome } from './PartnerHome';

/* A NAME ENDING IN S, because that is the whole of item 2. */
const SUPPLIER = 'zzz-kestrel-lettings';

const PARTNERS = [
  { id: SUPPLIER, name: 'Kestrel Lettings', status: 'active', since: '2026-01-01',
    weight: 1, users: 1, apps: 2, referencingMode: 'pre_referenced_open',
    partnerRate: 0.25, agentRate: 0.1, primary: false },
] as unknown as Partner[];

const AGENCIES = [
  /* NO AGENCY EMAIL and an office with an address: the warning case, and
     the one whose office must print its address. */
  { id: 'ag-bare', partner: SUPPLIER, name: 'ZZZ Bare Agents', users: 0, referrals: 0,
    guaranteed: '£0', fees: 0, contacts: [],
    branches: [{ id: 'b-bare', name: 'ZZZ Bare Office', area: '12 Example Street, N1 1AA',
      referrals: 0, guaranteed: '£0', contacts: [] }] },
  /* AND ONE WITH NO ADDRESS ON ITS OFFICE, which must print nothing
     rather than a dash. */
  { id: 'ag-covered', partner: SUPPLIER, name: 'ZZZ Covered Agents', users: 0, referrals: 0,
    guaranteed: '£0', fees: 0,
    contacts: [{ id: 'c1', name: 'Desk', email: 'desk@zzz.test', primary: true }],
    branches: [{ id: 'b-cov', name: 'ZZZ Covered Office', area: '',
      referrals: 0, guaranteed: '£0', contacts: [] }] },
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

async function open(tab?: string) {
  const view = render(
    <MemoryRouter initialEntries={[`/partners/${SUPPLIER}`]}>
      <ToastProvider><SessionProvider><PageMetaProvider>
        <Routes><Route path="/partners/:key" element={<PartnerHome />} /></Routes>
      </PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('[role="tablist"]')) throw new Error('no tabs'); });
  if (tab) {
    const b = [...view.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((x) => (x.textContent ?? '').trim() === tab);
    if (!b) throw new Error(`no ${tab} tab`);
    await act(async () => { fireEvent.click(b); });
  }
  await act(async () => {});
  return view;
}

describe('the Overview tab, which drew nothing at all', () => {
  it('leads with the commission deal in one line', async () => {
    const { container } = await open();
    expect(container.textContent).toContain('Commission');
    // The standard columns, because this fixture has no negotiated deal.
    expect(container.textContent).toContain('25% of the fee, agencies 10%');
  });

  it('and says who gets the statements', async () => {
    const { container } = await open();
    expect(container.textContent).toContain('Who gets the statements');
  });

  it('and warns about the agency with no email, with a way to it', async () => {
    const { container } = await open();
    expect(container.textContent).toContain('1 agency has no agency email');
    expect(container.textContent).toContain('ZZZ Bare Agents');
    const link = [...container.querySelectorAll('button')]
      .find((b) => (b.textContent ?? '').includes('Open the Agencies tab'));
    expect(link, 'the warning does not link anywhere').not.toBeUndefined();
  });

  /* AND THE LINK GOES THERE, which is the half "linking to it" asks for
     and the half a label alone would not prove. */
  it('and that way actually opens the Agencies tab', async () => {
    const view = await open();
    const link = [...view.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => (b.textContent ?? '').includes('Open the Agencies tab'))!;
    await act(async () => { fireEvent.click(link); });
    expect(view.container.textContent).toContain('ZZZ Bare Office');
  });

  it('and carries the supplier’s Recent changes', async () => {
    const { container } = await open();
    expect(container.textContent).toContain('Recent changes');
  });
});

describe('the Agencies tab', () => {
  it('heads itself with the shared possessive, not an apostrophe-s', async () => {
    const { container } = await open('Agencies');
    expect(container.textContent).toContain('Kestrel Lettings’ agencies');
    expect(container.textContent).not.toContain("Kestrel Lettings's");
  });

  it('offers Add email beside the agency that has none', async () => {
    const { container } = await open('Agencies');
    const buttons = [...container.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
    expect(buttons).toContain('Add email');
  });

  /* AND "CHANGE EMAIL" WHERE THERE IS ONE, which is the "or changed"
     half of the instruction. */
  it('and Change email beside the one that has', async () => {
    const { container } = await open('Agencies');
    const buttons = [...container.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
    expect(buttons).toContain('Change email');
  });

  it('prints a branch address where there is one', async () => {
    const { container } = await open('Agencies');
    expect(container.textContent).toContain('12 Example Street, N1 1AA');
  });

  /* ADD AGENCY AND ADD BRANCH, 2026-10-02: "Both create the agency or
     branch in this supplier's estate, never in Opndoor's." The estate
     is decided by the arguments the dialog passes, which is asserted in
     the source rather than by creating a row here -- mock mode has no
     partner slug to check against. */
  it('offers Add agency on the tab, and Add branch on each agency', async () => {
    const { container } = await open('Agencies');
    const buttons = [...container.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
    expect(buttons).toContain('Add agency');
    expect(buttons.filter((t) => t === 'Add branch')).toHaveLength(2);
  });

  it('and both open a form that names this supplier', async () => {
    const view = await open('Agencies');
    const add = [...view.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => (b.textContent ?? '').trim() === 'Add agency')!;
    await act(async () => { fireEvent.click(add); });
    const text = document.body.textContent ?? '';
    expect(text).toContain('Add an agency to Kestrel Lettings');
    // The sentence that says which estate it lands in.
    expect(text).toContain('It belongs to Kestrel Lettings');
    expect(text).toContain('Agency email');
  });

  /* AND NOTHING WHERE THERE IS NOT. Asserted on the row rather than the
     page, because a dash somewhere else would pass a page-wide check. */
  it('and nothing at all where there is not', async () => {
    const { container } = await open('Agencies');
    const row = [...container.querySelectorAll('.ph-tree__branch')]
      .find((d) => (d.querySelector('.ph-tree__bname')?.textContent ?? '') === 'ZZZ Covered Office')!;
    expect(row, 'the office is not on the screen').not.toBeUndefined();
    expect(row.querySelector('.ph-tree__barea')).toBeNull();
  });
});
