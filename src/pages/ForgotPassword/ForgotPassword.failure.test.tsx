/* What /forgot-password says when the send does NOT work.

   WHY THIS EXISTS. A reset for a real address produced no email and the page
   said "a reset link is on its way" anyway. Three conditions arrived at one
   catch block and left as that one sentence: the address has no account, the
   send failed, and the service is down. Only the first is a secret worth
   keeping, and the server keeps it by answering ok for a hit and a miss alike.
   The other two are facts about us, and the neutral copy was absorbing them.

   So these assert the SEPARATION, not just the wording: a success still keeps
   account existence invisible, and a failure never claims an email is coming. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ForgotPassword } from './ForgotPassword';
import * as tenantAuth from '@/tenant/tenantAuth';
import { authService } from '@/data';

vi.mock('@/tenant/tenantAuth', async (orig) => ({
  ...(await orig<typeof import('@/tenant/tenantAuth')>()),
  requestReset: vi.fn(),
}));
vi.mock('@/data', async (orig) => {
  const real = await orig<typeof import('@/data')>();
  return { ...real, authService: { ...real.authService, requestPasswordReset: vi.fn() } };
});

const tenantReset = tenantAuth.requestReset as ReturnType<typeof vi.fn>;
const staffReset = authService.requestPasswordReset as ReturnType<typeof vi.fn>;

const at = (path = '/forgot-password') =>
  render(<MemoryRouter initialEntries={[path]}><ForgotPassword /></MemoryRouter>);

async function ask(address = 'someone@example.invalid') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: address } });
  fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
}

beforeEach(() => { tenantReset.mockReset(); staffReset.mockReset(); });
afterEach(() => cleanup());

describe('a reset that did not send does not claim it did', () => {
  it('shows the failure, and never the on-its-way copy', async () => {
    tenantReset.mockRejectedValue(new Error('We could not send that just now. Try again in a moment.'));
    at('/forgot-password?tab=tenant');
    await ask();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/could not send that just now/i);
    // The whole defect in one assertion.
    expect(screen.queryByText(/on\s+its\s+way/i)).toBeNull();
  });

  it('passes the wait through when the limiter refused', async () => {
    // withinLimits used to discard the minutes limitCheck had already computed,
    // so a refusal was reported as a link being on its way.
    tenantReset.mockRejectedValue(new Error('Too many reset requests. Try again in 45 minutes.'));
    at('/forgot-password?tab=tenant');
    await ask();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/45 minutes/);
    expect(screen.queryByText(/on\s+its\s+way/i)).toBeNull();
  });

  it('still hides whether the account exists when the send worked', async () => {
    // The non-disclosure that IS worth keeping. A hit and a miss both land here.
    tenantReset.mockResolvedValue({ ok: true });
    at('/forgot-password?tab=tenant');
    await ask('nobody@example.invalid');
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toMatch(/if an account exists/i);
    expect(screen.queryByRole('alert')).toBeNull();
    // POSITIVE CONTROL. The two failure tests above assert this phrase is
    // ABSENT. That assertion is worth nothing unless the same query finds it
    // when it IS there, and the copy splits across a <b>, which is exactly the
    // shape that silently stops queryByText matching.
    expect(screen.queryByText(/on\s+its\s+way/i)).not.toBeNull();
  });

  it('reports a failed send on the staff path too', async () => {
    // authService swallowed its own errors and always resolved ok, so fixing
    // only the page would have left Agent and Supplier exactly as they were.
    staffReset.mockRejectedValue(new Error('We could not send that just now. Try again in a moment.'));
    at('/forgot-password?tab=agent');
    await ask('agent@example.invalid');
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText(/on\s+its\s+way/i)).toBeNull();
  });

  it('clears the failure when the next attempt succeeds', async () => {
    tenantReset.mockRejectedValueOnce(new Error('We could not send that just now. Try again in a moment.'));
    at('/forgot-password?tab=tenant');
    await ask();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    tenantReset.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
