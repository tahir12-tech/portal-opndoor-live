/* NO EM DASHES IN ANYTHING A CUSTOMER READS.
 *
 * Matt, 2026-10-01, verbatim: "No em dashes anywhere in emails, PDFs,
 * CSV headers or screen text, including TEST subject lines. Replace any
 * with a comma, colon or full stop. Add a check that fails the build if
 * an em dash appears in any customer-facing text."
 *
 * "INCLUDING TEST SUBJECT LINES" IS POINTED AT ME. The rule was already
 * in CLAUDE.md and I broke it in the one piece of copy I wrote by hand
 * rather than generated: both statement emails I sent that evening were
 * subjected "[TEST] Agency statement, branded <em dash> Commission
 * statement for September 2026". That is why he asked for a check
 * instead of a reminder, and he is right: a rule a person has to
 * remember is a rule that holds until the person is busy.
 *
 * =====================================================================
 * WHY THIS LOOKS AT STRINGS AND NOT AT FILES
 * =====================================================================
 *
 * The source is FULL of em dashes, deliberately and permanently: the
 * comments in this codebase are prose, written for whoever reads them
 * next, and they are not customer-facing by any reading. A check that
 * grepped whole files would fail on nearly every file in the repo, and
 * a check that always fails is a check somebody deletes.
 *
 * So it strips comments first, then looks at what is left: string
 * literals, template literals and JSX text. That is what reaches a
 * screen, an email or a document.
 *
 * AND IT INCLUDES THE EN DASH, which is not what he asked for and is
 * the same mistake one keystroke away. A dash that is not a hyphen has
 * no business in product copy either, and finding out later that the
 * check let the other one through would be the obvious failure.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = process.cwd();

/** Every source file that can produce something a customer reads. */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p, out); continue; }
    if (!/\.(ts|tsx)$/.test(p)) continue;
    // A test's own prose is not customer-facing, and several tests quote
    // the very strings this rule is about in order to assert on them.
    if (/\.test\.(ts|tsx)$/.test(p)) continue;
    out.push(p);
  }
  return out;
}

const FILES = [
  ...walk(resolve(ROOT, 'src')),
  ...walk(resolve(ROOT, 'supabase/functions')),
];

/** Comments out, so the prose this codebase is written in does not count. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[^\n'"`]*\/\/[^\n]*$/gm, ' ');
}

const DASHES = /[—–]/;

/** Each offending line, as `path:line  the text`. */
function offenders(): string[] {
  const out: string[] = [];
  for (const f of FILES) {
    const lines = codeOnly(readFileSync(f, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (!DASHES.test(line)) return;
      out.push(`${relative(ROOT, f)}:${i + 1}  ${line.trim().slice(0, 110)}`);
    });
  }
  return out;
}

describe('an em dash never reaches a customer', () => {
  it('found files to check, so a broken walk cannot pass silently', () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(FILES.some((f) => f.includes('emailTemplates'))).toBe(true);
    expect(FILES.some((f) => f.includes('commission-statements'))).toBe(true);
  });

  /* THE CHECK ITSELF, and it names every line so a failure is a
     to-do list rather than a hunt. */
  it('appears in no email, document or screen string', () => {
    expect(offenders()).toEqual([]);
  });

  /* THE CHECK CAN FAIL, which is worth proving: a regex that silently
     matched nothing would pass this file forever. */
  it('and the check would catch one if it were there', () => {
    const sample = 'const s = "Commission statement — September";';
    expect(DASHES.test(codeOnly(sample))).toBe(true);
    // ...while an ordinary hyphen is left alone.
    expect(DASHES.test('const s = "Sent-to-Deed";')).toBe(false);
  });

  /* AND A COMMENT IS STILL ALLOWED TO BE PROSE. If this ever fails,
     somebody has made the check stricter than Matt asked and the next
     person will switch it off. */
  it('and a comment may still contain one', () => {
    expect(codeOnly('/* a dash — here */ const x = 1;')).not.toMatch(DASHES);
    expect(codeOnly('// a dash — here')).not.toMatch(DASHES);
  });
});
