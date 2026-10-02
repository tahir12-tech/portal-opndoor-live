/* HOME'S RECONCILIATION TILE COUNTS EVERY KIND OF WORK ON THAT PAGE.
 *
 * Matt, 2026-10-02: "Home's Reconciliation count shows 0 while the
 * 'Supplier agencies with no email' tab lists two. Include those in the
 * Home count and say what they are, e.g. '2 supplier agencies need an
 * email'."
 *
 * THE SHAPE OF THE FAULT, which is worth naming because it will happen
 * again: a new kind of work was added to Reconciliation and the tile
 * that sends people there was not told. The tile is the only thing on
 * Home that gets anybody to the page, so a tab nobody is sent to is a
 * tab nobody opens. Anything added to that page from here on has to be
 * added to `reconMeta` and to the number beside it, and these cases are
 * what will say so.
 *
 * TWO HALVES, BOTH ASSERTED: the NUMBER includes them, and the SENTENCE
 * says what they are. A tile that counts both and describes one sends
 * the reader looking for rows that are on another tab.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { Home, reconMeta } from './Home';
import { hydrateApplications } from '@/data';
import { hydrateOrg, hydrateGroups } from '@/data/orgService';
import { hydratePartners } from '@/data/partnersService';
import * as recon from '@/data/reconciliationService';
import type { Agency, Partner } from '@/data/types';

const SUPPLIER = 'zzz-rightmove';

const PARTNERS = [
  { id: SUPPLIER, name: 'ZZZ Rightmove', status: 'active', since: '2026-01-01',
    weight: 1, users: 1, apps: 2, referencingMode: 'pre_referenced_open',
    partnerRate: 0.25, agentRate: 0.1, primary: false },
] as unknown as Partner[];

/* TWO OF THE SUPPLIER'S, one of ours. Matt's example number is two, and
   ours is here so the count is a filtered answer rather than a total. */
const AGENCIES = [
  { id: 'ag-a', partner: SUPPLIER, name: 'ZZZ Bare Agents', users: 0, referrals: 0,
    guaranteed: '£0', fees: 0, contacts: [], branches: [] },
  { id: 'ag-b', partner: SUPPLIER, name: 'ZZZ Other Agents', users: 0, referrals: 0,
    guaranteed: '£0', fees: 0, contacts: [], branches: [] },
  { id: 'ag-ours', partner: 'opndoor-agents', name: "ZZZ Regent's", users: 1, referrals: 0,
    guaranteed: '£0', fees: 0, contacts: [], branches: [] },
] as unknown as Agency[];

beforeEach(() => {
  localStorage.clear();
  hydrateApplications([], []);
  hydrateGroups([]);
  hydratePartners(PARTNERS);
  hydrateOrg(AGENCIES);
  /* NOTHING IN THE REVIEW QUEUE, which is the reported state: the tile
     read 0 while the page had two rows of work on it. */
  vi.spyOn(recon, 'reconciliationPendingCount').mockReturnValue(0);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); hydrateOrg([]); });

async function openHome() {
  localStorage.setItem('grp_role', 'superadmin');
  const view = render(
    <MemoryRouter initialEntries={['/home']}>
      <ToastProvider><SessionProvider><PageMetaProvider><Home /></PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.home-queues')) throw new Error('no queues'); });
  await act(async () => {});
  return view;
}

const reconTile = (c: HTMLElement) =>
  [...c.querySelectorAll('.home-q')]
    .find((t) => t.querySelector('.home-q__label')?.textContent?.trim() === 'Reconciliation');

describe('the Reconciliation tile', () => {
  it('counts the supplier agencies that need an email', async () => {
    const { container } = await openHome();
    const tile = reconTile(container);
    expect(tile, 'no Reconciliation tile on Home').not.toBeUndefined();
    expect(tile!.textContent).toContain('2');
  });

  it('and says what they are, in Matt’s words', async () => {
    const { container } = await openHome();
    expect(reconTile(container)!.textContent)
      .toContain('2 supplier agencies need an email');
  });

  it('and not one of ours, however bare it is', async () => {
    const { container } = await openHome();
    // Three agencies are hydrated and one is Opndoor's own with no contact.
    expect(reconTile(container)!.textContent).not.toContain('3');
  });
});

/* THE SENTENCE ON ITS OWN, because the tile can only show one combination
   at a time and the awkward ones are the singular and the both-at-once. */
describe('the sentence under the number', () => {
  it('names only what is there', () => {
    expect(reconMeta(0, 2)).toBe('waiting now: 2 supplier agencies need an email');
    expect(reconMeta(3, 0)).toBe('waiting now: 3 to review');
  });

  it('and both when both are', () => {
    expect(reconMeta(3, 2)).toBe('waiting now: 3 to review, 2 supplier agencies need an email');
  });

  it('with the verb and the noun agreeing on one', () => {
    expect(reconMeta(1, 1)).toBe('waiting now: 1 to review, 1 supplier agency needs an email');
  });

  /* AND AN EMPTY QUEUE STILL SAYS WHAT THE 0 WOULD BE A COUNT OF, which
     is walk fix 25's rule for every tile on this page. */
  it('and an empty queue still says what it would count', () => {
    expect(reconMeta(0, 0)).toBe('waiting now: agencies and branches to review');
  });
});
