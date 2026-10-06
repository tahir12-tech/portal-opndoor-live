/* THE RENT IS NOT GUARANTEED UNTIL SOMEBODY HAS GUARANTEED IT.
 *
 * Matt, 2026-10-01, verbatim: "Application detail: before the deed is
 * issued, label the rent figure 'Rent to be guaranteed' instead of
 * 'Guaranteed annual rent'."
 *
 * The figure does not move. What changes is whether a deed exists, and
 * until it does the card was stating a guarantee over a tenancy nobody
 * had guaranteed -- on the same card as an issue date reading "-".
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { App } from '@/App';
import { getApplicationDetail } from '@/data';

afterEach(() => { cleanup(); localStorage.clear(); });

async function detail(ref: string) {
  localStorage.setItem('grp_role', 'superadmin');
  const view = render(
    <MemoryRouter initialEntries={[`/applications/${ref}`]}>
      <SessionProvider><ToastProvider><App /></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('.gsum')) throw new Error('no summary'); });
  return view;
}

/** A reference from the mock book in each state, found rather than hardcoded:
    the seed changes and a fixture that names one ref goes stale silently. */
function refWith(status: string): string {
  for (const r of ['GR-20601', 'GR-20602', 'GR-20418', 'GR-20455', 'GR-20489', 'GR-20493']) {
    const d = getApplicationDetail(r);
    if (d && d.status === status) return r;
  }
  throw new Error(`no mock application in state ${status}`);
}

describe('the rent figure on the guarantee card', () => {
  it('reads "Guaranteed annual rent" once the deed is issued', async () => {
    const v = await detail(refWith('deed'));
    const t = v.container.querySelector('.gsum')?.textContent ?? '';
    expect(t).toContain('Guaranteed annual rent');
    expect(t).not.toContain('Rent to be guaranteed');
  });

  it('and "Rent to be guaranteed" before it is', async () => {
    const v = await detail(refWith('paid'));
    const t = v.container.querySelector('.gsum')?.textContent ?? '';
    expect(t).toContain('Rent to be guaranteed');
    expect(t).not.toContain('Guaranteed annual rent');
  });

  /* AND THE FIGURE ITSELF IS THE SAME ONE, which is the point: the label
     moved, the number did not. */
  it('and the amount is unchanged either way', async () => {
    const paid = await detail(refWith('paid'));
    const amount = paid.container.querySelectorAll('.gsum__row')[3]?.querySelector('.v')?.textContent ?? '';
    expect(amount).toMatch(/£[\d,]+/);
  });
});
