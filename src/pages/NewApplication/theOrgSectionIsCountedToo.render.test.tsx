/* =====================================================================
   THE ORG SECTION'S MISSING ANSWERS ARE COUNTED AND JUMPED TO.

   Matt, 2026-10-04: "Admin New application form: with required fields missing,
   pressing Send shows the messages ('Tell us whether this is a single-office
   agency', 'Enter a contact email...') only in the sections above, so from the
   bottom of the page nothing seems to happen. On Send, scroll to the first
   missing field, mark every missing field, and show 'N things still need
   filling in' next to the Send button with a link to the first."

   THIS IS A GAP IN WHAT I BUILT FOR ITEM 7 AND HE IS RIGHT ABOUT IT. The count
   and the jump read `.field.is-invalid`, which `Field` sets. The org section's
   four errors were not in a `Field` at all: bare `<p className="na-form-error">`
   and a loose `<span className="field-error">`, rendered UNDER the picker by
   the form. So none of the four was counted, the jump stepped over all of
   them, and on the one form where the org section is step 1 and the button is
   at the bottom of a long page, pressing Send did nothing a reader could see.

   THE FIX IS WHERE THE CONTROL IS. The picker owns those controls, so the
   picker is told when to show errors and marks its own fields. The form's four
   paragraphs are gone: two statements of one problem is how they drift apart.

   WHICH IS WHY THIS FILE ASSERTS THE MECHANISM AND NOT THE MESSAGES.
   `pressSendAndBeTold` covers the count, the jump and the pressable button on
   an empty form. What was broken here is that the org section was INVISIBLE to
   all three, so these assertions are about it being in the population.
   ===================================================================== */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { hydrateCommissionVisibility } from '@/data';
import { NewApplication } from './NewApplication';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

/* AS AN ADMIN, which is the level Matt was on and the only one that sees the
   Supplier picker inside the agency contact block. */
function openAsAdmin() {
  localStorage.setItem('grp_role', 'superadmin');
  hydrateCommissionVisibility(true);
  return render(
    <MemoryRouter initialEntries={['/new-application']}>
      <ToastProvider><SessionProvider><PageMetaProvider>
        <NewApplication />
      </PageMetaProvider></SessionProvider></ToastProvider>
    </MemoryRouter>,
  );
}

const sendButton = () => screen.getAllByRole('button')
  .find((b) => /Send application/.test(b.textContent ?? ''))!;
const invalid = (v: { container: HTMLElement }) =>
  [...v.container.querySelectorAll('#na-form .field.is-invalid')];
const body = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

describe('the form the admin was looking at', () => {
  it('has a Send button that can be pressed', async () => {
    openAsAdmin();
    await waitFor(() => expect(sendButton()).toBeTruthy());
    expect(sendButton().hasAttribute('disabled')).toBe(false);
  });

  /* THE COUNT IS BESIDE THE BUTTON, which is the whole complaint: the reader
     is standing at the bottom of the page and the errors were at the top. */
  it('and says how many things need attention, beside it', async () => {
    const v = openAsAdmin();
    await waitFor(() => expect(sendButton()).toBeTruthy());
    fireEvent.click(sendButton());
    await waitFor(() => expect(body()).toMatch(/\d+ things still need your attention/));
    const shown = Number(/(\d+) things still need your attention/.exec(body())![1]);
    expect(shown).toBe(invalid(v).length);
  });

  /* "N THINGS", NOT "N FIELDS", which is Matt's own word the second time and
     is right: two of the org section's four are not fields anybody fills in. */
  it('and calls them things rather than fields', async () => {
    openAsAdmin();
    await waitFor(() => expect(sendButton()).toBeTruthy());
    fireEvent.click(sendButton());
    await waitFor(() => expect(body()).toMatch(/still need your attention/));
    expect(body()).not.toMatch(/still need[s]? filling in/);
  });
});

describe('the org section is in the population now', () => {
  /* THE AGENCY AND OFFICE PAIR. An empty form has neither, and the old code
     said so in a `<span className="field-error">` that no `Field` owned, so
     it was neither counted nor reachable. */
  it('marks the agency picker when nothing is chosen', async () => {
    const v = openAsAdmin();
    await waitFor(() => expect(document.getElementById('ag-name')).toBeTruthy());
    fireEvent.click(sendButton());
    await waitFor(() => {
      const marked = invalid(v).some((f) => f.querySelector('#ag-name'));
      expect(marked).toBe(true);
    });
  });

  /* AND THE FORM NO LONGER SAYS IT TWICE. The paragraphs it used to print
     under the picker are gone; the field says it. */
  it('and no longer prints the old paragraphs under the picker', async () => {
    openAsAdmin();
    await waitFor(() => expect(sendButton()).toBeTruthy());
    fireEvent.click(sendButton());
    await waitFor(() => expect(body()).toMatch(/still need your attention/));
    expect(body()).not.toMatch(/Select an agent and a branch/);
    expect(body()).not.toMatch(/Select the partner this new agency belongs to/);
  });

  /* THE JUMP REACHES THE FIRST ONE, which on this form is in the org section
     because that section is step 1. This is the behaviour that appeared to do
     nothing: the button was at the bottom and the first missing thing was off
     the top of the screen. */
  it('and the jump lands on the first missing thing', async () => {
    const v = openAsAdmin();
    await waitFor(() => expect(sendButton()).toBeTruthy());
    fireEvent.click(sendButton());
    await waitFor(() => expect(body()).toMatch(/still need your attention/));
    const first = invalid(v)[0].querySelector('input, select, textarea') as HTMLElement;
    const jump = screen.getAllByRole('button').find((b) => b.textContent === 'Go to the first one')!;
    fireEvent.click(jump);
    await waitFor(() => expect(document.activeElement).toBe(first));
  });
});
