/* =====================================================================
   PRESS SEND ON AN EMPTY FORM AND THE FORM TELLS YOU WHAT IS LEFT.

   Matt, 2026-10-03: "New application form: when Send is pressed with required
   fields missing, scroll to the first missing field, highlight every missing
   field in red with 'Required', and show a message at the Send button: '3
   fields still need filling in' with a link that jumps to the first one."

   WHAT IT DID INSTEAD, and this is the behaviour the file is really about:
   `disabled = busy || (submitted && !isValid)`. So the first press revealed
   the errors a screen and a half above the button, and then the button went
   DEAD. A reader who then filled in two of the missing fields had no way to
   ask again, no count, and no way to find the rest.
   ===================================================================== */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { NewApplication } from './NewApplication';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function open() {
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

describe('an empty form', () => {
  it('has a Send button that can be pressed', async () => {
    const v = open();
    await waitFor(() => expect(sendButton()).toBeTruthy());
    expect(sendButton().hasAttribute('disabled')).toBe(false);
  });

  it('marks nothing before it has been pressed', async () => {
    const v = open();
    await waitFor(() => expect(sendButton()).toBeTruthy());
    // A form nobody has typed in yet is being filled in, not failing.
    expect(invalid(v).length).toBe(0);
    expect(body()).not.toMatch(/still need[s]? filling in/);
  });

  it('marks every missing field once it has', async () => {
    const v = open();
    await waitFor(() => expect(sendButton()).toBeTruthy());
    fireEvent.click(sendButton());
    await waitFor(() => expect(invalid(v).length).toBeGreaterThan(3));
    // Matt's word, on the fields that are simply empty.
    expect(invalid(v).map((f) => f.querySelector('.field-error')?.textContent))
      .toContain('Required');
  });

  /* THE COUNT, BESIDE THE BUTTON. It has to agree with what is on the page,
     which is why it is read off the page rather than off the error object:
     the picker's fields and every extra tenant's belong to other components. */
  it('and says how many, beside the button', async () => {
    const v = open();
    await waitFor(() => expect(sendButton()).toBeTruthy());
    fireEvent.click(sendButton());
    await waitFor(() => expect(body()).toMatch(/\d+ fields still need filling in/));
    const shown = Number(/(\d+) fields still need filling in/.exec(body())![1]);
    expect(shown).toBe(invalid(v).length);
  });

  /* THE BUTTON STAYS ALIVE, which is the regression this file exists for. */
  it('and the button is still pressable afterwards', async () => {
    const v = open();
    await waitFor(() => expect(sendButton()).toBeTruthy());
    fireEvent.click(sendButton());
    await waitFor(() => expect(invalid(v).length).toBeGreaterThan(0));
    expect(sendButton().hasAttribute('disabled')).toBe(false);
  });

  /* AND THERE IS A WAY BACK TO THE FIRST ONE. The jump is a button and not an
     anchor on purpose: an href would leave a fragment in the address bar and
     the back button would start stepping through the fields somebody failed
     to fill in. */
  it('offers a way to the first missing field, and takes you there', async () => {
    const v = open();
    await waitFor(() => expect(sendButton()).toBeTruthy());
    fireEvent.click(sendButton());
    await waitFor(() => expect(body()).toMatch(/still need[s]? filling in/));
    const jump = screen.getAllByRole('button').find((b) => b.textContent === 'Go to the first one')!;
    expect(jump).toBeTruthy();
    expect(jump.tagName).toBe('BUTTON');
    const firstControl = invalid(v)[0].querySelector('input, select, textarea') as HTMLElement;
    fireEvent.click(jump);
    await waitFor(() => expect(document.activeElement).toBe(firstControl));
  });
});

describe('as the form is filled in', () => {
  /* THE COUNT COMES DOWN, which is the other half of keeping the button
     alive: pressing Send is now how a reader checks their progress. */
  it('the count falls as fields are answered', async () => {
    const v = open();
    await waitFor(() => expect(sendButton()).toBeTruthy());
    fireEvent.click(sendButton());
    await waitFor(() => expect(body()).toMatch(/fields still need filling in/));
    const before = invalid(v).length;

    fireEvent.change(v.container.querySelector('#t-first')!, { target: { value: 'Ada' } });
    fireEvent.change(v.container.querySelector('#t-last')!, { target: { value: 'Lovelace' } });
    await waitFor(() => expect(invalid(v).length).toBe(before - 2));
    await waitFor(() => {
      const n = Number(/(\d+) fields? still needs? filling in/.exec(body())?.[1] ?? '0');
      expect(n).toBe(before - 2);
    });
  });
});
