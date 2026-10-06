/* ADD BRANCH / ADD ANOTHER AGENCY: THE BUTTON IS LIVE AND SAYS WHY NOT.
 *
 * Matt, 2026-10-04, verbatim: "Fix AgencyGrow now, the same way as the
 * others: enable the button, and on press with anything missing, scroll to
 * the first missing field, mark each one, and show 'N things still need
 * filling in' by the button."
 *
 * =====================================================================
 * THE OPPOSITE FAILURE TO THE ONE EVERY OTHER FORM HAD
 * =====================================================================
 *
 * The four forms fixed before this one had a live button and errors the
 * reader could not find. This one could not be pressed at all:
 *
 *     disabled={mode === 'branch' ? !canBranch : !canAgency}
 *
 * so there was nothing to press, nothing to report, and no way to learn
 * which of twelve fields the form was waiting for. A grey button is a
 * worse silence than a dead one, because it looks deliberate.
 *
 * THE REFUSAL IS NOW DERIVED FROM THE SAME LIST THAT MARKS THE FIELDS, which
 * is what these tests are really pinning: a press that does not save must
 * always leave something marked, or the silence is back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { AgencyGrow } from './AgencyGrow';
import * as data from '@/data';
import type { Agency } from '@/data';

beforeEach(() => { localStorage.setItem('grp_role', 'superadmin'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const dialog = () => document.querySelector('[role="dialog"]')!;
const btn = (label: string) =>
  [...dialog().querySelectorAll<HTMLButtonElement>('button')]
    .find((b) => (b.textContent ?? '').trim() === label);
const invalid = () => [...dialog().querySelectorAll<HTMLElement>('.field.is-invalid')];
const type = async (id: string, value: string) => {
  const el = dialog().querySelector<HTMLInputElement>(`#${id}`)!;
  expect(el, `no field ${id}`).toBeTruthy();
  await act(async () => { fireEvent.change(el, { target: { value } }); });
};

const AGENCY = { id: 'a1', name: 'Northwind Property', partner: 'opndoor-agents' } as unknown as Agency;

async function open(mode: 'branch' | 'agency', group?: { id: string; name: string }) {
  render(
    <MemoryRouter><ToastProvider><SessionProvider>
      <AgencyGrow
        mode={mode}
        agencies={[AGENCY]}
        group={group as never}
        onClose={() => {}}
        onDone={() => {}}
      />
    </SessionProvider></ToastProvider></MemoryRouter>,
  );
  await waitFor(() => { if (!document.querySelector('[role="dialog"]')) throw new Error('no dialog'); });
}

describe('Add branch is never a dead button', () => {
  it('is pressable with nothing filled in at all', async () => {
    await open('branch');
    expect(btn('Add branch')!.disabled).toBe(false);
  });

  it('and pressing it marks what is missing instead of saving', async () => {
    const spy = vi.spyOn(data, 'createBranchLive');
    await open('branch');
    await act(async () => { fireEvent.click(btn('Add branch')!); });
    expect(spy, 'it tried to save an empty form').not.toHaveBeenCalled();
    expect(invalid().length, 'nothing was marked').toBeGreaterThan(0);
  });

  it('and says how many, in the words every other form uses', async () => {
    await open('branch');
    await act(async () => { fireEvent.click(btn('Add branch')!); });
    expect(dialog().textContent).toMatch(/\d+ things? still needs? filling in/);
  });

  /* THE INVARIANT THAT MATTERS. A refused press must always leave something
     to count, or the grey button has simply been replaced by a live one that
     does nothing. Asserted as a relationship between the two, not as a
     number, because the number depends on which fields are on screen. */
  it('and a refused press always leaves something marked', async () => {
    const spy = vi.spyOn(data, 'createBranchLive');
    await open('branch');
    await act(async () => { fireEvent.click(btn('Add branch')!); });
    expect(spy).not.toHaveBeenCalled();
    expect(invalid().length).toBeGreaterThan(0);
    expect(dialog().textContent).toMatch(/still needs? filling in/);
  });

  it('and the jump reaches the first missing field', async () => {
    await open('branch');
    await act(async () => { fireEvent.click(btn('Add branch')!); });
    const first = invalid()[0].querySelector('input, select') as HTMLElement;
    const jump = [...dialog().querySelectorAll('button')]
      .find((b) => b.textContent === 'Go to the first one')!;
    expect(jump, 'no jump button beside the save button').toBeTruthy();
    await act(async () => { fireEvent.click(jump); });
    await waitFor(() => expect(document.activeElement).toBe(first));
  });

  it('and once the name is given it saves', async () => {
    const spy = vi.spyOn(data, 'createBranchLive').mockResolvedValue(undefined as never);
    await open('branch');
    await type('ag-branch-name', 'Headingley');
    await act(async () => { fireEvent.click(btn('Add branch')!); });
    await waitFor(() => expect(spy).toHaveBeenCalled());
  });

  it('and says nothing before the reader has pressed anything', async () => {
    await open('branch');
    expect(dialog().textContent).not.toMatch(/still needs? filling in/);
    expect(invalid().length).toBe(0);
  });
});

describe('Add another agency is never a dead button either', () => {
  it('is pressable, and names all three missing things at once', async () => {
    await open('agency');
    expect(btn('Add agency')!.disabled).toBe(false);
    await act(async () => { fireEvent.click(btn('Add agency')!); });
    /* AN INDEPENDENT GROWING INTO A GROUP needs the group name, the new
       agency and its first branch. All three on one press: a reader should
       not discover them one at a time. */
    expect(invalid().length).toBe(3);
    expect(dialog().textContent).toMatch(/3 things still need filling in/);
  });
});

describe('a mistyped email', () => {
  /* IT MARKS ITSELF AT ONCE, which is deliberate and different from
     "Required": a typo is a fact about something already typed, and worth
     saying before the press. The COUNT still waits for the press, because a
     tally that ticks down while somebody types is a scold. */
  it('is marked while typing, but not counted until the press', async () => {
    await open('branch');
    await type('ag-branch-name', 'Headingley');
    await type('ag-branch-email', 'not-an-email');
    expect(invalid().length, 'the email should be marked live').toBe(1);
    expect(dialog().textContent).not.toMatch(/still needs? filling in/);
    await act(async () => { fireEvent.click(btn('Add branch')!); });
    expect(dialog().textContent).toMatch(/1 thing still needs filling in/);
  });

  it('and still stops the save', async () => {
    const spy = vi.spyOn(data, 'createBranchLive');
    await open('branch');
    await type('ag-branch-name', 'Headingley');
    await type('ag-branch-email', 'not-an-email');
    await act(async () => { fireEvent.click(btn('Add branch')!); });
    expect(spy).not.toHaveBeenCalled();
  });
});
