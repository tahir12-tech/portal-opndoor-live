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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { selectionIsAgency } from '@/data/origin';
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
  /* AND AN AGENCY IN KESTREL'S ESTATE WITH A NAME OF ITS OWN, added
     2026-10-02 for the via-label rule below. Frost Partnership is the
     real case: dev holds one in Opndoor's estate and one in Kestrel's,
     which is why the label exists at all, and it is the name that must
     NOT be labelled on Kestrel's own page. */
  app({ ref: 'K-2', partner: 'kestrel-lettings', agency: 'Frost Partnership', branch: 'Frost Central' }),
];

const PARTNERS = [
  { id: 'opndoor-agents', name: 'Opndoor Agents', status: 'active', since: '2024-01', weight: 1,
    isHouse: true, referencingMode: 'opndoor_referenced', users: 1, apps: 1, rates: { partner: 0.25, agent: 0.25 }, kind: 'agency' },
  { id: 'kestrel-lettings', name: 'Kestrel Lettings', status: 'active', since: '2024-01', weight: 1,
    referencingMode: 'partner_referenced', users: 1, apps: 1, rates: { partner: 0.25, agent: 0.25 }, kind: 'supplier' },
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
  /* VIEW AS IS A LINK NOW, so the harness arrives the way a reader does:
     Reporting clears the selection on arrival (Matt, 2026-10-02) and
     `ViewAsButton` navigates to /dashboard?origin=<selection>. The
     stored key is kept, because it is still what the session reads
     before the effect runs. */
  const at = opts.scopeSel ? `/dashboard?origin=${encodeURIComponent(opts.scopeSel)}` : '/dashboard';
  const v = render(
    <MemoryRouter initialEntries={[at]}>
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

/* ===========================================================================
   KESTREL'S OWN REPORTING, 2026-10-02.

   Matt, reading it:
     1. "Don't add '(via Kestrel Lettings)' to agency and branch names in
        the supplier's own view; it's only needed where Opndoor sees both
        estates."
     2. "'Kestrel Lettings' commission': show Kestrel's own statement
        first (its total, reference and downloads), with its agencies'
        schedules beneath it, not a single agency's statement as the
        headline."

   WHY THE HEADLINE WAS WRONG, which is what the second test pins. The
   panel under that heading lists the payees in Kestrel's ESTATE -- its
   agencies -- biggest first. So the heading named the supplier and the
   figure beneath it was one agency's: a different company's money, and a
   smaller number than the one Kestrel is paid. Kestrel's own statement
   is a different accumulator (built server-side, see SupplierStatements)
   and was on the page several sections further down, under a heading of
   its own, which is why no amount of re-sorting the panel would have
   fixed it.
   =========================================================================== */
describe('the supplier’s own Reporting', () => {
  /* ONE SEARCH OVER THE WHOLE PAGE, for the same reason the Regent's
     assertion above is one: the label is a suffix on a name and it can
     appear in a chart, a table, a subtitle or a payee row. Asking each
     surface separately is how one of them keeps it. */
  it('does not label its own agencies with itself', async () => {
    expect(text(await asTheSupplier())).not.toContain('(via Kestrel Lettings)');
  });

  it('and neither does View as of them, which is the same page', async () => {
    expect(text(await asAdminViewingThem())).not.toContain('(via Kestrel Lettings)');
  });

  /* THE HALF THAT MUST NOT MOVE. The label is the only thing telling the
     two Frost Partnerships apart on a screen that shows both, so an
     admin across the estate still gets it. A fix that simply deleted the
     label would pass the two tests above and lose the reason for them. */
  it('while an admin across both estates still gets it', async () => {
    const v = await openReporting({ role: 'superadmin', partner: ALL_PARTNERS });
    expect(text(v)).toContain('(via Kestrel Lettings)');
  });

  /* THE ORDER, read off the DOM rather than off the text: two cards, and
     the question is which comes first. `.stmt__ref` and the "Commission
     statements" head belong to the supplier's own card; "Agency
     schedules" is the title the per-agency panel takes on this page. */
  it('shows the supplier’s own statement above its agencies’ schedules', async () => {
    const v = await asTheSupplier();
    const heads = [...v.container.querySelectorAll('.card__head, .card-head, h2, h3')]
      .map((e) => (e.textContent ?? '').trim());
    const own = heads.findIndex((h) => h.includes('Commission statements'));
    const agencies = heads.findIndex((h) => h.includes('Agency schedules'));
    expect(own, 'the supplier’s own statements card is not on the page').toBeGreaterThan(-1);
    expect(agencies, 'the agency schedules card is not on the page').toBeGreaterThan(-1);
    expect(own).toBeLessThan(agencies);
  });

  /* AND IT IS DRAWN ONCE. It used to be mounted lower down; moving it
     without removing the old mount would build the same bundle twice and
     show the same figure twice under one heading. */
  it('and the supplier’s own statements card is drawn exactly once', async () => {
    const v = await asTheSupplier();
    const heads = [...v.container.querySelectorAll('.card__head, .card-head, h2, h3')]
      .map((e) => (e.textContent ?? '').trim())
      .filter((h) => h.includes('Commission statements'));
    expect(heads.length).toBe(1);
  });

  /* AN AGENCY IN THE SUPPLIER'S ESTATE IS NOT THE SUPPLIER. Under View as
     of one of Kestrel's agencies the scope is STILL Kestrel -- every
     agency in its estate hangs off that partner -- so `partyIsSupplier`
     alone would headline the supplier's own statement while the reader is
     looking at one agency's page.

     ASSERTED ON THE GATE, not by mounting it. Resolving an `agency:`
     selection needs the org tree hydrated, and this file deliberately
     hydrates only a book: its whole method is handing the client more
     applications than it may draw. Adding an org here to reach one
     clause would change the fixture every other test in the file reads.
     So the two halves are asked where each one lives: the predicate
     answers for the selection, and the page is asked whether it consults
     it. */
  it('and an agency selection is not the supplier’s own page', () => {
    expect(selectionIsAgency('agency:Frost Partnership')).toBe(true);
    expect(selectionIsAgency('partner:kestrel-lettings')).toBe(false);
    const src = readFileSync(join(process.cwd(), 'src/pages/Dashboard/Dashboard.tsx'), 'utf8');
    expect(src).toContain(
      'const supplierOwnPage = supplierFacing && (viewingAs === null || !selectionIsAgency(viewingAs));',
    );
  });
});

/* ===========================================================================
   AND NOTHING ABOUT ROUTES OR OPNDOOR'S SETTLEMENT RUN, 2026-10-03.

   Matt: "Reporting as a supplier (Kestrel's own login and 'View as'): hide
   the 'Commission by route' table; it's Opndoor-only. The supplier's
   commission is already shown in the summary and its statement. Check
   nothing else on a supplier's or agency's Reporting mentions routes, other
   suppliers, or Opndoor's settlement process."

   THE SAME MISS AS 2026-10-01, TWICE MORE. Both surfaces were gated on
   `!agencyFacing`, written when the only non-agency reader WAS Opndoor. A
   supplier reading its own page is the third case, and it fell on Opndoor's
   side of both gates:

     Commission by route   lists the three rails and EVERY supplier, so
                           Kestrel saw its competitors and what Opndoor pays
                           them
     the settlement banner totals Opndoor's settlement run across both rails

   THE OTHER CUSTOMER'S NAME IS THE ASSERTION, for the reason the top of this
   file gives: a figure can collide by arithmetic accident and a name cannot.
   =========================================================================== */
describe('Commission by route', () => {
  const routeHeads = (v: View) =>
    [...v.container.querySelectorAll('.card__head, .card-head, h2, h3')]
      .map((e) => (e.textContent ?? '').trim())
      .filter((t) => t.includes('Commission by route'));

  it('is absent on the supplier’s own login', async () => {
    expect(routeHeads(await asTheSupplier())).toEqual([]);
  });

  it('and absent under View as of them, which is the same page', async () => {
    expect(routeHeads(await asAdminViewingThem())).toEqual([]);
  });

  /* THE HALF THAT MUST NOT MOVE. It is Opndoor's own table and Opndoor keeps
     it; a fix that simply deleted it would pass the two tests above. */
  it('while an admin across the estate still has it', async () => {
    const v = await openReporting({ role: 'superadmin', partner: ALL_PARTNERS });
    expect(routeHeads(v).length).toBeGreaterThan(0);
  });
});

describe('the gates that were written when Opndoor was the only other reader', () => {
  /* ASSERTED ON THE SOURCE, because what was wrong is WHICH predicate each
     one asks, and both versions render identically for an agency -- the only
     reader the old gate was ever tested against. */
  const DASH = readFileSync(join(process.cwd(), 'src/pages/Dashboard/Dashboard.tsx'), 'utf8');

  it('the route table asks for Opndoor staff, not merely "not an agency"', () => {
    expect(DASH).toContain('{d.live && partnerBreakdown.length > 0 && opndoorStaff && (');
    expect(DASH).not.toContain('{d.live && partnerBreakdown.length > 0 && !agencyFacing && (');
  });

  it('and the settlement banner excludes a supplier as well as an agency', () => {
    expect(DASH).toContain('&& !agencyFacing && !supplierFacing && (partnerDue > 0 || agentDue > 0);');
  });
});
