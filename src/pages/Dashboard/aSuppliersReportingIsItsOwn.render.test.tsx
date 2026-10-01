/* =====================================================================
   A SUPPLIER'S REPORTING IS ITS OWN, AND SO IS View as OF IT.

   Matt, 2026-10-01, verbatim: "Reporting under View as Kestrel Lettings
   shows the 'Every customer' table (other agencies' referrals, fees and
   commission), the Agencies/Suppliers commission split and Settlements,
   none of which a supplier may see. First check whether a real supplier
   login (director@kestrel.dev.test) sees them too, and tell me. Then fix
   both: a supplier's Reporting, and View as of it, shows only its own
   figures, statements and agencies, never other customers or Opndoor's
   settlements."

   WHAT THE ANSWER TO THE QUESTION WAS, because it decides what this file
   has to prove. A real supplier login did NOT see the Every customer
   table and could not reach another customer's name: acting as
   director@kestrel.dev.test's uid on dev, RLS returns one application,
   one partner, one agency and two branches, all theirs, and the table is
   gated on `isOpndoorStaff`, which they are not. It DID see the payable
   split and the Settlements blocks, which are Opndoor's own surfaces.

   So there are two different defects here and the tests are split the
   same way:

     View as          showed another customer's rows. A false PREVIEW in
                      a session that could lawfully read them, not a
                      leak -- but a preview of nothing.
     The real login   got Opndoor's settlement run and payable split on
                      its own page.

   THE BOOK THESE TESTS HYDRATE CONTAINS ANOTHER CUSTOMER ON PURPOSE.
   On dev the server narrows a supplier's book to one partner, so a test
   built on a one-partner book would pass whatever the client did. Handing
   the client MORE than it may draw is the only way to assert that the
   client is the second lock and not a pass-through.
   ===================================================================== */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* Live mode, because every surface under test is gated on `d.live` /
   `liveAvailable()` and a mock-mode page draws none of them: the test
   would be green on an unfixed build. */
vi.mock('@/lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase')>()),
  SUPABASE_ENABLED: true,
}));

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { Dashboard } from './Dashboard';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { hydrateCommissionVisibility, hydratePartners, setHomePartner, ALL_PARTNERS } from '@/data';
import { KEYS } from '@/data/storage';

const D = (y: number, m: number, d: number) => new Date(y, m, d);

const app = (over: Partial<FullApp>): FullApp => ({
  ref: 'X-1', partner: 'opndoor-agents', agency: 'Regent’s Lettings',
  branch: "Regent's Park", agencyId: 'ag-1', branchId: 'br-1',
  referrer: 'Tom Reeve', referrerId: 'u-tom', referrerRole: 'referrer',
  referrerSeesCommission: false, owner: 1,
  rent: 2000, fee: 2000, agentRate: 0.25, partnerRate: 0.25,
  status: 'deed', deedState: 'executed',
  /* The PRIOR calendar month, so "Payable now" has something in it. A
     settlement block over an empty month renders different words, and a
     test that never populates it cannot tell a gate from an empty set. */
  sentAt: D(2026, 8, 10), paidAt: D(2026, 8, 20), deedAt: D(2026, 8, 25),
  tenancyStart: D(2026, 8, 26), expiry: D(2027, 8, 25),
  refunded: false, partiallyRefunded: false, withdrawn: false, expired: false,
  refundedAt: null, refundedAmount: null, refundAfterStart: false,
  deedSentAt: null, deedViewedAt: null, ...over,
} as unknown as FullApp);

/** One of OUR agencies on the house route, and one supplier. The agency is
    the "other customer" whose name must not appear on the supplier's page. */
const BOOK = [
  app({ ref: 'A-1', partner: 'opndoor-agents', agency: 'Regent’s Lettings' }),
  app({ ref: 'K-1', partner: 'kestrel-lettings', agency: 'Kestrel Lettings', branch: 'Kestrel Central' }),
];

const PARTNERS = [
  { id: 'opndoor-agents', name: 'Opndoor Agents', status: 'active', since: '2024-01', weight: 1,
    isHouse: true, referencingMode: 'opndoor_referenced', users: 1, apps: 1, rates: { partner: 0.25, agent: 0.25 } },
  { id: 'kestrel-lettings', name: 'Kestrel Lettings', status: 'active', since: '2024-01', weight: 1,
    referencingMode: 'partner_referenced', users: 1, apps: 1, rates: { partner: 0.25, agent: 0.25 } },
] as never;

beforeEach(() => {
  localStorage.clear();
  hydrateFull(BOOK);
  hydrateCommissionVisibility(true);
  hydratePartners(PARTNERS);
  setHomePartner('kestrel-lettings');
});
afterEach(() => { cleanup(); hydrateFull([]); hydrateCommissionVisibility(true); });

async function openReporting(opts: { role: string; partner?: string; scopeSel?: string }) {
  localStorage.setItem(KEYS.role, opts.role);
  if (opts.partner) localStorage.setItem(KEYS.partner, opts.partner);
  /* `partnerScope` is `selectedPartner` for an admin and `homePartner()` for
     everybody else, so a management reader is pinned here and not by the
     localStorage key -- which is the admin's picker, not their position. */
  if (opts.partner && opts.role !== 'superadmin') setHomePartner(opts.partner);
  if (opts.scopeSel) localStorage.setItem(KEYS.scopeSel, opts.scopeSel);
  const v = render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <ToastProvider><SessionProvider><PageMetaProvider><Dashboard /></PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!v.container.querySelector('.page-head')) throw new Error('not ready'); });
  await act(async () => {});
  return v;
}

/** The supplier's own director: role management, pinned to their partner. */
const asTheSupplier = () => openReporting({ role: 'management', partner: 'kestrel-lettings' });
/** An Opndoor admin with the shared scope selection on that supplier. */
const asAdminViewingThem = () => openReporting({
  role: 'superadmin', partner: 'kestrel-lettings', scopeSel: 'partner:kestrel-lettings',
});

type View = Awaited<ReturnType<typeof openReporting>>;
const text = (v: View) => v.container.textContent ?? '';

/* ===========================================================================
   THE ASSERTION MATT ASKED FOR, and it is about a NAME.

   Deliberately not "no other customer's figures": a figure is a number and
   numbers collide, so an assertion about them can pass by arithmetic
   accident. A name cannot. "Regent’s Lettings" is in the hydrated book and
   nowhere in Kestrel's business, so one substring search over the whole
   rendered page is the strongest form of this test and the hardest to
   satisfy by luck.
   =========================================================================== */
describe('a supplier’s Reporting contains no other customer’s name', () => {
  it('on the supplier’s own login', async () => {
    const v = await asTheSupplier();
    expect(text(v)).not.toContain('Regent');
  });

  /* THE ONE MATT REPORTED. Same page, same assertion, admin session. */
  it('and under View as of them', async () => {
    const v = await asAdminViewingThem();
    expect(text(v)).not.toContain('Regent');
  });

  /* AND THE PAGE IS STILL THEIRS, so the two above cannot be passed by
     rendering nothing at all. */
  it('while still being their own page', async () => {
    expect(text(await asTheSupplier())).toContain('Kestrel Lettings');
    cleanup();
    expect(text(await asAdminViewingThem())).toContain('Kestrel Lettings');
  });

  /* "SHOWS ONLY ITS OWN FIGURES, STATEMENTS AND AGENCIES" is a statement of
     what STAYS as much as of what goes. A supplier is owed money and is told
     so by a statement; removing the settlement run from their page must not
     take that with it. */
  it('and still carries their own statements', async () => {
    expect(text(await asTheSupplier())).toContain('Commission statements');
    cleanup();
    expect(text(await asAdminViewingThem())).toContain('Commission statements');
  });
});

describe('the Every customer table', () => {
  it('is absent on the supplier’s own login', async () => {
    expect((await asTheSupplier()).container.querySelector('.custtab')).toBeNull();
  });

  /* THE DEFECT. `opndoorStaff` asked who was READING, and View as does not
     change the reader; the rows under it are built with a hardcoded
     ALL_PARTNERS that no scope selection can narrow. */
  it('is absent under View as of them', async () => {
    expect((await asAdminViewingThem()).container.querySelector('.custtab')).toBeNull();
  });

  /* AND STILL THERE WHERE IT BELONGS. The table is the answer to "how is
     each customer doing" and removing it from the admin's own page would
     be a second defect, not a fix for this one. */
  it('and present for an admin on their own page', async () => {
    const v = await openReporting({ role: 'superadmin', partner: ALL_PARTNERS });
    expect(v.container.querySelector('.custtab')).toBeTruthy();
    expect(text(v)).toContain('Regent');
  });
});

describe('Opndoor’s settlements', () => {
  /* "Payable now" and "Accruing" are the settlement run; the split inside
     them names who Opndoor owes. A supplier is one of the payees, not a
     reader of the list. */
  it('are absent on the supplier’s own login', async () => {
    const v = await asTheSupplier();
    expect(v.container.querySelector('#settlements')).toBeNull();
    expect(v.container.querySelectorAll('.settle__block').length).toBe(0);
  });

  it('and absent under View as of them', async () => {
    const v = await asAdminViewingThem();
    expect(v.container.querySelector('#settlements')).toBeNull();
    expect(v.container.querySelectorAll('.settle__block').length).toBe(0);
  });

  /* AND STILL DRAWN FOR AN AGENCY, which is the regression this gate could
     cause and the reason the predicate asks about the party rather than the
     role. SettlementBlocks has two homes on purpose -- "the admin surface and
     the agency's own Reporting show the same two blocks over the same two
     windows, so the figure an agency reads and the figure Opndoor reads for
     them cannot diverge" -- and an agency Director's own payable total is
     their money, not Opndoor's.

     NOT asserted for an admin at All partners: Reporting has never drawn this
     section for them. It is `RoleOnly roles={['management']}`, and the
     admin's settlement surface is the ops Home. Writing that assertion is how
     this file would have claimed to protect something that was never there. */
  /* CHANGED 2026-10-01 ON MATT'S WORD: "Remove the top banner
     ('Settlements due... £0.00 partner / £1,601.54 agent') and the
     'Payable now' and 'Agent commission settlement' blocks for agency
     users. Under the statement, one line: 'Opndoor pays this on 15 Oct
     2026.'"

     Those blocks total Opndoor's own settlement run across both rails,
     which is why they name a partner figure beside an agent one. To an
     agency they read as money they are owed on a rail they are not on.
     What they are owed is the statement, and the line under it. */
  it('and not for one of our own agencies either, since 2026-10-01', async () => {
    const v = await openReporting({ role: 'management', partner: 'opndoor-agents' });
    expect(v.container.querySelector('#settlements')).toBeNull();
    /* What they get instead is one line under their own statement. */
    expect(v.container.textContent).toMatch(/Opndoor pays this on/);
  });
});

describe('the Agencies / Suppliers payable split', () => {
  /* The comment over this gate said "Admin only" and the gate did not: it
     tested `ownOnly`, which is false for a supplier's management because
     they do read a whole book -- their own. */
  const splitLabels = (v: View) =>
    [...v.container.querySelectorAll('.hero-kpi .muted')]
      .map((e) => (e.textContent ?? '').trim())
      .filter((t) => t === 'Agencies' || t === 'Suppliers');

  it('is absent on the supplier’s own login', async () => {
    expect(splitLabels(await asTheSupplier())).toEqual([]);
  });

  it('and absent under View as of them', async () => {
    expect(splitLabels(await asAdminViewingThem())).toEqual([]);
  });

  it('and still drawn for an admin across the estate', async () => {
    const v = await openReporting({ role: 'superadmin', partner: ALL_PARTNERS });
    expect(splitLabels(v)).toEqual(['Agencies', 'Suppliers']);
  });
});

/* ===========================================================================
   AND THE APOSTROPHE.

   "Also fix 'Kestrel Lettings's' to 'Kestrel Lettings''." `possessive()` in
   lib/format has been right about this since it was written; two call sites
   appended `'s` by hand instead, and most letting agency names end in s.
   =========================================================================== */
describe('a name that ends in s', () => {
  it('takes a bare apostrophe anywhere on the page', async () => {
    const t = text(await asAdminViewingThem());
    expect(t).not.toContain("Kestrel Lettings's");
    expect(t).not.toContain('Kestrel Lettings’s');
  });
});
