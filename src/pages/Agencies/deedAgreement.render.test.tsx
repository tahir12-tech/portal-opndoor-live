/* The Agencies LIST and the agency DETAIL page must give the same answer to
   "can a deed be received here?".

   They used to disagree by construction: the list asked org_deed_readiness (active
   people only) while the detail page recomputed its own chain from the people it
   had loaded, counting negotiators and ignoring status entirely. Both now read the
   same RPC, so these tests mock that one source and assert the two surfaces agree
   on the cases that used to differ: an agency whose only manager is PENDING, and a
   branch whose only person is a NEGOTIATOR. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { App } from '@/App';
import { hydrateOrg, hydrateGroups } from '@/data/orgService';
import { hydratePartners } from '@/data/partnersService';
import type { Agency, AgencyGroup, Partner } from '@/data/types';

const HOUSE = 'opndoor-agents';

/* The one source of truth, mocked once. Harborview's only manager is pending and
   Northgate West's only person is a negotiator, so neither can receive a deed;
   Southbank has an active manager and can. */
vi.mock('@/data/positionsService', async () => {
  const actual = await vi.importActual<typeof import('@/data/positionsService')>('@/data/positionsService');
  return {
    ...actual,
    getOrgDeedReadiness: async () => ({
      agencies: new Map<string, boolean>([
        ['ag-harborview', false],  // only manager is pending
        ['ag-northgate', false],   // only person is a negotiator
        ['ag-southbank', true],    // active manager
      ]),
      branches: new Map<string, boolean>([
        ['br-marina', false],
        ['br-west', false],
        ['br-quay', true],
      ]),
    }),
  };
});

// Partner is keyed by `id`, which carries the slug.
const PARTNERS: Partner[] = [
  { id: HOUSE, name: 'Opndoor Agents', status: 'active', since: '2024-09', weight: 1,
    isHouse: true, referencingMode: 'opndoor_referenced', kind: 'agency' } as Partner,
];
const GROUPS: AgencyGroup[] = [{ id: 'gr-meridian', partner: HOUSE, name: 'Meridian Property Group' }];
const AGENCIES: Agency[] = [
  { id: 'ag-northgate', partner: HOUSE, name: 'Northgate Lettings', groupId: 'gr-meridian', users: 1, referrals: 0, guaranteed: '£0', fees: 0,
    branches: [{ id: 'br-west', name: 'Northgate West', area: 'LS4', referrers: 1, referrals: 0, guaranteed: '£0', fees: 0 }] },
  { id: 'ag-southbank', partner: HOUSE, name: 'Southbank Residential', groupId: 'gr-meridian', users: 1, referrals: 0, guaranteed: '£0', fees: 0,
    branches: [{ id: 'br-quay', name: 'Southbank Quay', area: 'SE1', referrers: 1, referrals: 0, guaranteed: '£0', fees: 0 }] },
  { id: 'ag-harborview', partner: HOUSE, name: 'Harborview Lettings', users: 1, referrals: 0, guaranteed: '£0', fees: 0,
    branches: [{ id: 'br-marina', name: 'Brighton Marina', area: 'BN2', referrers: 0, referrals: 0, guaranteed: '£0', fees: 0 }] },
];

const AGENCY_WARN = 'No one at this agency can receive the deed';

/** Readiness arrives from an async RPC, so let it land before reading the DOM. */
async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function renderAt(path: string) {
  localStorage.setItem('grp_role', 'superadmin');
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider><ToastProvider><App /></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  hydratePartners(PARTNERS);
  hydrateGroups(GROUPS);
  hydrateOrg(AGENCIES);
});
afterEach(cleanup);

/** Does the LIST warn for this agency? Expand everything, then read its row. */
async function listWarnsFor(agencyName: string): Promise<boolean> {
  const { container } = renderAt('/agencies');
  await waitFor(() => { if (!(container.querySelector('.org')?.textContent ?? '').length) throw new Error('not ready'); });
  await settle();
  const expandAll = [...container.querySelectorAll('.org-tools__btn')]
    .find((el) => (el.textContent ?? '').trim() === 'Expand all');
  if (expandAll) fireEvent.click(expandAll);
  const row = [...container.querySelectorAll('.agency')]
    .find((el) => (el.querySelector('.agency__name')?.textContent ?? '').includes(agencyName));
  const text = row?.querySelector('.agency__head')?.textContent ?? '';
  cleanup();
  return text.includes(AGENCY_WARN);
}

/** Does the DETAIL page warn for this agency? */
async function detailWarnsFor(agencyId: string, agencyName: string): Promise<boolean> {
  const { container } = renderAt(`/agencies/${agencyId}`);
  await waitFor(() => { if (!container.querySelector('.ah-tree')) throw new Error('not ready'); });
  await waitFor(() => { if (!container.querySelector('.ah-node--agency')) throw new Error('no agency node'); });
  await settle();
  // A grouped agency resolves to its GROUP page, which lists every sibling, so the
  // node has to be picked by name rather than taking the first one.
  const node = [...container.querySelectorAll('.ah-node--agency')]
    .find((el) => (el.querySelector('.ah-node-name')?.textContent ?? '').includes(agencyName));
  const text = node?.textContent ?? '';
  cleanup();
  return text.includes(AGENCY_WARN);
}

describe('list and detail agree on who can receive a deed', () => {
  it('agree on an agency whose only manager is PENDING (Harborview)', async () => {
    const onList = await listWarnsFor('Harborview Lettings');
    const onDetail = await detailWarnsFor('ag-harborview', 'Harborview Lettings');
    expect(onList).toBe(true);
    expect(onDetail).toBe(true);
    expect(onList).toBe(onDetail);
  });

  it('agree on an agency whose only person is a NEGOTIATOR (Northgate)', async () => {
    const onList = await listWarnsFor('Northgate Lettings');
    const onDetail = await detailWarnsFor('ag-northgate', 'Northgate Lettings');
    expect(onList).toBe(true);
    expect(onDetail).toBe(true);
    expect(onList).toBe(onDetail);
  });

  it('agree that an agency with an ACTIVE manager does NOT warn (Southbank)', async () => {
    const onList = await listWarnsFor('Southbank Residential');
    const onDetail = await detailWarnsFor('ag-southbank', 'Southbank Residential');
    expect(onList).toBe(false);
    expect(onDetail).toBe(false);
    expect(onList).toBe(onDetail);
  });
});
