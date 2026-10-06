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

/* COMMENTS STRIPPED, and that is not a detail. Half these files explain the
   defect they fixed by quoting the old form verbatim, so an unstripped scan
   flags every fix as the bug -- and a lint that cries wolf gets switched off
   within a week, which is the real failure mode. migrationPatterns.test.ts
   makes the same point about the SQL side. */
const code = (rel: string) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

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

/* AND A CALLER'S TEXT IS NOT A QUERY PATTERN. Backlog B4, same family: a
 * value the caller chose, used as something it is not. `.ilike()` takes a SQL
 * LIKE pattern, so request-body text reaching it means `%` and `_` reach the
 * database. In resolveReferrer that turned a deliberate refusal --
 * "this address is not available as a referrer" -- into a cross-partner
 * existence oracle for other suppliers' staff, binary-searchable and creating
 * nothing.
 *
 * users.email is normalised to lowercase on write (20261006710000), so
 * equality on a lowercased key is exact and no pattern is needed anywhere. */
describe('looking somebody up by the address they sent', () => {
  it('never matches it as a LIKE pattern', () => {
    const pattern = FILES.filter((f) => /\.ilike\(\s*["']email["']/.test(code(f)));
    expect(pattern).toEqual([]);
  });

  /* AND A CALLER'S TEXT IS NOT FILTER SYNTAX EITHER. Found by the final
     review round, in code written an hour earlier: create-referral resolved
     the chosen route with

       .or(`slug.eq.${b.route},id.eq.${b.route}`)

     PostgREST's .or() takes an EXPRESSION, so a comma or a parenthesis in
     the value is syntax rather than data: a route of `x,id.gt.0` adds a
     third clause and the filter stops meaning what it says. Exactly the
     shape of B4's ILIKE above -- a value the caller chose, used as something
     it is not.

     .eq() sends the value as a parameter, so this is a rule about which
     method is reached for, and that is checkable. */
  it('never interpolates a value into an .or() filter expression', () => {
    const interpolated = FILES.filter((f) => /\.or\(\s*`[^`]*\$\{/.test(code(f)));
    expect(interpolated).toEqual([]);
  });

  it('and does not use .neq on a nullable column, which never matches NULL', () => {
    // Backlog B5: users_partner_by_role REQUIRES partner_id to be NULL for
    // every superadmin and opndoor_manager, so `.neq("partner_id", x)` was
    // blind to exactly the accounts that matter.
    const neq = FILES.filter((f) => /\.neq\(\s*["']partner_id["']/.test(code(f)));
    expect(neq).toEqual([]);
  });
});

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
