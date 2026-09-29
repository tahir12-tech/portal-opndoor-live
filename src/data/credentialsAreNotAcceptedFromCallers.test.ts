/* A CREDENTIAL WE PRESENT TO SOMEBODY ELSE NEVER COMES FROM THE REQUEST.
 *
 * Round 5, M13. hubspot-sync resolved its outbound token as
 *
 *   Deno.env.get("HUBSPOT_ACCESS_TOKEN") ?? req.headers.get("x-hubspot-token") ?? ""
 *
 * and then presented it as `Authorization: Bearer ${TOKEN}` to HubSpot. The
 * function is behind the ops cron secret, so this is not open to the internet;
 * what it means is that anybody holding that one shared secret can choose
 * WHICH HubSpot account our portal data is written into. A credential supplied
 * by the caller is the caller's, and using it makes the caller the destination.
 *
 * THE DISTINCTION THE LINT DRAWS, because most header reads here are fine:
 *
 *   inbound, identifying    Authorization: the caller's own JWT, verified
 *   inbound, verified       x-ops-secret / x-reminders-secret, compared in
 *                           constant time against an env var
 *   inbound, not a secret   x-forwarded-for, Idempotency-Key, stripe-signature
 *   OUTBOUND                a value we put in a request WE make
 *
 * Only the last is forbidden. So the rule is not "do not read headers", it is
 * "nothing read from the request is ever presented as our credential to a
 * third party", which is checkable: take every name bound from
 * `req.headers.get(...)` and assert none of them reaches a `Bearer ${...}`.
 *
 * It reads source because these are Deno edge functions and `npm test` cannot
 * collect them (see vitest.config.ts). The property is structural, so source
 * is the right level to check it at.
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

/** Every identifier bound to an expression that reads a request header. */
function fromRequest(src: string): string[] {
  const names = new Set<string>();
  // `const x = ...req.headers.get(...)...` up to the end of the statement,
  // which catches the `??` chains where the header is one alternative among
  // several rather than the whole right-hand side.
  for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]*(?:\n\s*[^;\n]*)*?);/g)) {
    if (/\breq\.headers\.get\s*\(/.test(m[2])) names.add(m[1]);
  }
  return [...names];
}

/** Every value interpolated into an outbound bearer credential. */
function presentedAsBearer(src: string): string[] {
  return [...src.matchAll(/Bearer\s+\$\{([^}]+)\}/g)].map((m) => m[1].trim());
}

describe('edge functions', () => {
  it('were found, so a broken glob cannot pass silently', () => {
    expect(FILES.length).toBeGreaterThan(20);
    // And the scan sees the shapes it is looking for at all.
    expect(FILES.filter((f) => /Bearer\s+\$\{/.test(read(f))).length).toBeGreaterThan(0);
    expect(FILES.filter((f) => fromRequest(read(f)).length > 0).length).toBeGreaterThan(0);
  });

  it('never present a caller-supplied value as our credential to a third party', () => {
    const bad: string[] = [];
    for (const f of FILES) {
      const src = read(f);
      const tainted = fromRequest(src);
      if (!tainted.length) continue;
      for (const used of presentedAsBearer(src)) {
        // `Bearer ${authHeader}` style pass-through of the CALLER's own token
        // to Supabase is a different thing: that is the caller acting as
        // themselves, not us borrowing their credential. Those are matched by
        // name because the whole header, not a token, is what is forwarded.
        if (/^authHeader$/.test(used) || /^header$/.test(used)) continue;
        if (tainted.some((t) => new RegExp(`\\b${t}\\b`).test(used))) {
          bad.push(`${f}: Bearer \${${used}} can come from the request`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
