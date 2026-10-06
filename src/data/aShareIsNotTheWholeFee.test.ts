/* A JOINT TENANT'S FEE SAYS IT IS A SHARE, ON ALL THREE SURFACES.
 *
 * Matt, 2026-10-04 (ba): 'Supplier joint referrals: the Payment section says
 * "£1,250.37 · one month's rent" without "(this tenant's 33% share)"; match
 * the agency wording, also in the tenant's payment email and Stripe
 * description.'
 *
 * IT IS NOT A RAIL SPLIT, WHICH CHANGES WHERE THE FIX GOES. Nothing in
 * feeLabels reads the partner. It is a FEE BASIS split: a deal priced in
 * WEEKS took the branch at the bottom, which has always appended the share,
 * and a deal priced at ONE MONTH'S RENT returned early a line above where the
 * suffix was built. Matt met it on Kestrel because Kestrel's basis is one
 * month; Regent on a one-month deal reads exactly the same, and an agency
 * tenant told they owe "one month's rent" when they owe a third of one is the
 * same error with more money behind it.
 *
 * MEASURED ON DEV: GR-26262 is 33% of a £3,789.01 rent, fee £1,250.37 -- a
 * third of one month. The figure was never wrong. The words around it said it
 * was the whole thing.
 *
 * THE OTHER TWO SURFACES WERE ALREADY RIGHT, and are asserted here anyway.
 * Matt asked for all three; two of them needed nothing, and the way to report
 * that honestly is a test that fails if either stops being true.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { feeLabels } from './applicationsService';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('the Payment section', () => {
  /* THE REPORTED ROW, to the penny. */
  it('calls a third of a month a third of a month', () => {
    // GR-26262 on dev, to the penny.
    expect(feeLabels({ rent: 3789.01, fee: 1250.37, sharePercent: 33 }).feeBasisLabel)
      .toBe("one month's rent (this tenant's 33% share)");
  });

  /* THE WEEKS BRANCH ALREADY DID THIS and must keep doing it: the suffix
     moved above the early return, so both branches now read from one place
     and neither can lose it alone. */
  it('and still says it on a weeks-based deal', () => {
    // GR-20845 on dev: 54% of a GBP 2,000 rent, fee GBP 1,246.15.
    expect(feeLabels({ rent: 2000, fee: 1246.15, sharePercent: 54 }).feeBasisLabel)
      .toContain("(this tenant's 54% share)");
  });

  /* A TENANCY OF ONE HAS NO SHARE TO NAME, and adding "(this tenant's 100%
     share)" to every sole referral would be the fix going too far. */
  it('and says nothing about a share on a sole tenancy', () => {
    expect(feeLabels({ rent: 1200, fee: 1200, sharePercent: null }).feeBasisLabel)
      .toBe("one month's rent");
    // Nor on a 100% share, which create_joint_referral never produces but a
    // single-applicant row can carry.
    expect(feeLabels({ rent: 1200, fee: 1200, sharePercent: 100 }).feeBasisLabel)
      .toBe("one month's rent");
  });
});

describe('the two surfaces that were already right', () => {
  /* THE TENANT'S EMAIL names the share without the percentage, by Matt's own
     ruling of 2026-10-03: "joint tenancies: describe it as 'Your share of the
     guarantee fee (5 weeks of rent for the whole tenancy)'". His first
     version that morning named the percentage and he replaced it. (ba) asks
     the email to make clear it is a share, which this does; it does not
     reopen the percentage question. */
  it('the tenant email calls it a share', () => {
    const t = read('supabase/functions/_shared/emailTemplates.ts');
    const fn = t.slice(t.indexOf('export function feeLineDescriptionFor'));
    expect(fn.slice(0, 600)).toContain('Your share of the guarantee fee');
    expect(fn.slice(0, 600)).toContain('for the whole tenancy');
  });

  /* THE STRIPE DESCRIPTION names the percentage, and is the one surface we
     cannot correct after the fact: it lands on a bank statement. */
  it('and the Stripe line names the percentage', () => {
    const cr = read('supabase/functions/create-referral/index.ts');
    expect(cr).toContain('`Your ${sharePct}% share of the guarantee fee for this tenancy');
    // Off the application's own snapshot, not a count or a guess.
    expect(cr).toContain('app.share_percent');
  });
});
