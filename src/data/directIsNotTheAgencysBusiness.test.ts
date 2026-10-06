/* ROUND 6, M9. DIRECT-RAIL ROWS ARE NOT THE MATCHED AGENCY'S BUSINESS.
 *
 * Recorded in docs/QUEUE.md as: "Direct-rail rows counted into
 * agency/branch counters in hydrate.ts; a group page's 'What they earned'
 * lists every payee on the rail; direct rows become an invented agency
 * payee in commissionSplit.ts."
 *
 * THE SERVER HALF OF THIS FAMILY IS ALREADY DONE, which is what makes the
 * client half easy to miss and easy to get wrong. Matt's own ruling on M4
 * of the earlier round: "direct-rail applications never count as the
 * matched agency's business: exclude them from agency digests, cohort CSVs
 * and every other agency-facing surface." That produced 20261006410000
 * (digests), the expiry-cohorts CSV, 20261006580000
 * (commission_statement_lines) and 20261006590000 (agreement_volume). The
 * CLIENT was never swept.
 *
 * WHY A DIRECT ROW CARRIES A REAL AGENCY AT ALL, which is the whole trap.
 * `resolve_agency_match` and the email matcher rewrite a direct
 * application's `agency_id` and `branch_id` to a REAL agency so a person
 * can service it, while pinning `partner_id` to `opndoor-direct`. So the
 * row looks like Regent's business by every field except the one that
 * decides: the partner slug. Anything that groups by agency_id or branch_id
 * without asking the rail counts somebody else's tenant as Regent's.
 *
 * ONE RAIL OUT, NOT ONE RAIL IN. The exclusion is written as "is this the
 * direct rail" rather than "is this an agency referral", matching
 * 20261006580000, because an inclusion test also silently drops the
 * supplier rail and the provider hand-over. That mistake has been made in
 * this codebase before: 20261006590000 exists because `agreement_volume`
 * carried `application_channel(...) = 'Agent referral'` and so zeroed every
 * SUPPLIER agency's volume.
 *
 * AND NOT `agentRailApp` EITHER. It asks the estate question
 * (referencingMode === 'opndoor_referenced') and answers false for a
 * supplier, so using it here would take the supplier rail's commission line
 * out along with the direct one.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hydrateFull, type FullApp } from './applicationsService';
import { linesFor } from './commissionSplit';
import { isDirectRail, isHousePartner } from './channel';

const D = (y: number, m: number, d: number) => new Date(y, m, d);

const app = (over: Partial<FullApp>): FullApp => ({
  ref: 'GR-M9-1', partner: 'opndoor-agents', agency: 'Regent’s Lettings',
  branch: "Regent's Park", agencyId: 'ag-1', branchId: 'br-1',
  referrer: 'Tom Reeve', referrerId: 'u-tom', referrerRole: 'referrer',
  referrerSeesCommission: false, owner: 1,
  rent: 2000, fee: 2000, agentRate: 0.2, partnerRate: 0.25,
  status: 'deed', deedState: 'executed',
  sentAt: D(2026, 3, 10), paidAt: D(2026, 3, 20), deedAt: D(2026, 4, 1),
  tenancyStart: D(2026, 4, 2), expiry: D(2027, 4, 1),
  refunded: false, partiallyRefunded: false, withdrawn: false, expired: false,
  refundedAt: null, refundedAmount: null, refundAfterStart: false,
  deedSentAt: null, deedViewedAt: null, commissionLines: undefined,
  ...over,
} as unknown as FullApp);

beforeEach(() => hydrateFull([]));
afterEach(() => hydrateFull([]));

describe('the rail predicate itself', () => {
  it('names the direct rail and nothing else', () => {
    expect(isDirectRail('opndoor-direct')).toBe(true);
    expect(isDirectRail('opndoor-agents')).toBe(false);
    expect(isDirectRail('referencing-partner')).toBe(false);
    expect(isDirectRail('harbourside')).toBe(false);
  });

  /* NULL AND UNDEFINED ARE NOT THE DIRECT RAIL. A guard that answered true
     for a missing slug would silently drop rows whose partner failed to
     hydrate, which is a data-loss shape rather than a correctness one. */
  it('and answers false for a missing slug rather than excluding it', () => {
    expect(isDirectRail(null)).toBe(false);
    expect(isDirectRail(undefined)).toBe(false);
    expect(isDirectRail('')).toBe(false);
  });

  /* IT IS NARROWER THAN isHousePartner, and that distinction is the reason
     it has to exist. All three house slugs are plumbing, but only ONE of
     them is the rail whose business belongs to nobody: `opndoor-agents`
     carries every real agency referral Opndoor onboards, so excluding it
     would empty the agency estate. */
  it('while isHousePartner is wider, which is why that one could not be used', () => {
    expect(isHousePartner('opndoor-agents')).toBe(true);
    expect(isDirectRail('opndoor-agents')).toBe(false);
  });
});

describe('M9-c. the commission lines a direct application pays', () => {
  /* THE DEFECT. `linesFor`'s fallback arm reconstructs an agency line out
     of `app.agency` and `app.agentRate`. A direct application never goes
     through create_referral, so it has no frozen lines and ALWAYS takes
     that arm -- manufacturing a payee named after the agency the matcher
     attached, paid at opndoor-direct's rate. */
  it('is none at all, rather than an invented one named after the agency', () => {
    const direct = app({ partner: 'opndoor-direct', agency: 'Regent’s Lettings', agentRate: 0.2 });
    expect(linesFor(direct)).toEqual([]);
  });

  /* THE SAME ROW WITH "Unattached" AS ITS AGENCY, which is what an
     unmatched direct signup carries. The old fallback named the payee
     "Unattached" and paid it, which is the literal row quoted in
     20261006580000's header. */
  it('and none when the matcher has attached nothing yet', () => {
    expect(linesFor(app({ partner: 'opndoor-direct', agency: 'Unattached' }))).toEqual([]);
  });

  /* THE EXCLUSION IS ON THE WHOLE FUNCTION, NOT THE FALLBACK ARM. The
     server excludes the rail above both split arms (20261006580000), so a
     direct row that somehow acquired a frozen line is still nobody's. */
  it('and none even if a direct row somehow carries a frozen split', () => {
    const withFrozen = app({
      partner: 'opndoor-direct',
      commissionLines: [{ level: 'agency', orgId: 'ag-1', orgName: 'Regent’s Lettings', rate: 0.2 }],
    } as Partial<FullApp>);
    expect(linesFor(withFrozen)).toEqual([]);
  });

  /* AND THE THREE RAILS THAT DO PAY STILL PAY. This is the assertion that
     stops the fix being made with an inclusion test: an agency referral, a
     SUPPLIER referral and a provider hand-over all keep their line, and the
     supplier is the one an `=== 'Agent referral'` test would have silently
     zeroed -- which is exactly what 20261006590000 was written to undo. */
  it('while an agency referral still pays its agency line', () => {
    const lines = linesFor(app({ partner: 'opndoor-agents' }));
    expect(lines).toHaveLength(1);
    expect(lines[0].orgName).toBe('Regent’s Lettings');
    expect(lines[0].rate).toBe(0.2);
  });

  it('and a supplier referral does too, which an inclusion test would have broken', () => {
    const lines = linesFor(app({ partner: 'harbourside', agency: 'Cityscape Lettings' }));
    expect(lines).toHaveLength(1);
    expect(lines[0].orgName).toBe('Cityscape Lettings');
  });

  it('and a frozen split is still returned untouched on a paying rail', () => {
    const frozen = [
      { level: 'agency' as const, orgId: 'ag-1', orgName: 'Regent’s Lettings', rate: 0.15 },
      { level: 'branch' as const, orgId: 'br-1', orgName: "Regent's Park", rate: 0.05 },
    ];
    expect(linesFor(app({ partner: 'opndoor-agents', commissionLines: frozen } as Partial<FullApp>))).toEqual(frozen);
  });
});
