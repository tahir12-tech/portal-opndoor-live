/* WHAT THE READER SEES WHEN THE REFERENCE COULD NOT BE READ.
 *
 * Matt, 2026-10-04, verbatim: "When a statement's reference can't be read,
 * don't label it a draft. Show 'Reference couldn't be loaded. Refresh to try
 * again.' in place of the reference and status, and log it to Health."
 *
 * "IN PLACE OF THE REFERENCE AND STATUS" IS TWO THINGS, which is why this is
 * a render test and not another unit test of draftLabel. The panel used to
 * print the reference slot and a draft label beside it; both had to go, and
 * a test that only checks the sentence appears would pass with the draft
 * still sitting next to it saying the opposite.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { CommissionStatement } from './CommissionStatement';
import { ALL_PARTNERS, REFERENCE_UNREADABLE, DRAFT_NOT_POSTED, DRAFT_IN_PROGRESS } from '@/data';

const MONTH = { key: '2026-05', label: 'May 2026' };

const STATEMENT = {
  monthKey: MONTH.key, monthLabel: MONTH.label, payeeKey: 'regent',
  level: 'agency' as const, orgId: 'org-regent', payeeName: "Regent's Lettings",
  lines: [{
    ref: 'GR-1', tenant: 'A Tenant', branch: 'Hampstead', tenancyPlace: null,
    sharePercent: null, paidAt: new Date('2026-05-12T00:00:00Z'),
    fee: 1500, rate: 0.2, source: 'agreement' as const, commission: 300,
  }],
  total: 300,
};

/** What statementReference answers this render. Swapped per test. */
const answer = vi.hoisted(() => ({ ref: '' }));

vi.mock('@/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/data')>();
  return {
    ...actual,
    statementMonths: () => [MONTH],
    getCommissionStatements: () => [STATEMENT],
    statementReference: async () => answer.ref,
    buildCommissionStatementDoc: async () => ({ blocks: [] }),
    exportBranded: async () => {},
  };
});

const view = () => render(<CommissionStatement role="superadmin" scope={ALL_PARTNERS} orgId="org-regent" />);
const body = () => document.body.textContent ?? '';

afterEach(() => { cleanup(); });

describe('a reference that could not be read', () => {
  it('says so, in Matt’s words', async () => {
    answer.ref = REFERENCE_UNREADABLE;
    view();
    await waitFor(() => expect(body()).toContain("Reference couldn't be loaded. Refresh to try again."));
  });

  /* THE INSTRUCTION'S OTHER HALF, and the one a careless fix would miss. */
  it('and is not labelled a draft', async () => {
    answer.ref = REFERENCE_UNREADABLE;
    view();
    await waitFor(() => expect(body()).toContain('Reference'));
    expect(body()).not.toContain(DRAFT_NOT_POSTED);
    expect(body()).not.toContain(DRAFT_IN_PROGRESS);
    expect(body()).not.toMatch(/Draft:/);
  });

  /* THE CONTRAST. A month that genuinely has no reference yet MUST still say
     draft, or this change has simply deleted a true label along with a false
     one. Without this the test above passes on a panel that never labels
     anything. */
  it('while a month with no reference yet still is', async () => {
    answer.ref = '-';
    view();
    await waitFor(() => expect(body()).toMatch(/Draft:/));
  });

  /* AND A REAL REFERENCE IS STILL A REFERENCE. */
  it('and a posted statement still shows its number', async () => {
    answer.ref = 'STMT-2026-05-0001';
    view();
    await waitFor(() => expect(body()).toContain('STMT-2026-05-0001'));
    expect(body()).not.toMatch(/Draft:/);
    expect(body()).not.toContain("Reference couldn't be loaded");
  });
});
