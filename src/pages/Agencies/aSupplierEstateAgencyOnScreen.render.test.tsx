/* =====================================================================
   (ci) THE SUPPLIER-ESTATE AGENCY PAGE, RENDERED.

   The companion to aSupplierEstateAgencyInherits.render.test.tsx, which
   reads the source. This one draws the page, because a source read is
   how (cd) passed while the dialog still said "Change role": asserting
   that a string is in a file is not asserting that a reader sees it.

   Matt (ci): "remove the 'How are [agency]'s tenants checked?' choice.
   It follows the supplier's setting; show 'Checked as Kestrel Lettings
   sets it: they check tenants, Opndoor accepts them as sent' with a
   link to Kestrel's Settings ... remove 'Invite agency manager' and
   'Add another agency (creates a group)' for supplier-estate
   agencies."

   TWO AGENCIES, ONE OF EACH, in one group and on one page: ours keeps
   the choice and theirs does not. A test with only the supplier case
   would pass just as well if the control had been removed for
   everybody.
   ===================================================================== */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { App } from '@/App';
import { hydrateOrg, hydrateGroups } from '@/data/orgService';
import { hydratePartners } from '@/data/partnersService';
import { hydrateUsers } from '@/data/usersService';
import type { Agency, AgencyGroup, Partner } from '@/data/types';

vi.mock('@/data/orgService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/orgService')>();
  return {
    ...actual,
    getAgreementForAgency: async () => null,
    getCommissionSplits: async () => new Map(),
    getSupplierDealForAgency: async () => null,
  };
});

const HOUSE = 'opndoor-agents';
const SUPPLIER = 'kestrel-lettings';

const PARTNERS: Partner[] = [
  { id: HOUSE, name: 'Opndoor Agents', status: 'active', since: '2024-09', weight: 1,
    isHouse: true, referencingMode: 'opndoor_referenced', kind: 'agency' } as Partner,
  /* THE SUPPLIER'S OWN SETTING, which is the sentence the page has to
     print: "they check tenants, and Opndoor accepts them as sent". */
  { id: SUPPLIER, name: 'Kestrel Lettings', status: 'active', since: '2026-08', weight: 1,
    referencingMode: 'pre_referenced_open', kind: 'supplier' } as Partner,
];
const GROUPS: AgencyGroup[] = [
  { id: 'gr-ours', partner: HOUSE, name: 'Our Group' },
  { id: 'gr-theirs', partner: SUPPLIER, name: 'Kestrel Group' },
];
const AGENCIES: Agency[] = [
  { id: 'ag-ours', partner: HOUSE, name: 'Northgate Lettings', groupId: 'gr-ours', users: 0, referrals: 0,
    guaranteed: '£0', fees: 0, referencingMode: 'opndoor_referenced',
    branches: [{ id: 'br-ours', name: 'Northgate Central', area: 'N1', referrers: 0, referrals: 0, guaranteed: '£0', fees: 0 }] },
  { id: 'ag-theirs', partner: SUPPLIER, name: 'Test Lettings asdah', groupId: 'gr-theirs', users: 0, referrals: 0,
    guaranteed: '£0', fees: 0,
    branches: [{ id: 'br-theirs', name: 'Test Office', area: 'S1', referrers: 0, referrals: 0, guaranteed: '£0', fees: 0 }] },
];

async function settle() { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }

async function openGroup(id: string) {
  localStorage.setItem('grp_role', 'superadmin');
  const view = render(
    <MemoryRouter initialEntries={[`/agencies/${id}`]}>
      <SessionProvider><ToastProvider><App /></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.ah-tree')) throw new Error('not ready'); });
  await settle();
  // Expand the agency: the choice and the sentence are both inside the node.
  const node = view.container.querySelector<HTMLElement>('.ah-node--agency')!;
  fireEvent.click(node.querySelector('.ah-tick-btn')!);
  await settle();
  return view;
}

beforeEach(() => {
  sessionStorage.clear();
  hydratePartners(PARTNERS);
  hydrateGroups(GROUPS);
  hydrateOrg(AGENCIES);
  hydrateUsers([]);
});
afterEach(() => { cleanup(); hydrateUsers([]); });

describe('an agency in a supplier’s estate, as an admin sees it', () => {
  it('is told whose setting it follows, in the product’s own words', async () => {
    const view = await openGroup('gr-theirs');
    const t = view.container.textContent ?? '';
    expect(t).toContain('Checked as Kestrel Lettings sets it:');
    expect(t).toContain('they check tenants, and Opndoor accepts them as sent');
  });

  it('and is not offered the choice', async () => {
    const view = await openGroup('gr-theirs');
    expect(view.container.textContent).not.toContain('How are');
    expect(view.container.querySelector('.ah-route__opts')).toBeNull();
  });

  it('with a link to the supplier’s own settings', async () => {
    const view = await openGroup('gr-theirs');
    const link = view.container.querySelector<HTMLAnchorElement>('.ah-route--inherited a');
    expect(link).toBeTruthy();
    expect(link!.getAttribute('href')).toContain('/partners/kestrel-lettings');
    expect(link!.getAttribute('href')).toContain('tab=settings');
  });

  /* (ci)(2) NOBODY TO INVITE. "Add another agency" is covered by the
     source test instead: it is drawn only on an agency-kind page, and
     this one is reached through a group, so its absence here would not
     prove the rule. */
  it('and nobody to invite', async () => {
    const view = await openGroup('gr-theirs');
    const t = view.container.textContent ?? '';
    expect(t).not.toContain('Invite agency manager');
  });
});

describe('and one of our own, on the same screen', () => {
  /* THE CONTROL CASE. Without it, removing the choice for everybody
     would pass every assertion above. */
  it('still gets the choice, and somebody to invite', async () => {
    const view = await openGroup('gr-ours');
    const t = view.container.textContent ?? '';
    expect(t).toContain('How are');
    expect(view.container.querySelector('.ah-route__opts')).toBeTruthy();
    expect(t).not.toContain('Checked as');
    /* AND THE INVITE, which the supplier's estate does not get. "Add
       another agency" is not asserted here: it is drawn only on an
       agency-kind page, and both of these are reached through a GROUP,
       so its absence above is the group's doing as much as the rule's.
       Asserting it would be a test passing for the wrong reason. */
    expect(t).toContain('Invite agency manager');
  });
});
