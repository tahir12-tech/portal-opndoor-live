/* A SUPPLIER'S REPORTING SAYS WHAT OPNDOOR OWES THEM, NOT THE TOTAL.
 *
 * Matt (q): 'replace the single "Commission payable" figure with "Owed to
 * you": what Opndoor pays the supplier; the agencies' commission, always
 * shown, worded by who pays it (per referral, using the setting frozen on
 * it) ... and "Total commission on your referrals". For GR-FROST-KES that's:
 * Owed to you £600; Paid by Opndoor directly to your agencies £240; Total
 * £840.'
 *
 * THE HEADLINE WAS THE SUM OF TWO DIFFERENT PEOPLE'S MONEY. For a supplier
 * it read `agentCommNet + supplierCommNet` -- their own cut plus what
 * opndoor pays their agencies directly -- under the words "Commission
 * payable". £840 of which £240 is never theirs.
 *
 * THE SETTING IS FROZEN PER REFERRAL, which is why the agencies' half can be
 * two lines rather than one worded by the partner's current flag. Kestrel on
 * dev holds both kinds right now: GR-FROST-KES is frozen true (opndoor pays
 * the agents) and GR-26262/3 are frozen false (the supplier passes it on).
 * An arrangement changed mid-month leaves exactly that.
 */
import { describe, it, expect } from 'vitest';
import { liveAggregate } from './liveAnalytics';
import { hydrateFull, type FullApp } from './applicationsService';
import { getPeriods, ALL_PARTNERS } from '@/data';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const agg = (scope: string) =>
  liveAggregate('management', scope, getPeriods().find((p) => p.id === 'alltime')!);

/* THE SHAPE THE REPO'S OTHER LIVE TESTS USE. `agentAmountOf` goes through
   `payeesFor`, which resolves a real agency ladder -- an invented agency
   name yields no payees and a silent zero, which is how my first version of
   this file asserted nothing while passing two of six. */
const paid = (over: Partial<FullApp>): FullApp => ({
  partner: 'opndoor-agents', agency: "Regent's Lettings", branch: "Regent's Park",
  rent: 1000, fee: 1000, agentRate: 0.25, partnerRate: 0.25,
  status: 'deed', tenancyStart: new Date('2026-06-01'), deedAt: new Date('2026-06-01'),
  expiry: null, sentAt: new Date('2026-06-01'), paidAt: new Date('2026-06-05'),
  refunded: false, partiallyRefunded: false, deedState: 'executed',
  referrer: 'A Referrer', livemode: true,
  ...over,
} as unknown as FullApp);

describe('the agencies\' commission is split by who pays it', () => {
  it('and reads the FROZEN flag, not the partner\'s current one', () => {
    hydrateFull([
      paid({ ref: 'GR-SIB', opndoorPaysAgentsAtFreeze: true }),
      paid({ ref: 'GR-CARVED', opndoorPaysAgentsAtFreeze: false }),
    ] as never[]);
    const a = agg(ALL_PARTNERS);
    // 25% of a GBP 1,000 fee, one referral on each side of the frozen flag.
    expect(a.agentCommOpndoorPays).toBeCloseTo(250, 2);
    expect(a.agentCommSupplierPasses).toBeCloseTo(250, 2);
    // And the two halves still account for the whole.
    expect(a.agentCommOpndoorPays + a.agentCommSupplierPasses).toBeCloseTo(a.agentCommNet, 2);
    hydrateFull([]);
  });

  /* A PERIOD WITH BOTH KINDS SHOWS BOTH LINES, which is Matt's own case and
     the reason this is two accumulators rather than one and a flag. */
  it('so a period holding both arrangements has money on both lines', () => {
    hydrateFull([
      paid({ ref: 'GR-SIB', opndoorPaysAgentsAtFreeze: true }),
      paid({ ref: 'GR-CARVED', opndoorPaysAgentsAtFreeze: false }),
    ] as never[]);
    const a = agg(ALL_PARTNERS);
    expect(a.agentCommOpndoorPays).toBeGreaterThan(0);
    expect(a.agentCommSupplierPasses).toBeGreaterThan(0);
    hydrateFull([]);
  });

  /* AN UNFROZEN ROW FALLS TO "the supplier passes it on", because that is
     the arrangement that predates the flag. Guessing the other way would
     tell a supplier opndoor had paid an agency directly when nobody had. */
  it('and an unfrozen referral counts as one the supplier passes on', () => {
    hydrateFull([paid({ ref: 'GR-OLD', opndoorPaysAgentsAtFreeze: null })] as never[]);
    const a = agg(ALL_PARTNERS);
    expect(a.agentCommOpndoorPays).toBe(0);
    expect(a.agentCommSupplierPasses).toBeCloseTo(250, 2);
    hydrateFull([]);
  });
});

/* THE TILE'S OWN WORDING, read from the live path's source.
 *
 * `getDashboardData` cannot be used here: SUPABASE_ENABLED is forced false
 * under test, so it takes the SYNTHETIC path -- which is why my first
 * attempt asserted "250" against the mock book's £438,725 and failed for a
 * reason that had nothing to do with the change. The live branch is the one
 * (q) is about, and these are its four lines.
 */
describe('the supplier tile\'s live wording', () => {
  const SRC = readFileSync(resolve(process.cwd(), 'src/data/analyticsService.ts'), 'utf8');
  const live = SRC.slice(SRC.indexOf('const comm: CommissionPart'), SRC.indexOf('  return {', SRC.indexOf('const comm: CommissionPart')));

  it('headlines the supplier\'s OWN cut, not the sum', () => {
    expect(live).toContain('commHeadline: supplierFacing ? fmtMoney(a.supplierCommNet)');
  });

  it('words the agencies\' line by who pays it, both ways', () => {
    expect(live).toContain("'Paid by opndoor directly to your agencies'");
    expect(live).toContain("'Your agencies\\u2019 share, included above for you to pass on'");
  });

  /* EACH LINE ONLY WHEN IT HAS MONEY IN IT, so the ordinary month with one
     arrangement still reads as one line rather than one line and a zero. */
  it('and shows each only when that arrangement has money in it', () => {
    expect(live).toContain('a.agentCommOpndoorPays > 0');
    expect(live).toContain('a.agentCommSupplierPasses > 0');
  });

  it('with the total named as a total', () => {
    expect(live).toContain("commFourthLbl: 'Total commission on your referrals'");
    expect(live).toContain('fmtMoney(a.supplierCommNet + a.agentCommNet)');
    expect(live).toContain('commFourthShown: supplierFacing');
  });

  /* AN OPNDOOR READER IS UNCHANGED, which is the half that must not move:
     the payable split is the shape of OUR book. */
  it('while opndoor\'s own tile keeps the payable split', () => {
    expect(live).toContain("commThirdLbl: supplierFacing");
    expect(live).toContain("'Suppliers'");
  });
});
