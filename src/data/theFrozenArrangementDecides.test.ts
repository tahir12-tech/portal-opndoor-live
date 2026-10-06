/* WHO OPNDOOR PAYS IS DECIDED BY THE ARRANGEMENT FROZEN AT CREATION.
 *
 * Matt, 2026-10-03, settling the rule: "under that setting [opndoor pays the
 * agents] the supplier's commission and the agency's commission are separate
 * and the total is their sum: Kestrel £600 (25%) plus Frost via Kestrel £240
 * (10%) = £840 owed, not £600 with £240 carved out. ... If a referral is
 * frozen under 'the supplier pays its own agents', the agency's share comes
 * out of the supplier's total and Opndoor pays only the supplier."
 *
 * =====================================================================
 * WHAT WAS WRONG, AND IT WAS NOT THE STORED MONEY
 * =====================================================================
 *
 * `freeze_commission_lines` writes two independent rows -- agency at its own
 * rate, supplier at `partner_rate`, both on the same basis, neither reduced by
 * the other. That is correct and it is what the Commission tab's worked
 * example describes. But it writes exactly those two rows under BOTH
 * arrangements, and it never read `opndoor_pays_agents`. So "pay £840" and
 * "pay £600" were the same data, and three readers each guessed:
 *
 *   Reporting                   read no flag at all and always added. £840,
 *                               right by luck, wrong for a carved referral.
 *   supplier_statement_lines    read the partner's LIVE flag.
 *   commission_statement_lines  read the partner's LIVE flag.
 *
 * And that flag is mutable. On dev it moved twice under Kestrel -- to "opndoor
 * pays the agents" on 1 Oct 15:52:55 and back on 2 Oct 09:33:06 -- with
 * GR-FROST-KES created between them at 2 Oct 00:07:24. So its statement and
 * its settlement were being read under an arrangement it was never sold under,
 * and would have changed shape again at the next flip.
 *
 * `applications.opndoor_pays_agents_at_freeze` (20261007610000) is the
 * snapshot, beside the rates that were already snapshotted for exactly this
 * reason. NO FROZEN AMOUNT CHANGED.
 *
 * THIS FILE IS THE CLIENT HALF. The SQL half is
 * supabase/tests/the_frozen_arrangement_decides.test.sql, which asserts the
 * same two cases against `supplier_statement_lines` and
 * `commission_statement_payees`. Both halves are needed because the two used
 * to disagree, and a test on either alone is what let them.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hydratePartners } from './partnersService';
import { payeesFor, supplierAmountOf, agentRailApp, feeBaseFor } from './commissionSplit';
import type { FullApp } from './applicationsService';
import type { Partner } from './types';

const PARTNERS = [
  { id: 'opndoor-agents', name: 'Opndoor Agents', kind: 'agency', isHouse: true,
    opndoorPaysAgents: false },
  /* THE LIVE FLAG SAYS "the supplier pays its own agents", which is where dev
     stands today. Every assertion below about a referral frozen the other way
     therefore fails if the code reads this instead of the snapshot -- which is
     precisely the defect, so the fixture is built to catch it. */
  { id: 'kestrel-lettings', name: 'Kestrel Lettings', kind: 'supplier',
    opndoorPaysAgents: false },
].map((p) => ({ ...p, status: 'active', since: '2026-01-01', weight: 1, users: 0, apps: 0,
  partnerRate: 0.25, agentRate: 0.1, primary: false })) as unknown as Partner[];

/** GR-FROST-KES as dev holds it: basis £2,400, agency line £240, supplier £600. */
const app = (over: Partial<FullApp> = {}): FullApp => ({
  ref: 'GR-FROST-KES', partner: 'kestrel-lettings', agency: 'Frost Partnership',
  branch: 'Frost Mayfair', referrer: 'R', owner: 0,
  rent: 2400, fee: 2400, agentRate: 0.1, partnerRate: 0.25,
  status: 'paid', paidAt: new Date(2026, 8, 27),
  refunded: false, partiallyRefunded: false, withdrawn: false,
  commissionLines: [
    { level: 'agency', orgId: 'ag-frost-kes', orgName: 'Frost Partnership', rate: 0.1, amount: 240 },
    { level: 'supplier', orgId: 'kes', orgName: 'Kestrel Lettings', rate: 0.25, amount: 600 },
  ],
  ...over,
} as unknown as FullApp);

beforeEach(() => { hydratePartners(PARTNERS); });
afterEach(() => { hydratePartners([]); });

/** What Opndoor owes in total on one referral: the supplier plus every payee. */
const owed = (a: FullApp) =>
  supplierAmountOf(a) + payeesFor(a, feeBaseFor(a)).reduce((s, p) => s + p.amount, 0);

describe('frozen under “opndoor pays the agents”', () => {
  const siblings = () => app({ opndoorPaysAgentsAtFreeze: true });

  it('the agency is a payee of Opndoor, at the frozen amount', () => {
    const ps = payeesFor(siblings(), 2400);
    expect(ps.map((p) => [p.orgName, p.amount])).toEqual([['Frost Partnership', 240]]);
  });

  it('and the supplier is owed its whole 25%, not 25% less the agency', () => {
    expect(supplierAmountOf(siblings())).toBe(600);
  });

  /* THE FIGURE MATT NAMED, and the one the SQL half now agrees with. */
  it('so Opndoor owes £840 in total, which is the sum', () => {
    expect(owed(siblings())).toBe(840);
  });

  /* THE DEFECT, STATED AS A TEST. The partner's live flag says the opposite,
     so this passing is the whole proof that the snapshot is what is read. */
  it('whatever the partner’s live flag says today', () => {
    expect(PARTNERS.find((p) => p.id === 'kestrel-lettings')!.opndoorPaysAgents).toBe(false);
    expect(owed(siblings())).toBe(840);
  });
});

describe('frozen under “the supplier pays its own agents”', () => {
  const carved = () => app({ opndoorPaysAgentsAtFreeze: false });

  /* "Opndoor pays only the supplier." The agency line still EXISTS and is
     still right -- it is the supplier's record of what it owes Frost, and the
     per-agency schedules are built from it -- but it is not a thing Opndoor
     pays, so it is not a payee. */
  it('Opndoor lists no payment to the agency', () => {
    expect(payeesFor(carved(), 2400)).toEqual([]);
  });

  it('and pays the supplier its whole 25%', () => {
    expect(supplierAmountOf(carved())).toBe(600);
  });

  it('so Opndoor owes £600 in total', () => {
    expect(owed(carved())).toBe(600);
  });
});

describe('a row with no snapshot', () => {
  /* EVERY ROW FROZEN BEFORE THE COLUMN EXISTED. The live flag is the same
     answer the product gave the day before, so nothing regresses; what
     changes is only that rows WITH a snapshot stop asking it. */
  it('falls back to the partner’s live flag, which is today’s behaviour', () => {
    const noSnap = app({ opndoorPaysAgentsAtFreeze: null });
    // The fixture's live flag is "the supplier pays its own agents".
    expect(payeesFor(noSnap, 2400)).toEqual([]);
    expect(owed(noSnap)).toBe(600);
  });

  it('and the other way when the live flag says Opndoor pays the agents', () => {
    hydratePartners(PARTNERS.map((p) => (
      p.id === 'kestrel-lettings' ? { ...p, opndoorPaysAgents: true } : p)) as Partner[]);
    const noSnap = app({ opndoorPaysAgentsAtFreeze: null });
    expect(payeesFor(noSnap, 2400).map((p) => p.amount)).toEqual([240]);
    expect(owed(noSnap)).toBe(840);
  });
});

describe('off a supplier estate there is nothing to decide', () => {
  /* OUR OWN AGENCIES. There is no supplier to carve anything out of, so the
     agency is always Opndoor's to pay and the snapshot is null there. A gate
     that asked the flag without asking the estate first would have stopped
     paying our own agencies the moment somebody set a supplier to carved. */
  const ours = () => app({
    partner: 'opndoor-agents', agency: "Regent's Lettings",
    opndoorPaysAgentsAtFreeze: null,
    commissionLines: [
      { level: 'agency', orgId: 'ag-regent', orgName: "Regent's Lettings", rate: 0.1, amount: 240 },
    ],
  } as Partial<FullApp>);

  it('the agency is paid by Opndoor, as it always was', () => {
    expect(payeesFor(ours(), 2400).map((p) => p.amount)).toEqual([240]);
  });

  /* AND THERE IS NO SUPPLIER SHARE ON OUR OWN RAIL, which is the house-cut
     rule `ourMarginIsNotTheirs` exists for and must not move. */
  it('and there is no supplier share at all', () => {
    expect(agentRailApp(ours())).toBe(true);
    expect(supplierAmountOf(ours())).toBe(0);
  });
});
