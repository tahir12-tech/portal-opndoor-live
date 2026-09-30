/* The direct-rail agency-match panel, in mock mode.

   The rules under test are the ones the tenant never sees: an EXACT name match
   pre-selects the agency but still makes a person pick the branch; a near miss
   auto-accepts nothing and shows its candidates with scores; and nothing here
   is placed until a branch is chosen. */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AgencyMatchQueue } from './AgencyMatchQueue';

afterEach(() => cleanup());

describe('direct agency matches', () => {
  it('pre-selects the exact-matched agency but still requires a branch', async () => {
    render(<AgencyMatchQueue />);
    await waitFor(() => expect(screen.getByText(/Tenant typed .*Meridian Lettings/)).toBeTruthy());

    /* The row is tagged and names the agency. Walk fix 22a renamed the
       tag from "Exact match", which stated our matcher's verdict, to
       "Name matches", which states what a reader can check. */
    expect(screen.getByText('Name matches')).toBeTruthy();

    // Its branches load, and "Set branch" is disabled until one is chosen:
    // the branch is never auto-accepted, whatever the agency outcome.
    const select = await screen.findByLabelText('Branch');
    await waitFor(() => expect(within(select).getByText(/City Centre/)).toBeTruthy());
    const setBtn = screen.getAllByRole('button', { name: /set branch/i })[0] as HTMLButtonElement;
    expect(setBtn.disabled).toBe(true);

    fireEvent.change(select, { target: { value: 'br-m-city' } });
    expect(setBtn.disabled).toBe(false);

    /* AND THEN IT ASKS. Walk fix 23 put a confirmation in front of this
       button, so the click no longer sets the branch: it raises a dialog
       naming the agency and the office, and the affirmative there does
       the work. The row clearing the queue is still the outcome, which is
       what this test was always about -- one step further along.

       The dialog is rendered in a portal, so it is found on `document`
       rather than through `screen` bound to the container. */
    fireEvent.click(setBtn);
    const link = await waitFor(() => {
      const b = [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')]
        .find((x) => (x.textContent ?? '').trim() === 'Link to this office');
      if (!b) throw new Error('no confirmation');
      return b;
    });
    fireEvent.click(link);
    await waitFor(() => expect(screen.queryByText(/Tenant typed .*Meridian Lettings/)).toBeNull());
  });

  it('auto-accepts nothing on a near miss and shows candidates with scores', async () => {
    render(<AgencyMatchQueue />);
    await waitFor(() => expect(screen.getByText(/Tenant typed .*barnad & co/)).toBeTruthy());
    // No exact match tag, and the closest name is offered as a hint, not accepted.
    expect(screen.getByText('No exact match')).toBeTruthy();
    expect(screen.getByText(/Barnard & Co/)).toBeTruthy();
    expect(screen.getByText(/62%/)).toBeTruthy();
  });

  it('shows an email auto-match read-only, naming the agency, branch and how it was matched', async () => {
    render(<AgencyMatchQueue />);
    await waitFor(() => expect(screen.getByText(/Tenant typed .*Harbour Lettings/)).toBeTruthy());
    const row = screen.getByText(/Tenant typed .*Harbour Lettings/).closest('.rqitem') as HTMLElement;
    // Tagged as an email match; names the agency and the branch it set itself.
    expect(within(row).getByText('Email match')).toBeTruthy();
    /* Walk fix 22a reworded this. It said "Contact email matched X ...
       Auto-accepted; no review needed", which stated the matcher's
       verdict; it now says the agent's email matches and that the row
       needs nothing from the reader, which is the part they act on. */
    expect(within(row).getByText(/email address matches/)).toBeTruthy();
    expect(within(row).getByText(/needs nothing from you/)).toBeTruthy();
    expect(within(row).getByText('Riverside')).toBeTruthy();
    // Auto-accepted, so it is read-only: no resolve or dismiss on this row.
    expect(within(row).queryByRole('button', { name: /set branch/i })).toBeNull();
    expect(within(row).queryByRole('button', { name: /not in network/i })).toBeNull();
  });

  it('can dismiss a row as not in network', async () => {
    render(<AgencyMatchQueue />);
    await waitFor(() => expect(screen.getByText(/Tenant typed .*barnad & co/)).toBeTruthy());
    const row = screen.getByText(/Tenant typed .*barnad & co/).closest('.rqitem') as HTMLElement;
    // Walk fix 23: the button asks first. See the note on the test above.
    fireEvent.click(within(row).getByRole('button', { name: /not in network/i }));
    const go = await waitFor(() => {
      const b = [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')]
        .find((x) => (x.textContent ?? '').trim() === 'We do not work with them');
      if (!b) throw new Error('no confirmation');
      return b;
    });
    fireEvent.click(go);
    await waitFor(() => expect(screen.queryByText(/Tenant typed .*barnad & co/)).toBeNull());
  });
});
