/* OPNDOOR'S NOTES, AND THE TENANT'S OWN FILES, ARE NOT THE AGENCY'S.
 *
 * Matt, 2026-10-01, verbatim: "Notes are Opndoor-only: hide the Notes
 * section entirely from agency and supplier users, and check they can't
 * read notes through any other route."
 *
 * =====================================================================
 * WHY THE PAGE SHOWED THEM, AND WHY THIS FILE IS NOT THE PROOF
 * =====================================================================
 *
 * The rule was `superadmin || management || (referrer && owner)`, and
 * `management` is the role an agency Director, an agency Manager AND a
 * supplier Management user hold: the level words are shared across the
 * rails. So "internal operational notes" were on an agency Director's
 * screen, and the applicant's bank statements were in the card below.
 *
 * THE OTHER ROUTE WAS THE TABLE, and that is where the fix is.
 * notesService selects app_notes in the browser, so the policy was the
 * whole boundary and a role test on a page is not a boundary at all.
 * tenant_isolation.test.sql asserts it from the other side: an agency
 * Manager, the Negotiator who referred the application, and a supplier's
 * Management user each read zero notes and zero applicant files ON THEIR
 * OWN application, and Opndoor still reads both.
 *
 * This file asserts only what a screen can assert: that the section is
 * gone for them and still there for us.
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
  it('is there for Opndoor, who the notes belong to', async () => {
    const view = await openAs('superadmin');
    expect(card(view, 'Notes'), 'Opndoor lost its own notes').toBeTruthy();
  });

  /* THE REPORTED BUG. "management" is an agency Director and an agency
     Manager as well as a supplier's Management user, and all three were
     reading Opndoor's internal notes about their own referrals. */
  it('is gone for an agency or supplier Management user', async () => {
    const view = await openAs('management');
    expect(card(view, 'Notes'), 'the agency can still read Opndoor’s notes').toBeNull();
    expect(view.container.textContent).not.toContain('Internal operational notes');
  });

  it('and gone for a Negotiator, including on a referral they sent', async () => {
    const view = await openAs('referrer');
    expect(card(view, 'Notes')).toBeNull();
  });

  it('and gone for a supplier’s developer', async () => {
    const view = await openAs('developer');
    expect(card(view, 'Notes')).toBeNull();
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
