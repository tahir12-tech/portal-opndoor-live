/* WHAT ONE OF OUR OWN AGENCIES READS ON THE DASHBOARD.

   Three rulings meet on this screen, and all three come from the same place:
   every figure here was written for Opndoor looking across a book of suppliers,
   and then 'management' became the role an agency DIRECTOR wears too.

   1. "Commission by partner" is Opndoor's table about Opndoor's business. Its
      allowlist was the only gate, so it opened on a director's dashboard and
      split their money with a party they have never heard of.
   2. The commission tile carried a blended percentage. It reconciles with the
      pound figure beside it and it is still not a rate anybody agreed to, so the
      tile states the amount and the terms, and the rates are named per
      agreement in the commission statement lower down the page.
   3. A first deed read "across 1 issued deeds".

   The reader is not stubbed: the page asks isAgencyUser, which reads the party
   in scope, so the test stages a real one. 'northwind' is opndoor_referenced in
   the mock partner seed and is the home partner in mock mode, which is what
   makes a 'management' user one of OUR agencies rather than a supplier's
   manager. The admin case proves the discrimination is on the READER and not on
   the rail: an Opndoor admin scoped to that same agency keeps everything.

   Live mode is staged rather than mocked away: SUPABASE_ENABLED is the switch
   into the live analytics path, and the figures are then summed from one
   hydrated application, so deedsIssued really is 1 and the partner breakdown
   really does have a row to draw. There is no client behind the flag, which is
   why `supabase` is null (SessionContext then resolves straight to ready) and
   sb() throws: nothing on this page may reach the network. */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/* Mutable through a getter so one file can test both halves of the switch: the
   live path the real portal runs on, and the synthetic model mock and demo mode
   read. vi.hoisted because the mock factory is evaluated during the imports
   below, before a plain module-scope binding exists. */
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

const AGENCY_PARTNER = 'northwind';

/* ONE deed, paid inside the dashboard's default period ("This calendar month"),
   which in live mode is the real month. Dated from now rather than from a fixed
   day so the row never falls out of the period as the calendar moves.

   The fee is three weeks of rent (2400 x 36 / 52), a negotiated basis rather
   than a month, so the copy under Net fees is exercised as Regent's actually is. */
function oneDeed(): FullApp {
  const now = new Date();
  return {
    ref: 'GR-AG01', partner: AGENCY_PARTNER, partnerRate: 0.25, agentRate: 0.25,
    agency: "Regent's Lettings", agencyId: 'ag-r', branch: "Regent's Park", branchId: 'br-rp',
    referrer: 'Rosa', owner: 0, status: 'deed',
    rent: 2400, fee: 1661.54, feeBasisWeeks: 3,
    commissionLines: [{ level: 'agency', orgId: 'ag-r', orgName: "Regent's Lettings", rate: 0.25, source: 'agreement' }],
    sentAt: now, paidAt: now, deedAt: now, tenancyStart: null, expiry: null,
    refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null,
    withdrawn: false, withdrawnReason: null, withdrawnNote: null, expired: false,
  };
}

beforeEach(() => {
  localStorage.clear();
  flags.live = true;
  hydrateFull([oneDeed()]);
});

afterEach(cleanup);
// Leave the module-level working copy as the rest of the suite expects to find it.
afterAll(() => hydrateFull([]));

/* The page on its own rather than through <App />: this is a test about one
   screen, and routing the whole shell in only makes it depend on every other
   page compiling. */
async function openDashboard(role: string, scope?: string) {
  localStorage.setItem('grp_role', role);
  if (scope) localStorage.setItem('grp_partner', scope);
  const view = render(
    <MemoryRouter initialEntries={['/']}>
      <SessionProvider><ToastProvider><PageMetaProvider><Dashboard /></PageMetaProvider></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.herorow')) throw new Error('dashboard not ready'); });
  return view;
}

type View = Awaited<ReturnType<typeof openDashboard>>;
/** The commission tile, found by its own content: the money tile beside it is
    about fees and never says "Commission". */
function commissionTile(v: View): HTMLElement {
  const tile = [...v.container.querySelectorAll<HTMLElement>('.hero-kpi')]
    .find((el) => /Commission/.test(el.textContent ?? ''));
  if (!tile) throw new Error('no commission tile on this dashboard');
  return tile;
}
const feesTile = (v: View) => v.container.querySelector<HTMLElement>('.hero-kpi--dark')!;

describe('the dashboard a director at one of our agencies reads', () => {
  it('has no Commission by partner table anywhere on it', async () => {
    const view = await openDashboard('management');
    expect(view.container.textContent).not.toMatch(/Commission by partner/i);
    // The caption said it five times; the whole section is what went.
    expect(view.container.querySelectorAll('.settle table')).toHaveLength(0);
  });

  it('labels the commission tile with the terms, and states no rate', async () => {
    const view = await openDashboard('management');
    const tile = commissionTile(view);
    expect(tile.querySelector('.kpi__label')!.textContent).toBe('Commission (agreed terms)');
    // Not in the tag, not in the sub-line, not anywhere on the tile.
    expect(tile.textContent).not.toContain('%');
    // The amount is still the point of the tile.
    expect(tile.querySelector('.comm-headline')!.textContent).toMatch(/^£[\d,]+$/);
  });

  it('agrees with its own count at one deed', async () => {
    const view = await openDashboard('management');
    expect(feesTile(view).textContent).toMatch(/across 1 issued deed,/);
    expect(feesTile(view).textContent).not.toMatch(/issued deeds/);
  });
});

describe('the same agency, read by Opndoor', () => {
  it('keeps the partner table and the effective rate for an admin scoped to it', async () => {
    // Same partner, same rail, same single row: the only thing that changes is
    // who is reading, which is the whole point of asking isAgencyUser.
    const view = await openDashboard('superadmin', AGENCY_PARTNER);
    expect(view.container.textContent).toMatch(/Commission by partner/);
    const tile = commissionTile(view);
    expect(tile.querySelector('.kpi__label')!.textContent).toBe('Commission earned');
    expect(tile.textContent).toContain('%');
  });
});

describe('mock and demo mode, where the synthetic model answers', () => {
  it('gives the agency the same rate-free tile, demo delta included', async () => {
    flags.live = false;
    const view = await openDashboard('management');
    const tile = commissionTile(view);
    expect(tile.querySelector('.kpi__label')!.textContent).toBe('Commission (agreed terms)');
    // The hard-coded "12.4% vs prior period" is demo furniture, and a figure
    // nobody computed is the worst kind of rate to show somebody their money by.
    expect(tile.textContent).not.toContain('%');
  });
});
