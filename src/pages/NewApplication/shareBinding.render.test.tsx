/* The rent-share two-way binding on the New application form: each field fills
   the other on input, rounded to the penny, and follows the rent; the mismatch
   warning appears only once both are set and they disagree. */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { App } from '@/App';

afterEach(cleanup);

async function openForm() {
  localStorage.setItem('grp_role', 'management');
  const view = render(
    <MemoryRouter initialEntries={['/new-application']}>
      <SessionProvider><ToastProvider><App /></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!document.querySelector('#ty-share-pct')) throw new Error('form not ready'); });
  const q = (sel: string) => view.container.querySelector<HTMLInputElement>(sel)!;
  const change = (sel: string, value: string) => fireEvent.change(q(sel), { target: { value } });
  return { q, change, view };
}
const MISMATCH = /do not agree/i;

describe('rent share, two-way binding on input', () => {
  it('typing a percentage fills the amount (£1,800 @ 50% = £900)', async () => {
    const { q, change } = await openForm();
    change('#ty-rent', '1800');
    change('#ty-share-pct', '50');
    expect(q('#ty-share-amt').value).toBe('900');
  });

  it('typing an amount sets the percentage (£900 of £1,800 = 50%)', async () => {
    const { q, change } = await openForm();
    change('#ty-rent', '1800');
    change('#ty-share-amt', '900');
    expect(q('#ty-share-pct').value).toBe('50');
  });

  it('fills the amount from the default 100% as soon as the rent is entered', async () => {
    const { q, change } = await openForm();
    change('#ty-rent', '1800');
    expect(q('#ty-share-amt').value).toBe('1800');
  });

  it('rounds to the penny', async () => {
    const { q, change } = await openForm();
    change('#ty-rent', '1000');
    change('#ty-share-pct', '33.333');
    expect(q('#ty-share-amt').value).toBe('333.33');
  });

  it('follows the rent, re-deriving the field the user did not pin', async () => {
    const { q, change } = await openForm();
    // Pinned the percentage: the amount follows the rent.
    change('#ty-rent', '1800');
    change('#ty-share-pct', '50');
    change('#ty-rent', '2000');
    expect(q('#ty-share-amt').value).toBe('1000');
  });

  it('follows the rent by the amount when the amount was the one set', async () => {
    const { q, change } = await openForm();
    change('#ty-rent', '1800');
    change('#ty-share-amt', '900'); // pins the amount; percent -> 50
    change('#ty-rent', '2000');
    expect(q('#ty-share-amt').value).toBe('900');   // amount preserved
    expect(q('#ty-share-pct').value).toBe('45');    // percent follows: 900 / 2000
  });

  it('does not warn of a mismatch on the freshly-entered state', async () => {
    const { view, change } = await openForm();
    change('#ty-rent', '1800'); // percent 100 (default), amount derives to 1800
    expect(view.container.textContent).not.toMatch(MISMATCH);
    change('#ty-share-pct', '50');
    expect(view.container.textContent).not.toMatch(MISMATCH);
  });
});
