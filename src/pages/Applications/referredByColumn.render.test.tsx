/* WHO SENT IT, ON THE AGENCY'S APPLICATIONS LIST.
 *
 * Matt, 2026-10-01, verbatim: "Agency Applications: add a 'Referred by'
 * column for Directors and Managers."
 *
 * NOT FOR A NEGOTIATOR, and the reason is the one this page already
 * applies to the Agency and Branch columns: their book is their own
 * referrals, so the column would be their own name repeated down every
 * row, which reads as data and carries none. `viewerShape` measures that
 * rather than guessing it from the role, so a one-person agency's
 * Director gets nothing either, for the same reason and without a
 * special case.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { App } from '@/App';

afterEach(() => { cleanup(); localStorage.clear(); });
beforeEach(() => { localStorage.clear(); });

async function listAs(role: string) {
  localStorage.setItem('grp_role', role);
  const view = render(
    <MemoryRouter initialEntries={['/applications']}>
      <SessionProvider><ToastProvider><App /></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!view.container.querySelector('table.dt')) throw new Error('no list'); });
  return view;
}

const headings = (v: { container: HTMLElement }) =>
  [...v.container.querySelectorAll('thead th')].map((t) => (t.textContent ?? '').trim());

describe('the Referred by column', () => {
  it('is there for a Director, whose book has several people in it', async () => {
    const v = await listAs('management');
    expect(headings(v)).toContain('Referred by');
  });

  it('and names somebody on the rows', async () => {
    const v = await listAs('management');
    const i = headings(v).indexOf('Referred by');
    const cells = [...v.container.querySelectorAll('tbody tr')]
      .map((r) => (r.querySelectorAll('td')[i]?.textContent ?? '').trim())
      .filter(Boolean);
    expect(cells.length, 'no rows to read').toBeGreaterThan(0);
    expect(cells.some((c) => c && c !== 'Not recorded')).toBe(true);
  });

  /* THE RULE THE PAGE ALREADY USES FOR AGENCY AND BRANCH. */
  it('and is gone for a Negotiator, whose every row would say their own name', async () => {
    const v = await listAs('referrer');
    expect(headings(v)).not.toContain('Referred by');
  });

  /* AND THE HEADER AND THE BODY AGREE, which a colSpan quietly left behind
     would break: the tenancy heading row spans the table and runs short. */
  it('and the header count matches every row', async () => {
    const v = await listAs('management');
    const cols = headings(v).length;
    for (const row of [...v.container.querySelectorAll('tbody tr')]) {
      const tds = [...row.querySelectorAll('td')];
      const span = tds.reduce((n, td) => n + (Number(td.getAttribute('colspan')) || 1), 0);
      expect(span, `row has ${span} cells against ${cols} headings`).toBe(cols);
    }
  });
});
