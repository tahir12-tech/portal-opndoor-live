/* The Agencies list at scale: groups and agencies are COLLAPSED by default and
   their children are not rendered at all, a search opens only the path to the hit,
   and the top level is paged.

   This page had no test of any kind before — only a smoke case asserting the route
   did not throw — so the collapse, the search behaviour and the paging were all
   unguarded. These pin the parts a reader would notice breaking. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { App } from '@/App';
import { hydrateOrg, hydrateGroups } from '@/data/orgService';
import type { Agency, AgencyGroup } from '@/data/types';

const PARTNER = 'northwind';

const GROUPS: AgencyGroup[] = [
  { id: 'grp-meridian', partner: PARTNER, name: 'Meridian Property Group' },
];

const AGENCIES: Agency[] = [
  {
    partner: PARTNER, name: 'Northgate Lettings', groupId: 'grp-meridian',
    users: 3, referrals: 40, guaranteed: '£1M', fees: 100000,
    branches: [
      { name: 'Northgate Central', area: 'LS1', referrers: 2, referrals: 25, guaranteed: '£0.6M', fees: 60000 },
      { name: 'Northgate West', area: 'LS4', referrers: 1, referrals: 15, guaranteed: '£0.4M', fees: 40000 },
    ],
  },
  {
    partner: PARTNER, name: 'Harborview Lettings',
    users: 1, referrals: 0, guaranteed: '£0', fees: 0,
    branches: [
      { name: 'Brighton Marina', area: 'BN2', referrers: 0, referrals: 0, guaranteed: '£0', fees: 0 },
    ],
  },
];

function renderList() {
  localStorage.setItem('grp_role', 'superadmin');
  return render(
    <MemoryRouter initialEntries={['/agencies']}>
      <SessionProvider><ToastProvider><App /></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
}

/* Scoped to the TREE (.org) on purpose. The page also carries a top-of-page
   "cannot issue a deed" banner that names agencies and branches, so asserting
   against the whole document would match rows that are not drawn in the tree. */
const shows = (c: HTMLElement, text: string) =>
  (c.querySelector('.org')?.textContent ?? '').includes(text);
/** Text of the whole page, for the toolbar and paging controls outside the tree. */
const pageText = (c: HTMLElement) => c.textContent ?? '';

beforeEach(() => {
  sessionStorage.clear();
  hydrateGroups(GROUPS);
  hydrateOrg(AGENCIES);
});
afterEach(cleanup);

describe('Agencies list: collapse and scale', () => {
  it('renders a group collapsed, with its agencies not in the DOM at all', async () => {
    const { container } = renderList();
    await waitFor(() => { if (!shows(container, 'Meridian Property Group')) throw new Error('not ready'); });

    // The group row is there, rolled up...
    expect(shows(container, 'Meridian Property Group')).toBe(true);
    expect(shows(container, '1 agency')).toBe(true);
    expect(shows(container, '2 branches')).toBe(true);
    // ...and nothing underneath it is rendered. Not hidden: absent.
    expect(shows(container, 'Northgate Lettings')).toBe(false);
    expect(container.querySelector('.orggroup__brands')).toBeNull();
  });

  it('an independent agency is a single collapsed row, its branches absent', async () => {
    const { container } = renderList();
    await waitFor(() => { if (!shows(container, 'Harborview Lettings')) throw new Error('not ready'); });

    expect(shows(container, 'Harborview Lettings')).toBe(true);
    expect(shows(container, 'Brighton Marina')).toBe(false);
    expect(container.querySelector('.branches')).toBeNull();
  });

  it('expands group then agency, one level per click', async () => {
    const { container } = renderList();
    await waitFor(() => { if (!shows(container, 'Meridian Property Group')) throw new Error('not ready'); });

    fireEvent.click(container.querySelector('.orggroup__head')!);
    expect(shows(container, 'Northgate Lettings')).toBe(true);
    // The agency is itself still collapsed: one level per click.
    expect(shows(container, 'Northgate Central')).toBe(false);

    const agencyHead = [...container.querySelectorAll('.agency__head')]
      .find((el) => (el.textContent ?? '').includes('Northgate Lettings'))!;
    fireEvent.click(agencyHead);
    expect(shows(container, 'Northgate Central')).toBe(true);
    expect(shows(container, 'Northgate West')).toBe(true);
  });

  it('expand all opens every level, collapse all closes them', async () => {
    const { container } = renderList();
    await waitFor(() => { if (!shows(container, 'Meridian Property Group')) throw new Error('not ready'); });

    const btn = (label: string) => [...container.querySelectorAll('.org-tools__btn')]
      .find((el) => (el.textContent ?? '').trim() === label)!;

    fireEvent.click(btn('Expand all'));
    expect(shows(container, 'Northgate Lettings')).toBe(true);
    expect(shows(container, 'Northgate Central')).toBe(true);
    expect(shows(container, 'Brighton Marina')).toBe(true);

    fireEvent.click(btn('Collapse all'));
    expect(shows(container, 'Northgate Lettings')).toBe(false);
    expect(shows(container, 'Brighton Marina')).toBe(false);
  });

  it('a branch search opens only the path to the hit', async () => {
    const { container } = renderList();
    await waitFor(() => { if (!shows(container, 'Meridian Property Group')) throw new Error('not ready'); });

    fireEvent.change(container.querySelector('.org-search input')!, { target: { value: 'Northgate Central' } });

    // The path down to the matching branch is open...
    expect(shows(container, 'Meridian Property Group')).toBe(true);
    expect(shows(container, 'Northgate Lettings')).toBe(true);
    expect(shows(container, 'Northgate Central')).toBe(true);
    // ...and the unrelated independent agency is filtered out entirely.
    expect(shows(container, 'Harborview Lettings')).toBe(false);
  });

  it('an agency-name search does not expand past the match', async () => {
    const { container } = renderList();
    await waitFor(() => { if (!shows(container, 'Meridian Property Group')) throw new Error('not ready'); });

    fireEvent.change(container.querySelector('.org-search input')!, { target: { value: 'Harborview' } });

    expect(shows(container, 'Harborview Lettings')).toBe(true);
    // The agency itself is the match, so its branches stay shut.
    expect(shows(container, 'Brighton Marina')).toBe(false);
  });

  it('pages the top level instead of drawing every row', async () => {
    // 120 independent agencies: more than one page of top-level rows.
    const many: Agency[] = Array.from({ length: 120 }, (_, i) => ({
      partner: PARTNER, name: `Fixture Agency ${String(i).padStart(3, '0')}`,
      users: 1, referrals: 1, guaranteed: '£0', fees: 1000,
      branches: [{ name: `Fixture Branch ${i}`, area: 'X1', referrers: 1, referrals: 1, guaranteed: '£0', fees: 1000 }],
    }));
    hydrateOrg(many);

    const { container } = renderList();
    await waitFor(() => { if (!shows(container, 'Fixture Agency 000')) throw new Error('not ready'); });

    expect(container.querySelectorAll('.agency').length).toBe(50);
    expect(pageText(container)).toContain('Showing');
    expect(pageText(container)).toContain('of 120 rows');
    expect(shows(container, 'Fixture Agency 049')).toBe(true);
    expect(shows(container, 'Fixture Agency 050')).toBe(false);

    fireEvent.click([...container.querySelectorAll('button')]
      .find((el) => (el.textContent ?? '').includes('Show 50 more'))!);
    expect(container.querySelectorAll('.agency').length).toBe(100);
    expect(shows(container, 'Fixture Agency 050')).toBe(true);
  });
});
