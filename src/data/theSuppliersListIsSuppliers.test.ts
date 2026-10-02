/* THE SUPPLIERS LIST IS SUPPLIERS, AND SAYS THE DEAL THAT IS IN FORCE.
 *
 * Matt, 2026-10-02:
 *   1. "Harbour Lets shows as a supplier, but it's an agency
 *      (Opndoor-referenced). Only real suppliers appear here; agencies
 *      appear under Agencies. Check every partner is listed in the
 *      right place."
 *   2. "Under each supplier's name, replace 'Total 25.0%, agents' share
 *      10.0%' with the plain one-line summary of its current deal from
 *      its Commission tab, e.g. '25% of the fee, agencies 10%' or
 *      'Tiered deal', so it never shows a rate that isn't in force."
 *
 * THE SAME THREE-WAY SPLIT, AGAIN. `partners` holds three kinds and the
 * page asked a two-way question: every row is a supplier. Harbour Lets
 * is the third kind -- one of our agencies that carries its own partner
 * record -- and `partyIsSupplier` has known the difference since the
 * estates work.
 *
 * WHERE HARBOUR LETS GOES INSTEAD IS NOWHERE NEW, which is the half
 * worth checking before calling item 1 done. The AGENCY "Harbour Lets"
 * is already on the Agencies screen, because that screen lists agency
 * ROWS and admin's filter keeps the agency-rail estates. Removing the
 * partner from Suppliers puts the company in one place rather than two.
 *
 * AND THE RATE. The old line read `partner_rate` and `agent_rate`, the
 * STANDARD columns, so a supplier on a negotiated agreement was
 * described with percentages that appear in no agreement and match no
 * statement line. "Never shows a rate that isn't in force" is the whole
 * instruction, and the three-way answer below is what it needs: the
 * columns only when nothing else is in force.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { hydratePartners } from './partnersService';
import { partyIsSupplier } from './capabilities';
import { supplierDealLine } from './supplierDealLine';
import type { AgreementView, Partner } from './types';

/* DEV'S OWN PARTNER LIST, which is what Matt was looking at. Three
   kinds, so the filter has something of each to get right. */
const PARTNERS = [
  { id: 'letly', name: 'Letly', referencingMode: 'pre_referenced_screened' },
  { id: 'opndoor-direct', name: 'Opndoor Direct', referencingMode: 'opndoor_referenced' },
  { id: 'referencing-partner', name: 'Referencing Partner', referencingMode: 'pre_referenced_open' },
  { id: 'harbour-lets', name: 'Harbour Lets', referencingMode: 'opndoor_referenced' },
  { id: 'kestrel-lettings', name: 'Kestrel Lettings', referencingMode: 'pre_referenced_open' },
  { id: 'opndoor-agents', name: 'Opndoor Agents', referencingMode: 'opndoor_referenced' },
  { id: 'test-supplier', name: 'Test Supplier', referencingMode: 'pre_referenced_screened' },
].map((p) => ({ ...p, status: 'active', since: '2026-01-01', weight: 1, users: 0, apps: 0,
  partnerRate: 0.25, agentRate: 0.1, primary: false })) as unknown as Partner[];

describe('every partner is listed in the right place', () => {
  it('so the Suppliers list holds the three real suppliers and nothing else', () => {
    hydratePartners(PARTNERS);
    expect(PARTNERS.filter((p) => partyIsSupplier(p.id)).map((p) => p.name))
      .toEqual(['Letly', 'Kestrel Lettings', 'Test Supplier']);
  });

  it('and Harbour Lets is not one of them, because it is one of ours', () => {
    hydratePartners(PARTNERS);
    expect(partyIsSupplier('harbour-lets')).toBe(false);
  });

  /* THE HOUSE RAILS WERE NEVER SUPPLIERS EITHER, and were on this list
     too: `opndoor-agents` is the plumbing every agency hangs off and
     `opndoor-direct` is a rail, not a company. Naming internal
     machinery on a customer-facing screen is what channel.ts exists to
     stop. */
  it('and neither are the house rails, which were also on it', () => {
    hydratePartners(PARTNERS);
    for (const slug of ['opndoor-agents', 'opndoor-direct', 'referencing-partner']) {
      expect(partyIsSupplier(slug), slug).toBe(false);
    }
  });

  it('and the page asks that question rather than listing everything', () => {
    expect(readFileSync('src/pages/PartnerManagement/PartnerManagement.tsx', 'utf8'))
      .toContain('getPartners().filter((p) => partyIsSupplier(p.id))');
  });
});

/* --------------------------------------------------------------------- */

const deal = (over: Partial<AgreementView>): AgreementView => ({
  agreementId: 'a1', scopeLevel: 'partner', coverage: 'additive', period: 'year',
  countingScope: 'partner', isStandard: false, note: null, periodStart: null,
  volume: 0, volumes: [], bands: [], tiers: [], nextRate: null, nextBasis: null,
  ...over,
} as AgreementView);

describe('the line under the name is the deal in force', () => {
  it('the standard columns, when nothing else is', () => {
    expect(supplierDealLine({
      commission: null, agentShare: null, standardTotal: 0.25, standardShare: 0.1,
    })).toBe('25% of the fee, agencies 10%');
  });

  /* MATT'S FIRST EXAMPLE, WORD FOR WORD. */
  it('and a flat negotiated deal in the same shape', () => {
    expect(supplierDealLine({
      commission: deal({ tiers: [{ from: 0, to: null, rate: 0.3 }] }),
      agentShare: deal({ tiers: [{ from: 0, to: null, rate: 0.12 }] }),
      standardTotal: 0.25, standardShare: 0.1,
    })).toBe('30% of the fee, agencies 12%');
  });

  /* AND THE ONE THAT MATTERS: the standard columns are NOT printed when
     a negotiated deal is in force. Against the old line this read
     "Total 25.0%, agents' share 10.0%" for a supplier on 30%. */
  it('and never the standard rate once a deal is in force', () => {
    const line = supplierDealLine({
      commission: deal({ tiers: [{ from: 0, to: null, rate: 0.3 }] }),
      agentShare: null, standardTotal: 0.25, standardShare: null,
    });
    expect(line).toBe('30% of the fee');
    expect(line).not.toContain('25');
  });

  /* MATT'S SECOND EXAMPLE. A deal with more than one tier has no single
     rate, and taking the first band -- which is what a "headline rate"
     would do -- is the same fault in the other direction. */
  it('"Tiered deal" when there is no one rate to show', () => {
    expect(supplierDealLine({
      commission: deal({ tiers: [{ from: 0, to: 5, rate: 0.2 }, { from: 5, to: null, rate: 0.3 }] }),
      agentShare: null, standardTotal: 0.25, standardShare: null,
    })).toBe('Tiered deal');
  });

  it('and it still names the agencies’ share beside it, where that is flat', () => {
    expect(supplierDealLine({
      commission: deal({ tiers: [{ from: 0, to: 5, rate: 0.2 }, { from: 5, to: null, rate: 0.3 }] }),
      agentShare: deal({ tiers: [{ from: 0, to: null, rate: 0.1 }] }),
      standardTotal: 0.25, standardShare: null,
    })).toBe('Tiered deal, agencies 10%');
  });

  /* A FEE BAND IS NOT A COMMISSION TIER. A deal can price the FEE in
     weeks of rent by band and still charge one commission rate; calling
     that "Tiered deal" would hide a rate that is perfectly sayable. */
  it('and a deal that bands the fee but not the rate is still flat', () => {
    expect(supplierDealLine({
      commission: deal({
        bands: [{ min: 1, max: 1, weeks: 4, rate: null }, { min: 2, max: null, weeks: 5, rate: null }],
        tiers: [{ from: 0, to: null, rate: 0.25 }],
      }),
      agentShare: null, standardTotal: 0.25, standardShare: null,
    })).toBe('25% of the fee');
  });

  it('and says so plainly when there is no rate at all', () => {
    expect(supplierDealLine({
      commission: null, agentShare: null, standardTotal: null, standardShare: null,
    })).toBe('No rate set');
  });
});
