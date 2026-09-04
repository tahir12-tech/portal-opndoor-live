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

    // The exact-match row is tagged and names the agency.
    expect(screen.getByText('Exact match')).toBeTruthy();

    // Its branches load, and "Set branch" is disabled until one is chosen:
    // the branch is never auto-accepted, whatever the agency outcome.
    const select = await screen.findByLabelText('Branch');
    await waitFor(() => expect(within(select).getByText(/City Centre/)).toBeTruthy());
    const setBtn = screen.getAllByRole('button', { name: /set branch/i })[0] as HTMLButtonElement;
    expect(setBtn.disabled).toBe(true);

    fireEvent.change(select, { target: { value: 'br-m-city' } });
    expect(setBtn.disabled).toBe(false);

    // Setting it clears the row from the queue.
    fireEvent.click(setBtn);
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
    expect(within(row).getByText(/Contact email matched/)).toBeTruthy();
    expect(within(row).getByText('Riverside')).toBeTruthy();
    // Auto-accepted, so it is read-only: no resolve or dismiss on this row.
    expect(within(row).queryByRole('button', { name: /set branch/i })).toBeNull();
    expect(within(row).queryByRole('button', { name: /not in network/i })).toBeNull();
  });

  it('can dismiss a row as not in network', async () => {
    render(<AgencyMatchQueue />);
    await waitFor(() => expect(screen.getByText(/Tenant typed .*barnad & co/)).toBeTruthy());
    const row = screen.getByText(/Tenant typed .*barnad & co/).closest('.rqitem') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /not in network/i }));
    await waitFor(() => expect(screen.queryByText(/Tenant typed .*barnad & co/)).toBeNull());
  });
});
