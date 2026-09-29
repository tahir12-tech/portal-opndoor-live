/* EVERY MONEY FIGURE COMES FROM ONE FORMATTER.
 *
 * Fold F1: "Monthly trend prints pence like everything else (Sep showed
 * £4,431.00 against £4,430.77 elsewhere); assert every money figure in an
 * export comes from one formatter."
 *
 * The defect is not a wrong number. It is two right numbers that disagree,
 * which is worse, because a reader reconciling a settlement against an export
 * cannot tell which to trust and neither looks broken on its own.
 *
 * `gbpPence` had three character-identical definitions -- Dashboard.tsx,
 * FinanceSurfaces.tsx and SettlementBlocks.tsx -- on three surfaces that
 * print the SAME settlement figures. They agreed by coincidence. This makes
 * them agree by construction.
 *
 * WHY A SOURCE LINT RATHER THAN A UNIT TEST. A unit test on the one function
 * proves the survivor is right and says nothing about a fourth copy appearing
 * next week, which is the actual failure mode: nobody writes a second
 * formatter on purpose, they write one because they did not know the first
 * existed.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gbpPence } from './format';

const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) ? [p] : [];
  });
}
const FILES = walk(SRC);

/* Comments quote the old shape to explain the fix, so an unstripped scan
   flags the explanation as the defect. The same trap migrationPatterns.ts and
   credentialsAreNotAcceptedFromCallers.ts both document. */
const code = (p: string) => readFileSync(p, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const rel = (p: string) => p.slice(process.cwd().length + 1);

describe('the penny formatter', () => {
  it('is defined exactly once, in src/lib/format.ts', () => {
    const definers = FILES.filter((f) => /\b(const|function)\s+gbpPence\b/.test(code(f)));
    expect(definers.map(rel)).toEqual(['src/lib/format.ts']);
  });

  /* THE SHAPE, not the name. Renaming a second copy would slip past the
     assertion above, so this looks for the literal toLocaleString options
     that make a figure print to the penny, wherever they appear. */
  it('and nothing else hand-rolls the same two-decimal sterling string', () => {
    const shape = /minimumFractionDigits:\s*2[\s\S]{0,40}maximumFractionDigits:\s*2/;
    const offenders = FILES
      .filter((f) => shape.test(code(f)))
      .map(rel)
      .filter((f) => f !== 'src/lib/format.ts');
    expect(offenders).toEqual([]);
  });

  it('prints pence, which is the whole point of it', () => {
    // 4430.77 is the figure from the defect: the trend said £4,431.00.
    expect(gbpPence(4430.77)).toBe('£4,430.77');
    expect(gbpPence(4431)).toBe('£4,431.00');
    expect(gbpPence(0)).toBe('£0.00');
  });

  it('and the scan reaches real files, so an empty pass is not a broken walk', () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(FILES.some((f) => rel(f) === 'src/components/SettlementBlocks.tsx')).toBe(true);
  });
});
