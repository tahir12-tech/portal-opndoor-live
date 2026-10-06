/* NO BARE TEXT BOX ANYWHERE A PERSON TYPES.
 *
 * Matt, 2026-10-01, verbatim: "Every bare text box in the admin screens
 * (the supplier 'Monthly statement addresses' inputs, the Origin filter
 * on Applications and League, and any others) gets the same styled input
 * as the rest of the portal: rounded border, padding, label above,
 * matching the commission fields on the same page. Sweep the whole admin
 * for unstyled inputs and fix them all."
 *
 * "AND ANY OTHERS" IS A SWEEP, and a sweep done once by eye is undone by
 * the next person who adds a form. This is the same shape as the em-dash
 * check he asked for a fortnight ago and for the same reason: a rule
 * somebody has to remember is a rule that holds until somebody is busy.
 *
 * =====================================================================
 * WHAT COUNTS AS STYLED
 * =====================================================================
 *
 * Three house patterns, and an input must be in one of them:
 *
 *   .field      a label above and the portal's bordered box. The form
 *               pattern, and what "matching the commission fields" means.
 *   .inp        the same box without the label, for the places a label
 *               above would be noise: a cell in a table whose COLUMN
 *               HEADING is already the label, and the share boxes on a
 *               joint tenancy.
 *   a styled wrapper, which is how every search box in the portal works:
 *               a pill with a magnifier, the input borderless inside it.
 *
 * THE THIRD ONE IS WHY THIS TEST READS THE CSS. My first pass flagged
 * nineteen inputs and several were perfectly fine: `.org-search` styles
 * the pill and leaves the input bare ON PURPOSE. Restyling those would
 * have put a border inside a border. So a wrapper counts when its own
 * rule sets a border, padding or a radius, whoever it sets it on.
 *
 * AND IT STRIPS COMMENTS FIRST, because the first pass also flagged a
 * commented-out search box in OrgManagement that has not rendered for
 * months.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p, out); continue; }
    if (p.endsWith('.tsx') && !p.includes('.test.')) out.push(p);
  }
  return out;
}

/** Every class whose own CSS gives it the look of a box. */
function styledClasses(): Set<string> {
  const css = [resolve(ROOT, 'src')].flatMap(function cssIn(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) return cssIn(p);
      return p.endsWith('.css') ? [readFileSync(p, 'utf8')] : [];
    });
  }).join('\n');
  const out = new Set<string>();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/\b(border|padding|border-radius)\s*:/.test(m[2])) continue;
    for (const c of m[1].matchAll(/\.([A-Za-z0-9_-]+)/g)) out.add(c[1]);
  }
  return out;
}

const stripComments = (src: string) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/^\s*\/\/.*$/gm, ' ');

/** Controls that are not text boxes and have their own look. */
const NOT_A_TEXT_BOX = /type=["']?\{?["']?(checkbox|radio|hidden|file|range|submit|button)/;

/* A FILE WHOSE CONTROLS ARE WRAPPED AFTER THEY ARE BUILT.
 *
 * The scan reads BACKWARDS from an input for its wrapper, which is how
 * JSX is normally written. FieldInput builds the control into a variable
 * and returns `<Field ...>{control}</Field>` at the bottom, so its
 * wrapper is three hundred lines BELOW the input and no amount of
 * look-back will find it. Verified by reading it: every branch ends at
 * one of those two returns, so every control it makes is inside a Field.
 *
 * Named rather than pattern-matched, because "there is a <Field> at the
 * end of the file" would excuse any file that happened to contain one. */
const WRAPPED_LATER = new Set(['src/pages/Apply/FieldInput.tsx']);

function bareInputs(): string[] {
  const styled = styledClasses();
  const out: string[] = [];
  for (const f of [...walk(resolve(ROOT, 'src/pages')), ...walk(resolve(ROOT, 'src/components'))]) {
    if (WRAPPED_LATER.has(relative(ROOT, f))) continue;
    const src = stripComments(readFileSync(f, 'utf8'));
    for (const m of src.matchAll(/<(input|textarea)\b/g)) {
      const seg = src.slice(m.index!, m.index! + 500);
      if (NOT_A_TEXT_BOX.test(seg.slice(0, 300))) continue;
      /* The nearest few wrappers, plus the input's own class. 1200
         characters is enough for a <Field> two or three elements up and
         short enough not to pick up an unrelated card above. */
      const before = src.slice(Math.max(0, m.index! - 1200), m.index!);
      const names = [...before.matchAll(/className=["']([^"']+)["']|<(Field)\b/g)]
        .map((w) => w[1] ?? w[2]).slice(-4).join(' ').split(/\s+/);
      const own = seg.slice(0, 300).match(/className=["']([^"']+)["']/);
      if (own) names.push(...own[1].split(/\s+/));
      if (names.some((n) => n.toLowerCase().includes('field') || n === 'inp')) continue;
      if (names.some((n) => styled.has(n))) continue;
      const line = src.slice(0, m.index!).split('\n').length;
      out.push(`${relative(ROOT, f)}:${line}`);
    }
  }
  return out;
}

describe('every text box a person types in is a styled one', () => {
  /* A GUARD ON THE SWEEP ITSELF, the same one the em-dash check has. If
     the scan stops finding inputs at all, the assertion below passes by
     testing nothing. */
  it('found the forms to check', () => {
    expect(styledClasses().size).toBeGreaterThan(50);
    expect(walk(resolve(ROOT, 'src/pages')).length).toBeGreaterThan(20);
  });

  it('and none of them is bare', () => {
    expect(bareInputs()).toEqual([]);
  });

  /* THE CHECK CAN FAIL, which is worth proving: three of the patterns it
     accepts are broad, and a scan that accepted everything would pass
     this file for ever. */
  it('and the check would catch one if it were there', () => {
    const styled = styledClasses();
    expect(styled.has('inp'), 'the shared input class lost its styling').toBe(true);
    expect(styled.has('definitely-not-a-real-class')).toBe(false);
  });

  /* AND THE ONE EXEMPTION IS STILL TRUE. A file on the list that stopped
     wrapping its controls would be exempt from the check for ever, which
     is the failure mode of every allowlist. */
  it('and the one file it excuses really does wrap its controls', () => {
    for (const f of WRAPPED_LATER) {
      const src = readFileSync(resolve(ROOT, f), 'utf8');
      expect(src, `${f} no longer wraps anything in <Field>`).toMatch(/<Field[\s\S]{0,200}>\{control\}<\/Field>/);
    }
  });
});
