/* NM-M. VIEW AS MOVES TO THE PARTY'S OWN PAGE, AND THE PICKER GOES.
 *
 * Matt, 2026-09-30, verbatim: "NM-M: keep View as, moved to a 'View as'
 * button on each agency and supplier page; delete the Reporting scope
 * picker."
 *
 * WHY THIS WAS PUT TO HIM RATHER THAN DECIDED. NM-F said "the scope picker
 * is deleted", and the picker is not only a picker: it writes `scopeSel`,
 * `viewingAs` derives from it, and Reporting reads `viewingAs` in four
 * places. Deleting it alone would have removed the ability to read a
 * party's own Reporting page -- a capability asked for the previous week.
 * He kept it and moved it.
 *
 * ONE CONSEQUENCE THAT IS NOT IN HIS SENTENCE, and is asserted here because
 * it is the difference between a working control and a trap. **The picker
 * was the only way to STOP viewing as.** A button that starts it needs
 * something that ends it, and `scopeSel` is shared with Applications, so an
 * admin who views as Regent and cannot stop would find that list narrowed
 * too, with no control on either screen. Hence the banner.
 *
 * ---------------------------------------------------------------------
 * REWRITTEN 2026-09-30, AFTER AN AUDIT FOUND THE SHIPPED CONTROL BROKEN.
 *
 * What the twelve assertions below originally proved: that pressing the
 * button wrote the right string to localStorage and that a banner appeared
 * with the right words in it. Every one passed. None of them looked at a
 * NUMBER, and the number was the thing that was wrong.
 *
 * `partnerFor` turns a selection into the partner scope every figure on
 * Reporting is keyed on, and it can only do that when the selection names a
 * partner. On the agency rail the partner is a ROUTE shared by every
 * agency, so `agency:` and `group:` both leave the scope at ALL_PARTNERS;
 * the narrowing was supposed to happen afterwards in `scopeFull`'s fourth
 * argument, which no production call site passes. So "View as Regent's
 * Lettings" put "This is the page their management sees" over Opndoor's
 * whole estate.
 *
 * The older test that looked like it covered this -- viewAsIsTheParty,
 * describe block "the same admin, viewing as one of our agencies" --
 * actually stages `partner:northwind`, the supplier-shaped arm that DOES
 * narrow. So the agency path had never been measured by anything.
 *
 * MATT'S STOPGAP, verbatim: "hide View as on agency and group pages, keep
 * it on supplier pages where it works, and make sure no banner can claim a
 * party the figures don't reflect."
 *
 * So this file now asserts the stopgap, and it asserts it by MEASURING A
 * FIGURE, not by reading a caption. The proper fix is recorded in QUEUE.md
 * as the first item after shipping; when it lands, the group and agency
 * blocks below come back and this header goes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { Dashboard } from './Dashboard';
import { AgencyHome } from '@/pages/Agencies/AgencyHome';
import { PartnerHome } from '@/pages/PartnerManagement/PartnerHome';
import { Applications } from '@/pages/Applications/Applications';
import { KEYS } from '@/data/storage';
import { hydrateCommissionVisibility, getAgencies, getPartners, hydrateGroups, hydrateOrg, partnerName, ALL_PARTNERS } from '@/data';
import { hydrateFull, type FullApp } from '@/data/applicationsService';
import { ORG_SEED } from '@/data/mock/org';
import type { Agency } from '@/data';

const AGENCY = getAgencies(ALL_PARTNERS).filter((a) => !a.isPlaceholder)[0];
const SUPPLIER = getPartners()[0];

/* A BOOK WITH EXACTLY TWO CUSTOMERS IN IT: one of our agencies, carried on
   the house partner, and one real supplier. Two is the smallest book in
   which "did the page narrow" is a question with a visible answer, and the
   per-customer table on Reporting names both, so the answer can be read off
   the screen instead of computed. This fixture is the thing the original
   twelve assertions did without, which is why they could all pass while
   every figure on the page was wrong. */
const D = (y: number, m: number, d: number) => new Date(y, m, d);
const app = (over: Partial<FullApp>): FullApp => ({
  ref: 'GR-VA-1', partner: 'opndoor-agents', agency: AGENCY.name,
  branch: 'Chelsea', agencyId: AGENCY.id, branchId: 'br-1',
  referrer: 'Tom Reeve', referrerId: 'u-tom', referrerRole: 'referrer',
  referrerSeesCommission: false, owner: 1,
  rent: 2000, fee: 2000, agentRate: 0.25, partnerRate: 0.25,
  status: 'deed', deedState: 'executed',
  sentAt: D(2026, 3, 10), paidAt: D(2026, 3, 20), deedAt: D(2026, 4, 1),
  tenancyStart: D(2026, 4, 2), expiry: D(2027, 4, 1),
  refunded: false, partiallyRefunded: false, withdrawn: false, expired: false,
  refundedAt: null, refundedAmount: null, refundAfterStart: false,
  deedSentAt: null, deedViewedAt: null,
  ...over,
} as unknown as FullApp);

const BOOK = [
  app({ ref: 'GR-AGENCY' }),
  app({ ref: 'GR-SUPPLIER', partner: SUPPLIER.id, agency: partnerName(SUPPLIER.id) }),
];

/** Both customers, which is what the page shows when it has not narrowed. */
const estateWide = [AGENCY.name, partnerName(SUPPLIER.id)].sort();

beforeEach(() => { localStorage.clear(); hydrateFull(BOOK); hydrateCommissionVisibility(true); });
afterEach(() => {
  cleanup();
  hydrateFull([]);
  hydrateCommissionVisibility(true);
  // The selection is remembered and shared with Applications, so it outlives
  // the component and would hand the next test a narrowed book.
  localStorage.removeItem(KEYS.scopeSel);
  localStorage.removeItem(KEYS.scopeRecents);
  localStorage.removeItem(KEYS.partner);
});

async function open(role: string, path: string) {
  localStorage.setItem('grp_role', role);
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider><SessionProvider><PageMetaProvider>
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/applications" element={<Applications />} />
          <Route path="/agencies/:key" element={<AgencyHome />} />
          <Route path="/partners/:key" element={<PartnerHome />} />
        </Routes>
      </PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.page-head')) throw new Error('not ready'); });
  await act(async () => {});
  return view;
}

/**
 * STAGE A SELECTION THE WAY THE APP MAKES ONE.
 *
 * Writing `scopeSel` alone is NOT what happens when a user chooses a party,
 * and a test that does it measures a state the product cannot produce. The
 * single writer is `SessionContext.setScopeSel`, and it does two things:
 * persists the selection, and calls `setSelectedPartner(partnerFor(v))`.
 * `partnerFor` yields a real slug for `partner:<slug>` and ALL_PARTNERS for
 * everything else -- which is the whole reason an agency selection narrows
 * nothing, so a test that skipped this step could never see it.
 *
 * Found by this file's own first run: staging `partner:<slug>` without the
 * partner key left the supplier case looking as broken as the agency one,
 * which would have been a false accusation against the one arm that works.
 */
function stageSelection(sel: string) {
  localStorage.setItem(KEYS.scopeSel, sel);
  localStorage.setItem(KEYS.partner, sel.startsWith('partner:') ? sel.slice('partner:'.length) : ALL_PARTNERS);
}

type View = Awaited<ReturnType<typeof open>>;
const buttons = (v: View) => [...v.container.querySelectorAll('button, a')].map((b) => (b.textContent ?? '').trim());
const viewAsButton = (v: View) =>
  [...v.container.querySelectorAll<HTMLElement>('button, a')].find((b) => (b.textContent ?? '').trim() === 'View as');

describe('the Reporting scope picker', () => {
  /* THE DELETION MATT ASKED FOR. */
  it('is gone from Reporting', async () => {
    const v = await open('superadmin', '/dashboard');
    expect(v.container.querySelector('.scopepick')).toBeNull();
  });

  /* AND IS STILL ON APPLICATIONS, which is a different job on a different
     screen: narrowing a list, not choosing whose report to read. Walk fix 7
     fixed it there and NM-F's deletion was only ever about Reporting.

     THIS USED TO BE `expect(true).toBe(true)` with a comment pointing at
     another file, which an audit called out and was right to. A test named
     for a behaviour that exercises no code is worse than no test: it counts
     in the total, it goes green when the behaviour is deleted, and it reads
     as coverage. If the claim is worth a name here it is worth a render
     here, and the two-line render below is what it costs.

     It also matters more than it did this morning. With `viewingAs`
     narrowed to `partner:` selections, this picker is the ONLY control in
     the product that can write an `agency:` or `group:` value -- which is
     precisely how one still reaches Reporting and why the stopgap had to
     go in SessionContext rather than on the button. */
  it('while Applications keeps its own, which item 7 fixed', async () => {
    const v = await open('superadmin', '/applications');
    expect(v.container.querySelector('.scopepick'), 'no Origin picker on Applications').toBeTruthy();
  });
});

describe('the View as button is NOT on an agency page', () => {
  /* MATT'S STOPGAP. It was there for half a day and it lied about every
     number on the page it led to. */
  it('is not offered, even to an Opndoor admin', async () => {
    const v = await open('superadmin', `/agencies/${encodeURIComponent(AGENCY.name)}`);
    expect(buttons(v)).not.toContain('View as');
  });

  it('nor to the agency’s own people', async () => {
    const v = await open('management', `/agencies/${encodeURIComponent(AGENCY.name)}`);
    expect(buttons(v)).not.toContain('View as');
  });
});

describe('the View as button is NOT on a group page either', () => {
  const GROUP = { id: 'grp-abc', partner: 'northwind', name: 'ABC group' };

  beforeEach(() => {
    hydrateGroups([GROUP]);
    const seeded: Agency[] = ORG_SEED.map((a, i) => (i < 2 ? { ...a, groupId: GROUP.id } : { ...a }));
    hydrateOrg(seeded);
  });
  afterEach(() => { hydrateGroups([]); hydrateOrg(ORG_SEED.map((a) => ({ ...a }))); });

  /* THE GROUP FIXTURE STAYS even though the button is gone, because it is
     the only group anything in this suite has ever had and the proper fix
     will need it back. Deleting it would mean re-deriving it later, which
     is how the group arm ended up untested the first time. */
  it('opens the group’s own page', async () => {
    const v = await open('superadmin', `/agencies/${encodeURIComponent(GROUP.id)}`);
    expect(v.container.querySelector('.page-head__title')?.textContent).toBe(GROUP.name);
  });

  it('and offers no View as there', async () => {
    const v = await open('superadmin', `/agencies/${encodeURIComponent(GROUP.id)}`);
    expect(buttons(v)).not.toContain('View as');
  });

  /* AND THE BANNER CANNOT BE REACHED BY THE BACK DOOR. Hiding the button is
     not the whole stopgap: `scopeSel` is one selection shared with
     Applications, whose Origin picker still writes `group:` values, and it
     is restored from localStorage on every load. So the test that matters
     stages the selection directly, as arriving from Applications would. */
  it('and a group selection arriving from Applications raises no banner', async () => {
    stageSelection(`group:${GROUP.id}`);
    const v = await open('superadmin', '/dashboard');
    expect(v.container.textContent).not.toMatch(/Viewing as/);
    expect(buttons(v)).not.toContain('Stop viewing as');
  });
});

describe('the View as button on a supplier page', () => {
  it('is offered, and selects that supplier', async () => {
    const v = await open('superadmin', `/partners/${encodeURIComponent(SUPPLIER.id)}`);
    expect(buttons(v)).toContain('View as');
    await act(async () => { viewAsButton(v)!.click(); });
    expect(localStorage.getItem(KEYS.scopeSel)).toBe(`partner:${SUPPLIER.id}`);
  });
});

describe('and Reporting only names a party whose figures it is actually showing', () => {
  /* THE ASSERTION THAT WOULD HAVE CAUGHT THIS, AND DID NOT EXIST.
     It reads a NUMBER off the page. Which number matters: the per-customer
     table is deliberately estate-wide whatever the selection (Dashboard.tsx
     says so: "every customer at once -- narrowing it to one would make it
     the table the picker already gives"), so measuring that would prove
     nothing either way. The funnel's first stage is keyed on `partnerScope`
     like every other figure here, so it moves when the page narrows.

     Measured rather than hardcoded. On today's mock book the three values
     are 129 estate-wide, 86 for a supplier and 129 for an agency, but
     pinning those would make this a fixture test instead of a behaviour
     one. */
  const funnelSent = (v: View) =>
    Number((v.container.querySelector('.fstage .fstage__count')?.textContent ?? '').replace(/[^0-9]/g, ''));

  async function sentUnder(sel: string | null): Promise<number> {
    cleanup();
    localStorage.clear();
    hydrateFull(BOOK);
    if (sel) stageSelection(sel);
    const v = await open('superadmin', '/dashboard');
    const n = funnelSent(v);
    expect(n, 'no funnel on the page, so this measures nothing').toBeGreaterThan(0);
    return n;
  }

  it('a supplier selection really does narrow the figures, which is why that one stays', async () => {
    const estate = await sentUnder(null);
    const supplier = await sentUnder(`partner:${SUPPLIER.id}`);
    expect(supplier).toBeLessThan(estate);
  });

  it('and names that supplier while it does', async () => {
    stageSelection(`partner:${SUPPLIER.id}`);
    const v = await open('superadmin', '/dashboard');
    expect(v.container.textContent).toMatch(/Viewing as/);
    expect(buttons(v)).toContain('Stop viewing as');
  });

  /* THE STOPGAP, AND BOTH HALVES TOGETHER ON PURPOSE.
     An agency selection narrows nothing, so nothing on the page may claim
     it has. Asserting the silence alone would also pass if somebody
     silenced the banner AND fixed the figures, which would be a
     regression; asserting the estate total alone would pass on a page with
     the banner still lying. The pair says: while these numbers are the
     estate's, no party is named. */
  it('an agency selection narrows nothing, and so the page names nobody', async () => {
    const estate = await sentUnder(null);
    const underAgency = await sentUnder(`agency:${AGENCY.name}`);
    expect(underAgency, 'the figures narrowed, so the banner should come back')
      .toBe(estate);

    stageSelection(`agency:${AGENCY.name}`);
    const v = await open('superadmin', '/dashboard');
    expect(v.container.textContent).not.toMatch(/Viewing as/);
    expect(buttons(v)).not.toContain('Stop viewing as');
  });

  /* THE COMMISSION EYEBROW WAS THE SECOND PLACE THAT NAMED A PARTY, off the
     same `viewingAs`. Narrowing the derivation fixes both; this says so
     rather than leaving it to be rediscovered. */
  it('and the commission heading does not put the estate under an agency’s name', async () => {
    stageSelection(`agency:${AGENCY.name}`);
    const v = await open('superadmin', '/dashboard');
    const esc = AGENCY.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expect(v.container.textContent ?? '').not.toMatch(new RegExp(`${esc}[\u2019']s commission`));
  });

  it('and stopping clears the selection, so both screens widen again', async () => {
    stageSelection(`partner:${SUPPLIER.id}`);
    const v = await open('superadmin', '/dashboard');
    const stop = [...v.container.querySelectorAll<HTMLElement>('button')]
      .find((b) => (b.textContent ?? '').trim() === 'Stop viewing as')!;
    await act(async () => { stop.click(); });
    expect(localStorage.getItem(KEYS.scopeSel) ?? '').toBe('');
  });

  it('and says nothing when not viewing as anybody', async () => {
    const v = await open('superadmin', '/dashboard');
    expect(v.container.textContent).not.toMatch(/Viewing as/);
    expect(buttons(v)).not.toContain('Stop viewing as');
  });
});
