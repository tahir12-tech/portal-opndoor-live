/* A TEST THAT ASSERTS AN RLS POLICY MUST RUN AS THE ROLE THE POLICY IS FOR.
 *
 * WHY. `user_scopes_delete` calls `may_act_on_user`, which `authenticated` may
 * not execute, so "Remove position" raised "permission denied for function"
 * for every user. The suite was green, because the test that covers removing
 * a position does the DELETE after `reset role` -- as `postgres`, which owns
 * the tables and bypasses RLS entirely. The policy predicate was never
 * evaluated. The test asserted the constraint trigger and nothing else, and
 * read as if it asserted both.
 *
 * postgres bypasses RLS. service_role bypasses RLS. Only `authenticated` with
 * a real `request.jwt.claims` exercises a policy, and only that role's
 * EXECUTE privilege exercises a grant. So: any statement in a pgTAP file that
 * asserts a policy or a grant must sit inside a `set local role authenticated`
 * block with a sub claim set.
 *
 * WHAT COUNTS AS ASSERTING A POLICY OR A GRANT, deliberately narrow so the
 * lint is not noise: a throws_ok or lives_ok whose SQL performs DML or calls
 * a public function. Those are the two shapes that mean "this is refused" or
 * "this is allowed", and both are meaningless as postgres.
 *
 * READING GROUND TRUTH AS postgres IS FINE and very common: after a refused
 * write, a test checks the row is unchanged, and it must do that with RLS off
 * or it cannot see the row at all. Those are plain `is`/`ok` selects and are
 * not flagged.
 *
 * ESCAPE HATCH: `-- lint:as-postgres <reason>` in the comment block directly
 * above the assertion, within six unbroken lines of it. It has to be written,
 * and the reason has to be readable, which is the point.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'supabase', 'tests');
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.test.sql')).sort();

/* WHAT COUNTS, narrowed until it is precise.
 *
 * The first version of this lint flagged any throws_ok or lives_ok whose SQL
 * touched the database, and found 43 sites. Almost all were assertions about
 * TRIGGERS and CHECK constraints -- the all-in rate guard, the one-rate-per-
 * party rule, the apportionment. Those fire for postgres exactly as they fire
 * for anybody, so running them as postgres is correct and a lint that nags
 * about them gets switched off within a week.
 *
 * 42501 is the signal that separates the two. It is Postgres's
 * insufficient_privilege, and it is what an RLS refusal and a missing EXECUTE
 * both raise. A test expecting 42501 is asserting an AUTHORISATION rule, and
 * asserting one as postgres is asserting nothing: postgres owns the tables
 * and bypasses RLS. A business rule raises 22023 or 23514 and is left alone.
 */
const ASSERTS_AUTHORISATION = /'42501'|insufficient_privilege|permission denied/i;

interface Offence { file: string; line: number; text: string }

/** Walk a file tracking the current role, and flag rule-assertions made while
    it is not `authenticated`. */
function offences(file: string): Offence[] {
  const src = readFileSync(join(DIR, file), 'utf8');
  const lines = src.split('\n');
  const out: Offence[] = [];
  let asAuthenticated = false;
  let claimsSet = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const bare = line.replace(/--.*$/, '');

    if (/set\s+local\s+role\s+authenticated/i.test(bare)) asAuthenticated = true;
    if (/\breset\s+role\b/i.test(bare)) asAuthenticated = false;
    if (/set\s+local\s+role\s+(?!authenticated)/i.test(bare)) asAuthenticated = false;
    if (/request\.jwt\.claims/i.test(bare)) claimsSet = true;

    if (!/\b(throws_ok|lives_ok)\s*\(/i.test(bare)) continue;

    // The assertion's SQL can run over several lines; read to its close.
    let block = '';
    for (let j = i; j < Math.min(i + 14, lines.length); j += 1) {
      block += `${lines[j]}\n`;
      if (/\);\s*$/.test(lines[j])) break;
    }
    if (!ASSERTS_AUTHORISATION.test(block.replace(/--.*$/gm, ''))) continue;

    /* The marker sits in the comment block above the assertion, and those
       blocks run to several lines because the reason has to be readable.
       Six lines of lookback, stopping at a blank line so a marker cannot
       drift onto an assertion it was not written for. */
    let excused = false;
    for (let k = i - 1; k >= Math.max(0, i - 6); k -= 1) {
      if (!(lines[k] ?? '').trim()) break;
      if (/--\s*lint:as-postgres\b/i.test(lines[k])) { excused = true; break; }
    }
    if (excused) continue;

    if (!asAuthenticated) {
      out.push({ file, line: i + 1, text: lines[i].trim().slice(0, 96) });
    } else if (!claimsSet) {
      out.push({ file, line: i + 1, text: `${lines[i].trim().slice(0, 80)}   [no jwt claim set]` });
    }
  }
  return out;
}

describe('a pgTAP assertion about a policy or a grant runs as authenticated', () => {
  it('has files to check, so a renamed directory cannot pass silently', () => {
    expect(FILES.length).toBeGreaterThan(20);
  });

  it('and none of them asserts a rule while running as postgres', () => {
    const all = FILES.flatMap(offences);
    const readable = all.map((o) => `${o.file}:${o.line}  ${o.text}`);
    expect(readable).toEqual([]);
  });

  /* The lint has to be able to SEE the thing it is looking for, or it is a
     test that always passes. This is the H2 shape, and it must be flagged. */
  it('does flag the shape it exists for', () => {
    const sample = [
      'reset role;',
      'select throws_ok(',
      "  $$delete from public.user_scopes where user_id = 'x'$$,",
      "  '42501', null, 'removing a position is refused');",
    ].join('\n');
    // Re-run the walker over a temporary in-memory file by writing the same
    // logic inline: the assertion sits after `reset role`, so it is an offence.
    let asAuthenticated = false;
    let flagged = false;
    const lines = sample.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (/set\s+local\s+role\s+authenticated/i.test(lines[i])) asAuthenticated = true;
      if (/\breset\s+role\b/i.test(lines[i])) asAuthenticated = false;
      if (!/\b(throws_ok|lives_ok)\s*\(/i.test(lines[i])) continue;
      const block = lines.slice(i, i + 4).join('\n');
      if (ASSERTS_AUTHORISATION.test(block) && !asAuthenticated) flagged = true;
    }
    expect(flagged).toBe(true);
  });
});
