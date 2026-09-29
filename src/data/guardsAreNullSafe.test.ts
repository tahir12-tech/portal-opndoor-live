/* A GUARD THAT EVALUATES TO NULL LETS THE CALLER THROUGH.

   In plpgsql `if NULL then ...` does not fire. So an authorisation guard
   written the way every one in this schema is written

     if not (public.is_admin()
          or (public.app_role() = 'referrer' and a.referrer_id = auth.uid())
          or ...) then
       raise exception 'not permitted' using errcode = '42501';

   is not a guard at all when any arm goes NULL. applications.referrer_id is
   nullable -- a direct tenant has no referrer -- so for a Negotiator reading
   a direct application the second arm is `true and NULL` = NULL, the OR is
   NULL, `not NULL` is NULL, and the IF does not fire. Measured on dev before
   20261006470000: a Regent Negotiator read another company's tenant's
   journey, withdrew their application, and minted a 90-day bearer token to
   their payment page. supabase/tests/a_null_guard_refuses.test.sql is that,
   asserted.

   Nothing in the language makes this visible. The expression is correct SQL,
   it reads correctly in English, and it is wrong only when a column happens
   to be NULL. That is what makes it a shape worth a lint rather than a fix.

   THE RULE. Every `if <cond> then` whose block raises must have <cond>
   NULL-safe, in one of two forms:

     if coalesce(<cond>, true) then           the whole condition wrapped
     if not coalesce(<operand>, false) then   the operand of `not` wrapped

   The second is only sound when <operand> is a single term. `not` binds
   tighter than `and`, so in `not A and not B` the operand of `not` is A
   alone, and wrapping everything up to `then` silently rewrites
   `(not A) and (not B)` into `not (A and not B)`. 20261006470000 did exactly
   that to six guards and 20261006480000 put them on the first form. So this
   check does not merely look for the word coalesce: where the condition is
   compound at the top level it requires the whole-condition form.

   WHY THE FINAL STATE AND NOT THE FILES. A function defined in a 2025
   migration and never touched since is still live, and grepping only recent
   files would miss it. finalState() replays every migration in filename order
   and hands back the body that a clean apply would leave behind, which is the
   same thing scripts/schema-drift.mjs proves dev agrees with.

   WHAT THIS DOES NOT COVER, stated rather than quietly skipped. The opposite
   polarity -- `if <cond> then raise`, where NULL also means "do not raise" --
   is not mechanically checkable the same way, because turning NULL into a
   raise there would break legitimate paths (`if p_user = auth.uid()` must not
   fire for a service-role caller whose auth.uid() is NULL). All 58 of those
   were audited by hand against the catalogue when 20261006470000 was written:
   all but set_home_branch were already total, using `is distinct from`,
   `is null` or coalesce, or comparing columns that are NOT NULL. Instead of
   pretending to check them, this file COUNTS them, so adding one forces
   somebody to come here and look. */
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error - plain .mjs helper, shared with scripts/schema-drift.mjs
import { finalState } from '../../scripts/schema-final-state.mjs';

const state = finalState();

/** Comments and string literals blanked, offsets preserved, so a `'` inside
 *  an English comment cannot throw the paren depth out. */
function mask(sql: string): string {
  const out = sql.split('');
  let i = 0;
  while (i < sql.length) {
    if (sql.startsWith('--', i)) {
      const j = sql.indexOf('\n', i);
      const end = j < 0 ? sql.length : j;
      for (let k = i; k < end; k += 1) out[k] = ' ';
      i = end;
    } else if (sql.startsWith('/*', i)) {
      const j = sql.indexOf('*/', i + 2);
      const end = j < 0 ? sql.length : j + 2;
      for (let k = i; k < end; k += 1) out[k] = ' ';
      i = end;
    } else if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; }
          j += 1;
          break;
        }
        j += 1;
      }
      for (let k = i; k < Math.min(j, sql.length); k += 1) out[k] = ' ';
      i = j;
    } else i += 1;
  }
  return out.join('');
}

type Guard = { sig: string; cond: string; denyUnless: boolean; authz: boolean };

/** Every `if <cond> then` in a body whose statement block raises. */
function guardsIn(sig: string, body: string): Guard[] {
  const m = mask(body);
  const found: Guard[] = [];
  for (const hit of m.matchAll(/\bif\s+/g)) {
    const i = hit.index + hit[0].length;
    let depth = 0;
    let j = i;
    for (; j < m.length; j += 1) {
      const c = m[j];
      if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
      else if (depth === 0 && m.startsWith('then', j)
               && !/[A-Za-z0-9_]/.test(m[j - 1] ?? ' ')
               && !/[A-Za-z0-9_]/.test(m[j + 4] ?? ' ')) break;
    }
    if (j >= m.length || depth !== 0) continue;
    const endif = m.indexOf('end if', j);
    const block = m.slice(j + 4, endif < 0 ? j + 400 : endif);
    if (!block.includes('raise')) continue;
    const cond = body.slice(i, j).trim();
    // 42501 is insufficient_privilege: the guard is an authorisation decision
    // rather than a validation of an argument's shape.
    // A deny-unless guard in either form: `not X`, or the whole-condition
    // wrap `coalesce(not X, true)` that a compound condition has to use.
    const denyUnless = /^not\b/.test(cond) || /^coalesce\s*\(\s*not\b/.test(cond);
    found.push({ sig, cond, denyUnless, authz: body.slice(j + 4, endif < 0 ? j + 400 : endif).includes('42501') });
  }
  return found;
}

/** True when the expression has an `and`/`or` outside every bracket. */
function compound(expr: string): boolean {
  let depth = 0;
  let flat = '';
  for (const c of mask(expr)) {
    if (c === '(') { depth += 1; flat += ' '; } else if (c === ')') { depth -= 1; flat += ' '; } else flat += depth ? ' ' : c;
  }
  return /(?<![A-Za-z0-9_])(and|or)(?![A-Za-z0-9_])/.test(flat);
}

const guards: Guard[] = [];
for (const [sig, body] of state.funcBodies as Map<string, string>) {
  if (typeof body === 'string') guards.push(...guardsIn(sig, body));
}
const denyUnless = guards.filter((g) => g.denyUnless);
const denyIf = guards.filter((g) => !g.denyUnless && g.authz);

describe('a raising guard cannot evaluate to NULL', () => {
  it('found guards to check, so a broken replay cannot pass silently', () => {
    expect(state.funcBodies.size).toBeGreaterThan(200);
    expect(denyUnless.length).toBeGreaterThan(150);
  });

  /* THE RULE ITSELF. */
  it('wraps every `if not ... then raise` condition in coalesce', () => {
    const bare = denyUnless.filter((g) => {
      const operand = g.cond.replace(/^not\s+/, '');
      const whole = /^coalesce\s*\(/.test(g.cond) && /,\s*true\s*\)$/.test(g.cond);
      const wrapped = /^coalesce\s*\(/.test(operand) && /,\s*false\s*\)$/.test(operand);
      return !whole && !wrapped;
    });
    expect(bare.map((g) => `${g.sig}: if ${g.cond.replace(/\s+/g, ' ').slice(0, 90)}`)).toEqual([]);
  });

  /* AND THE PART THAT WOULD HAVE CAUGHT 20261006470000. Wrapping the operand
     is only sound for a single term; a compound condition must be wrapped
     whole, or `not` quietly changes what it applies to. */
  it('wraps a COMPOUND condition whole, because `not` binds tighter than `and`', () => {
    const mangled = denyUnless.filter((g) => {
      if (/^coalesce\s*\(/.test(g.cond) && /,\s*true\s*\)$/.test(g.cond)) return false;
      const operand = g.cond.replace(/^not\s+/, '');
      const inner = operand.replace(/^coalesce\s*\(/, '').replace(/,\s*false\s*\)$/, '');
      return compound(inner);
    });
    expect(mangled.map((g) => `${g.sig}: if ${g.cond.replace(/\s+/g, ' ').slice(0, 90)}`)).toEqual([]);
  });

  /* THE OTHER POLARITY, counted rather than checked. See the header: these
     cannot take the same treatment, and were audited individually. If this
     number moves, a new one was written and needs the same audit. */
  it('has exactly the deny-if guards that were audited by hand', () => {
    expect(denyIf.length).toBe(58);
  });
});
