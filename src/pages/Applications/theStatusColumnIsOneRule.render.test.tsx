/* =====================================================================
   (bq) THE SAME STATUS RULE ON THE SCREEN, DRAWN.

   Matt: "1) every fully refunded application's Status is 'Refunded'
   ... 4) an application whose deed was voided for a correction and
   awaits re-signing shows 'Awaiting signature', not 'Paid'. Same rules
   in every export and on screen."

   THE EXPORT HALF IS TESTED AGAINST THE BUILDER
   (theExportStatusIsOneRule.test.ts). This is the other half of his
   last sentence: the Applications list, rendered, with his own four
   references in it. One function answers both, and a test of the
   function alone would not have told anybody whether the list calls
   it.

   THE LIST ROW CARRIES `awaitingSignature`, where a full application
   carries `deedState`. Both shapes reach the same rule, which is why
   it takes either -- and this file is the one that proves the list's
   shape is the one it takes.
   ===================================================================== */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionProvider } from '@/session/SessionContext';
import { ToastProvider } from '@/components/ui/Toast';
import { PageMetaProvider } from '@/components/layout/pageMeta';
import { Applications } from './Applications';
import { hydrateApplications } from '@/data';
import type { ApplicationSummary } from '@/data';
import { KEYS } from '@/data/storage';

function row(o: Partial<ApplicationSummary> & { ref: string; tenant: string }): ApplicationSummary {
  return {
    prop: '14 Thistle Row, SW6 2QT', branch: 'Chelsea', agency: 'Foxglove Residential',
    ben: '', rent: 2400, status: 'deed', date: '2026-05-12', owner: 1,
    partner: 'northwind', referrer: 'Priya Nair',
    ...o,
  } as ApplicationSummary;
}

/* HIS FOUR ROWS, in the states dev holds them in. */
function seed(): void {
  hydrateApplications([
    // refunded, deed voided -- read "Paid", because the refund was not consulted
    row({ ref: 'GR-23854', tenant: 'Ada Lovelace', status: 'paid', refunded: true }),
    // refunded, deed cancelled -- the deed state beat the refund
    row({ ref: 'GR-23853', tenant: 'Grace Hopper', status: 'deed', refunded: true }),
    // deed out and unsigned after a correction -- read "Paid"
    row({ ref: 'GR-26262', tenant: 'Alan Turing', status: 'paid', awaitingSignature: true }),
    // executed, and always right
    row({ ref: 'GR-26263', tenant: 'Edith Clarke', status: 'deed' }),
  ], []);
}

afterEach(() => {
  cleanup();
  localStorage.removeItem(KEYS.scopeSel);
  localStorage.removeItem(KEYS.scopeRecents);
});

async function openList() {
  localStorage.setItem('grp_role', 'superadmin');
  seed();
  const view = render(
    <MemoryRouter initialEntries={['/applications']}>
      <SessionProvider><ToastProvider><PageMetaProvider><Applications /></PageMetaProvider></ToastProvider></SessionProvider>
    </MemoryRouter>,
  );
  await waitFor(() => { if (!document.querySelector('table.dt tbody tr')) throw new Error('list not ready'); });
  return view;
}

/** The status cell of the row for this reference. */
function statusOf(container: HTMLElement, ref: string): string {
  const tr = [...container.querySelectorAll<HTMLTableRowElement>('table.dt tbody tr')]
    .find((r) => (r.textContent ?? '').includes(ref));
  if (!tr) throw new Error(`no row for ${ref}`);
  const pill = tr.querySelector('.pill, [class*="pill"]');
  return ((pill ?? tr).textContent ?? '').trim();
}

describe('the Applications list says what the export says', () => {
  it.each([
    ['GR-23854', 'Refunded'],
    ['GR-23853', 'Refunded'],
    ['GR-26262', 'Awaiting signature'],
    ['GR-26263', 'Deed Issued'],
  ])('%s reads "%s"', async (ref, expected) => {
    const { container } = await openList();
    expect(statusOf(container, ref)).toContain(expected);
  });

  /* THE ROW THAT CONTRADICTED ITSELF. "Deed Issued" on a guarantee that
     has ended is the half Matt saw first, and it must not come back
     under any of the four. */
  it('and never says Deed Issued on a refunded one', async () => {
    const { container } = await openList();
    expect(statusOf(container, 'GR-23853')).not.toContain('Deed Issued');
    expect(statusOf(container, 'GR-23854')).not.toContain('Deed Issued');
  });
});
