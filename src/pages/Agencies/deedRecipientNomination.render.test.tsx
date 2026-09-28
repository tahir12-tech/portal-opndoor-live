/* NOMINATING A DEED RECIPIENT, which could not be done at all.

   The branch node's `(a.branches ?? []).map((b) => ...)` opened with

     const nomineeId = b.id ? deedRecipients[b.id] : undefined;

   and the page already had `const [nomineeId, setNomineeId] = useState('')`
   for the picker. The const shadowed the state for the whole of that map,
   which is where the picker is rendered, so `<select value={nomineeId}>` and
   `<button disabled={!nomineeId}>` both read THIS BRANCH'S EXISTING RECIPIENT.

   The picker only renders when there is no recipient, so the shadowed value was
   undefined every single time it was on screen: the select never showed the
   chosen person and Nominate was permanently disabled. onChange did update the
   real state, which is why nothing looked broken in the code.

   This matters beyond the control. On dev, Regent's Lettings has three issued
   deeds and no nominated recipient, and this was the only way to give it one.

   The assertion is deliberately about the BUTTON rather than about a successful
   nomination: nominateDeedRecipient short-circuits when Supabase is off, so the
   write cannot be driven here, but the defect was that the choice never reached
   the control at all. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

const PARTNERS: Partner[] = [
  { id: HOUSE, name: 'Opndoor Agents', status: 'active', since: '2024-09', weight: 1,
    isHouse: true, referencingMode: 'opndoor_referenced' } as Partner,
];
const GROUPS: AgencyGroup[] = [];
/* Ungrouped on purpose: a grouped agency's URL resolves UP to its group page
   (AgencyHome's group upgrade), and this test is about one branch. */
const AGENCIES: Agency[] = [
  { id: 'ag-harborview', partner: HOUSE, name: 'Harborview Lettings', users: 2, referrals: 0, guaranteed: '£0', fees: 0,
    branches: [{ id: 'br-marina', name: 'Brighton Marina', area: 'BN2', referrers: 0, referrals: 0, guaranteed: '£0', fees: 0 }] },
];

function user(o: Partial<ManagedUser> & { id: string; name: string }): ManagedUser {
  return {
    email: `${o.name.toLowerCase().replace(/\W+/g, '.')}@harborview.test`,
    role: 'management',
    lastActive: '2026-09-01',
    status: 'active',
    partner: HOUSE,
    ...o,
  } as ManagedUser;
}

const USERS: ManagedUser[] = [
  user({ id: 'u-rosa', name: 'Rosa Carver', seesCommission: true }),
  user({ id: 'u-nadia', name: 'Nadia Okonkwo' }),
  // Invited, never signed in. The database's deed_people_target is active-only.
  user({ id: 'u-pending', name: 'Pip Pending', status: 'pending' }),
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

/** Open the agency page and open its one office.
 *
 *  Harborview has a single office, so there is no branch node to click: the
 *  office is merged into the agency card and that link is the way in. */
async function openBranch() {
  const view = renderAt('/agencies/ag-harborview');
  await waitFor(() => { if (!view.container.querySelector('.ah-tree')) throw new Error('not ready'); });
  await settle();
  const officeBtn = [...view.container.querySelectorAll<HTMLElement>('.ah-office-inline')]
    .find((el) => (el.textContent ?? '').includes('Brighton Marina'));
  if (!officeBtn) throw new Error('no office link on the agency card');
  fireEvent.click(officeBtn);
  await settle();
  return view;
}

beforeEach(() => {
  sessionStorage.clear();
  hydratePartners(PARTNERS);
  hydrateGroups(GROUPS);
  hydrateOrg(AGENCIES);
  hydrateUsers(USERS);
});
afterEach(() => { cleanup(); hydrateUsers([]); });

describe('nominating a deed recipient', () => {
  it('enables Nominate once a person is chosen', async () => {
    const view = await openBranch();
    fireEvent.click(view.getByText('Nominate deed recipient'));
    await settle();

    const select = view.container.querySelector<HTMLSelectElement>('select[aria-label="Nominate deed recipient"]')!;
    const nominate = [...view.container.querySelectorAll<HTMLButtonElement>('.ah-deed button')]
      .find((b) => (b.textContent ?? '').trim() === 'Nominate')!;

    // Nothing chosen yet, so the button is correctly disabled.
    expect(nominate.disabled).toBe(true);

    fireEvent.change(select, { target: { value: 'u-rosa' } });
    await settle();

    /* THE DEFECT, stated as the assertion. Both of these read the shadowed
       const before the fix: the select showed nothing and the button never
       came out of its disabled state, whatever you picked. */
    expect(select.value).toBe('u-rosa');
    const after = [...view.container.querySelectorAll<HTMLButtonElement>('.ah-deed button')]
      .find((b) => (b.textContent ?? '').trim() === 'Nominate')!;
    expect(after.disabled).toBe(false);
  });

  /* ACTIVE PEOPLE ONLY. The database resolves a deed to the nominated person
     only while they are active, so offering a pending invitee produces a
     nomination that reports success and then silently falls through to the
     manager chain. */
  it('offers only people who could actually receive a deed', async () => {
    const view = await openBranch();
    fireEvent.click(view.getByText('Nominate deed recipient'));
    await settle();

    const options = [...view.container.querySelectorAll('select[aria-label="Nominate deed recipient"] option')]
      .map((o) => (o.textContent ?? '').trim());
    expect(options).toContain('Rosa Carver');
    expect(options).toContain('Nadia Okonkwo');
    expect(options).not.toContain('Pip Pending');
  });
});
