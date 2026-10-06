/* The Agencies LIST and the agency DETAIL page must give the same answer to
   "can a deed be received here?".

   They used to disagree by construction: the list asked org_deed_readiness (active
   people only) while the detail page recomputed its own chain from the people it
   had loaded, counting negotiators and ignoring status entirely. Both now read the
   same RPC, so these tests mock that one source and assert the two surfaces agree
   on the cases that used to differ: an agency whose only manager is PENDING, and a
   branch whose only person is a NEGOTIATOR.

   AND SINCE 2026-10-03 THE QUESTION HAS A SECOND HALF. Matt: "Only warn about
   deed delivery when there's an application at that agency whose deed has
   nowhere to go." Readiness alone is a CAPABILITY, and it is false for an
   agency onboarded this morning for the most ordinary reason there is, so the
   alert fired on agencies with no deed, no application and nothing wrong.

   What this file is about is unchanged -- the two surfaces give one answer --
   so every case below still asserts list === detail. What changed is that
   each case is now run twice: once with a deed actually stranded at that
   agency, where both warn, and once without, where neither does. A rule that
   only ever moved one of the two surfaces would be caught by the equality
   either way, which is the point of testing it this way round. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { App } from '@/App';
import { hydrateOrg, hydrateGroups } from '@/data/orgService';
import { hydratePartners } from '@/data/partnersService';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
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
      /* PEOPLE COUNTS, added to the RPC by 20261007800000. Each of these
         agencies HAS somebody -- that is what makes them the interesting
         cases -- so none of them is the "No users yet" case, which has its
         own describe at the bottom. */
      agencyPeople: new Map<string, number>([
        ['ag-harborview', 1], ['ag-northgate', 1], ['ag-southbank', 1],
      ]),
      branchPeople: new Map<string, number>([
        ['br-marina', 1], ['br-west', 1], ['br-quay', 1],
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

/* A DEED WITH NOWHERE TO GO: executed, and queued for a staff send because
   nobody active could receive it. `deedsWithNowhereToGo` reads exactly this
   off the hydrated book. */
function strandedAt(agencyId: string, branchId: string): FullApp {
  return {
    ref: `GR-${agencyId}`, partner: HOUSE, agency: agencyId, agencyId, branch: branchId, branchId,
    referrer: 'Someone', owner: 0, status: 'deed', rent: 2000, fee: 2000,
    partnerRate: 0, agentRate: 0.1,
    sentAt: null, paidAt: null, deedAt: null, tenancyStart: null, expiry: null,
    refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null,
    awaitingStaffSend: true,
  } as unknown as FullApp;
}

beforeEach(() => {
  sessionStorage.clear();
  hydratePartners(PARTNERS);
  hydrateGroups(GROUPS);
  hydrateOrg(AGENCIES);
  hydrateFull([]);
});
afterEach(() => { cleanup(); hydrateFull([]); });

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

describe('with a deed actually stranded there, both surfaces warn', () => {
  it('on an agency whose only manager is PENDING (Harborview)', async () => {
    hydrateFull([strandedAt('ag-harborview', 'br-marina')]);
    const onList = await listWarnsFor('Harborview Lettings');
    const onDetail = await detailWarnsFor('ag-harborview', 'Harborview Lettings');
    expect(onList).toBe(true);
    expect(onDetail).toBe(true);
    expect(onList).toBe(onDetail);
  });

  it('and on an agency whose only person is a NEGOTIATOR (Northgate)', async () => {
    hydrateFull([strandedAt('ag-northgate', 'br-west')]);
    const onList = await listWarnsFor('Northgate Lettings');
    const onDetail = await detailWarnsFor('ag-northgate', 'Northgate Lettings');
    expect(onList).toBe(true);
    expect(onDetail).toBe(true);
    expect(onList).toBe(onDetail);
  });
});

describe('with no deed waiting, neither surface warns', () => {
  /* THE SAME TWO AGENCIES, same readiness, no application. Matt, 2026-10-03:
     "Only warn about deed delivery when there's an application at that agency
     whose deed has nowhere to go." */
  it('not on Harborview', async () => {
    const onList = await listWarnsFor('Harborview Lettings');
    const onDetail = await detailWarnsFor('ag-harborview', 'Harborview Lettings');
    expect(onList).toBe(false);
    expect(onDetail).toBe(false);
  });

  it('and not on Northgate', async () => {
    const onList = await listWarnsFor('Northgate Lettings');
    const onDetail = await detailWarnsFor('ag-northgate', 'Northgate Lettings');
    expect(onList).toBe(false);
    expect(onDetail).toBe(false);
  });

  /* A STRANDED DEED AT ONE AGENCY IS NOT A WARNING AT ANOTHER, which is the
     whole reason the fact is per-org rather than a count of the book. */
  it('and not on Harborview because Northgate has one', async () => {
    hydrateFull([strandedAt('ag-northgate', 'br-west')]);
    expect(await listWarnsFor('Harborview Lettings')).toBe(false);
    expect(await detailWarnsFor('ag-harborview', 'Harborview Lettings')).toBe(false);
  });
});

describe('and an agency that can receive one never warned anyway', () => {
  it('Southbank, with and without a deed on the book', async () => {
    expect(await listWarnsFor('Southbank Residential')).toBe(false);
    expect(await detailWarnsFor('ag-southbank', 'Southbank Residential')).toBe(false);
    hydrateFull([strandedAt('ag-southbank', 'br-quay')]);
    expect(await listWarnsFor('Southbank Residential')).toBe(false);
    expect(await detailWarnsFor('ag-southbank', 'Southbank Residential')).toBe(false);
  });
});
