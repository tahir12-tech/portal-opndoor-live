/* =====================================================================
   (cp), THE SECOND HALF: THE SENTENCE WENT INTO THE FILENAME.

   Matt, 2026-10-05: "(cp) draft-month 'Reference couldn't be loaded'
   and the export filename."

   buildCommissionStatementDoc named the file after the reference, and
   tested for the empty glyph to decide whether there was one:

       const stamp = ref === EMPTY ? `${monthKey}-${payee}` : ref;

   That was right when the only two answers were a reference and a
   dash. Two of the four answers are now SENTENCES -- "Reference
   assigned when the statement is posted" for a month nothing has been
   posted for, and "Reference couldn't be loaded. Refresh to try
   again." for a failed read -- and both fell through to `ref`. A draft
   month downloaded as

       opndoor-statement-Reference assigned when the statement is posted.xlsx

   and a failed read put an apostrophe and two full stops in it.

   THE OTHER TWO STATEMENT EXPORTS ALREADY ASKED isPostedReference.
   This one is older and nobody came back to it when the sentences
   arrived, which is the same shape as the stale allowlists and the
   renamed RPC argument: a new state added centrally, and one caller
   left reasoning about the old set.
   ===================================================================== */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/* THE REFERENCE COMES FROM THE SERVER, so the back end is mocked rather
   than the function that reads it: the point is what the whole path
   produces for each answer the RPC can give. */
let answer: { data: unknown; error: unknown } = { data: null, error: null };
vi.mock('@/lib/supabase', () => ({
  SUPABASE_ENABLED: true,
  supabase: null,
  sb: () => ({ rpc: () => Promise.resolve(answer) }),
}));

import { ALL_PARTNERS } from '@/data/types';
import { buildCommissionStatementDoc } from '@/data/exportsService';
import { getCommissionStatements } from '@/data/liveAnalytics';
import { hydrateFull, type FullApp } from '@/data/applicationsService';

const D = (s: string) => new Date(`${s}T12:00:00Z`);
const LINE = [{ level: 'agency', orgId: 'ag-r', orgName: "Regent's Lettings", rate: 0.25, amount: 415.39, source: 'rate' }];

function app(): FullApp {
  return {
    ref: 'GR-F1', status: 'deed', partner: 'northwind', partnerRate: 0.25, agentRate: 0.25,
    agency: "Regent's Lettings", agencyId: 'ag-r', branch: "Regent's Park", branchId: 'br-rp',
    referrer: 'Rosa', owner: 0,
    rent: 2400, fee: 1661.54, feeBasisWeeks: 3, commissionLines: LINE,
    sentAt: D('2026-03-02'), paidAt: D('2026-03-05'), deedAt: D('2026-03-08'),
    tenancyStart: D('2026-04-01'), expiry: D('2027-03-31'),
    refunded: false, refundedAt: null, refundedAmount: null, refundAfterStart: false,
    deedState: null, deedSentAt: null, deedViewedAt: null,
    withdrawn: false, withdrawnReason: null, withdrawnNote: null, expired: false,
  } as unknown as FullApp;
}

async function filename(): Promise<string> {
  /* AS AN ADMIN OVER EVERY PARTNER, because this mock reports the back end
     as present and scopeFull then narrows an agency reader to the agencies
     the (empty) hydrated book says they reach. The filename rule is the same
     for every reader; the scope is only how the statement is found. */
  const st = getCommissionStatements('superadmin', ALL_PARTNERS, '2026-03')[0];
  expect(st, 'the book has a March statement').toBeTruthy();
  const built = await buildCommissionStatementDoc('superadmin', ALL_PARTNERS, st.monthKey, st.payeeKey);
  return built.filename;
}

beforeEach(() => { hydrateFull([app()]); answer = { data: null, error: null }; });
afterAll(() => hydrateFull([]));

describe('the statement export filename', () => {
  /* THE RULE, AS ONE ASSERTION. Whatever the server answers, the name is
     a name: no spaces, no apostrophes, no full stops before the
     extension. This is the shape of the bug rather than one instance of
     it, so a fifth answer added later is caught too. */
  it.each([
    ['a draft month, nothing posted', { data: null, error: null }],
    ['a read that failed', { data: null, error: { code: 'PGRST301' } }],
    ['a posted month', { data: 'STMT-2026-03-0004', error: null }],
  ])('is a filename and not a sentence: %s', async (_case, a) => {
    answer = a;
    const name = await filename();
    expect(name).toMatch(/^opndoor-statement-[A-Za-z0-9-]+\.xlsx$/);
    expect(name).not.toMatch(/\s/);
    expect(name).not.toMatch(/['’]/);
  });

  it('is named after the reference once there is one', async () => {
    answer = { data: 'STMT-2026-03-0004', error: null };
    expect(await filename()).toBe('opndoor-statement-STMT-2026-03-0004.xlsx');
  });

  /* AND THE FALLBACK STILL IDENTIFIES THE FILE. Naming every unposted
     month after the month alone would give two payees in one month the
     same download, so the payee stays in it. */
  it('and after the month and the payee until then', async () => {
    answer = { data: null, error: null };
    expect(await filename()).toBe('opndoor-statement-2026-03-regent-s-lettings.xlsx');
  });
});
