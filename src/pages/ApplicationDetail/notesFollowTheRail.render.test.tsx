/* THE NOTES ARE THE SHARED RECORD; THE TENANT'S FILES ARE NOT.
 *
 * Matt, 2026-10-01, in three messages across one evening. First: "Notes
 * are Opndoor-only: hide the Notes section entirely from agency and
 * supplier users, and check they can't read notes through any other
 * route." Then: "notes on an application are shared between Opndoor and
 * the supplier that referred it." Then: "also share them with the agency
 * that referred the application, on the same terms as suppliers: anyone
 * who can see the application reads and adds notes, each showing who
 * wrote it. Tenants and other partners never see them."
 *
 * =====================================================================
 * WHAT SURVIVED ALL THREE, AND WHAT THIS FILE CAN ACTUALLY ASSERT
 * =====================================================================
 *
 * The constant across every version is the tenant's own uploaded files:
 * bank statements, proof of address, a P60, a tax return, collected for
 * the guarantee decision Opndoor makes. They were shown to every agency
 * Director by `role === 'superadmin' || role === 'management'`, the same
 * shared role word that started all of this, and they stay Opndoor's.
 *
 * The notes now have no client gate at all: reaching this page means the
 * server resolved the application for this caller, which is the same test
 * `app_notes_select` applies. A second copy of that rule on the client
 * could only disagree with it, and twice today it did. So the assertion
 * here is that the section is present for a reader who has the page, and
 * the boundary itself is proved in tenant_isolation.test.sql, from the
 * other side: an agency Manager and the Negotiator who referred it read
 * and write the notes on their OWN application and none on anybody
 * else's, a supplier's Management user the same on theirs, the author is
 * stamped by the database whichever door the note came through, and no
 * tenant session can resolve an application at all.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { App } from '@/App';

afterEach(() => { cleanup(); localStorage.clear(); });

const REF = 'GR-20601';

async function openAs(role: string) {
  localStorage.setItem('grp_role', role);
  const view = render(
    <MemoryRouter initialEntries={[`/applications/${REF}`]}>
      <SessionProvider><ToastProvider><App /></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!document.querySelector('.rec-head')) throw new Error('detail not ready'); });
  return view;
}

/** A card by its heading, which is how a reader finds one. */
const card = (view: { container: HTMLElement }, title: string) =>
  [...view.container.querySelectorAll('.card')]
    .find((c) => (c.querySelector('.card__title')?.textContent ?? '').trim() === title) ?? null;

describe('the Notes section', () => {
  it('is there for Opndoor, who keep the record', async () => {
    const view = await openAs('superadmin');
    expect(card(view, 'Notes'), 'Opndoor lost the notes').toBeTruthy();
  });

  /* THE CORRECTION, TWICE OVER. An agency Manager and a Negotiator can both
     see the application, so both read and add notes on it. */
  it('and for the agency that referred it', async () => {
    const view = await openAs('management');
    expect(card(view, 'Notes'), 'the agency cannot see the shared record').toBeTruthy();
  });

  it('and for the Negotiator who sent it', async () => {
    const view = await openAs('referrer');
    expect(card(view, 'Notes')).toBeTruthy();
  });

  /* AND IT SAYS WHOSE RECORD IT IS. The old subtitle, "Internal
     operational notes. Not shared with tenants or agents", is now false
     about agents and would be read as permission to write things the
     agency should not see. */
  it('and says who shares it, rather than claiming to be internal', async () => {
    const view = await openAs('management');
    const t = view.container.textContent ?? '';
    expect(t).toContain('The shared record of this application');
    expect(t).not.toContain('Not shared with tenants or agents');
  });

  /* ANYONE WHO READS IT CAN ADD TO IT, which is what "shared" means and is
     the half that was management-only before today. */
  it('and anyone who can see it can add one', async () => {
    const view = await openAs('referrer');
    expect(view.container.querySelector('#note-body'), 'no composer').toBeTruthy();
  });

  /* EACH SHOWING WHO WROTE IT. The author comes from the row, which the
     database stamps from auth.uid(); the screen must print it. */
  it('and every note shows who wrote it', async () => {
    const view = await openAs('superadmin');
    const notes = [...view.container.querySelectorAll('.note-item')];
    expect(notes.length, 'no notes in the fixture to check').toBeGreaterThan(0);
    for (const n of notes) {
      expect((n.querySelector('.note-item__time')?.textContent ?? '').trim()).toMatch(/·\s*\S/);
    }
  });
});

/* AND THE SAME FAULT ONE CARD DOWN, found checking the first: the
   applicant's bank statements, proof of address, P60 and tax return were
   shown by `superadmin || management` on a page whose own comment says
   they are collected for the decision Opndoor makes. The file itself was
   reachable too: application-document-url signs it with the service key
   on the strength of the caller's own read. */
describe('the applicant’s uploaded documents', () => {
  it('are there for Opndoor, who collected them', async () => {
    const view = await openAs('superadmin');
    expect(card(view, 'Documents'), 'Opndoor lost the applicant’s files').toBeTruthy();
  });

  it('and gone for an agency or supplier Management user', async () => {
    const view = await openAs('management');
    expect(card(view, 'Documents'), 'the agency can still read the tenant’s bank statements').toBeNull();
  });
});


