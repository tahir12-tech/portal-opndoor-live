/* THE PAGE THAT REPORTS THE WORK CAN NOW DO IT.
 *
 * Matt, 2026-10-02, verbatim: "Reconciliation, 'Supplier agencies with
 * no email': each row gets an 'Add email' button that sets the agency
 * email right there (same as on the supplier's Agencies tab), plus a
 * link to the agency on its supplier's page. Once added, the row
 * disappears and the counts update."
 *
 * THE TAB HAS BEEN A LIST YOU COULD ONLY READ since `55b981b`. Its own
 * header comment argued for that -- "a button here would be a second
 * way to do one thing" -- and the argument is why it had to go: it is
 * true of a second DIALOG, and this is the component the supplier's
 * Agencies tab already uses, writing through the same RPCs. What it was
 * really defending was a page that reports work it cannot do, one
 * navigation away from the page that can.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { NoAgencyEmail } from './NoAgencyEmail';
import type { Agency } from '@/data/types';

/** The list the tab renders, and the hydrated book behind it. */
let listRows: unknown[] = [];
const added: { agency: string; email: string }[] = [];

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return {
    ...actual,
    loadSupplierAgenciesWithoutAnEmail: async () => listRows,
    /* THE AGENCY THE BUTTON WRITES AGAINST. Two agencies called Frost
       Partnership exist, one per estate, so the row finds its own by ID
       and this book has both to prove the lookup is not by name. */
    getAgencies: () => ([
      { id: 'ag-kes', name: 'Frost Partnership', partner: 'kestrel-lettings', branches: [], contacts: [] },
      { id: 'ag-ours', name: 'Frost Partnership', partner: 'opndoor-agents', branches: [], contacts: [] },
    ] as unknown as Agency[]),
    /* The partners the fallback resolves a display name through. The
       row's `partnerName` comes from the RPC, which returns the
       partner's real name; `partnerName(slug)` is how the client reaches
       the same one, and it answers the slug back when the partner is not
       in the hydrated book -- which is this test, since the mock seed
       has no Kestrel. */
    partnerName: (slug: string) => (slug === 'kestrel-lettings' ? 'Kestrel Lettings'
      : slug === 'opndoor-agents' ? 'Opndoor Agents' : slug),
    addContactLive: async (agency: Agency, _b: unknown, rec: { email: string }) => {
      added.push({ agency: agency.id ?? '', email: rec.email });
    },
  };
});

function renderTab(onChanged?: () => void) {
  localStorage.setItem('grp_role', 'superadmin');
  return render(
    <MemoryRouter>
      <SessionProvider><ToastProvider><PageMetaProvider>
        <NoAgencyEmail onChanged={onChanged} />
      </PageMetaProvider></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
}
const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

const ROW = {
  agencyId: 'ag-kes', agencyName: 'Frost Partnership', partnerName: 'Kestrel Lettings',
  branches: 1, branchesCovered: 1,
};

beforeEach(() => { listRows = [ROW]; added.length = 0; });
afterEach(cleanup);

describe('a row on "Supplier agencies with no email"', () => {
  it('offers Add email, on the row itself', async () => {
    const v = renderTab();
    await waitFor(() => { if (!v.container.querySelector('.nin__card')) throw new Error('not ready'); });
    expect(v.getByText('Add email')).toBeTruthy();
  });

  /* THE SAME COMPONENT the supplier's Agencies tab uses, which is the
     instruction and the constraint: one way to store a contact. */
  it('and it is the supplier tab\'s own control, not a second dialog', () => {
    const src = readSrc('src/pages/Reconciliation/NoAgencyEmail.tsx');
    expect(src).toContain("import { AddContactEmail } from '@/pages/PartnerManagement/AddContactEmail'");
    expect(src).toContain('<AddContactEmail agency={ag}');
  });

  /* AND A LINK AT THE AGENCY ON ITS SUPPLIER'S PAGE, which needed
     PartnerHome to learn ?tab=: a link landing on Overview has not
     opened the agency, it has opened a summary the reader must search. */
  it('and links at the agency on its supplier page, on the Agencies tab', async () => {
    const v = renderTab();
    await waitFor(() => { if (!v.container.querySelector('.nin__card')) throw new Error('not ready'); });
    const link = v.container.querySelector('a.ah-linkbtn') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/partners/kestrel-lettings?tab=agencies');
    expect(link.textContent).toContain('Kestrel Lettings');
  });

  /* BY ID, NOT BY NAME. The book above holds two agencies called Frost
     Partnership, one per estate; linking the wrong one would send an
     admin to Opndoor's own Frost to fix a Kestrel agency. */
  it('and finds its agency by id, with two of that name on file', async () => {
    const v = renderTab();
    await waitFor(() => { if (!v.container.querySelector('.nin__card')) throw new Error('not ready'); });
    expect((v.container.querySelector('a.ah-linkbtn') as HTMLAnchorElement).getAttribute('href'))
      .not.toContain('opndoor-agents');
  });

  /* AND WHERE THERE IS NO ID, the estate and the name, which the
     database treats as a unique pair. The mock book needs it: an agency
     there has none, because the agency page keys its URL on
     `id ?? name` and inventing ids would move those pages. */
  it('and falls back to the estate and the name when there is no id', async () => {
    listRows = [{ ...ROW, agencyId: 'not-a-real-id' }];
    const v = renderTab();
    await waitFor(() => { if (!v.container.querySelector('.nin__card')) throw new Error('not ready'); });
    const link = v.container.querySelector('a.ah-linkbtn') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/partners/kestrel-lettings?tab=agencies');
  });

  /* BUT NEVER ON A GUESS. Two agencies of one name in one estate would
     not be the pair the database guarantees, so the row offers nothing
     rather than writing an address against whichever came first. */
  it('and offers nothing rather than guessing between two of one name', async () => {
    listRows = [{ ...ROW, agencyId: 'not-a-real-id', partnerName: 'Both Estates' }];
    const v = renderTab();
    await waitFor(() => { if (!v.container.querySelector('.nin__card')) throw new Error('not ready'); });
    expect(v.queryByText('Add email')).toBeNull();
  });

  it('writes the address against that agency', async () => {
    const v = renderTab();
    await waitFor(() => { if (!v.container.querySelector('.nin__card')) throw new Error('not ready'); });
    fireEvent.click(v.getByText('Add email'));
    fireEvent.change(v.container.querySelector('.ph-addemail__form input')!, {
      target: { value: 'deeds@frost.test' },
    });
    fireEvent.click(v.getByText('Save'));
    // The confirmation, which the shared control asks for.
    await settle();
    fireEvent.click(v.getByText('Set email'));
    await settle();
    expect(added).toEqual([{ agency: 'ag-kes', email: 'deeds@frost.test' }]);
  });

  /* ONCE ADDED, THE ROW DISAPPEARS AND THE COUNTS UPDATE. The list is
     re-read and the page is told, which is what moves the tab count,
     the All count and the three tiles; the session refresh is what
     moves Home's tile and the sidebar badge, because those read the
     hydrated org. */
  it('then tells the page, so every count that holds it moves', async () => {
    const onChanged = vi.fn();
    const v = renderTab(onChanged);
    await waitFor(() => { if (!v.container.querySelector('.nin__card')) throw new Error('not ready'); });
    fireEvent.click(v.getByText('Add email'));
    fireEvent.change(v.container.querySelector('.ph-addemail__form input')!, {
      target: { value: 'deeds@frost.test' },
    });
    fireEvent.click(v.getByText('Save'));
    await settle();
    // The agency now has an address, so the RPC stops returning it.
    listRows = [];
    fireEvent.click(v.getByText('Set email'));
    await settle();
    await settle();
    expect(onChanged).toHaveBeenCalled();
    expect(v.container.querySelector('.nin__card')).toBeNull();
  });
});

/* =====================================================================
   AND THE CONTROL CARRIES ITS OWN LOOK.

   Its styles were in PartnerHome.css, which Reconciliation does not
   import, so the button would have rendered unstyled on the second page
   that used it -- and the second page would then have grown a copy of
   the rules that drifts from the first.
   ===================================================================== */
import { readFileSync } from 'node:fs';
const readSrc = (f: string) => readFileSync(f, 'utf8');

describe('the shared control', () => {
  it('imports its own stylesheet', () => {
    expect(readSrc('src/pages/PartnerManagement/AddContactEmail.tsx'))
      .toContain("import './AddContactEmail.css'");
  });

  it('and the page that used to own those rules no longer does', () => {
    expect(readSrc('src/pages/PartnerManagement/PartnerHome.css')).not.toContain('.ph-addemail {');
  });

  /* THE SUPPLIER PAGE LEARNED ?tab= FOR THIS, with the same whitelist
     Reconciliation uses: a tab has to be named to be deep-linkable, and
     missing it opens Overview rather than nothing. */
  it('and the supplier page can be linked at a tab', () => {
    const src = readSrc('src/pages/PartnerManagement/PartnerHome.tsx');
    expect(src).toContain("const t = params.get('tab');");
    expect(src).toContain("t === 'agencies'");
  });
});
