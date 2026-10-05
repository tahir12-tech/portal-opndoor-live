/* =====================================================================
   THE AGENT COLUMN RECONCILES TO THE SUMMARY.

   Matt (bp): "Agency/branch breakdowns double-count commission on
   referrals where the supplier passes on the agencies' share (e.g.
   Test Lettings asda: Supplier GBP 947.25 and Agent GBP 378.90, but
   the GBP 378.90 is inside the GBP 947.25). The breakdown's agent
   column must reconcile to the summary (GBP 4,208.66); show a
   carved-out share as 'Included in supplier commission: GBP 378.90' or
   similar, never as a second payable amount. Make the referrer
   breakdown consistent with the agency one."

   And in the order he set: "one shared rule for 'supplier passes it on
   vs Opndoor pays the agency directly', used by all six surfaces".

   =====================================================================
   WHY THE ASSERTION IS ARITHMETIC AND NOT WORDING
   =====================================================================

   "Must reconcile to the summary" is a checkable property, and Matt
   gave the figure. Wording can be got right while the sum is still
   wrong, and the sum is what pays people. So the rule under test is:

       supplier + agent-paid-directly  ==  total commission
       and the carved share is reported, separately, never added

   ONE FOLD, ASSERTED AT THE FOLD. The six surfaces now read
   whoPaysTheAgency; testing each surface's rendering would be six
   tests of one function plus five of React. The split itself is tested
   here exhaustively, and each surface is asserted to USE it -- which
   is the pair that cannot drift.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  addAgencyShare, agencyPayer, splitAgencyShare, totalCommissionOnReferrals,
  EMPTY_SPLIT, INCLUDED_IN_SUPPLIER_COMMISSION, includedInSupplierCommission,
} from './whoPaysTheAgency';

describe('which arrangement a referral was frozen on', () => {
  it('true means opndoor pays the agency directly', () => {
    expect(agencyPayer(true)).toBe('opndoor');
  });

  /* NULL IS THE CASE THAT MATTERS, because every referral created
     before the flag existed has one. It must read as CARVED: guessing
     the other way tells a supplier opndoor paid an agency directly
     when nobody did, and that is the direction that invents money. */
  it.each([[false], [null], [undefined]])('%s means the supplier passes it on', (v) => {
    expect(agencyPayer(v as boolean | null | undefined)).toBe('supplier');
  });
});

describe('the split', () => {
  /* MATT'S OWN FIGURES. GBP 947.25 is the supplier's, GBP 378.90 the
     agencies' share inside it. The breakdown used to print both as
     payable, which is GBP 1,326.15 of commission on a referral that
     pays GBP 947.25. */
  const CARVED = [
    { comm: 378.90, frozen: false },
  ];

  it('puts a passed-on share inside the supplier figure, not beside it', () => {
    const s = splitAgencyShare(CARVED, (r) => r.comm, (r) => r.frozen);
    expect(s.passedOnBySupplier).toBe(378.90);
    expect(s.paidDirectByOpndoor).toBe(0);
    // The sum that was wrong: the total is the supplier's figure alone.
    expect(totalCommissionOnReferrals(947.25, s)).toBe(947.25);
  });

  it('and adds a directly-paid share, because that really is extra', () => {
    const s = splitAgencyShare([{ comm: 378.90, frozen: true }], (r) => r.comm, (r) => r.frozen);
    expect(s.paidDirectByOpndoor).toBe(378.90);
    expect(totalCommissionOnReferrals(947.25, s)).toBeCloseTo(1326.15, 2);
  });

  /* A PERIOD CAN HOLD BOTH, which is the case a branch would get wrong
     and a split gets right: the flag is frozen per application, so an
     arrangement changed mid-month leaves referrals on either side. */
  it('reports both when a month holds both arrangements', () => {
    const s = splitAgencyShare(
      [{ comm: 100, frozen: true }, { comm: 50, frozen: false }, { comm: 25, frozen: null as boolean | null }],
      (r) => r.comm, (r) => r.frozen,
    );
    expect(s.paidDirectByOpndoor).toBe(100);
    expect(s.passedOnBySupplier).toBe(75);
    expect(totalCommissionOnReferrals(1000, s)).toBe(1100);
  });

  it('and a zero share moves nothing either way', () => {
    const s = { ...EMPTY_SPLIT };
    addAgencyShare(s, 0, true);
    expect(s).toEqual(EMPTY_SPLIT);
  });
});

describe('the breakdown column', () => {
  it('is named for what it is, not as a payable amount', () => {
    expect(INCLUDED_IN_SUPPLIER_COMMISSION).toBe('Included in supplier commission');
    expect(includedInSupplierCommission('£378.90')).toBe('Included in supplier commission: £378.90');
  });
});

describe('the surfaces read the one rule', () => {
  // From the repo root, as the other source-reading guards do: a URL
  // relative to import.meta.url resolves against vite's transformed
  // module id under vitest, not against this file on disk.
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  /* EACH NAMED, because "six surfaces" is Matt's count and a surface
     that quietly stops calling the rule is exactly the regression this
     whole exercise exists to prevent. */
  /* (dd)(1) THE FOLD IS FED WHAT THE AGENCY EARNED, NOT WHAT OPNDOOR
     PAYS. payeesFor returns nothing on a carved referral -- correct,
     because opndoor pays the supplier -- so agentAmountOf is zero
     there, and feeding that to the split meant the carved bucket
     could never fill. The line that describes carved referrals could
     therefore never draw on a carved month, which is exactly what
     Matt reported on Kestrel's October. */
  it('is fed the earned amount, so the carved bucket can actually fill', () => {
    const src = read('src/data/liveAnalytics.ts');
    expect(src.match(/addAgentSide\(a, app, agentEarnedOf\(app\)\)/g)?.length ?? 0).toBe(2);
    expect(src).not.toContain('addAgentSide(a, app, agentComm)');
  });

  it('liveAnalytics folds through addAgencyShare, in both places', () => {
    const src = read('src/data/liveAnalytics.ts');
    expect(src).toContain("import { addAgencyShare } from './whoPaysTheAgency'");
    // The tile's aggregate, and the league rows.
    expect(src.match(/addAgencyShare\(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('the Reporting tile takes its words from the rule', () => {
    const src = read('src/data/analyticsService.ts');
    expect(src).toContain("from './whoPaysTheAgency'");
    expect(src).toContain('PAID_DIRECT_BY_OPNDOOR');
    expect(src).toContain('PASSED_ON_BY_SUPPLIER');
    expect(src).toContain('OWED_TO_YOU');
  });

  /* THE BREAKDOWN'S AGENT CELL IS THE DIRECT SHARE ONLY. The fallback
     to agentComm is for rows that predate the split being carried;
     asserting the expression keeps the fallback from quietly becoming
     the normal path. */
  it('the League boards split it the same way', () => {
    const src = read('src/data/exportsService.ts');
    expect(src).toContain("moneyCol('Supplier commission'), moneyCol('Agent commission'), moneyCol(INCLUDED_IN_SUPPLIER_COMMISSION)");
    expect(src).toContain('money(r.partnerComm), money(r.agentPaidDirect ?? r.agentComm), money(r.agentPassedOn ?? 0)');
  });

  it('the exports split the agent column from the carved one', () => {
    const src = read('src/data/exportsService.ts');
    expect(src).toContain('const direct = e.agentPaidDirect ?? e.agentComm;');
    expect(src).toContain('const carved = e.agentPassedOn ?? 0;');
    expect(src).toContain('money(e.partnerComm), money(direct), money(carved)');
    expect(src).toContain('INCLUDED_IN_SUPPLIER_COMMISSION');
  });
});
