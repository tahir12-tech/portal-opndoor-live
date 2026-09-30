/* NM-N. THE AGENCIES WE DO NOT WORK WITH, FOR SOMEBODY TO TYPE INTO HUBSPOT.
 *
 * Matt, 2026-09-30, verbatim: "NM-N: don't create companies in HubSpot
 * automatically; list agencies a direct tenant named that we don't work
 * with on the Reconciliation page, with the agent contact given, for
 * someone to add to HubSpot by hand."
 *
 * BOTH HALVES ARE ASSERTED, and the first is the unusual one: a test that
 * nothing is written. Item 24 asked for the agency to be created in HubSpot
 * as a prospect; the check against HUBSPOT-CONSEQUENCES.md found that its
 * own dedupe sentence cannot be honoured, and Matt's answer is to write
 * nothing at all. "We decided not to build a thing" leaves no code behind
 * to protect it, so the assertion is on the surface: this list offers no
 * control that reaches the CRM. Without it, the next person to read
 * "agencies to add to HubSpot" adds a helpful button.
 *
 * AND THE TENANT IS NOT ON IT. Item 24: "Only the agency and agent contact
 * go across, never the tenant's details." The SQL does not select them and
 * the row type cannot carry them, so this is the third lock rather than the
 * only one -- but it is the one that fails loudly if somebody widens the
 * other two.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { Reconciliation } from './Reconciliation';

beforeEach(() => { localStorage.clear(); localStorage.setItem('grp_role', 'superadmin'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function open(tab?: string) {
  const view = render(
    <MemoryRouter initialEntries={[tab ? `/reconciliation?tab=${tab}` : '/reconciliation']}>
      <ToastProvider><SessionProvider><PageMetaProvider>
        <Reconciliation />
      </PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.rtabs')) throw new Error('no tabs'); });
  await act(async () => {});
  return view;
}

type View = Awaited<ReturnType<typeof open>>;
const tabLabels = (v: View) =>
  [...v.container.querySelectorAll('.rtabs button')].map((b) => (b.textContent ?? '').trim());
const text = (v: View) => v.container.textContent ?? '';

describe('the tab', () => {
  it('is offered on Reconciliation', async () => {
    const v = await open();
    expect(tabLabels(v).join(' | ')).toMatch(/Not in network/);
  });

  /* THE COUNT IS THE POINT OF THE TAB. Two agencies are in the mock book, so
     a tab reading "Not in network" with no number would be a worse version
     of the four beside it, all of which count. */
  it('and carries its count, like the four beside it', async () => {
    const v = await open();
    expect(tabLabels(v).some((l) => /Not in network\s*2/.test(l))).toBe(true);
  });

  /* A DEEP LINK HAS TO LAND ON IT. The ?tab= parser is a whitelist of string
     literals, so a new tab that is not added to it falls back to All -- and
     the page would open on a list that does not contain what was clicked. */
  it('and ?tab= lands on it rather than falling back to All', async () => {
    const v = await open('notinnetwork');
    expect(text(v)).toMatch(/Foxton & Hale/);
  });
});

describe('what the list says', () => {
  it('names each agency, in the spelling a tenant used', async () => {
    const v = await open('notinnetwork');
    expect(text(v)).toMatch(/Foxton & Hale/);
    expect(text(v)).toMatch(/Quayside Residential/);
  });

  it('and how many tenants named it', async () => {
    const v = await open('notinnetwork');
    expect(text(v)).toMatch(/3 tenants/);
    expect(text(v)).toMatch(/1 tenant\b/);
  });

  it('and the agent contact the tenant gave', async () => {
    const v = await open('notinnetwork');
    expect(text(v)).toMatch(/Ruth Calder/);
    expect(text(v)).toMatch(/lettings@foxtonhale\.test/);
    expect(text(v)).toMatch(/020 7946 2200/);
  });

  /* THE ROW WITH NO AGENT CONTACT IS STILL A ROW, and says so. On dev this
     is the real case: the one dismissed application gave a private
     landlord, who is not an agent and is deliberately not carried across.
     An agency that silently vanished because nobody left a phone number is
     a prospect lost without anybody knowing. */
  it('and says plainly when no agent contact was given', async () => {
    const v = await open('notinnetwork');
    expect(text(v)).toMatch(/No agent contact/);
  });
});

describe('what the list must not do', () => {
  /* MATT'S FIRST CLAUSE, HELD ON THE SURFACE. */
  it('offers nothing that writes to HubSpot', async () => {
    const v = await open('notinnetwork');
    const controls = [...v.container.querySelectorAll('.nin button, .nin a')]
      .map((b) => (b.textContent ?? '').trim());
    for (const c of controls) {
      expect(c, `"${c}" reads like a CRM write`).not.toMatch(/hubspot|crm|sync|add to|create|push/i);
    }
  });

  /* AND NOTHING OF THE TENANT'S. Written against the tenant data that is
     REALLY ON THIS PAGE rather than against the word "tenant", which the
     list says legitimately when it counts them. The Direct matches tab one
     click away carries tenant names, guarantee references and properties,
     because the person working that queue is deciding which agency a named
     tenant belongs to. This tab is for retyping a company into a CRM and
     item 24 says "never the tenant's details", so the same three must not
     be here.

     BOTH DIRECTIONS, so the assertion is discriminating: the names are
     asserted PRESENT on the tab that should have them. Without that half
     this passes just as well if the fixture stops carrying tenants. */
  it('and shows no tenant name, guarantee reference or property', async () => {
    const v = await open('notinnetwork');
    const list = v.container.querySelector('.nin')?.textContent ?? '';
    for (const leak of ['Sam Okafor', 'Alex Field', 'Priya Shah', 'GR-1000', 'Leeds LS1 4DY']) {
      expect(list, `${leak} is the tenant's, not the agency's`).not.toContain(leak);
    }
  });

  it('while the Direct matches tab does carry them, which is why this bites', async () => {
    const v = await open('matches');
    expect(text(v)).toContain('Sam Okafor');
    expect(text(v)).toContain('GR-1000');
  });
});

describe('the four tabs that were already there', () => {
  /* THE CONTROL. A new member of the Filter union, a new arm in the ?tab=
     whitelist, a new entry in the tabs array and a new branch in the body:
     four edits to shared code, and the way to get one wrong is to break a
     sibling. */
  it('still open their own lists', async () => {
    const v = await open('matches');
    expect(v.container.querySelector('.nin')).toBeNull();
    cleanup();
    const w = await open();
    expect(w.container.querySelector('.nin')).toBeNull();
    expect(tabLabels(w).join(' | ')).toMatch(/All/);
  });
});
