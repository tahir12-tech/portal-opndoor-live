/* ID check and Financials are built as the right shape now: the vendor route is
   the primary action, shown but disabled. ID check is scan-only (no photo upload:
   a file is not an identity check), with a human fallback. Financials keeps the
   statement upload as its secondary route. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { IdCheckPanel, FinancialsPanel } from './Sections';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

type Doc = { id: string; kind: string; filename: string; bytes: number | null; income_id: string | null; address_id: string | null };
const doc = (kind: string): Doc => ({ id: kind, kind, filename: `${kind}.pdf`, bytes: 1, income_id: null, address_id: null });

describe('ID check', () => {
  it('offers the guided scan as the only route, not switched on yet', () => {
    render(<IdCheckPanel />);
    expect((screen.getByRole('button', { name: /start the check/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/not switched on yet/i)).toBeTruthy();
  });

  it('has no photo upload, only a way to reach a human who has paid', () => {
    render(<IdCheckPanel />);
    expect(screen.queryByRole('button', { name: /upload a photo/i })).toBeNull();
    expect(screen.queryByText(/or send a photo/i)).toBeNull();
    expect((screen.getByRole('link', { name: /hello@opndoor\.co/i }) as HTMLAnchorElement).getAttribute('href')).toBe('mailto:hello@opndoor.co');
  });
});

describe('Financials', () => {
  it('shows connecting the bank as the primary route, not switched on yet', () => {
    render(<FinancialsPanel applicationId="a1" documents={[]} editable onChanged={() => {}} />);
    expect((screen.getByRole('button', { name: /connect your bank/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/not switched on yet/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /upload a bank statement/i })).toBeTruthy();
  });

  it('a completed bank connection satisfies it and hides the upload', () => {
    render(<FinancialsPanel applicationId="a1" documents={[doc('bank_connection')]} editable onChanged={() => {}} />);
    expect(screen.getByText(/your bank is connected/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /upload a bank statement/i })).toBeNull();
  });
});
