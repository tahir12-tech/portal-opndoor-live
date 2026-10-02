/* THE OVERVIEW AS A NAVIGABLE TREE.

   Five rulings, all about the same screen.

   1. A node's NAME opens that node; the tick beside it expands the tree. One
      click used to do both jobs, which meant a branch could not be opened at
      all: a branch has nothing under it, so "expand" was a no-op and the only
      thing a branch name did was toggle a strip of read-only people pills.
   2. Those pills said "Branch manager" / "Agency manager" / "Group director",
      which is where somebody SITS. The ladder is Director / Manager /
      Negotiator and it is what somebody IS. A Director and a Manager standing
      on the same branch read identically.
   3. An agency with one office drew a branch node holding the same people and
      the same referrals under a nearly identical name. It is merged into the
      agency card, and the office is still a link because its deed recipient
      and its own rate live in the branch view.
   4. "Set rate" was offered on a party priced by an agreement, where the
      database refuses it. The deal itself stands there instead.
   5. The payout line printed a rate without saying where it came from, so a
      negotiated 20% and the Opndoor standard 20% were the same five
      characters.

   The group here is deliberate: Regent has one office and Kestrel has two, so
   the merge has to be decided per agency. A page-level "how many offices"
   count, which is what the People tab uses, spans the whole group and would
   never merge Regent. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { App } from '@/App';
import { hydrateOrg, hydrateGroups } from '@/data/orgService';
import { hydratePartners } from '@/data/partnersService';
import { hydrateUsers } from '@/data/usersService';
import type { ManagedUser } from '@/data/usersService';
import type { Agency, AgencyGroup, Partner } from '@/data/types';

const HOUSE = 'opndoor-agents';

/* Regent's real deal on dev: one tenant three weeks at 20%, two or more five
   weeks at 25%. Mocked because getAgreementForAgency and getCommissionSplits
   both return nothing whenever Supabase is off, which under vitest is always. */
const REGENT_AGREEMENT = {
  agreementId: 'agr-1', scopeLevel: 'agency', coverage: 'additive' as const,
  period: 'year', countingScope: 'agency', isStandard: false, note: null,
  periodStart: '2026-09-23', volume: 0,
  /* ONE ROUTE, which is the ordinary case and must keep reading as a single
     counter. The two-route case is asserted separately below. */
  volumes: [{ routeId: 'p-house', route: 'Opndoor agents', count: 0 }],
  bands: [
    { min: 1, max: 1, weeks: 3, unit: 'weeks' as const, rate: 0.2 },
    { min: 2, max: null, weeks: 5, unit: 'weeks' as const, rate: 0.25 },
  ],
  tiers: [],
  nextRate: 0.2, nextBasis: 3,
};

/* WHO IS PLACED WHERE. A Negotiator reaches a branch by their home branch, but
   a Director and a Manager reach one through user_scopes, which is empty in
   mock mode. Without this the branch holds only Tom and the pair that the old
   pill could not tell apart is not on the page to tell apart. */
vi.mock('@/data/positionsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/positionsService')>();
  return {
    ...actual,
    getPositionsForUsers: async () => ({
      'u-rosa': [{ id: 'p1', kind: 'branch' as const, targetId: 'br-hampstead', targetName: 'Regent Hampstead' }],
      'u-nadia': [{ id: 'p2', kind: 'branch' as const, targetId: 'br-hampstead', targetName: 'Regent Hampstead' }],
      'u-tom': [],
    }),
  };
});

/* The agreement the mock hands back. A let rather than a spy because the mock
   below replaces getAgreementForAgency with a plain function, which vi.spyOn
   cannot intercept. Tests that need a different deal assign to this. */
let AGREEMENT_OVERRIDE: unknown = null;

vi.mock('@/data/orgService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/orgService')>();
  return {
    ...actual,
    getAgreementForAgency: async (agencyId: string) =>
      (AGREEMENT_OVERRIDE ?? (agencyId === 'ag-regent' ? REGENT_AGREEMENT : null)),
    getCommissionSplits: async () => new Map([
      ['br-hampstead', [
        { branchId: 'br-hampstead', level: 'agency' as const, orgId: 'ag-regent', orgName: "Regent's Lettings", rate: 0.2, source: 'agreement' as const },
      ]],
      ['br-central', [
        { branchId: 'br-central', level: 'agency' as const, orgId: 'ag-kestrel', orgName: 'Kestrel Lettings', rate: 0.1, source: 'standard' as const },
      ]],
    ]),
  };
});

const PARTNERS: Partner[] = [
  { id: HOUSE, name: 'Opndoor Agents', status: 'active', since: '2024-09', weight: 1,
    isHouse: true, referencingMode: 'opndoor_referenced' } as Partner,
];
const GROUPS: AgencyGroup[] = [{ id: 'gr-test', partner: HOUSE, name: 'Test Group' }];
const AGENCIES: Agency[] = [
  { id: 'ag-regent', partner: HOUSE, name: "Regent's Lettings", groupId: 'gr-test', users: 2, referrals: 3, guaranteed: '£0', fees: 0,
    branches: [{ id: 'br-hampstead', name: 'Regent Hampstead', area: 'NW3', referrers: 2, referrals: 3, guaranteed: '£0', fees: 0 }] },
  { id: 'ag-kestrel', partner: HOUSE, name: 'Kestrel Lettings', groupId: 'gr-test', users: 1, referrals: 0, guaranteed: '£0', fees: 0,
    branches: [
      { id: 'br-central', name: 'Kestrel Central', area: 'E1', referrers: 1, referrals: 0, guaranteed: '£0', fees: 0 },
      { id: 'br-river', name: 'Kestrel Riverside', area: 'SE1', referrers: 0, referrals: 0, guaranteed: '£0', fees: 0 },
    ] },
];

function user(o: Partial<ManagedUser> & { id: string; name: string }): ManagedUser {
  return {
    email: `${o.name.toLowerCase().replace(/\W+/g, '.')}@test.invalid`,
    role: 'management', lastActive: '2026-09-01', status: 'active', partner: HOUSE,
    ...o,
  } as ManagedUser;
}
/* A Director and a Manager on the SAME branch, which is the pair the old pill
   could not tell apart, plus a Negotiator placed there by home branch. */
const USERS: ManagedUser[] = [
  user({ id: 'u-rosa', name: 'Rosa Carver', seesCommission: true, homeBranchId: 'br-hampstead' }),
  user({ id: 'u-nadia', name: 'Nadia Okonkwo', seesCommission: false, homeBranchId: 'br-hampstead' }),
  user({ id: 'u-tom', name: 'Tom Reeve', role: 'referrer', homeBranchId: 'br-hampstead' }),
];

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

async function openGroup() {
  const view = renderAt('/agencies/gr-test');
  await waitFor(() => { if (!view.container.querySelector('.ah-tree')) throw new Error('not ready'); });
  await settle();
  return view;
}

type View = Awaited<ReturnType<typeof openGroup>>;
const nodeNamed = (v: View, sel: string, name: string) =>
  [...v.container.querySelectorAll<HTMLElement>(sel)].find((el) => (el.textContent ?? '').includes(name));

beforeEach(() => {
  sessionStorage.clear();
  hydratePartners(PARTNERS);
  hydrateGroups(GROUPS);
  hydrateOrg(AGENCIES);
  hydrateUsers(USERS);
});
afterEach(() => { cleanup(); hydrateUsers([]); });

describe('a one-office agency merges its office into the card', () => {
  it('draws no branch node for it, and names the office on the agency card', async () => {
    const view = await openGroup();
    const regent = nodeNamed(view, '.ah-node--agency', "Regent's Lettings")!;
    expect(regent.querySelector('.ah-office-inline')!.textContent).toContain('Regent Hampstead');

    // Expanding Regent must not then produce the branch node the merge removed.
    fireEvent.click(regent.querySelector('.ah-tick-btn')!);
    await settle();
    expect(nodeNamed(view, '.ah-node--branch', 'Regent Hampstead')).toBeUndefined();
  });

  /* DECIDED PER AGENCY. Kestrel has two offices and sits in the same group, so
     a page-level office count would have merged neither or both. */
  it('leaves a two-office agency its branch nodes', async () => {
    const view = await openGroup();
    const kestrel = nodeNamed(view, '.ah-node--agency', 'Kestrel Lettings')!;
    expect(kestrel.querySelector('.ah-office-inline')).toBeNull();
    fireEvent.click(kestrel.querySelector('.ah-tick-btn')!);
    await settle();
    expect(nodeNamed(view, '.ah-node--branch', 'Kestrel Central')).toBeTruthy();
    expect(nodeNamed(view, '.ah-node--branch', 'Kestrel Riverside')).toBeTruthy();
  });
});

describe('the tick expands and the name opens', () => {
  it('expands the tree without leaving it', async () => {
    const view = await openGroup();
    const kestrel = nodeNamed(view, '.ah-node--agency', 'Kestrel Lettings')!;
    fireEvent.click(kestrel.querySelector('.ah-tick-btn')!);
    await settle();
    // Still the tree, now showing what was under it.
    expect(view.container.querySelector('.ah-tree')).toBeTruthy();
    expect(nodeNamed(view, '.ah-node--branch', 'Kestrel Central')).toBeTruthy();
  });

  it('opens a branch out of the tree when its name is clicked', async () => {
    const view = await openGroup();
    const kestrel = nodeNamed(view, '.ah-node--agency', 'Kestrel Lettings')!;
    fireEvent.click(kestrel.querySelector('.ah-tick-btn')!);
    await settle();
    fireEvent.click(nodeNamed(view, '.ah-node--branch', 'Kestrel Central')!.querySelector('.ah-node-name')!);
    await settle();

    expect(view.container.querySelector('.ah-tree')).toBeNull();
    expect(view.container.textContent).toContain('Office of Kestrel Lettings');
    expect(view.getByText('Back to the tree')).toBeTruthy();
  });

  it('comes back to the tree', async () => {
    const view = await openGroup();
    const regent = nodeNamed(view, '.ah-node--agency', "Regent's Lettings")!;
    fireEvent.click(regent.querySelector('.ah-office-inline')!);
    await settle();
    expect(view.container.querySelector('.ah-tree')).toBeNull();
    fireEvent.click(view.getByText('Back to the tree'));
    await settle();
    expect(view.container.querySelector('.ah-tree')).toBeTruthy();
  });

  it('opens the agency-level people from the agency name', async () => {
    const view = await openGroup();
    fireEvent.click(nodeNamed(view, '.ah-node--agency', "Regent's Lettings")!.querySelector('.ah-node-name')!);
    await settle();
    expect(view.container.querySelector('.ah-tree')).toBeNull();
    expect(view.container.textContent).toContain('People at agency level');
  });
});

describe('a branch view', () => {
  async function openHampstead() {
    const view = await openGroup();
    fireEvent.click(nodeNamed(view, '.ah-node--agency', "Regent's Lettings")!.querySelector('.ah-office-inline')!);
    await settle();
    return view;
  }

  it('lists the office\'s people with what they ARE, not where they sit', async () => {
    const view = await openHampstead();
    const rows = [...view.container.querySelectorAll('table.dt tbody tr')]
      .map((tr) => (tr.textContent ?? ''));
    const levelOf = (name: string) => rows.find((t) => t.includes(name)) ?? '';
    /* THE DEFECT. Rosa and Nadia are both management on the same branch and
       both read "Branch manager"; they differ only in the commission bit. */
    expect(levelOf('Rosa Carver')).toContain('Director');
    expect(levelOf('Nadia Okonkwo')).toContain('Manager');
    expect(levelOf('Tom Reeve')).toContain('Negotiator');
    expect(view.container.textContent).not.toContain('Branch manager');
  });

  it('carries the People tab\'s own row actions, rather than a second set', async () => {
    const view = await openHampstead();
    const row = [...view.container.querySelectorAll('table.dt tbody tr')]
      .find((tr) => (tr.textContent ?? '').includes('Rosa Carver'))!;
    const acts = [...row.querySelectorAll('.ah-rowacts button')].map((b) => (b.textContent ?? '').trim());
    expect(acts).toContain('Change level');
    expect(acts).toContain('Send password reset');
    expect(acts).toContain('Reset two-factor');
    expect(acts).toContain('Remove access');
  });

  /* THE NOMINATION IS GONE. A deed goes to whoever sent the referral, which is
     a fact about the referral and not about the branch, so there is nothing
     here to nominate and the view says where deeds actually go instead. */
  it('shows the office\'s referrals, and who its deeds go to', async () => {
    const view = await openHampstead();
    expect(view.container.textContent).toContain('Referrals');
    expect(view.container.textContent).toContain('go to whoever sent the referral');
    expect(view.queryByText('Nominate deed recipient')).toBeNull();
  });

  /* WHERE THE RATE CAME FROM. Regent's 20% is negotiated and the Opndoor
     standard is also a percentage, so a line that prints only the figure
     cannot tell one from the other. */
  it('says what the payout is and where the rate came from', async () => {
    const view = await openHampstead();
    const payout = view.container.querySelector('.ah-payout')!;
    expect(payout.textContent).toBe("Pays out: Regent's Lettings 20% (agreement)");
  });
});

describe('an agreement replaces Set rate', () => {
  it('states the deal on the agency priced by one', async () => {
    const view = await openGroup();
    const regent = nodeNamed(view, '.ah-node--agency', "Regent's Lettings")!;
    /* REWORDED 2026-10-01, and the point of the change is in the
       string: it now says WHO each price applies to. "3 weeks at 20%,
       5 weeks at 25%" named two prices and left the reader to work out
       which tenancy got which. */
    expect(regent.querySelector('.ah-agreement-sum')!.textContent)
      .toBe('Deal: 1 tenant: 3 weeks at 20%, 2 or more: 5 weeks at 25%');
    /* A rate cannot be set alongside an agreement: the database refuses it, and
       the refusal used to arrive only after the round trip. */
    const buttons = [...regent.querySelectorAll('.ah-node-main button')].map((b) => (b.textContent ?? '').trim());
    expect(buttons).not.toContain('Set rate');
    expect(buttons).not.toContain('Change rate');
  });

  /* AND SENDS YOU TO THE COMMISSION TAB WHERE THERE IS NONE, since
     2026-10-02. Matt: "The 'Set rate' button beside the agency name: if
     commission is set on the Commission tab, remove it so there's one
     place to set commission."

     The tree used to carry the editor, and the Commission tab listed
     only the rates that WERE set -- so the tab could change one and the
     tree was the only place to set a first. Both halves moved together:
     the tab now lists every node and keeps the editor, and the tree
     points at it. Removing the tree's button without the other half
     would have removed the capability rather than moved it.

     The case is kept and turned over because what it protects is the
     distinction beside it: an agreement party gets NO rate control at
     all, and a non-agreement party gets one. That is still true; where
     the control lives is what changed. */
  it('offers the Commission tab where there is no agreement', async () => {
    const view = await openGroup();
    const kestrel = nodeNamed(view, '.ah-node--agency', 'Kestrel Lettings')!;
    expect(kestrel.querySelector('.ah-agreement-sum')).toBeNull();
    const buttons = [...kestrel.querySelectorAll('.ah-node-main button')].map((b) => (b.textContent ?? '').trim());
    expect(buttons).toContain('Set on Commission');
    // And the editor is not in the tree any more: one place to set it.
    expect(buttons).not.toContain('Set rate');
  });
});

/* ONE AGENCY, TWO COUNTERS.
 *
 * Matt, 2026-08-17: an agency exists once and is never duplicated per
 * supplier, so an agency under two suppliers is ONE party shown with TWO
 * counters. 20261006750000 made the count belong to a route and
 * 20261006760000 returns one entry per route the agency has paid business on.
 * This is the showing half.
 *
 * Why it matters that they are separate rather than summed: a pooled total
 * would let volume bought through one supplier pay for a better commission
 * band with the other, in both directions.
 */
describe('an agency that does business on two routes', () => {
  const twoRoutes = {
    ...REGENT_AGREEMENT,
    volume: 12,
    volumes: [
      { routeId: 'p-house', route: 'Opndoor agents', count: 12 },
      { routeId: 'p-harbour', route: 'Harbour Lets', count: 3 },
    ],
  };

  afterEach(() => { AGREEMENT_OVERRIDE = null; });

  async function openAgency(agreement: typeof REGENT_AGREEMENT) {
    AGREEMENT_OVERRIDE = agreement;
    const view = renderAt('/agencies/ag-regent');
    // The counters live on the Commission tab, which only a Director sees.
    await waitFor(() => { if (!view.container.querySelector('[role="tablist"]')) throw new Error('no tabs'); });
    const commission = [...view.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((b) => (b.textContent ?? '').trim() === 'Commission');
    if (!commission) throw new Error('no Commission tab: is the viewer a Director?');
    await act(async () => { fireEvent.click(commission); });
    await waitFor(() => { if (!view.container.querySelector('.ah-agr__now')) throw new Error('no agreement panel'); });
    await settle();
    return view;
  }

  it('shows a counter for each route, named, rather than one pooled total', async () => {
    const view = await openAgency(twoRoutes);
    const now = view.container.querySelector('.ah-agr__now')!.textContent ?? '';
    expect(now).toMatch(/Counters, one per route/);
    expect(now).toMatch(/12\s*paid through Opndoor agents/);
    expect(now).toMatch(/3\s*paid through Harbour Lets/);
    // And never the sum, which is the number that would be wrong.
    expect(now).not.toMatch(/\b15\b/);
  });

  it('and still reads as one plain counter when there is only one route', async () => {
    const view = await openAgency({
      ...REGENT_AGREEMENT, volume: 7,
      volumes: [{ routeId: 'p-house', route: 'Opndoor agents', count: 7 }],
    });
    const now = view.container.querySelector('.ah-agr__now')!.textContent ?? '';
    expect(now).toMatch(/Counter/);
    expect(now).not.toMatch(/one per route/);
    expect(now).toMatch(/7\s*paid since/);
  });
});
