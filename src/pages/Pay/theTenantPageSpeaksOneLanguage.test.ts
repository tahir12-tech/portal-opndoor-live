/* ONE ADDRESS, ONE NAME FOR THE FEE, ONE DATE FORMAT, TENANT SIDE.
 *
 * Matt, 2026-10-01, verbatim: "Tenant payment page: use support@opndoor.co
 * (not hello@), the same fee name as the emails everywhere ('guarantee
 * fee'), and dates as '20 Nov 2026'. Sweep all tenant-facing pages and
 * emails for hello@opndoor.co and 'guarantor fee' and make them
 * consistent."
 *
 * THE DATE IS THE ONE WORTH THE MOST. 20/11/2026 is the one format in the
 * product that can be read two ways, and this is the page where somebody
 * is told when their guarantee starts before paying for it.
 *
 * WHAT THIS SWEEP DOES NOT COVER, deliberately: the exports, the staff
 * activity feed and the API documentation still say "guarantor fee". They
 * are not tenant-facing, a CSV heading is something partners reconcile
 * against, and the API's field names are a published contract. Flagged in
 * QUEUE.md for Matt rather than changed on a guess.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Every tenant-facing source file: the two journeys plus the two
    functions that render or price the tenant's own page. */
function tenantFacing(): string[] {
  const out: string[] = [];
  for (const dir of ['src/pages/Pay', 'src/pages/Apply']) {
    for (const f of readdirSync(dir)) {
      if (/\.tsx?$/.test(f) && !f.includes('.test.')) out.push(join(dir, f));
    }
  }
  out.push('supabase/functions/payment-page/index.ts');
  out.push('supabase/functions/create-referral/index.ts');
  return out;
}

describe('the tenant side', () => {
  it('has files to check, so a renamed directory cannot pass silently', () => {
    expect(tenantFacing().length).toBeGreaterThan(6);
  });

  it('writes to support@opndoor.co and never hello@', () => {
    const bad = tenantFacing().filter((f) => readFileSync(f, 'utf8').includes('hello@opndoor.co'));
    expect(bad).toEqual([]);
  });

  it('and calls it a guarantee fee, as the emails do', () => {
    const bad = tenantFacing().filter((f) => /[Gg]uarantor fee/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});

describe('the dates on the payment page', () => {
  const page = readFileSync('supabase/functions/payment-page/index.ts', 'utf8');

  it('spell the month, so 03/09 cannot be read two ways', () => {
    expect(page).toContain('MONTH_SHORT');
    expect(page).not.toMatch(/\$\{m\[3\]\}\/\$\{m\[2\]\}\/\$\{m\[1\]\}/);
  });

  /* "Sept" IS THE TRAP, and it is why the table is written out rather than
     taken from toLocaleString: Node's en-GB gives four characters for one
     month out of twelve. */
  it('and say Sep, like every other date in the product', () => {
    const table = /const MONTH_SHORT = \[([\s\S]*?)\];/.exec(page)?.[1] ?? '';
    expect(table).toContain("'Sep'");
    expect(table).not.toContain("'Sept'");
  });

  it('and the mock the page is built against shows the same shape', () => {
    const api = readFileSync('src/pages/Pay/paymentPageApi.ts', 'utf8');
    expect(api).toContain("tenancyStart: '1 Sep 2026'");
  });
});
