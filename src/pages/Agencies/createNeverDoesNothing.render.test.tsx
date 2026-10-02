/* ADD AGENCY: CREATE MUST NEVER DO NOTHING.
 *
 * Matt, 2026-10-01, verbatim: "Add agency form: Create must never do
 * nothing. If anything is missing or the save fails, show the reason
 * next to the field or at the top of the form. Don't ask for a branch
 * to create an agency: ask for the agency's name and address; that
 * becomes its office behind the scenes, never shown separately. 'Add
 * another branch' stays available for agencies with several offices.
 * The first invite is created with the agency in one step. Reproduce
 * the silent failure first, then fix it."
 *
 * =====================================================================
 * THE SILENT FAILURE, REPRODUCED BEFORE IT WAS FIXED
 * =====================================================================
 *
 * Choose "An independent agency", type the agency name, press Create:
 * the button was DISABLED, nothing on the form said why, and the thing
 * it was silently waiting for was a BRANCH NAME. `canSave` was a
 * boolean with no voice:
 *
 *     const canSave = !busy && emailOk && namedAgencies.length > 0
 *       && (shape === 'independent' ? drafts[0].branches.some(...) : ...)
 *
 * The two halves of Matt's instruction are the same bug from either
 * end: the form was demanding a branch, and refusing silently when it
 * did not get one.
 *
 * NOW: Create is always live. Pressing it either creates or says what
 * is missing, beside each field AND at the top, because this form is
 * long enough to hide a message beside a field the reader has scrolled
 * past.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { AgencyCreate } from './AgencyCreate';
import * as shapes from '@/data/orgShapes';

beforeEach(() => { localStorage.setItem('grp_role', 'superadmin'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const dialog = () => document.querySelector('[role="dialog"]')!;
const btn = (label: string) =>
  [...dialog().querySelectorAll<HTMLButtonElement>('button')]
    .find((b) => (b.textContent ?? '').trim() === label);

async function independentForm() {
  render(
    <MemoryRouter><ToastProvider><SessionProvider>
      <AgencyCreate open onClose={() => {}} />
    </SessionProvider></ToastProvider></MemoryRouter>,
  );
  await waitFor(() => { if (!document.querySelector('[role="dialog"]')) throw new Error('no dialog'); });
  const shape = [...dialog().querySelectorAll<HTMLElement>('.ac-shape')]
    .find((o) => /independent/i.test(o.textContent ?? ''))!;
  await act(async () => { fireEvent.click(shape); });
}
const type = async (id: string, value: string) => {
  const el = dialog().querySelector<HTMLInputElement>(`#${id}`)!;
  expect(el, `no field ${id}`).toBeTruthy();
  await act(async () => { fireEvent.change(el, { target: { value } }); });
};

describe('Create is never a dead button', () => {
  it('is pressable with nothing filled in at all', async () => {
    await independentForm();
    expect(btn('Create')!.disabled).toBe(false);
  });

  it('and pressing it says what is missing, at the top', async () => {
    const spy = vi.spyOn(shapes, 'createOrgShape');
    await independentForm();
    await act(async () => { fireEvent.click(btn('Create')!); });
    expect(spy, 'it tried to create with nothing filled in').not.toHaveBeenCalled();
    const summary = dialog().querySelector('.ac-problems');
    expect(summary, 'no summary at the top of the form').toBeTruthy();
    /* BOTH, on one press. An empty form knows two things are missing and
       should not make the reader discover them one at a time. */
    expect(summary!.textContent).toMatch(/Give the agency a name/);
    expect(summary!.textContent).toMatch(/Give the agency an address/);
    /* THREE SINCE 2026-10-02, not two: Matt required a contact email on
       every agency at creation ("so one always exists"), so an empty form
       is now short of a name, an address and somewhere to send a deed. */
    expect(summary!.textContent).toMatch(/3 things are missing/);
    expect(summary!.textContent).toMatch(/contact email/i);
  });

  /* THE REPORTED CASE, which used to be a dead button and silence. */
  it('and with only the name, says the address is what is missing', async () => {
    const spy = vi.spyOn(shapes, 'createOrgShape');
    await independentForm();
    await type('ac-name-0', 'Northgate Lettings');
    await act(async () => { fireEvent.click(btn('Create')!); });
    expect(spy).not.toHaveBeenCalled();
    expect(dialog().querySelector('.ac-problems')!.textContent)
      .toMatch(/Give the agency an address/);
    /* AND BESIDE THE FIELD TOO. Field renders `error` as .field-error. */
    const errs = [...dialog().querySelectorAll('.field-error')].map((e) => e.textContent);
    expect(errs.some((t) => /address/i.test(t ?? ''))).toBe(true);
  });

  it('and says nothing before the reader has pressed anything', async () => {
    await independentForm();
    expect(dialog().querySelector('.ac-problems')).toBeNull();
    expect(dialog().querySelectorAll('.field-error')).toHaveLength(0);
  });
});

describe('it asks for an address, not a branch', () => {
  it('there is no branch field to fill in', async () => {
    await independentForm();
    /* STARTS-WITH, not equality: Field renders its hint INSIDE the
       <label>, so "Agency address" arrives as "Agency address Where they
       work from. This becomes their office." */
    const labels = [...dialog().querySelectorAll('label')].map((l) => (l.textContent ?? '').trim());
    const has = (t: string) => labels.some((l) => l.startsWith(t));
    expect(has('Agency name')).toBe(true);
    expect(has('Agency address')).toBe(true);
    expect(has('First branch'), 'the form still demands a branch').toBe(false);
  });

  /* "ADD ANOTHER BRANCH STAYS AVAILABLE", and adds a field when pressed
     rather than sitting there as an empty row nobody needs. */
  it('and "Add another branch" is still there for an agency with several offices', async () => {
    await independentForm();
    expect(btn('Add another branch')).toBeTruthy();
    expect(dialog().querySelector('#ac-br-0-0')).toBeNull();
    await act(async () => { fireEvent.click(btn('Add another branch')!); });
    expect(dialog().querySelector('#ac-br-0-0')).toBeTruthy();
  });

  /* THE OFFICE IS MADE BEHIND THE AGENCY, named after it, carrying the
     address. Matt: "that becomes its office behind the scenes, never shown
     separately." */
  it('and the address becomes an office named after the agency', async () => {
    const spy = vi.spyOn(shapes, 'createOrgShape')
      .mockResolvedValue({ agencyIds: ['a1'], branchIds: ['b1'], groupId: undefined } as never);
    await independentForm();
    await type('ac-name-0', 'Northgate Lettings');
    await type('ac-addr-0', '14 Northgate, Chester CH1 2EX');
    await type('ac-email-0', 'lettings@northgate.test');
    await act(async () => { fireEvent.click(btn('Create')!); });
    expect(spy).toHaveBeenCalled();
    const arg = spy.mock.calls[0][0];
    expect(arg.agencies[0].name).toBe('Northgate Lettings');
    expect(arg.agencies[0].branches).toEqual([
      { name: 'Northgate Lettings', area: '14 Northgate, Chester CH1 2EX' },
    ]);
  });

  it('and a second office is carried through as its own branch', async () => {
    const spy = vi.spyOn(shapes, 'createOrgShape')
      .mockResolvedValue({ agencyIds: ['a1'], branchIds: ['b1'], groupId: undefined } as never);
    await independentForm();
    await type('ac-name-0', 'Northgate Lettings');
    await type('ac-addr-0', '14 Northgate, Chester');
    await type('ac-email-0', 'lettings@northgate.test');
    await act(async () => { fireEvent.click(btn('Add another branch')!); });
    await type('ac-br-0-0', 'Northgate Wrexham');
    await act(async () => { fireEvent.click(btn('Create')!); });
    expect(spy.mock.calls[0][0].agencies[0].branches).toHaveLength(2);
  });
});

describe('the first invite goes with the agency', () => {
  it('in the same call, not a second step', async () => {
    const spy = vi.spyOn(shapes, 'createOrgShape')
      .mockResolvedValue({ agencyIds: ['a1'], branchIds: ['b1'], groupId: undefined } as never);
    await independentForm();
    await type('ac-name-0', 'Northgate Lettings');
    await type('ac-addr-0', '14 Northgate, Chester');
    await type('ac-email-0', 'lettings@northgate.test');
    await type('ac-inv-email', 'manager@northgate.test');
    await act(async () => { fireEvent.click(btn('Create')!); });
    expect(spy.mock.calls[0][0].invite?.email).toBe('manager@northgate.test');
  });

  /* A BAD EMAIL IS A REASON, not a dead button. */
  it('and a bad address for it says so rather than refusing silently', async () => {
    const spy = vi.spyOn(shapes, 'createOrgShape');
    await independentForm();
    await type('ac-name-0', 'Northgate Lettings');
    await type('ac-addr-0', '14 Northgate, Chester');
    await type('ac-inv-email', 'not-an-email');
    await act(async () => { fireEvent.click(btn('Create')!); });
    expect(spy).not.toHaveBeenCalled();
    expect(dialog().querySelector('.ac-problems')!.textContent).toMatch(/not an email address/i);
  });
});

/* AND A SAVE THAT FAILS SAYS SO. "If anything is missing OR THE SAVE
   FAILS, show the reason" -- the second half was already a toast, and
   this pins it so the rewrite did not drop it. */
describe('a save that fails', () => {
  it('shows the reason rather than closing quietly', async () => {
    vi.spyOn(shapes, 'createOrgShape').mockRejectedValue(new Error('That name is already taken.'));
    await independentForm();
    await type('ac-name-0', 'Northgate Lettings');
    await type('ac-addr-0', '14 Northgate, Chester');
    await type('ac-email-0', 'lettings@northgate.test');
    await act(async () => { fireEvent.click(btn('Create')!); });
    await waitFor(() => {
      if (!/already taken/.test(document.body.textContent ?? '')) throw new Error('no message');
    });
    expect(document.querySelector('[role="dialog"]'), 'the form closed on a failure').toBeTruthy();
  });
});
