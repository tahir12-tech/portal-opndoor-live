/* WHERE THE INVOICE EMAIL LIVES, AND WHAT HAPPENS WHEN IT DOES NOT.
 *
 * Matt, 2026-10-01, in two messages:
 *   "The invoice email is not hardcoded and has no default: make it a
 *   setting Opndoor admin fills in. Until it's set, don't send
 *   statements; show a clear warning on Home and Health saying the
 *   invoice email needs setting. Tell me where the setting lives."
 *   "Invoice email: default it to accounts@opndoor.co, as a setting
 *   Opndoor admin can change later. No warning needed while it's set."
 *
 * IT LIVES ON HEALTH, UNDER SETTINGS. Health is where the things that
 * stop a scheduled job are already shown, and an unset invoice address
 * stops the monthly statement run dead. where_to_send_the_invoice.test.sql
 * proves the database half: the RPC is admin-only and MFA'd, the shape of
 * the address is checked, and statements_can_be_posted() is false while
 * it is empty. What only a render can show is that there is a screen at
 * all, that it says what clearing it costs, and that the warning appears
 * for exactly the state it is about.
 *
 * THE WARNING IS CONDITIONAL, which is the second message. The setting is
 * seeded with accounts@opndoor.co, so on a healthy estate neither block
 * renders and this file asserts that too: a standing note saying "set
 * your invoice email" on a page where it is already set is noise, and
 * noise on Health is what makes a real alert get scrolled past.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/components/ui/Toast';
import { InvoiceEmailCard } from './InvoiceEmailCard';
import * as settings from '@/data/settingsService';

const SET = { email: 'accounts@opndoor.co', changedAt: new Date('2026-10-01'), changedBy: 'Matt Dwyer' };
const UNSET = { email: null, changedAt: null, changedBy: null };

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function open(state: settings.InvoiceEmailSetting) {
  vi.spyOn(settings, 'getInvoiceEmail').mockResolvedValue(state);
  const onChanged = vi.fn();
  const view = render(
    <MemoryRouter><ToastProvider><InvoiceEmailCard onChanged={onChanged} /></ToastProvider></MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('#inv-email')) throw new Error('no field'); });
  await act(async () => {});
  return { ...view, onChanged };
}
type View = Awaited<ReturnType<typeof open>>;
const field = (v: View) => v.container.querySelector<HTMLInputElement>('#inv-email')!;
const btn = (v: View, label: string) =>
  [...v.container.querySelectorAll<HTMLElement>('button')]
    .find((b) => (b.textContent ?? '').trim() === label);
const dialog = () => document.querySelector('[role="dialog"]');
const dialogTitle = () => dialog()?.querySelector('.modal__title')?.textContent ?? '';
const dialogBtn = (label: string) =>
  [...(dialog()?.querySelectorAll<HTMLElement>('button') ?? [])]
    .find((b) => (b.textContent ?? '').trim() === label);

describe('the setting has a home', () => {
  it('is a field under Settings, holding the address that is set', async () => {
    const v = await open(SET);
    expect(v.container.textContent).toContain('Settings');
    expect(field(v).value).toBe('accounts@opndoor.co');
  });

  /* THE SENTENCE IT FILLS IN, shown rather than described. An admin
     changing an address should see the line they are changing. */
  it('and shows the sentence a payee will actually read', async () => {
    const v = await open(SET);
    expect(v.container.textContent).toContain('Please send an invoice to opndoor for [total]');
    expect(v.container.textContent).toContain('accounts@opndoor.co');
    expect(v.container.textContent).toMatch(/Invoices received by the 8th are paid by the 15th/);
  });

  it('and who last changed it, so a wrong address has somebody to ask', async () => {
    const v = await open(SET);
    expect(v.container.textContent).toContain('Matt Dwyer');
  });

  /* SAVE IS DEAD UNTIL SOMETHING CHANGES. A live Save on an unedited
     field invites a confirmation box about no change at all. */
  it('and Save does nothing until the address is edited', async () => {
    const v = await open(SET);
    expect((btn(v, 'Save') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { fireEvent.change(field(v), { target: { value: 'finance@opndoor.co' } }); });
    expect((btn(v, 'Save') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('changing it', () => {
  it('asks first, and names the address it will put on every statement', async () => {
    const spy = vi.spyOn(settings, 'setInvoiceEmail');
    const v = await open(SET);
    await act(async () => { fireEvent.change(field(v), { target: { value: 'finance@opndoor.co' } }); });
    await act(async () => { fireEvent.click(btn(v, 'Save')!); });
    expect(dialog(), 'no confirmation box').toBeTruthy();
    expect(spy, 'it saved before the reader confirmed').not.toHaveBeenCalled();
    expect(dialogTitle()).toBe('Change the invoice address');
    expect(dialog()?.textContent).toContain('finance@opndoor.co');
    expect(dialog()?.textContent).toMatch(/email, the PDF and the CSV/);
  });

  it('and saves the trimmed address once confirmed', async () => {
    const spy = vi.spyOn(settings, 'setInvoiceEmail').mockResolvedValue(undefined);
    const v = await open(SET);
    await act(async () => { fireEvent.change(field(v), { target: { value: '  finance@opndoor.co  ' } }); });
    await act(async () => { fireEvent.click(btn(v, 'Save')!); });
    await act(async () => { fireEvent.click(dialogBtn('Save address')!); });
    expect(spy).toHaveBeenCalledWith('finance@opndoor.co');
  });

  /* CLEARING IT IS THE LOUD CASE. With no address the monthly run posts
     nothing at all, and the box has to say that rather than ask a mild
     question about an empty field. */
  it('and clearing it says that no statement can be posted at all', async () => {
    const v = await open(SET);
    await act(async () => { fireEvent.change(field(v), { target: { value: '' } }); });
    await act(async () => { fireEvent.click(btn(v, 'Save')!); });
    /* THE TITLE AS WELL AS THE BODY. A box headed "Change the invoice
       address" over a body that says no statement can be posted is the
       wrong first line to read, and a mutant that made the title
       unconditional survived the first version of this file, because
       every assertion here was about the body. */
    expect(dialogTitle()).toBe('Clear the invoice address');
    const t = dialog()?.textContent ?? '';
    expect(t).toMatch(/no statement can be posted at all/i);
    expect(t).toMatch(/Home and Health will both warn/i);
    expect(dialogBtn('Clear it')).toBeTruthy();
  });
});

describe('while it is unset', () => {
  it('the card says so, and says what it costs', async () => {
    const v = await open(UNSET);
    expect(field(v).value).toBe('');
    expect(v.container.textContent).toMatch(/Not set, so no statement can be posted/i);
  });

  /* THE CARD TELLS THE PAGE, so the page can put its own warning at the
     top. `onChanged(false)` is what drives the Health alert. */
  it('and tells the page, which is what drives the warning above it', async () => {
    const v = await open(UNSET);
    expect(v.onChanged).toHaveBeenCalledWith(false);
  });

  it('while a set address reports the opposite, so no warning renders', async () => {
    const v = await open(SET);
    expect(v.onChanged).toHaveBeenCalledWith(true);
  });
});

/* A READ THAT FAILED IS NOT AN EMPTY SETTING, and this is the difference
   between "go and fill this in" and "we could not look". Telling an admin
   to set an address that is already set, because a select errored, is a
   warning that destroys trust in every other warning on the page. */
describe('when the setting cannot be read at all', () => {
  it('says so, and raises no alarm about a value it does not know', async () => {
    vi.spyOn(settings, 'getInvoiceEmail').mockRejectedValue(new Error('nope'));
    const onChanged = vi.fn();
    const v = render(
      <MemoryRouter><ToastProvider><InvoiceEmailCard onChanged={onChanged} /></ToastProvider></MemoryRouter>,
    );
    await waitFor(() => {
      if (!(v.container.textContent ?? '').match(/Could not read the setting/)) throw new Error('no message');
    });
    expect(v.container.textContent).toContain('It has not been changed.');
    expect(onChanged).not.toHaveBeenCalled();
  });
});
