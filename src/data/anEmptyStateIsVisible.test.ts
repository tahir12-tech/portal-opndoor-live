/* AN EMPTY STATE THAT IS INVISIBLE IS NOT AN EMPTY STATE.
 *
 * Found by the audit on NM-N, in code I had written the same morning.
 * `NotInNetwork.tsx` rendered `<div className="empty">No direct tenant has
 * named an agency we do not work with...</div>` and it displayed nothing at
 * all, because the shared rule is:
 *
 *     .empty          { display: none; ... }
 *     .empty.is-shown { display: block; }
 *
 * The class is invisible BY DEFAULT and the modifier is what shows it. Every
 * other caller in the product knew that -- four of them build the class as
 * `empty${cond ? ' is-shown' : ''}` and one writes `empty is-shown`
 * outright -- and the two lines I added did not.
 *
 * WHY THIS IS A SOURCE LINT AND NOT A RENDER TEST. jsdom does not load the
 * stylesheet, so `getComputedStyle` on a rendered `.empty` reports nothing
 * about `display: none` and a render test CANNOT see this defect. That is
 * exactly why it shipped past a suite of 1500: the element was in the DOM,
 * with the right text in it, and invisible to the user. A test asserting
 * `container.textContent` contains the message would have passed while the
 * screen was blank.
 *
 * SO THE TEST READS THE CSS AND THE TSX TOGETHER. It finds every class whose
 * stylesheet rule hides it by default and requires a `.is-shown` companion,
 * then requires every JSX use of that class to mention `is-shown` somewhere
 * in the same expression. That is a weak check on its own -- it cannot tell
 * whether the CONDITION is right -- but it catches the whole of the failure
 * mode that bit here, which is forgetting the modifier exists.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(SRC);
const cssFiles = files.filter((f) => f.endsWith('.css'));
const tsxFiles = files.filter((f) => f.endsWith('.tsx') && !f.includes('.test.'));

/**
 * Classes the stylesheets hide by default and reveal with `.is-shown`.
 *
 * Derived from the CSS rather than listed here, so a sixth one added later
 * is covered without anybody remembering to come back.
 */
const hiddenByDefault = (() => {
  const css = cssFiles.map((f) => readFileSync(f, 'utf8')).join('\n');
  const names = new Set<string>();
  // `.x.is-shown { ... }` tells us `.x` is a hide-by-default class.
  for (const m of css.matchAll(/\.([a-zA-Z0-9_-]+)\.is-shown\s*\{/g)) {
    const cls = m[1];
    // Confirm the bare rule really does hide it, so a decorative
    // `.x.is-shown` modifier is not swept in.
    const bare = new RegExp(`\\.${cls}\\s*\\{[^}]*display:\\s*none`, 's');
    if (bare.test(css)) names.add(cls);
  }
  return names;
})();

describe('the hide-by-default classes', () => {
  /* IF THIS FINDS NOTHING the lint below is vacuous and would pass on a
     product that had reintroduced the bug everywhere. */
  it('are found in the stylesheets, so the lint below is not vacuous', () => {
    expect(hiddenByDefault.size).toBeGreaterThan(0);
    expect([...hiddenByDefault]).toContain('empty');
  });
});

describe('every use of one in JSX', () => {
  it('mentions is-shown, or it renders nothing at all', () => {
    const offences: string[] = [];
    for (const f of tsxFiles) {
      const src = readFileSync(f, 'utf8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        // Only the className attribute, in either of its two forms.
        for (const m of line.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
          const value = m[1] ?? m[2] ?? '';
          // The class must appear as a whole word, not as part of another.
          const used = [...hiddenByDefault].filter((c) => new RegExp(`(^|[\\s$\`{])${c}(?![a-zA-Z0-9_-])`).test(value));
          if (used.length === 0) continue;
          if (value.includes('is-shown')) continue;
          // A commented-out line is not a use.
          if (line.trimStart().startsWith('//')) continue;
          offences.push(`${f.replace(process.cwd() + '/', '')}:${i + 1}  ${used.join(', ')}  ->  ${line.trim().slice(0, 110)}`);
        }
      });
    }
    expect(offences, `these render nothing:\n${offences.join('\n')}`).toEqual([]);
  });
});
