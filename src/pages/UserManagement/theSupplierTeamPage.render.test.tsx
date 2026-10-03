/* =====================================================================
   A SUPPLIER'S OWN TEAM PAGE, AS ITS MANAGEMENT SEES IT.

   Matt, 2026-10-03: "Supplier Users page (as Kestrel Management): the '...'
   menu on each row opens an empty box, so no actions are possible; the level
   key shows agency levels (Director, Manager, Negotiator) instead of the
   supplier's (Management, Referrer, Developer); and it's an older page, not
   the shared People table the agency Team and admin pages use. Replace it with
   the shared People table, with the supplier's levels, 'Sees' column and the
   same confirmed actions, and the sidebar label 'Team' to match agencies."

   AND, THE SAME DAY: "Add user dialog for supplier users: sentence case, not
   capitals; no Supplier picker (it's always their own supplier); short level
   descriptions ... Use the same dialog component as the agency Team page."

   WHAT WAS ACTUALLY WRONG, measured before changing anything, because three of
   the five complaints turned out to be about one page that was already half
   migrated:

     the shared table        ALREADY used. UserManagement has imported
                             PeopleTable, personConfirm, ChangeLevelModal and
                             PersonNotifications for days.
     the ROWS' level words   ALREADY right: personLevelLabel reads the rail off
                             the person, so Kestrel's people read "Management"
                             and "Referrer".
     the level KEY           WRONG. Hard-wired to AGENCY_LEVELS, so the key
                             above the table explained Director, Manager and
                             Negotiator -- three words that appear nowhere in
                             it and that nobody on that rail can hold.
     the "Sees" column       MISSING. The slot was filled with the Partner
                             name, which only an admin needs.
     the empty "..." box     REAL, and it is the LADDER: everything that acts
                             on somebody is gated on mayActOn, which is
                             strictly-below, so a colleague at Management
                             switched all of it off at once and left a box
                             with nothing in it and no way to find out why.
   ===================================================================== */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import * as users from '@/data/usersService';
import type { ManagedUser } from '@/data/usersService';
import { hydrateCommissionVisibility } from '@/data';
import { hydratePartners, setHomePartner } from '@/data/partnersService';
import type { Partner } from '@/data/types';
import { App } from '@/App';

const SUPPLIER = 'zzz-kes';
const ME = 'u-me';

/* API ACCESS OFF, deliberately: Developer is only worth offering with the Dev
   Centre behind it, and the one test that wants it switches it on. */
const PARTNERS = [
  { id: SUPPLIER, name: 'ZZZ Kestrel', status: 'active', since: '2026-01-01', weight: 1,
    users: 3, apps: 2, referencingMode: 'pre_referenced_open', partnerRate: 0.25,
    agentRate: 0.1, primary: false, kind: 'supplier', apiAccessEnabled: false },
] as unknown as Partner[];

/* MANAGEMENT SEES COMMISSION since 20261007880000, which is what makes two of
   them PEERS -- rank 1 and rank 1 -- and is the state the empty box appeared
   in. A referrer is below them and is the row that must keep every action. */
const PEOPLE: ManagedUser[] = [
  { id: ME, name: 'Kes Management', email: 'kes@zzz.test', role: 'management',
    seesCommission: true, partner: SUPPLIER, status: 'active', lastActive: 'today' },
  { id: 'u-peer', name: 'Peer Management', email: 'peer@zzz.test', role: 'management',
    seesCommission: true, partner: SUPPLIER, status: 'active', lastActive: 'today' },
  { id: 'u-ref', name: 'Ref Errer', email: 'ref@zzz.test', role: 'referrer',
    seesCommission: false, partner: SUPPLIER, status: 'active', lastActive: 'today' },
] as unknown as ManagedUser[];

vi.mock('@/session/SessionContext', async (io) => {
  const actual = await io<typeof import('@/session/SessionContext')>();
  return { ...actual, useSession: () => ({ ...actual.useSession(), currentUserId: ME }) };
});

function signIn(api = false) {
  localStorage.setItem('grp_role', 'management');
  hydratePartners(PARTNERS.map((p) => ({ ...p, apiAccessEnabled: api })) as unknown as Partner[]);
  setHomePartner(SUPPLIER);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  hydrateCommissionVisibility(true);
  vi.spyOn(users, 'getUsers').mockReturnValue(PEOPLE);
  signIn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function openTeam() {
  const v = render(
    <MemoryRouter initialEntries={['/users']}>
      <ToastProvider><SessionProvider><App /></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!/Kes Management/.test(v.container.textContent ?? '')) throw new Error('not drawn'); });
  return v;
}

const text = (v: { container: HTMLElement }) => (v.container.textContent ?? '').replace(/\s+/g, ' ');

describe('the page it is', () => {
  it('is called Team, like the agency one', async () => {
    const v = await openTeam();
    // The sidebar, the breadcrumb and the heading, which is the whole
    // complaint: a reader follows the first and must arrive at the same word.
    expect(text(v)).toContain('Home/Team');
    expect([...v.container.querySelectorAll('h1')].map((h) => h.textContent)).toContain('Team');
    expect(text(v)).not.toContain('Home/Administration/Users');
  });

  /* "Administration" IS OPNDOOR'S SECTION and a supplier is not in it. */
  it('and is not filed under Administration', async () => {
    const v = await openTeam();
    expect(text(v)).toContain('Your company · Management');
    expect(text(v)).not.toContain('Administration · Management');
  });
});

describe('the level key', () => {
  it('describes the supplier’s own three levels', async () => {
    const v = await openTeam();
    const t = text(v);
    expect(t).toContain('Management · sees everything for your company');
    expect(t).toContain('Referrer · sends referrals and sees their own');
  });

  /* THE REPORTED DEFECT. Three words nobody on this rail can hold. */
  it('and never the agency ladder', async () => {
    const v = await openTeam();
    const t = text(v);
    expect(t).not.toContain('Director ·');
    expect(t).not.toContain('Manager ·');
    expect(t).not.toContain('Negotiator ·');
  });

  /* DEVELOPER FOLLOWS THE API SWITCH, so the key cannot advertise a level the
     Add user dialog will not offer. */
  it('leaves Developer out until API access is on', async () => {
    const v = await openTeam();
    expect(text(v)).not.toContain('Developer ·');
    cleanup();
    signIn(true);
    const v2 = await openTeam();
    expect(text(v2)).toContain('Developer · uses the dev centre and api');
  });
});

describe('the Sees column', () => {
  it('is there, and says what each level reaches', async () => {
    const v = await openTeam();
    const heads = [...v.container.querySelectorAll('th')].map((h) => h.textContent);
    expect(heads).toContain('Sees');
    // Not the Partner column, which is an admin's question on a list that
    // holds both rails.
    expect(heads).not.toContain('Partner');
    const t = text(v);
    expect(t).toContain('Everything');
    expect(t).toContain('Own referrals');
  });
});

describe('the … menu', () => {
  const openMenu = async (v: { container: HTMLElement }, who: string) => {
    const row = [...v.container.querySelectorAll('tr')].find((r) => (r.textContent ?? '').includes(who))!;
    fireEvent.click(row.querySelector('button[aria-label="User actions"]')!);
    await waitFor(() => { if (!document.querySelector('.rowmenu__list, .rowmenu__pop, .rowmenu__item, .rowmenu__note')) throw new Error('no menu'); });
  };

  /* A ROW BELOW YOU KEEPS EVERY ACTION, which is the control that proves the
     empty box below is about the ladder and not about the page. */
  it('offers the full set on somebody below you', async () => {
    const v = await openTeam();
    await openMenu(v, 'Ref Errer');
    const t = (document.body.textContent ?? '');
    expect(t).toContain('Remove access');
    expect(t).toContain('Send password reset');
    expect(t).toContain('Reset two-factor');
  });

  /* THE REPORTED DEFECT, AND MATT'S OWN REMEDY FOR IT ON THE OTHER RAIL. */
  it('says why there is nothing to do on a peer, instead of an empty box', async () => {
    const v = await openTeam();
    await openMenu(v, 'Peer Management');
    const t = (document.body.textContent ?? '');
    expect(t).toContain('To change or remove someone at Management level, contact your account manager at partners@opndoor.co.');
    expect(t).not.toContain('Remove access');
  });

  // Your own row is not a case of being outranked, so it does not get the note.
  it('and does not tell you to email opndoor about yourself', async () => {
    const v = await openTeam();
    await openMenu(v, 'Kes Management');
    expect(document.body.textContent ?? '').not.toContain('contact your account manager');
  });
});

describe('the Add user dialog', () => {
  const open = async (v: { container: HTMLElement }) => {
    const b = [...v.container.querySelectorAll('button')].find((x) => /Add user/.test(x.textContent ?? ''))!;
    fireEvent.click(b);
    await waitFor(() => { if (!document.querySelector('[role="dialog"]')) throw new Error('no dialog'); });
    return (document.querySelector('[role="dialog"]') as HTMLElement);
  };

  /* "no Supplier picker (it's always their own supplier)". It was a select
     with one option in it, under a label implying there was a choice. */
  it('does not ask which supplier', async () => {
    const v = await openTeam();
    const d = await open(v);
    expect(d.textContent).not.toContain('Supplier');
    expect(d.textContent).not.toContain('The supplier this person works for');
  });

  it('offers the supplier’s levels, in one line each', async () => {
    const v = await openTeam();
    const d = await open(v);
    expect(d.textContent).toContain('Sees everything for your company, including commission, and manages the team and agencies.');
    expect(d.textContent).toContain('Sends referrals and sees their own; can add agencies and offices while referring.');
    // The long paragraph those strings replaced, which documents a level
    // rather than choosing between them.
    expect(d.textContent).not.toContain('Cannot change portal settings');
  });

  it('calls them levels, not roles', async () => {
    const v = await openTeam();
    const d = await open(v);
    const labels = [...d.querySelectorAll('label')].map((l) => l.textContent?.trim());
    expect(labels).toContain('Level');
    expect(labels).not.toContain('Role');
  });

  /* SENTENCE CASE, which the same CSS fix of 2026-10-03 gave the opndoor team
     dialog: asserted here so the two cannot drift apart again. */
  it('and names them in sentence case', async () => {
    const v = await openTeam();
    const d = await open(v);
    const names = [...d.querySelectorAll('.roleopt__name')].map((n) => n.textContent);
    expect(names).toEqual(['Management', 'Referrer']);
    expect(names.some((n) => n === n?.toUpperCase() && (n?.length ?? 0) > 2)).toBe(false);
  });

  it('and says which switch brings Developer back', async () => {
    const v = await openTeam();
    const d = await open(v);
    expect(d.textContent).toContain('Developer is offered once API access is switched on');
  });
});
