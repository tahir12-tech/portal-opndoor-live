/* AN AGENCY DIRECTOR'S REPORTING, THE REST OF THE SIX.
 *
 * Matt, 2026-10-01, verbatim: "Commission statement Tenancy column shows
 * only 'Single' or 'Joint (2)', never 'Joint, Single' or 'Joint, Joint
 * (2)'. ... Fix '15 Oct 2026 2026'. Remove the top banner ('Settlements
 * due... £0.00 partner / £1,601.54 agent') and the 'Payable now' and
 * 'Agent commission settlement' blocks for agency users. Under the
 * statement, one line: 'Opndoor pays this on 15 Oct 2026.' Keep the
 * Download statement button. Rename 'Commission (agreed terms) ·
 * Agreement · net of refunds' to 'Your commission, net of refunds'."
 *
 * The trend and the guaranteed-rent figure are in their own files; these
 * are the four that are about what the page says rather than what it
 * computes.
 *
 * WHY THE BLOCKS WENT. They total Opndoor's own settlement run across
 * both rails, which is why the banner names a partner figure beside an
 * agent one. To Regent that read as being owed £0.00 on a rail they are
 * not on. What they are owed is their statement, and the date it is paid.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const DASH = readFileSync('src/pages/Dashboard/Dashboard.tsx', 'utf8');
const ANALYTICS = readFileSync('src/data/analyticsService.ts', 'utf8');
const SETTLE = readFileSync('src/components/SettlementBlocks.tsx', 'utf8');
const STATEMENT = readFileSync('src/components/CommissionStatement.tsx', 'utf8');
const EXPORTS = readFileSync('src/data/exportsService.ts', 'utf8');

describe('the Tenancy column', () => {
  /* `tenancyPlace` has been "Single" or "Joint (2)" since liveAnalytics
     built it, and all three readers prefixed "Joint," to both. */
  it('prints what the value already says, on the screen and in both exports', () => {
    expect(STATEMENT).not.toContain('`Joint, ${l.tenancyPlace}`');
    expect(EXPORTS).not.toContain('`Joint, ${l.tenancyPlace}`');
    expect((EXPORTS.match(/l\.tenancyPlace \|\| 'Single'/g) ?? []).length).toBe(2);
  });
});

describe('the settlement date', () => {
  /* "15 Oct 2026 2026": `dayMonth` was day and month only and `fullDate`
     added the year; both moved onto the shared formatDate, which already
     ends in the year, and the second went on appending it. */
  it('says the year once', () => {
    expect(SETTLE).not.toContain('${d.getFullYear()}');
    expect(SETTLE).toContain('const fullDate = (d: Date) => formatDate(d);');
  });
});

describe("Opndoor's settlement run is not an agency's page", () => {
  it('the banner is gated on the reader not being an agency', () => {
    const line = /const naSettlements =[\s\S]*?;\n/.exec(DASH)?.[0] ?? '';
    expect(line).toContain('!agencyFacing');
  });

  it('and so are the Settlements section and both settlement blocks', () => {
    expect((DASH.match(/!supplierFacing && !agencyFacing/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  /* WHAT REPLACES THEM, which is the half that matters: an agency still
     has to know when they are paid. */
  it('and one line under the statement says when Opndoor pays', () => {
    expect(DASH).toContain('Opndoor pays this on');
    expect(DASH).toContain('{agencyFacing && agentSettleDate && (');
  });
});

describe('the commission tile', () => {
  it('is theirs, in their words', () => {
    expect(ANALYTICS).toContain("? (isOpndoorStaff(role) ? 'Agency commission' : 'Your commission')");
    expect(ANALYTICS).not.toContain("agencyFacing ? 'Commission (agreed terms)'");
  });

  /* AND THE TAG IS ONE PHRASE, not the source said twice: "(agreed
     terms)" and the source pill were both answering "where does this rate
     come from", which is not what somebody reading their own earnings is
     asking. */
  it('and its tag is just "net of refunds"', () => {
    expect(ANALYTICS).toContain("commTag: agencyFacing\n      ? 'net of refunds'");
  });

  /* THE DEMO SAYS THE SAME WORDS. A synthetic model that teaches a
     different vocabulary is worse than no demo. */
  it('and the mock model agrees with the live path', () => {
    expect((ANALYTICS.match(/'Agency commission' : 'Your commission'/g) ?? []).length).toBe(2);
  });
});
