/* OPNDOOR'S OWN MARGIN IS NOT THE AGENCY'S BUSINESS.
 *
 * Round 6, from the client-side isolation sweep. Rule 3 makes commercial terms
 * Director-level; it does not make OUR commercial terms theirs.
 *
 * On the agency rail `partnerRate` is Opndoor's house cut -- `opndoor-agents`
 * carries 0.25 and resolve_rates snapshots it onto every agency-rail row. Three
 * of the four commission accumulators in liveAnalytics.ts zero it for that rail
 * (`agentRailApp(app) ? 0 : app.partnerRate`). Two did not:
 *
 *   getCommissionSettlement  a line "Agency referral - £X" on the Director's
 *                            own Reporting page, where X is 25% of their own
 *                            fees, ADDED to what they are owed. Divide it by
 *                            the fees beside it and you have our margin.
 *   the trailing-12 chart    the same rate in `m.comm`.
 *
 * The export path already refused this -- exportsService returns an empty
 * export for an agency reader -- so the rule was agreed and one surface had
 * not been told.
 *
 * WHY A UNIT TEST AND NOT A RENDER TEST: the figure is the defect, not the
 * markup. A render test would assert that some element is absent, which stays
 * green if the element moves; this asserts the number the screen is given.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hydrateCommissionVisibility } from '@/data';

afterEach(() => { hydrateCommissionVisibility(true); });

const src = readFileSync(join(process.cwd(), 'src', 'data', 'liveAnalytics.ts'), 'utf8');

/** Every line that multiplies by a partnerRate, with the three lines above it.
 *  The guard is sometimes inline (`agentRailApp(app) ? 0 : app.partnerRate`)
 *  and sometimes a `continue` on the statement before, so a single-line scan
 *  would report a protected site as naked. */
function partnerRateUses(): string[] {
  const lines = src.split('\n');
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (!/\*\s*(?:\([^)]*\))?\s*\w+\.partnerRate/.test(line)) return;
    out.push(lines.slice(Math.max(0, i - 3), i + 1).join(' ').trim());
  });
  return out;
}

describe('the house cut on the agency rail', () => {
  it('is zeroed everywhere partnerRate is turned into money', () => {
    // Either guard is correct, and which one is the point: isHousePartner for
    // "this rate is OURS", agentRailApp for "this rail has no partner share".
    // A line with neither is turning our house cut into somebody's commission.
    const naked = partnerRateUses().filter((line) => !/agentRailApp\(|isHousePartner\(/.test(line));
    expect(naked).toEqual([]);
  });

  /* AND THE SETTLEMENT DROPS THE HOUSE PARTNER ALTOGETHER. Zeroing the rate
     leaves a "£0.00" line named after a route, which is still Opndoor's
     plumbing showing through on an agency's own page. getCommissionSettlement
     is a SUPPLIER settlement; a house partner is not one. */
  it('and the supplier settlement skips a house partner entirely', () => {
    expect(src).toMatch(/if \(isHousePartner\(a\.partner\)\) continue;/);
  });

  /* THE MOUNT. FinanceSurfaces gated itself on maySeeCommission, which a
     Director passes, so the whole opndoor money-ops section rendered for them
     -- and double-rendered SettlementBlocks, which is the visible tell. */
  it('and the money-ops surface is gated on the seat, not the capability', () => {
    const dash = readFileSync(join(process.cwd(), 'src', 'pages', 'Dashboard', 'Dashboard.tsx'), 'utf8');
    const mount = dash.indexOf('<FinanceSurfaces');
    expect(mount).toBeGreaterThan(-1);
    // The nearest RoleOnly above the mount names superadmin.
    const before = dash.slice(0, mount);
    const lastGate = before.lastIndexOf('<RoleOnly');
    expect(lastGate).toBeGreaterThan(-1);
    expect(dash.slice(lastGate, mount)).toMatch(/roles=\{\['superadmin'\]\}/);
  });
});
