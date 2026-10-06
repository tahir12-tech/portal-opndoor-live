/* A SUPPLIER STAYS A SUPPLIER, WHATEVER ITS REFERENCING MODE.
 *
 * Matt, 2026-10-02: "Every partner gets a fixed 'supplier or agency' setting
 * of its own, decided when it's created ('Add supplier' makes a supplier; an
 * agency partner is an agency) and never inferred from referencing mode.
 * Referencing mode becomes independent: a supplier can use any referencing
 * mode and stays a supplier." And: "Prove it: on dev, switch Kestrel to
 * 'opndoor referenced' in a test and show it stays a supplier everywhere,
 * including the settlement, then switch it back."
 *
 * =====================================================================
 * WHAT THE SWITCH USED TO DO, MEASURED BEFORE THE FIX
 * =====================================================================
 *
 * `partyIsAgency` read `referencingMode === 'opndoor_referenced'`, and
 * `partyIsSupplier` was "not a house partner and not an agency". So one
 * dropdown on Supplier Settings moved a supplier across the product:
 *
 *   Suppliers list      it left, because the page filters on partyIsSupplier
 *   Agencies list       it arrived, as an estate of ours
 *   Commission by route it folded into "Agency referral"
 *   Agency labels       "(via Kestrel Lettings)" stopped being added, so the
 *                       two Frost Partnerships became one name twice
 *   Reconciliation      its agencies left the "no agency email" queue
 *   Reporting           it was served the agency layout, including Opndoor's
 *                       own payable split
 *   The settlement      getCommissionSettlement skipped it outright
 *
 * while SQL went on billing it: the payee row and the statement line are
 * guarded by is_house_partner_id and opndoor_pays_agents, not by the mode.
 * A screen that stops listing a supplier the database still bills is a
 * missed payment, and that is the defect this file pins.
 *
 * SEVEN OF THE TEN CASES BELOW FAIL AGAINST THE CODE BEFORE THIS CHANGE,
 * measured by putting the old predicate back. The other three are about
 * `partyIsOurEstate`, which this change introduced and which had nothing to
 * regress from. The fixture is deliberately the awkward one: a supplier whose
 * referencing mode is `opndoor_referenced`, which is precisely the state the
 * old predicates read as "one of our agencies".
 *
 * THE SQL HALF IS supabase/tests/a_supplier_stays_a_supplier.test.sql, which
 * makes the same switch against the three predicates and the month's
 * settlement run. Two files because the two halves failed differently: SQL
 * kept billing and the client stopped listing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hydrateFull } from './applicationsService';
import { hydratePartners } from './partnersService';
import { ALL_PARTNERS, hydrateCommissionVisibility } from './types';
import { partyIsAgency, partyIsOurEstate, partyIsSupplier, portalLabel } from './capabilities';
import { agentRailApp } from './commissionSplit';
import { routeOf } from './route';
import { isSupplierEstate, viaSupplier } from './viaSupplier';
import { getCommissionSettlement, agentRailScope, livePartnerBreakdown } from './liveAnalytics';
import { selectionIsAgency } from './origin';
import type { FullApp } from './applicationsService';
import type { Partner } from './types';

const KESTREL = 'kestrel-lettings';

/* THE PARTNER LIST, WITH THE SWITCH ALREADY THROWN.
 *
 * `referencingMode: 'opndoor_referenced'` on a partner whose kind is
 * 'supplier' is the whole test. Harbour Lets is here as the mirror -- an
 * agency that carries its own partner row -- so a fix that simply made
 * everything a supplier would fail too. */
const partners = (kestrelMode: Partner['referencingMode']) => ([
  { id: 'opndoor-agents', name: 'Opndoor Agents', referencingMode: 'opndoor_referenced',
    kind: 'agency', isHouse: true },
  { id: 'opndoor-direct', name: 'Opndoor Direct', referencingMode: 'opndoor_referenced',
    kind: 'house', isHouse: true },
  { id: KESTREL, name: 'Kestrel Lettings', referencingMode: kestrelMode, kind: 'supplier' },
  { id: 'harbour-lets', name: 'Harbour Lets', referencingMode: 'opndoor_referenced', kind: 'agency' },
].map((p) => ({ ...p, status: 'active', since: '2026-01-01', weight: 1, users: 0, apps: 0,
  partnerRate: 0.25, agentRate: 0.1, primary: false })) as unknown as Partner[]);

/* Test mode's clock is fixed at 2026-06-26, so the prior settlement month is
   May 2026 and a May payment lands in it. */
const app = (over: Partial<FullApp> = {}): FullApp => ({
  ref: 'GR-KIND-1', partner: KESTREL, agency: 'Frost Partnership',
  branch: 'Frost Central', referrer: 'R', owner: 0,
  rent: 2000, fee: 2000, agentRate: 0.1, partnerRate: 0.25,
  status: 'deed', deedState: 'executed',
  sentAt: new Date(2026, 4, 1), paidAt: new Date(2026, 4, 10),
  deedAt: new Date(2026, 4, 12), tenancyStart: new Date(2026, 5, 1),
  expiry: new Date(2027, 4, 31),
  refunded: false, partiallyRefunded: false, withdrawn: false,
  refundedAt: null, refundedAmount: null, refundAfterStart: false,
  deedSentAt: null, deedViewedAt: null, expired: false,
  ...over,
} as unknown as FullApp);

beforeEach(() => { hydrateCommissionVisibility(true); });
afterEach(() => { hydrateFull([]); hydratePartners([]); hydrateCommissionVisibility(true); });

/** Run a block with Kestrel on each of the two modes, so every claim below is
 *  made about the SWITCH and not about one state of the world. */
function bothWays(check: (mode: string) => void) {
  for (const mode of ['pre_referenced_open', 'opndoor_referenced'] as const) {
    hydratePartners(partners(mode));
    hydrateFull([app()]);
    check(mode);
  }
}

describe('switched to “opndoor referenced”, a supplier is still a supplier', () => {
  it('on the Suppliers list, and still not on the Agencies one', () => {
    bothWays((mode) => {
      expect(partyIsSupplier(KESTREL), mode).toBe(true);
      expect(partyIsAgency(KESTREL), mode).toBe(false);
    });
  });

  it('in the portal wordmark its own director sees', () => {
    bothWays((mode) => {
      expect(portalLabel('management', KESTREL), mode).toBe('Supplier');
    });
  });

  /* "Commission by route": only real suppliers are their own route, and an
     agency folds into "Agency referral". A supplier that folded in took its
     referrals out of its own row and into ours. */
  it('as its own route in Commission by route', () => {
    bothWays((mode) => {
      expect(routeOf(KESTREL), mode).toEqual({ key: KESTREL, name: 'Kestrel Lettings' });
    });
  });

  /* The label that tells the two Frost Partnerships apart. Without it, an
     admin reading the branch and agency charts cannot say which company a
     row is. */
  it('so its agencies are still labelled with it', () => {
    bothWays((mode) => {
      expect(viaSupplier(ALL_PARTNERS, 'Frost Partnership', KESTREL), mode)
        .toBe('Frost Partnership (via Kestrel Lettings)');
      expect(isSupplierEstate(KESTREL), mode).toBe(true);
    });
  });

  /* THE ESTATE, which is what Reconciliation's "supplier agencies with no
     email" queue and the deed-contact warnings are filtered on. */
  it('and its estate is still a supplier estate, not one of ours', () => {
    bothWays((mode) => {
      expect(partyIsOurEstate(KESTREL), mode).toBe(false);
      expect(selectionIsAgency(`partner:${KESTREL}`), mode).toBe(false);
    });
  });

  /* THE MONEY. agentRailApp decides whether an application has a supplier
     share at all: true zeroes the partner cut in all four accumulators. A
     supplier moved onto the agent rail earns nothing, anywhere. */
  it('and its referrals still carry a supplier share of the fee', () => {
    bothWays((mode) => {
      expect(agentRailApp(app()), mode).toBe(false);
      expect(agentRailScope(KESTREL), mode).toBe(false);
    });
  });

  /* THE SETTLEMENT, which is the one Matt named. getCommissionSettlement
     skips a house partner and an agency-shaped one; a supplier read as an
     agency was skipped with them, so the screen stopped listing a payee the
     database still owed. */
  it('and it is still in the settlement, for the same amount', () => {
    bothWays((mode) => {
      const s = getCommissionSettlement('superadmin', 'all');
      const row = s.partners.find((p) => p.partnerName === 'Kestrel Lettings');
      expect(row, `${mode}: Kestrel is missing from the settlement`).toBeTruthy();
      // 25% of a £2,000 fee, which is what SQL's payee row holds too.
      expect(row?.commission, mode).toBe(500);
    });
  });

  /* AND ITS BUSINESS IS ON ITS OWN ROW. The breakdown carries a row per
     route whether or not the period put anything on it, so the claim that
     matters is not "Agency referral is absent" -- it is that the fee and
     the supplier cut are on Kestrel's row and not folded into ours. */
  it('and its referrals are on its own row, not folded into Agency referral', () => {
    bothWays((mode) => {
      const rows = livePartnerBreakdown('superadmin', 'all', 'all');
      const own = rows.find((r) => r.partnerName === 'Kestrel Lettings');
      expect(own, `${mode}: Kestrel has no route row`).toBeTruthy();
      expect(own?.feesGross, mode).toBe(2000);
      expect(own?.partnerCommNet, mode).toBe(500);
      const ours = rows.find((r) => r.partnerName === 'Agency referral');
      expect(ours?.feesGross ?? 0, mode).toBe(0);
    });
  });
});

/* =====================================================================
   AND THE MIRROR, so this is a fix and not a blanket.
   ===================================================================== */
describe('an agency that references its own tenants is still an agency', () => {
  it('whatever mode it is on', () => {
    for (const mode of ['opndoor_referenced', 'pre_referenced_screened'] as const) {
      const list = partners('pre_referenced_open').map((p) => (
        p.id === 'harbour-lets' ? { ...p, referencingMode: mode } : p));
      hydratePartners(list as Partner[]);
      expect(partyIsAgency('harbour-lets'), mode).toBe(true);
      expect(partyIsSupplier('harbour-lets'), mode).toBe(false);
      expect(routeOf('harbour-lets'), mode)
        .toEqual({ key: 'opndoor-agents', name: 'Agency referral' });
    }
  });
});

/* =====================================================================
   AND THE DIRECT RAIL KEEPS THE ANSWER IT HAD.

   `partner_kind` for `opndoor-direct` is 'house', and the three commission
   accumulators zero the partner rate on `agentRailApp`. Reading the kind
   alone would have turned that guard off and invented a partner share on
   every direct signup, because resolve_rates fills partner_rate on every
   row regardless of rail. `partyIsOurEstate` names the rail for exactly
   this reason, as is_our_estate_partner does in SQL.
   ===================================================================== */
describe('the direct rail', () => {
  it('has no supplier share, though its kind is house and not agency', () => {
    hydratePartners(partners('pre_referenced_open'));
    expect(partyIsOurEstate('opndoor-direct')).toBe(true);
    expect(agentRailApp(app({ partner: 'opndoor-direct' }))).toBe(true);
    expect(agentRailScope('opndoor-direct')).toBe(true);
    // And it is not an agency, which is the question origin.ts already asked
    // correctly and capabilities.ts used to answer differently.
    expect(partyIsAgency('opndoor-direct')).toBe(false);
    expect(selectionIsAgency('partner:opndoor-direct')).toBe(false);
  });
});
