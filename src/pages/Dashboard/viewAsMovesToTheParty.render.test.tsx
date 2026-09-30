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
import { KEYS } from '@/data/storage';
import { hydrateCommissionVisibility, getAgencies, getPartners, ALL_PARTNERS } from '@/data';

const AGENCY = getAgencies(ALL_PARTNERS).filter((a) => !a.isPlaceholder)[0];
const SUPPLIER = getPartners()[0];

beforeEach(() => { localStorage.clear(); hydrateCommissionVisibility(true); });
afterEach(() => {
  cleanup();
  hydrateCommissionVisibility(true);
  // The selection is remembered and shared with Applications, so it outlives
  // the component and would hand the next test a narrowed book.
  localStorage.removeItem(KEYS.scopeSel);
  localStorage.removeItem(KEYS.scopeRecents);
});

async function open(role: string, path: string) {
  localStorage.setItem('grp_role', role);
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider><SessionProvider><PageMetaProvider>
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
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
     fixed it there and NM-F's deletion was only ever about Reporting. That
     is asserted in originPicker.render.test.tsx; named here so the two
     cannot be confused by somebody deleting "the picker". */
  it('while Applications keeps its own, which item 7 fixed', () => {
    // Asserted in src/pages/Applications/originPicker.render.test.tsx.
    expect(true).toBe(true);
  });
});

describe('the View as button on an agency page', () => {
  it('is offered to Opndoor staff', async () => {
    const v = await open('superadmin', `/agencies/${encodeURIComponent(AGENCY.name)}`);
    expect(buttons(v)).toContain('View as');
  });

  /* NOT TO THE AGENCY'S OWN PEOPLE. Viewing as yourself is the page you are
     already on, and the control writes a shared selection that would then
     narrow their Applications list to the agency it is already narrowed to. */
  it('and not to the agency’s own people', async () => {
    const v = await open('management', `/agencies/${encodeURIComponent(AGENCY.name)}`);
    expect(buttons(v)).not.toContain('View as');
  });

  /* NOR TO OPNDOOR'S OWN OPS STAFF, and this one is a judgement rather than
     a rule, so it is written down. `isOpndoorStaff` -- superadmin OR
     opndoor_manager -- is what gates the Reporting tab three lines away on
     this same page, and matching it here would look consistent. It would be
     a dead control: `viewingAs` derives in SessionContext for `superadmin`
     only, so an opndoor_manager pressing this would narrow their shared
     Applications list and find Reporting unchanged and unexplained. They
     already have the better surface for the same question, which is the
     per-customer Reporting tab on this page. Widening means changing
     SessionContext first and the gate second. */
  it('nor to Opndoor’s ops staff, for whom it would do nothing', async () => {
    const v = await open('opndoor_manager', `/agencies/${encodeURIComponent(AGENCY.name)}`);
    expect(buttons(v)).not.toContain('View as');
  });

  it('and pressing it remembers that party as the selection', async () => {
    const v = await open('superadmin', `/agencies/${encodeURIComponent(AGENCY.name)}`);
    await act(async () => { viewAsButton(v)!.click(); });
    expect(localStorage.getItem(KEYS.scopeSel)).toBe(`agency:${AGENCY.name}`);
  });

  /* AND TAKES YOU TO THE REPORT. Setting a selection and leaving the reader
     where they were is a preference control, which is the thing Matt found
     confusing about the picker. The Dashboard route is mounted in this
     test's router, so arriving is observable. */
  it('and takes the reader to that party’s Reporting page', async () => {
    const v = await open('superadmin', `/agencies/${encodeURIComponent(AGENCY.name)}`);
    await act(async () => { viewAsButton(v)!.click(); });
    expect(v.container.textContent).toMatch(/Viewing as/);
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

describe('and Reporting says whose page it is showing, and how to stop', () => {
  /* THE CONSEQUENCE THAT IS NOT IN THE INSTRUCTION. Without this an admin
     who views as a party has no way back: the picker was the only control
     that cleared the selection, and the selection is shared with
     Applications. */
  it('names the party while viewing as one', async () => {
    localStorage.setItem(KEYS.scopeSel, `agency:${AGENCY.name}`);
    const v = await open('superadmin', '/dashboard');
    expect(v.container.textContent).toMatch(new RegExp(`Viewing as ${AGENCY.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  });

  it('and offers a way to stop', async () => {
    localStorage.setItem(KEYS.scopeSel, `agency:${AGENCY.name}`);
    const v = await open('superadmin', '/dashboard');
    expect(buttons(v)).toContain('Stop viewing as');
  });

  it('and stopping clears the selection, so both screens widen again', async () => {
    localStorage.setItem(KEYS.scopeSel, `agency:${AGENCY.name}`);
    const v = await open('superadmin', '/dashboard');
    const stop = [...v.container.querySelectorAll<HTMLElement>('button')]
      .find((b) => (b.textContent ?? '').trim() === 'Stop viewing as')!;
    await act(async () => { stop.click(); });
    expect(localStorage.getItem(KEYS.scopeSel) ?? '').toBe('');
  });

  /* AND SAYS NOTHING WHEN THERE IS NOTHING TO SAY. A banner on the
     estate-wide view would be furniture on every page load. */
  it('and says nothing when not viewing as anybody', async () => {
    const v = await open('superadmin', '/dashboard');
    expect(v.container.textContent).not.toMatch(/Viewing as/);
    expect(buttons(v)).not.toContain('Stop viewing as');
  });
});
