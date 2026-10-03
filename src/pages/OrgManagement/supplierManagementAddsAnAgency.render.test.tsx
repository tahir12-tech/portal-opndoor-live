/* =====================================================================
   "ADD AGENCY" ON A SUPPLIER'S OWN AGENCIES PAGE.

   Matt, 2026-10-03: "Supplier Management can also add and edit agencies and
   offices from their Agencies page; show an 'Add agency' button there to match
   the page's own text."

   THE PAGE'S OWN TEXT IS THE COMPLAINT. The banner has told Management "You
   can view, add and edit the agencies and branches you manage" since
   2026-10-01, and on the supplier rail there was no button to do it with. The
   button was `role === 'superadmin'`, with the reason written next to it:
   "admin_create_agency_and_branch refuses anyone but an admin, so drawing this
   for an agency manager offered a button that could only fail."

   HALF OF THAT REASON STILL HOLDS, which is why this file tests the negative
   as hard as the positive. 20261007840000 admits a supplier's own Management;
   it still refuses our own estate, because `opndoor-agents` is ONE partner
   shared by every agency we onboard, so an agency Director adding there would
   be making a sibling beside their own agency, and agencies_insert refuses it
   in SQL. A button for them would still be a button that could only fail.

   AND IT IS A DIFFERENT DIALOG, not the admin's onboarding wizard: a supplier
   adding to its own estate has no commission to set (its own deal covers it)
   and no first invite to send (an agency in a supplier's estate never has
   logins), so it gets the three fields Matt specified.
   ===================================================================== */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { hydrateOrg, hydrateGroups } from '@/data/orgService';
import { hydratePartners, setHomePartner } from '@/data/partnersService';
import * as users from '@/data/usersService';
import type { Agency, Partner } from '@/data/types';
import { OrgManagement } from './OrgManagement';

const SUPPLIER = 'zzz-kestrel';
const SUPPLIER_NAME = 'ZZZ Kestrel Lettings';
const HOUSE = 'opndoor-agents';

const PARTNERS = [
  { id: SUPPLIER, name: SUPPLIER_NAME, status: 'active', since: '2026-01-01', weight: 1,
    users: 1, apps: 2, referencingMode: 'pre_referenced_open', partnerRate: 0.25,
    agentRate: 0.1, primary: false, kind: 'supplier' },
  /* THE HOUSE PARTNER, with its real kind. partyIsSupplier reads the kind, and
     an estate the store cannot resolve answers "not a supplier" -- so without
     this row the agency-user case below would pass for the wrong reason. */
  { id: HOUSE, name: 'opndoor agents', status: 'active', since: '2026-01-01', weight: 1,
    users: 9, apps: 9, referencingMode: 'pre_referenced_open', partnerRate: 0.25,
    agentRate: 0.1, primary: true, kind: 'agency' },
] as unknown as Partner[];

const AGENCIES = [
  { id: 'ag-frost', partner: SUPPLIER, name: 'ZZZ Frost Partnership', users: 0, referrals: 1,
    guaranteed: '£0', fees: 0, contacts: [],
    branches: [{ id: 'b-may', name: 'ZZZ Frost Mayfair', referrals: 1, guaranteed: '£0', contacts: [] }] },
  { id: 'ag-ours', partner: HOUSE, name: "ZZZ Regent's", users: 2, referrals: 3,
    guaranteed: '£0', fees: 0, contacts: [],
    branches: [{ id: 'b-ours', name: "ZZZ Regent's Park", referrals: 0, guaranteed: '£0', contacts: [] }] },
] as unknown as Agency[];

/* THE HOME PARTNER IS A MODULE VALUE, not a storage key, which is the one
   thing that has to be got right for this file to measure anything:
   `partnerScope` for a non-admin is `homePartner()`, and that reads a variable
   `setHomePartner` writes. Writing grp_partner alone left the scope on the
   mock seed's default and a supplier's Management was read as somebody else. */
function signIn(role: string, partner: string) {
  localStorage.setItem('grp_role', role);
  setHomePartner(partner);
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  hydrateGroups([]);
  hydratePartners(PARTNERS);
  hydrateOrg(AGENCIES);
  vi.spyOn(users, 'getUsers').mockReturnValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function openAgencies() {
  const view = render(
    <MemoryRouter initialEntries={['/agencies']}>
      <ToastProvider><SessionProvider><PageMetaProvider>
        <OrgManagement />
      </PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.org')) throw new Error('tree not ready'); });
  return view;
}

const addAgency = (c: HTMLElement) =>
  [...c.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Add agency');

describe('a supplier’s Management', () => {
  it('is given the Add agency button the banner already promised', async () => {
    signIn('management', SUPPLIER);
    const { container } = await openAgencies();
    expect(container.textContent).toContain('You can view, add and edit the agencies and branches you manage');
    expect(addAgency(container)).toBeTruthy();
  });

  /* THE SUPPLIER DIALOG, NOT THE ONBOARDING WIZARD. Three fields and no
     commission, which is how the two are told apart on screen: the wizard
     asks for a rate and a first invite. */
  it('and it opens the three-field dialog, named for their own company', async () => {
    signIn('management', SUPPLIER);
    const { container } = await openAgencies();
    fireEvent.click(addAgency(container)!);
    await waitFor(() => { if (!document.getElementById('sao-name')) throw new Error('no dialog'); });
    expect(document.getElementById('sao-addr')).toBeTruthy();
    expect(document.getElementById('sao-email')).toBeTruthy();
    /* THE DIALOG'S OWN TEXT, not the page's. Read off the page body this
       caught "1 agency has no agency email" and the commission wording in the
       banner behind the scrim, which is the page being itself and says nothing
       about which dialog opened. */
    const text = document.querySelector('[role="dialog"]')?.textContent ?? '';
    expect(text).toContain(`Add an agency to ${SUPPLIER_NAME}`);
    expect(text).toMatch(/It will not appear on Opndoor's own Agencies list, and it never has logins/);
    // The wizard's own questions, which this dialog must not be asking.
    expect(text).not.toMatch(/commission/i);
    expect(text).not.toMatch(/invite/i);
  });

  /* THE DUPLICATE CHECK IS THE SAME ONE, and here the offer is the LINK,
     because on this page the existing agency is where the managing happens.
     The referral form passes onUseExisting and gets a selection instead. */
  it('and is told when they already have that agency, with a way to open it', async () => {
    signIn('management', SUPPLIER);
    const { container } = await openAgencies();
    fireEvent.click(addAgency(container)!);
    await waitFor(() => { if (!document.getElementById('sao-name')) throw new Error('no dialog'); });
    fireEvent.change(document.getElementById('sao-name')!, { target: { value: 'zzz frost partnership' } });
    await waitFor(() => {
      const t = document.body.textContent ?? '';
      if (!t.includes(`${SUPPLIER_NAME} already has an agency called ZZZ Frost Partnership`)) throw new Error('no warning');
    });
    expect(document.querySelector('a[href*="/agencies/ag-frost"]')).toBeTruthy();
  });
});

describe('one of our own agencies’ Management', () => {
  /* A DIRECTOR AT REGENT. Opndoor onboards our agencies, so the button they
     were never shown stays unshown -- and the banner they get is the other
     one, which does not promise it. */
  it('is not given the button, and is not promised it either', async () => {
    signIn('management', HOUSE);
    const { container } = await openAgencies();
    expect(addAgency(container)).toBeFalsy();
  });
});

describe('a supplier’s referrer', () => {
  /* HOUSEKEEPING IS MANAGEMENT'S. The referrer's door is the New application
     form, where they have met a new office and the alternative is an abandoned
     referral; it is not this page. The SERVER admits them either way, so this
     is a screen decision and this is where it is recorded. */
  it('is not given the button on this page', async () => {
    signIn('referrer', SUPPLIER);
    const { container } = await openAgencies();
    expect(addAgency(container)).toBeFalsy();
  });
});

describe('an opndoor admin', () => {
  it('keeps the onboarding wizard, not the supplier dialog', async () => {
    signIn('superadmin', HOUSE);
    const { container } = await openAgencies();
    fireEvent.click(addAgency(container)!);
    await waitFor(() => {
      if (!/Add agency/.test(document.body.textContent ?? '')) throw new Error('no dialog');
    });
    expect(document.getElementById('sao-name')).toBeNull();
  });
});
