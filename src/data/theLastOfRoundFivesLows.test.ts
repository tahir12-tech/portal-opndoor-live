/* THE THREE OF ROUND FIVE'S LOWS THAT LIVE IN EDGE FUNCTIONS.
 *
 * The other nine are in SQL (supabase/tests/the_rest_of_round_fives_lows.test.sql
 * and what_the_fifth_reviewer_found.test.sql) or were client-side. These three
 * cannot be asserted either way: they are Deno functions, `npm test` cannot
 * collect them, and two of the three reach Deno.env at module scope so they
 * cannot be imported. What CAN be checked is the property, and in all three
 * cases the property is structural.
 *
 *   application-document-url  signed `doc.bucket` -- whatever bucket the row
 *                             named -- with the service key. The RLS read above
 *                             it authorises the DOCUMENT; it says nothing about
 *                             which bucket is a legitimate target for this
 *                             endpoint, so the endpoint's reach was whatever
 *                             anything that writes application_documents put in
 *                             that column.
 *
 *   tenant-portal             read STRIPE_SECRET_KEY straight from the
 *                             environment, so a SANDBOX application's tenant
 *                             was charged against the live Stripe account.
 *                             _shared/livemodeCredentials is the only file that
 *                             is supposed to know which key is which.
 *
 *   create-referral           wrote caller-supplied share_percent and
 *                             share_amount with the SERVICE key. share_amount
 *                             is the fee basis (`rentBase`), so nothing stood
 *                             between a caller and the number their guarantee
 *                             fee is calculated from.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fn = (p: string) => readFileSync(join(process.cwd(), 'supabase', 'functions', p), 'utf8');

describe('application-document-url', () => {
  it('signs only a bucket this endpoint is allowed to sign', () => {
    const s = fn('application-document-url/index.ts');
    // The allowlist exists, and the guard runs before the signer.
    expect(s).toMatch(/SIGNABLE\s*=\s*\[/);
    const guard = s.indexOf('SIGNABLE.includes');
    const sign = s.indexOf('createSignedUrl');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(sign);
  });
});

describe('tenant-portal', () => {
  it('takes its Stripe key from the application livemode, not the environment', () => {
    const s = fn('tenant-portal/index.ts');
    expect(s).toMatch(/stripeSecretFor\(\s*app\.livemode === true\s*\)/);
  });

  it('does not read STRIPE_SECRET_KEY directly any more', () => {
    expect(fn('tenant-portal/index.ts')).not.toMatch(/Deno\.env\.get\(\s*"STRIPE_SECRET_KEY"/);
  });

  /* THE CLASS, not the instance. livemodeCredentials exists so that exactly one
     file chooses between the live and test credentials; any other function
     reading a Stripe key out of the environment has reintroduced the same
     defect somewhere else. */
  it('is the last function to read a Stripe key out of the environment', () => {
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
    const DIR = join(process.cwd(), 'supabase', 'functions');
    const files = readdirSync(DIR)
      .filter((d) => statSync(join(DIR, d)).isDirectory())
      .flatMap((d) => readdirSync(join(DIR, d))
        .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
        .map((f) => `${d}/${f}`));
    const direct = files.filter((f) =>
      f !== '_shared/livemodeCredentials.ts' && /Deno\.env\.get\(\s*"STRIPE_(SECRET|PUBLISHABLE)/.test(fn(f)));
    expect(direct).toEqual([]);
  });
});

describe('create-referral', () => {
  it('refuses a share outside the range a share can occupy', () => {
    const s = fn('create-referral/index.ts');
    // A percentage is 1..100.
    expect(s).toMatch(/n <= 0 \|\| n > 100/);
    // An amount cannot exceed the rent it is a share of.
    expect(s).toMatch(/rentCap > 0 && n > rentCap/);
  });

  it('refuses rather than clamps, so the fee is the number that was asked for', () => {
    const s = fn('create-referral/index.ts');
    expect(s).toMatch(/A share is between 1 and 100 per cent/);
    expect(s).toMatch(/A share cannot be more than the rent it is a share of/);
    // No silent correction of the caller's number.
    expect(s).not.toMatch(/Math\.min\(\s*Number\(pct\)/);
  });
});
