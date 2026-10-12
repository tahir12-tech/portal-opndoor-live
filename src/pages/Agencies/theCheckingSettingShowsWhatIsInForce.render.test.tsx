/* THE CHECKING SETTING SHOWS THE MODE IN FORCE, INCLUDING WHEN INHERITED.
 *
 * Matt, 2026-10-12, from live: "Regent (an Opndoor-estate agency) had
 * referencing_mode = null, so it inherited opndoor_referenced from the
 * opndoor-agents partner, but the agency page showed 'Agency has already
 * referenced them' as selected. A real referral would have gone to
 * eligibility and the £20. ... Fix the screen so it always shows the mode
 * actually in force, including when inherited, and make sure choosing an
 * option always saves it. Add a test with a null-mode agency under
 * opndoor-agents."
 *
 * WHY A NULL MODE IS NORMAL AGAIN, which is the part that made this
 * reachable. 20261007470000 made agencies.referencing_mode NOT NULL DEFAULT
 * 'opndoor_referenced'; 20261008050000 dropped BOTH, because the default made
 * resolve_referencing_mode's inheritance arm unreachable and a supplier's
 * agencies could never inherit. Dropping the default stopped every creation
 * path setting the column -- on OUR OWN estate as well as a supplier's -- so
 * an agency Opndoor adds now arrives with null and inherits the house
 * partner's opndoor_referenced. The journey was right; only the screen was
 * wrong, and it was wrong in the direction that reads as "no eligibility, no
 * fee".
 *
 * A REAL RENDER, not a source-text match. The two existing tests for this
 * control assert strings in AgencyHome.tsx, which is why neither of them
 * noticed that the radio was computed from the column rather than from the
 * mode in force: the string they assert is still there and still correct.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { App } from '@/App';
import { hydrateOrg, hydrateGroups } from '@/data/orgService';
import { hydratePartners } from '@/data/partnersService';
import { hydrateUsers } from '@/data/usersService';
import type { Agency, AgencyGroup, Partner } from '@/data/types';

const HOUSE = 'opndoor-agents';

/** Every call the screen makes to save a mode, in order. */
const SAVED: { agencyId: string; mode: string | null }[] = [];

vi.mock('@/data/orgService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data/orgService')>();
  return {
    ...actual,
    setAgencyReferencingMode: async (agencyId: string, mode: string | null) => {
      SAVED.push({ agencyId, mode });
    },
    getAgreementForAgency: async () => null,
    getCommissionSplits: async () => new Map(),
  };
});

/* THE HOUSE PARTNER IS opndoor_referenced, which is what makes a null-mode
   agency under it inherit eligibility. That is the live shape: on dev and on
   live `opndoor-agents` reads opndoor_referenced. */
const PARTNERS: Partner[] = [
  { id: HOUSE, name: 'Opndoor Agents', status: 'active', since: '2024-09', weight: 1,
    isHouse: true, referencingMode: 'opndoor_referenced', kind: 'agency' } as Partner,
];
const GROUPS: AgencyGroup[] = [{ id: 'gr-estate', partner: HOUSE, name: 'Our Estate' }];

const agency = (o: Partial<Agency> & { id: string; name: string }): Agency => ({
  partner: HOUSE, groupId: 'gr-estate', users: 0, referrals: 0, guaranteed: '£0', fees: 0,
  branches: [{ id: `br-${o.id}`, name: o.name, area: '', referrers: 0, referrals: 0, guaranteed: '£0', fees: 0 }],
  ...o,
} as Agency);

const AGENCIES: Agency[] = [
  // THE CASE MATT REPORTED: no opinion of its own, under the house partner.
  agency({ id: 'ag-null', name: 'Null Mode Agency' }),
  // An agency that has said, so the inherited note must NOT appear.
  agency({ id: 'ag-open', name: 'Explicit Open Agency', referencingMode: 'pre_referenced_open' }),
  // And the commercially dangerous one: screened must not become open.
  agency({ id: 'ag-screened', name: 'Explicit Screened Agency', referencingMode: 'pre_referenced_screened' }),
];

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function openEstate() {
  localStorage.setItem('grp_role', 'superadmin');
  const view = render(
    <MemoryRouter initialEntries={['/agencies/gr-estate']}>
      <SessionProvider><ToastProvider><App /></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.ah-tree')) throw new Error('not ready'); });
  await settle();
  return view;
}

type View = Awaited<ReturnType<typeof openEstate>>;

/** Expand one agency's card so its checking control is on the page. */
async function openAgency(view: View, name: string) {
  const node = [...view.container.querySelectorAll<HTMLElement>('.ah-node--agency')]
    .find((el) => (el.textContent ?? '').includes(name));
  if (!node) throw new Error(`no agency node for ${name}`);
  fireEvent.click(node.querySelector('.ah-tick-btn')!);
  await settle();
  const route = node.querySelector<HTMLElement>('.ah-route');
  if (!route) throw new Error(`no checking control for ${name}`);
  return route;
}

/** The two radios, by the label each carries. */
function options(route: HTMLElement) {
  const opts = [...route.querySelectorAll<HTMLElement>('.ah-route__opt')];
  const find = (needle: string) => {
    const el = opts.find((o) => (o.textContent ?? '').includes(needle));
    if (!el) throw new Error(`no option matching ${needle}`);
    return { el, input: el.querySelector<HTMLInputElement>('input')! };
  };
  return { eligibility: find('Opndoor checks eligibility'), preReferenced: find('Agency has already referenced them') };
}

/** Say yes to the confirmation the control raises before it saves. */
async function confirmIt(view: View) {
  const btn = [...view.container.ownerDocument.querySelectorAll<HTMLElement>('button')]
    .find((b) => (b.textContent ?? '').trim() === 'Change it');
  if (!btn) throw new Error('no confirmation to accept');
  fireEvent.click(btn);
  await settle();
}

beforeEach(() => {
  SAVED.length = 0;
  sessionStorage.clear();
  hydratePartners(PARTNERS);
  hydrateGroups(GROUPS);
  hydrateOrg(AGENCIES);
  hydrateUsers([]);
});
afterEach(() => { cleanup(); hydrateUsers([]); });

describe('a null-mode agency under opndoor-agents', () => {
  /* THE WHOLE BUG, IN ONE ASSERTION. Before the fix the pre-referenced option
     was lit, which told a reader the tenant goes straight to payment. */
  it('shows the inherited mode, Opndoor checks eligibility, as the one in force', async () => {
    const view = await openEstate();
    const { eligibility, preReferenced } = options(await openAgency(view, 'Null Mode Agency'));
    expect(eligibility.input.checked).toBe(true);
    expect(preReferenced.input.checked).toBe(false);
    expect(eligibility.el.className).toContain('is-on');
    expect(preReferenced.el.className).not.toContain('is-on');
  });

  it('and says the answer came from the partner rather than from a choice', async () => {
    const view = await openEstate();
    const route = await openAgency(view, 'Null Mode Agency');
    expect(route.textContent).toContain('Inherited from Opndoor Agents');
  });

  /* "MAKE SURE CHOOSING AN OPTION ALWAYS SAVES IT." The click that matters is
     on the option ALREADY LIT: that is how an admin pins an inherited value
     so it stops following the partner. A radio fires no change event when it
     is already checked, so this is also the assertion that holds the handler
     on onClick. */
  it('saves the inherited value when the lit option is chosen, pinning it', async () => {
    const view = await openEstate();
    const { eligibility } = options(await openAgency(view, 'Null Mode Agency'));
    /* THE PRECONDITION IS THE TEST. Without it this passes against the old
       code for the wrong reason: there the eligibility option was NOT lit, so
       clicking it was an ordinary change and onChange fired. The thing being
       proved is that a click on the option ALREADY LIT still saves. */
    expect(eligibility.input.checked).toBe(true);
    fireEvent.click(eligibility.input);
    await settle();
    await confirmIt(view);
    expect(SAVED).toEqual([{ agencyId: 'ag-null', mode: 'opndoor_referenced' }]);
  });

  it('and saves the other option when that one is chosen', async () => {
    const view = await openEstate();
    const { preReferenced } = options(await openAgency(view, 'Null Mode Agency'));
    fireEvent.click(preReferenced.input);
    await settle();
    await confirmIt(view);
    expect(SAVED).toEqual([{ agencyId: 'ag-null', mode: 'pre_referenced_open' }]);
  });
});

describe('an agency that has said', () => {
  it('shows its own answer and no inherited note', async () => {
    const view = await openEstate();
    const route = await openAgency(view, 'Explicit Open Agency');
    const { eligibility, preReferenced } = options(route);
    expect(preReferenced.input.checked).toBe(true);
    expect(eligibility.input.checked).toBe(false);
    expect(route.textContent).not.toContain('Inherited from');
  });

  /* AND RE-CLICKING IT WRITES NOTHING, so the fix does not fill Recent
     changes with rows that record no change. */
  it('writes nothing when its own answer is clicked again', async () => {
    const view = await openEstate();
    const { preReferenced } = options(await openAgency(view, 'Explicit Open Agency'));
    expect(preReferenced.input.checked).toBe(true);
    fireEvent.click(preReferenced.input);
    await settle();
    expect(SAVED).toEqual([]);
  });
});

describe('a screened agency', () => {
  /* BOTH PRE-REFERENCED MODES ANSWER THE SECOND OPTION, because the screen
     offers two answers and screened is one of the two ways an agency has
     already referenced somebody. */
  it('lights the pre-referenced option', async () => {
    const view = await openEstate();
    const { preReferenced } = options(await openAgency(view, 'Explicit Screened Agency'));
    expect(preReferenced.input.checked).toBe(true);
  });

  /* AND PINNING IT MUST NOT TURN SCREENED INTO OPEN. `pre_referenced_open`
     means opndoor applies NO criteria at all, a commercial position granted
     deliberately; writing it because somebody clicked the option already lit
     would give that away silently. */
  it('does not become open when the lit option is clicked again', async () => {
    const view = await openEstate();
    const { preReferenced } = options(await openAgency(view, 'Explicit Screened Agency'));
    expect(preReferenced.input.checked).toBe(true);
    fireEvent.click(preReferenced.input);
    await settle();
    /* NOTHING SAVED, and specifically not pre_referenced_open. The naive
       reading of "always save" writes the option's own value, which for this
       agency would silently move it from screened to open. */
    expect(SAVED).toEqual([]);
  });
});
