/* NOTES FOLLOW THE RAIL, AND THE TENANT'S FILES NEVER LEAVE OPNDOOR.
 *
 * Matt, 2026-10-01: "Notes are Opndoor-only: hide the Notes section
 * entirely from agency and supplier users, and check they can't read
 * notes through any other route." And, the same evening, correcting the
 * supplier half of it: "notes on an application are shared between
 * Opndoor and the supplier that referred it (e.g. Rightmove's staff); on
 * agency referrals (e.g. Regent) notes stay Opndoor-only."
 *
 * So the rule is about the RAIL. An agency Director sees none; a
 * supplier's staff see the ones on their own applications; the tenant's
 * uploaded files stay Opndoor's on every rail, because the correction
 * says notes and a bank statement is not a note.
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
 * Manager and the Negotiator who referred the application read zero notes
 * on their OWN application, a supplier's Management user reads the one on
 * theirs and nobody else's, and the applicant's files stay Opndoor's
 * throughout.
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
import { maySeeApplicationNotes } from '@/data/capabilities';
import { ALL_PARTNERS } from '@/data/types';

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
  /* THE REPORTED BUG, which was about the AGENCY rail: GR-20601 is a
     Northwind referral, and Northwind is on opndoor_referenced, so it is
     an agency and its notes are Opndoor's. */
  it('is gone for an agency Management user', async () => {
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

/* AND THE RULE ITSELF, on both rails. The page can only be rendered for the
   party the mock session is scoped to, so the two rails are asked of the
   predicate the page uses, which is also the one the policy mirrors. */
describe('who the notes belong to', () => {
  it('Opndoor, on any rail', () => {
    expect(maySeeApplicationNotes('superadmin', ALL_PARTNERS)).toBe(true);
    expect(maySeeApplicationNotes('opndoor_manager', ALL_PARTNERS)).toBe(true);
  });

  /* THE CORRECTION. A supplier's staff work the account with us and the
     notes are the shared record of that. */
  it('and the supplier that referred it, on theirs', () => {
    expect(maySeeApplicationNotes('management', 'harbourside')).toBe(true);
    expect(maySeeApplicationNotes('referrer', 'harbourside')).toBe(true);
  });

  it('but never an agency, which is what the original instruction was about', () => {
    expect(maySeeApplicationNotes('management', 'northwind')).toBe(false);
    expect(maySeeApplicationNotes('referrer', 'northwind')).toBe(false);
  });

  /* VIEW AS SHOWS WHAT THAT PARTY SEES, which for an agency is no notes and
     for a supplier is their own. */
  it('and View as follows the party, not the admin', () => {
    expect(maySeeApplicationNotes('superadmin', 'northwind', 'northwind')).toBe(false);
    expect(maySeeApplicationNotes('superadmin', 'harbourside', 'harbourside')).toBe(true);
  });
});
