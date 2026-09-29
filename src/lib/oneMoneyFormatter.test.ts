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

/* AND ONE ROUNDER, WHICH IS THE OTHER HALF.
 *
 * gbpPence above turns a number into text. Inside the export builders the
 * money cells are NUMBERS -- a spreadsheet has to be able to sum them -- and
 * they are rounded to 2dp by `money()` in exportsService. There were two:
 * `money()` and `bxRound2`, the second used only by the bordereau, which is
 * the one document that leaves the building for an underwriter.
 *
 * They agreed. They agreed because they were written the same fortnight, not
 * because anything made them.
 */
describe('the 2dp rounder inside the export builders', () => {
  const EXPORTS = join(SRC, 'data', 'exportsService.ts');

  it('is declared exactly once', () => {
    /* COUNTING THE EXPRESSION, not matching a declaration. The obvious
       version -- a name followed by the rounding shape -- reaches across
       whatever sits between them, and here that is a `const MONEY` column
       type ten lines above `money()`, which it duly reported as a second
       rounder. The expression cannot be ambiguous about itself. */
    const src = code(EXPORTS);
    const rounding = [...src.matchAll(/Math\.round\([^;]{0,80}?\*\s*100\s*\)\s*\/\s*100/g)];
    expect(rounding).toHaveLength(1);
    expect(src).toMatch(/function money\(n: number\): number \{[\s\S]{0,120}Math\.round/);
  });

  /* THE RATCHET. A new export builder that nobody walks is a document whose
     money nothing checks, and the two that were missed -- the all-statements
     CSV and the bordereau -- were missed for exactly that reason: they were
     outside the loop rather than wrong. Naming is a weak check and it is
     deliberately weak; it makes the omission LOUD at the moment the builder
     is added, which is the only moment anybody is thinking about it. Same
     device as definerAllowlistCoverage.test.ts. */
  it('and every exported builder is named in the money walk', () => {
    const declared = [...code(EXPORTS).matchAll(/export function (build\w+)/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(6);
    const walk = readFileSync(join(SRC, 'data', 'exportMoney.test.ts'), 'utf8');
    const unwalked = declared.filter((n) => !walk.includes(n));
    expect(unwalked).toEqual([]);
  });
});
