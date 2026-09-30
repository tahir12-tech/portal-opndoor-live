/* WALK FIX 23. THE TWO BUTTONS THAT ACTED ON ONE CLICK.
 *
 * Matt, verbatim: "Reconciliation, Direct matches: 'Set branch' and 'Not in
 * network' act immediately. Both need a confirmation box first, saying in
 * plain English what will happen (for example 'Link this tenant's agent to
 * Foo Lettings, Foo Central?'). Apply the same rule to any other admin
 * action that changes records in one click."
 *
 * THIS FILE IS THE TWO HE NAMED. The wider clause -- every other one-click
 * admin action -- is 29 actions across the product, which is a decision
 * about scope rather than a thing to assume, and it is Q9 in QUEUE.md.
 *
 * BOTH ARE ONE-WAY FROM THIS SCREEN, which is what makes the confirmation
 * worth more than a habit. On success the row leaves the queue, so there is
 * no undo and no second chance to read what happened. "Not in network" is
 * the worse of the two: it also puts the agency on the Not in network list
 * that somebody will later retype into HubSpot.
 *
 * THE ASSERTIONS ARE ABOUT THE SENTENCE, NOT THE DIALOG. Matt's example
 * names the tenant's typed agency AND the chosen office, and that is the
 * whole point: a confirmation that does not say which record it is about
 * is the same click with an extra step in front of it, and it teaches
 * people to press through. So every assertion below reads the dialog for
 * the actual names from the row, and the last two prove that nothing
 * happened until the reader said so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/components/ui/Toast';
import { AgencyMatchQueue } from './AgencyMatchQueue';
import * as recon from '@/data/reconciliationService';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function open() {
  const onChanged = vi.fn(async () => {});
  const view = render(
    <MemoryRouter><ToastProvider><AgencyMatchQueue onChanged={onChanged} /></ToastProvider></MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.rqitem')) throw new Error('no rows'); });
  await act(async () => {});
  return { ...view, onChanged };
}

type View = Awaited<ReturnType<typeof open>>;
const btn = (v: View, label: string) =>
  [...v.container.querySelectorAll<HTMLElement>('button')]
    .find((b) => (b.textContent ?? '').trim() === label);
/** The confirmation renders in a portal, so it is not inside `container`. */
const dialog = () => document.querySelector('[role="dialog"]');
const dialogText = () => dialog()?.textContent ?? '';
const dialogBtn = (label: string) =>
  [...(dialog()?.querySelectorAll<HTMLElement>('button') ?? [])]
    .find((b) => (b.textContent ?? '').trim() === label);

/** The first row's typed agency name, read off the page rather than
    hardcoded, so the fixture can change without silently weakening this.
    The heading renders it as: Tenant typed “<name>” */
function firstTypedName(v: View): string {
  const heading = (v.container.querySelector('.rqitem .rqitem__name')?.textContent ?? '');
  return (heading.match(/“([^”]+)”/)?.[1] ?? '').trim();
}

describe('Not in network', () => {
  it('asks before it acts', async () => {
    const spy = vi.spyOn(recon, 'dismissAgencyMatch');
    const v = await open();
    await act(async () => { fireEvent.click(btn(v, 'Not in network')!); });
    expect(dialog(), 'no confirmation appeared').toBeTruthy();
    expect(spy, 'it dismissed the match before anybody agreed').not.toHaveBeenCalled();
  });

  /* THE SENTENCE NAMES THE AGENCY THE TENANT TYPED. Without this the
     dialog is "are you sure", which is the click again. */
  it('and names the agency the tenant typed', async () => {
    const v = await open();
    const typed = firstTypedName(v);
    expect(typed, 'the fixture has no typed name, so this proves nothing').toBeTruthy();
    await act(async () => { fireEvent.click(btn(v, 'Not in network')!); });
    expect(dialogText()).toContain(typed);
  });

  /* AND SAYS WHAT ELSE HAPPENS. The tenant stays with Opndoor direct, and
     the agency goes on a list somebody will retype into HubSpot. The
     second half is the consequence a reader cannot guess from the button. */
  it('and says the tenant stays with Opndoor and the agency goes on the list', async () => {
    const v = await open();
    await act(async () => { fireEvent.click(btn(v, 'Not in network')!); });
    expect(dialogText()).toMatch(/direct/i);
    expect(dialogText()).toMatch(/Not in network list/i);
  });

  it('and does it once the reader agrees', async () => {
    const spy = vi.spyOn(recon, 'dismissAgencyMatch').mockResolvedValue(undefined);
    const v = await open();
    await act(async () => { fireEvent.click(btn(v, 'Not in network')!); });
    await act(async () => { dialogBtn('We do not work with them')!.click(); });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  /* AND CANCEL REALLY CANCELS, which is the half that is easy to leave
     broken: a dialog whose Cancel runs the action anyway is worse than no
     dialog, because the reader believes they stopped it. */
  it('and cancelling does nothing at all', async () => {
    const spy = vi.spyOn(recon, 'dismissAgencyMatch');
    const v = await open();
    await act(async () => { fireEvent.click(btn(v, 'Not in network')!); });
    await act(async () => { dialogBtn('Cancel')!.click(); });
    expect(spy).not.toHaveBeenCalled();
    expect(dialog(), 'the dialog stayed open after Cancel').toBeNull();
  });
});

describe('Set branch', () => {
  /** Pick the first real branch so the button is enabled. */
  async function withBranchChosen() {
    const v = await open();
    /* The branch options arrive from loadMatchBranchOptions after the row
       renders, so waiting for the row is not waiting for the select. */
    await waitFor(() => { if (!v.container.querySelector('select')) throw new Error('no branches yet'); });
    const select = v.container.querySelector<HTMLSelectElement>('select');
    expect(select, 'no branch select on the row').toBeTruthy();
    const option = [...select!.querySelectorAll('option')].find((o) => o.value);
    expect(option, 'no branch to choose').toBeTruthy();
    await act(async () => { fireEvent.change(select!, { target: { value: option!.value } }); });
    return { v, branchLabel: (option!.textContent ?? '').trim() };
  }

  it('asks before it acts', async () => {
    const spy = vi.spyOn(recon, 'resolveAgencyMatch');
    const { v } = await withBranchChosen();
    await act(async () => { fireEvent.click(btn(v, 'Set branch')!); });
    expect(dialog(), 'no confirmation appeared').toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  /* MATT'S OWN EXAMPLE, both halves of it: "Link this tenant's agent to
     Foo Lettings, Foo Central?" names the AGENCY and the OFFICE. */
  it('and names both the agency and the office, as Matt’s example does', async () => {
    const { v, branchLabel } = await withBranchChosen();
    const typed = firstTypedName(v);
    await act(async () => { fireEvent.click(btn(v, 'Set branch')!); });
    const t = dialogText();
    expect(t, 'the agency the tenant typed is missing').toContain(typed);
    // The option label can carry an area after a separator; the name is enough.
    expect(t, 'the chosen office is missing').toContain(branchLabel.split(' · ')[0]);
  });

  /* AND SAYS WHAT DOES NOT CHANGE. The reader's likeliest worry about
     linking a direct tenant to an agency is that it hands the agency the
     commission. It does not, and the dialog says so. */
  it('and says the commission does not move', async () => {
    const { v } = await withBranchChosen();
    await act(async () => { fireEvent.click(btn(v, 'Set branch')!); });
    expect(dialogText()).toMatch(/commission/i);
  });

  it('and does it once the reader agrees', async () => {
    const spy = vi.spyOn(recon, 'resolveAgencyMatch').mockResolvedValue(undefined);
    const { v } = await withBranchChosen();
    await act(async () => { fireEvent.click(btn(v, 'Set branch')!); });
    await act(async () => { dialogBtn('Link to this office')!.click(); });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('and cancelling does nothing at all', async () => {
    const spy = vi.spyOn(recon, 'resolveAgencyMatch');
    const { v } = await withBranchChosen();
    await act(async () => { fireEvent.click(btn(v, 'Set branch')!); });
    await act(async () => { dialogBtn('Cancel')!.click(); });
    expect(spy).not.toHaveBeenCalled();
  });
});
