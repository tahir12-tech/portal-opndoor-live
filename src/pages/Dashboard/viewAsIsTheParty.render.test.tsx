/* UNDER VIEW AS, REPORTING IS THAT PARTY'S REPORTING.
 *
 * Q-06 item B, verbatim: "Under View as, Reporting shows exactly what that
 * party's management sees: no bordereau, no Opndoor settlements, 'Your
 * commission' reads as the party's own statement."
 *
 * WHAT WAS ACTUALLY WRONG, which is not what the 2026-09-28 audit recorded.
 * The audit said the bordereau and the settlement stack were gated on the
 * commission capability rather than on the seat, so a Director saw them. That
 * is false and was false when it was written: FinanceSurfaces is mounted
 * inside <RoleOnly roles={['superadmin']}> and ourMarginIsNotTheirs.test.ts
 * has asserted that gate for days.
 *
 * The real fault was the other way round, and it only appears under View as.
 * An Opndoor admin narrowed to a party kept their OWN page:
 *
 *   drawn:     the Opndoor money-ops stack, because the reader is still a
 *              superadmin and the role does not change when the scope does
 *   not drawn: that party's own settlement blocks and agent settlement,
 *              because those are gated `roles={['management']}` and a
 *              superadmin is not on that list
 *   labelled:  "Your commission", which under View as is not the reader's
 *
 * So the admin saw Opndoor's money and not the party's, which is the exact
 * inverse of the instruction.
 *
 * THE FIX IS A THIRD QUESTION, not a loosened gate. `role` is who is reading.
 * `partnerScope` is whose data. `viewingAs` is the new one: the party an
 * admin has narrowed to, or null. The allowlist on each gate is then drawn
 * for that party's management, while the COMMISSION half of the gate still
 * tests the real reader -- pretending about a capability is how a capability
 * check becomes decorative.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const flags = vi.hoisted(() => ({ live: true }));
vi.mock('@/lib/supabase', () => ({
  get SUPABASE_ENABLED() { return flags.live; },
  supabase: null,
  sb: () => { throw new Error('This test runs with no Supabase client.'); },
}));

import { KEYS } from '@/data/storage';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { Dashboard } from './Dashboard';

afterAll(() => hydrateFull([]));

/** An agency of ours, on the house route. */
const AGENCY = 'northwind';
/** A supplier: its own partner, and NOT one of our agencies. */
const SUPPLIER = 'harbourside';

/* One paid application so the settlement and breakdown blocks have something
   to draw. Without it they render nothing and every assertion below passes
   for the wrong reason. */
const PAID: FullApp[] = [{
  ref: 'GR-VIEWAS-1', tenant: 'V Tenant', prop: '1 View Street', branch: 'North Office',
  agency: 'Northwind Lettings', ben: '', rent: 1200, status: 'paid',
  date: '2026-09-02', eventTs: '2026-09-02T10:00:00Z', owner: 1, partner: AGENCY,
} as unknown as FullApp];

beforeEach(() => {
  flags.live = true;
  localStorage.clear();
  hydrateFull(PAID);
});
afterEach(() => cleanup());

async function openReporting(role: string, scope?: string) {
  localStorage.setItem('grp_role', role);
  /* BOTH KEYS, because that is what the picker writes. `grp_partner` is the
     isolation scope the server rule speaks in; `grp_scope_sel` is the richer
     selection the picker holds, and it is what "am I viewing as somebody"
     is read off. Setting only the first is how this harness used to lie:
     selecting an AGENCY leaves the partner at All, so a test that drove only
     the partner could never reach the agency case at all. */
  if (scope) {
    localStorage.setItem('grp_partner', scope);
    localStorage.setItem(KEYS.scopeSel, `partner:${scope}`);
  }
  const view = render(
    <MemoryRouter initialEntries={['/']}>
      <SessionProvider><ToastProvider><PageMetaProvider><Dashboard /></PageMetaProvider></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.herorow')) throw new Error('not ready'); });
  return view;
}

type View = Awaited<ReturnType<typeof openReporting>>;
const text = (v: View) => v.container.textContent ?? '';

describe('an Opndoor admin who is not viewing as anybody', () => {
  it('still gets the whole money-ops page, which is the thing not to break', async () => {
    const v = await openReporting('superadmin');
    // The bordereau lives inside FinanceSurfaces and nowhere else.
    expect(v.container.querySelector('.fin-surfaces, [data-surface="finance"]') ?? text(v))
      .toBeTruthy();
    expect(text(v)).toMatch(/bordereau/i);
    expect(text(v)).toMatch(/Commission by partner/);
  });
});

describe('the same admin, viewing as one of our agencies', () => {
  it('is not shown Opndoor’s own bordereau', async () => {
    const v = await openReporting('superadmin', AGENCY);
    expect(text(v)).not.toMatch(/bordereau/i);
  });

  it('nor the commission-by-partner split, which is Opndoor’s view of its book', async () => {
    const v = await openReporting('superadmin', AGENCY);
    expect(text(v)).not.toMatch(/Commission by partner/);
  });

  /* THE HALF THAT WAS MISSING RATHER THAN LEAKING. The party's own settlement
     was gated on `management`, so an admin viewing as them saw nothing at
     all -- the page showed Opndoor's money and withheld the agency's. */
  it('and IS shown that agency’s own settlement, which it was not before', async () => {
    const v = await openReporting('superadmin', AGENCY);
    expect(text(v)).toMatch(/Settlements/);
  });

  it('with the statement named for the party rather than called “Your commission”', async () => {
    const v = await openReporting('superadmin', AGENCY);
    expect(text(v)).not.toMatch(/Your commission/);
    expect(text(v)).toMatch(/’s commission/);
  });
});

describe('the same admin, viewing as a supplier', () => {
  /* A SUPPLIER IS NOT AN AGENCY, and the distinction is the whole reason
     `partyIsAgency` exists separately from `isAgencyUser`. The commission-by-
     partner split is Opndoor's view of what it owes out; a supplier is one of
     the parties it is owed to, so the split stays off, but the tile keeps
     Opndoor's vocabulary because the supplier is not on agreed agency terms. */
  it('is still not shown the bordereau, because that is Opndoor’s alone', async () => {
    const v = await openReporting('superadmin', SUPPLIER);
    expect(text(v)).not.toMatch(/bordereau/i);
  });
});

describe('an agency reading their own Reporting', () => {
  it('is unaffected: they were never viewing as anybody', async () => {
    const v = await openReporting('management', AGENCY);
    expect(text(v)).not.toMatch(/bordereau/i);
    expect(text(v)).toMatch(/Your commission/);
  });
});

/* AND THEY LOOK LIKE THE REST OF THE PAGE.
 *
 * Matt's B text: "Settlements and the bordereau export render as cards
 * matching the rest of Reporting". They were hand-rolled headers -- a
 * `.settle__head` holding a `.kpi__label` and a muted paragraph -- which is
 * the same thing CardHead draws, spelled differently in six places. Six
 * copies of a header is how two of them come to disagree about padding.
 */
describe('the settlement and bordereau panels', () => {
  it('use the shared card header rather than a hand-rolled one', async () => {
    const v = await openReporting('superadmin');
    const panels = [...v.container.querySelectorAll('.settle')];
    expect(panels.length).toBeGreaterThan(0);
    for (const p of panels) {
      // Only the panels that HAVE a header need one; a bare block is fine.
      const hand = p.querySelector('.settle__head');
      expect(hand).toBeNull();
    }
    expect(v.container.querySelector('.settle .card__head')).toBeTruthy();
  });
});
