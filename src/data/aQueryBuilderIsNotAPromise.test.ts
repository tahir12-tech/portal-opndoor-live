/* A SUPABASE QUERY BUILDER IS A THENABLE, NOT A PROMISE.
 *
 * Found on 2026-09-30, the day Deno was finally installed on this machine.
 * `deno check` had never been run against the edge functions here -- the
 * README said so and `npm test` cannot collect them -- and the first run
 * found this in expiry-reminders:
 *
 *     await service.rpc("report_ops_incident", { ... }).catch(() => {});
 *
 * PostgrestFilterBuilder implements `then`. It does NOT implement `catch`.
 * So that line does not swallow an error: it throws
 * `TypeError: ....catch is not a function` before the RPC has even been
 * awaited.
 *
 * WHAT IT ACTUALLY COST. That line runs when an expiry reminder is PARKED --
 * a guarantee about to expire with nobody to send the reminder to. The
 * intent is "log an incident so somebody places a recipient, then carry on
 * with the rest". The effect is that the TypeError is caught by the outer
 * handler, the whole nightly job returns 500, and every remaining reminder
 * for that night is never sent. One guarantee with a missing contact
 * silences the reminders for all the others.
 *
 * The codebase already knew the right shape -- send-deed-to-agent,
 * renewal-notices and stripe-webhook all write `.then(() => {}, () => {})`,
 * which is the two-argument form a thenable does support. This one was
 * written the other way and nothing could see it.
 *
 * WHY A LINT AND NOT JUST A FIX. `deno check` now catches this, and
 * `npm run check:functions` runs it. But deno check is not part of
 * `npm test`, and the whole reason this survived is that the one tool that
 * would have caught it was not installed. A grep-based check runs in the
 * suite everybody already runs.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../supabase/functions');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const FILES = tsFiles(ROOT);

/** Every `.catch(` whose own STATEMENT starts with a Supabase query builder
 *  and has no `.then(` before it.
 *
 *  Bounded to the statement on purpose. A line-window look-back reads an
 *  unrelated builder from earlier in the file and flags
 *  `await req.json().catch(...)`, which is a real Promise and perfectly fine.
 *  The statement is cut at the previous `;`, `{` or `}`. */
function badCatches(src: string): string[] {
  const hits: string[] = [];
  const BUILDER = /\.(rpc|select|insert|update|delete|upsert|maybeSingle|single|eq|in|order|limit)\s*\(/;
  let from = 0;
  for (;;) {
    const at = src.indexOf('.catch(', from);
    if (at < 0) break;
    from = at + 7;
    /* The previous `;` ONLY. Cutting on braces too looks tidier and is
       wrong: the argument to an RPC is an object literal, so the nearest
       `}` sits INSIDE the very call being checked and the statement gets
       cut to nothing. That version passed the suite while detecting
       nothing, which is why the self-check above exists. */
    const cut = src.lastIndexOf(';', at);
    const stmt = src.slice(cut + 1, at);
    // A `.then(` converts the thenable to a real Promise, after which
    // `.catch` is correct. That is what partnerAuth.ts and partner-api do.
    if (stmt.includes('.then(')) continue;
    if (!BUILDER.test(stmt)) continue;
    const line = src.slice(0, at).split('\n').length;
    hits.push(`line ${line}: ${src.slice(cut + 1, at + 20).replace(/\s+/g, ' ').trim().slice(0, 90)}`);
  }
  return hits;
}

describe('the edge functions', () => {
  it('found files to check, so an empty sweep cannot pass silently', () => {
    expect(FILES.length).toBeGreaterThan(20);
  });

  /* THE DETECTOR IS ITSELF CHECKED, because it was tightened once already.
     The first version scanned a window of lines and flagged
     `await req.json().catch(...)`, which is a real Promise; bounding it to
     the statement fixed that, and a bound that is slightly too tight would
     silently stop catching the real thing. These two snippets are the exact
     shapes that matter: the bug as it was written, and the safe form beside
     it. */
  it('actually detects the shape it is looking for', () => {
    const bug = 'await service.rpc("report_ops_incident", { p_type: "x" }).catch(() => {});';
    const safe = 'await service.rpc("report_ops_incident", { p_type: "x" }).then(() => {}, () => {});';
    const alsoSafe = 'const body = await req.json().catch(() => ({}));';
    expect(badCatches(bug)).toHaveLength(1);
    expect(badCatches(safe)).toEqual([]);
    expect(badCatches(alsoSafe)).toEqual([]);
  });

  it('never call .catch() straight onto a Supabase query builder', () => {
    const bad = FILES.flatMap((f) => badCatches(readFileSync(f, 'utf8')).map((h) => `${f.split('/functions/')[1]} ${h}`));
    expect(bad).toEqual([]);
  });

  /* THE POSITIVE HALF. The two-argument `then` IS supported and is what the
     rest of the codebase uses, so the fix has somewhere to go and this test
     is not simply banning error handling. */
  it('and the two-argument then, which a thenable does support, is in use', () => {
    const used = FILES.filter((f) => readFileSync(f, 'utf8').includes('.then(() => {}, () => {})'));
    expect(used.length).toBeGreaterThan(1);
  });
});
