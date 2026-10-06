/* THE BLANK REPORTING PAGE, ON THE PAGE. OPNDOOR'S OPS STAFF.
 *
 * Matt, 2026-09-30: "Also fix the blank Reporting page for opndoor_manager."
 *
 * THE DATA-LAYER HALF IS IN src/data/opndoorManagerReadsTheBook.test.ts, and
 * it was written first because that is where the defect was found. It is not
 * the whole defect. Fixing `scopeFull` alone leaves this page exactly as
 * blank as it was, because FOUR separate allowlists, in three files, each
 * omit this role independently:
 *
 *   1. paymentMetrics.scopeFull        the set every figure is built from
 *   2. SessionContext.partnerScope     pins them to a home partner they
 *                                      do not have, so scopeFull's FIRST
 *                                      filter empties the set before the
 *                                      role allowlist is even reached
 *   3. analyticsService.ownOnly x2     the page's COPY ("your referrals")
 *   4. the RoleOnly gates on this      nine of them, plus canSeeSettlements
 *      page, by name
 *
 * AND A FIFTH THAT MAKES ANY TEST OF THIS ROLE A LIE UNTIL IT IS FIXED.
 * SessionContext.KNOWN_ROLES never learned 'opndoor_manager', and
 * initialRole() falls back to LEAST_PRIVILEGED_ROLE for anything not on it.
 * So in mock and test mode -- where there is no Supabase profile to correct
 * it -- `localStorage.setItem('grp_role', 'opndoor_manager')` silently
 * stages a NEGOTIATOR. Every assertion below would have passed or failed
 * for the wrong reason, and an earlier assertion of mine in
 * viewAsMovesToTheParty.render.test.tsx did exactly that until this was
 * found. In Supabase mode it is a wrong-role flash on every page load
 * instead, corrected when the profile lands.
 *
 * SO THE FIRST ASSERTION HERE IS THAT THE ROLE IS THE ROLE. It looks like
 * testing the test harness. It is: this harness was lying.
 *
 * WHAT THEY MUST NOT GAIN. Reading the book and seeing what it earns are two
 * permissions, and migration 20261005170000 is explicit that
 * may_see_commission is "never true for opndoor_manager, who is Opndoor
 * operations and has never seen commission." Widening a page by adding a
 * role to nine allowlists is exactly the change that hands over a tenth
 * thing by accident, so every commission surface is asserted absent below.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider, useSession } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { Dashboard } from './Dashboard';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { hydrateCommissionVisibility } from '@/data';

const D = (y: number, m: number, d: number) => new Date(y, m, d);

const app = (over: Partial<FullApp>): FullApp => ({
  ref: 'GR-OM-1', partner: 'opndoor-agents', agency: 'Regent’s Lettings',
  branch: "Regent's Park", agencyId: 'ag-1', branchId: 'br-1',
  referrer: 'Tom Reeve', referrerId: 'u-tom', referrerRole: 'referrer',
  referrerSeesCommission: false,
  /* owner: 0. Opndoor's ops staff own no referral, which is the whole
     reason the referrer arm of the allowlist cannot be the fix. */
  owner: 0,
  rent: 2000, fee: 2000, agentRate: 0.25, partnerRate: 0.25,
  status: 'deed', deedState: 'executed',
  sentAt: D(2026, 3, 10), paidAt: D(2026, 3, 20), deedAt: D(2026, 4, 1),
  tenancyStart: D(2026, 4, 2), expiry: D(2027, 4, 1),
  refunded: false, partiallyRefunded: false, withdrawn: false, expired: false,
  refundedAt: null, refundedAmount: null, refundAfterStart: false,
  deedSentAt: null, deedViewedAt: null,
  ...over,
} as unknown as FullApp);

/* An agency and a supplier, so "the whole book" is a real claim and not one
   partner seen twice. */
const BOOK = [
  app({ ref: 'GR-AG' }),
  app({ ref: 'GR-SUP', partner: 'harbourside', agency: 'Harbourside Homes' }),
];

beforeEach(() => { localStorage.clear(); hydrateFull(BOOK); hydrateCommissionVisibility(true); });
afterEach(() => { cleanup(); hydrateFull([]); hydrateCommissionVisibility(true); });

/** Reports back what the session actually resolved the staged role to. */
function RoleProbe({ onRole }: { onRole: (r: string) => void }) {
  const { role } = useSession();
  onRole(role);
  return null;
}

async function openReporting(role: string) {
  localStorage.setItem('grp_role', role);
  let resolved = '';
  const view = render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <ToastProvider><SessionProvider><PageMetaProvider>
        <RoleProbe onRole={(r) => { resolved = r; }} />
        <Dashboard />
      </PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.page-head')) throw new Error('not ready'); });
  await act(async () => {});
  return { ...view, resolvedRole: () => resolved };
}

type View = Awaited<ReturnType<typeof openReporting>>;
const text = (v: View) => v.container.textContent ?? '';

describe('the harness, before anything it reports can be believed', () => {
  it('stages an opndoor manager and gets an opndoor manager', async () => {
    const v = await openReporting('opndoor_manager');
    expect(v.resolvedRole()).toBe('opndoor_manager');
  });

  /* AND THE FALLBACK IS STILL THE LEAST PRIVILEGED ONE for a role nobody
     has named, which is the property KNOWN_ROLES exists for: forgetting to
     add a role costs access rather than granting it. Asserted so that
     "teach it the role" is not done by deleting the list. */
  it('while a role nobody has named still falls to the least privileged', async () => {
    const v = await openReporting('archivist');
    expect(v.resolvedRole()).toBe('referrer');
  });
});

describe('what Opndoor’s ops staff read on Reporting', () => {
  /* THE DEFECT AS MATT REPORTED IT: the page was blank. These are the
     sections an admin gets, each behind its own allowlist. */
  it('the hero figures, rather than an empty page', async () => {
    const v = await openReporting('opndoor_manager');
    expect(text(v)).toMatch(/Net fees/);
  });

  it('the volume charts', async () => {
    const v = await openReporting('opndoor_manager');
    expect(text(v)).toMatch(/Volume by referrer/);
    expect(v.container.querySelectorAll('.bars .bar').length).toBeGreaterThan(0);
  });

  it('and the monthly trend', async () => {
    const v = await openReporting('opndoor_manager');
    expect(text(v)).toMatch(/Monthly volume trend/);
  });

  it('and the per-customer table, with every customer in the estate', async () => {
    const v = await openReporting('opndoor_manager');
    const names = [...v.container.querySelectorAll('.custtab tbody tr td:first-child a')]
      .map((a) => a.textContent ?? '').sort();
    expect(names).toEqual(['Harbourside Homes', 'Regent’s Lettings']);
  });

  /* THE COPY HAS TO AGREE WITH THE FIGURES. `ownOnly` is a fourth allowlist
     on the same page and it drives the words: leave it and the page says
     "your referrals" and "your agency" over Opndoor's whole estate, which
     is a worse page than the blank one because it is confidently wrong. */
  it('and the page calls it the estate, not "yours"', async () => {
    const v = await openReporting('opndoor_manager');
    expect(text(v)).not.toMatch(/your referrals/i);
    expect(text(v)).not.toMatch(/your agency/i);
  });
});

describe('but never what the estate earns', () => {
  /* THE LINE MIGRATION 20261005170000 DRAWS, held on the client. Nine
     allowlists were widened to fix this page; this is the assertion that
     says a tenth was not. */
  it('no commission tile, statement or column', async () => {
    const v = await openReporting('opndoor_manager');
    expect(text(v)).not.toMatch(/Commission payable/);
    expect(text(v)).not.toMatch(/Commission earned/);
    expect(text(v)).not.toMatch(/Your commission/);
    expect(text(v)).not.toMatch(/Commission by partner/);
    // The hero's commission tile carries its own class, so this is the
    // structural half of the same assertion and does not rely on wording.
    expect(v.container.querySelector('.comm-headline')).toBeNull();
  });

  /* AND THE VOLUME BESIDE IT IS REAL, so the assertion above is not passing
     because the page is still blank. This is the pairing that the
     data-layer test makes with feesGross, made here on the page. */
  it('while the volume beside it is real, so the absence means something', async () => {
    const v = await openReporting('opndoor_manager');
    expect(v.container.querySelectorAll('.custtab tbody tr').length).toBe(2);
  });

  /* THE MONEY-OPS STACK IS A SEAT, NOT A CAPABILITY. Settlements and the
     bordereau are Opndoor's own payment run; the ops role is admitted to
     the report, not to the cheque book. */
  it('and no settlement stack, and no bordereau', async () => {
    const v = await openReporting('opndoor_manager');
    expect(text(v)).not.toMatch(/Settlements/);
    expect(text(v)).not.toMatch(/Underwriter bordereau/);
    expect(v.container.querySelector('.settle')).toBeNull();
  });
});

describe('and the admin’s own page is unchanged', () => {
  /* THE CONTROL. Several allowlists were widened at once, and the likeliest
     way to get one wrong is to move something for the reader they were
     already right for. Every surface asserted absent above is asserted
     present here, off the same fixture. */
  it('an admin still gets the commission tile and the settlements', async () => {
    const v = await openReporting('superadmin');
    expect(text(v)).toMatch(/Commission payable/);
    expect(v.container.querySelector('.comm-headline')).toBeTruthy();
    expect(text(v)).toMatch(/Settlements/);
    expect(text(v)).toMatch(/Underwriter bordereau/);
  });

  it('and still the figures, so the control is a real comparison', async () => {
    const v = await openReporting('superadmin');
    expect(text(v)).toMatch(/Net fees/);
    expect(v.container.querySelectorAll('.custtab tbody tr').length).toBe(2);
  });
});
