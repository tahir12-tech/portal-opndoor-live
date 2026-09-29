/* A CLIENT-SUPPLIED HEADER IS NOT A RATE-LIMIT KEY.
 *
 * Round 7, D. `x-forwarded-for` is a list the client can prepend to. The
 * LEFTMOST entry is whatever the caller wrote; the RIGHTMOST is the one the
 * trusted edge appended. Keying a rate limit on the leftmost gives a fresh
 * bucket per request, so the limit counts to one forever.
 *
 * Measured against the real `bump_rate_limit` on dev (rolled back, 10/hour):
 * with a fixed key the 11th probe is refused; with a rotated key all twelve
 * pass, because `rate_limit` is keyed `key text primary key` and a rotated
 * header is simply a new row.
 *
 * It matters most on tenant-auth, which is `verify_jwt = false` and answers
 * one bit per request about whether an address is registered. On a guarantor
 * service that is a list of people who failed referencing. The comment at
 * tenant-auth/index.ts:230 calls the cap "the whole defence", and it was
 * bypassed by one header.
 *
 * `payment-confirmation/index.ts:52` has taken the rightmost hop since it was
 * written, with exactly this reasoning in its own comment. So the rule was
 * already known here and two of the three sites did not follow it -- which is
 * why this is a lint over all of them rather than two edits.
 *
 * WHY IT LIVES IN src/. `_shared/rateLimit.test.ts` is a Deno test;
 * vitest.config.ts excludes `supabase/**`, Deno is not installed on this
 * machine, and CI has no Deno step. A test added there would never run in the
 * suite that is now the definition of secure.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'supabase', 'functions');

const FILES = readdirSync(DIR)
  .filter((d) => statSync(join(DIR, d)).isDirectory())
  .flatMap((d) => readdirSync(join(DIR, d))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => `${d}/${f}`));

const read = (rel: string) => readFileSync(join(DIR, rel), 'utf8');

/** Files that derive an address from the forwarded-for header at all. */
const derivers = FILES.filter((f) => /headers\.get\(\s*["']x-forwarded-for["']\s*\)/.test(read(f)));

describe('deriving a caller address', () => {
  it('found the places that do it, so a broken glob cannot pass silently', () => {
    // rateLimit, partner-api, payment-confirmation.
    expect(derivers.length).toBeGreaterThanOrEqual(3);
  });

  /* THE RULE. */
  it('never takes the leftmost hop, which is whatever the caller wrote', () => {
    const leftmost = derivers.filter((f) => {
      const s = read(f);
      // `.split(",")[0]` or `.split(",")?.[0]` anywhere near the header read.
      return /x-forwarded-for[\s\S]{0,200}?\.split\(\s*","\s*\)\s*\??\.?\[\s*0\s*\]/.test(s);
    });
    expect(leftmost).toEqual([]);
  });

  it('takes the rightmost hop everywhere, which is the one the edge appended', () => {
    const wrong = derivers.filter((f) => !/\.pop\(\)/.test(read(f)));
    expect(wrong).toEqual([]);
  });

  /* AND EMPTY ENTRIES ARE DROPPED BEFORE THE POP. Without the filter, a
     trailing comma in the header makes `.pop()` return an empty string and
     every caller shares the "" bucket -- which is worse than the leftmost,
     not better. */
  it('drops empty entries, so a trailing comma cannot collapse every caller into one bucket', () => {
    const unfiltered = derivers.filter((f) => {
      const s = read(f);
      return /\.pop\(\)/.test(s) && !/\.filter\(Boolean\)[\s\S]{0,40}\.pop\(\)/.test(s);
    });
    expect(unfiltered).toEqual([]);
  });
});
