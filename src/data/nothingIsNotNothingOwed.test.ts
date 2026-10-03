/* AN EMPTY MONEY CELL IS EMPTY, NOT ZERO.
 *
 * Matt, 2026-10-03: "an unfinished application with no rent given (e.g.
 * GR-20626) still shows £0.00 for Monthly rent, Share of rent, Guarantee fee
 * charged and Tenancy total fee. Leave all four blank until the tenant has
 * given a rent, whether the stored value is empty or zero."
 *
 * ALL FOUR WERE ALREADY BLANKED, which is why this was worth tracing rather
 * than patching. `exportsService` has passed `''` for them since 2026-10-02
 * -- `a.rent ? money(a.rent) : ''`, `unfinished ? '' : ...` -- and they still
 * printed £0.00, because the row builder did `Number(val)` and `Number('')`
 * is 0. A comment in that file had even noticed the symptom and worked around
 * it for one column instead of fixing it at the source.
 *
 * SO THE FIX IS IN THE TEMPLATE AND EVERY EXPORT GAINS IT, which is right: no
 * money column anywhere should turn "nothing" into "nothing owed". A reader
 * can sum £0.00; they cannot sum a blank, and that difference is the whole
 * point of the distinction.
 *
 * ZERO STILL PRINTS. "whether the stored value is empty or zero" is about the
 * SOURCE value being zero, not about a real zero becoming invisible: a fee
 * genuinely charged at £0.00 -- Letly's deal of nothing -- is a figure and
 * must show.
 */
import { describe, expect, it } from 'vitest';
import { buildBrandedSheet, type BrandedDoc } from './xlsxTemplate';

/* The template builds a worksheet object keyed by cell address; a numeric
   cell carries t:'n' and a value, a blank one carries t:'s' and ''. */
function cellsOf(doc: BrandedDoc): Record<string, { v: unknown; t: string }> {
  return buildBrandedSheet(doc) as unknown as Record<string, { v: unknown; t: string }>;
}

const doc = (rows: (string | number)[][]): BrandedDoc => ({
  reportName: 'Test',
  metaLine: 'meta',
  blocks: [{
    kind: 'table',
    columns: [{ header: 'Thing', type: 'text' }, { header: 'Amount', type: 'money' }],
    rows,
  }],
});

describe('a money column', () => {
  it('leaves an empty value empty, rather than turning it into zero', () => {
    const ws = cellsOf(doc([['No rent yet', '']]));
    const money = Object.entries(ws).find(([k, c]) => /^B/.test(k) && c.v === '');
    expect(money, 'no blank money cell was produced').toBeTruthy();
    expect(money![1].t).toBe('s');
  });

  /* THE HALF THAT MUST NOT MOVE. A fee genuinely charged at zero is a figure:
     Letly is on a deal of nothing and its statements say £0.00 on purpose. */
  it('but still prints a real zero, which is a figure and not an absence', () => {
    const ws = cellsOf(doc([['Charged nothing', 0]]));
    const zero = Object.entries(ws).find(([k, c]) => /^B/.test(k) && c.v === 0);
    expect(zero, 'a real zero was dropped').toBeTruthy();
    expect(zero![1].t).toBe('n');
  });

  it('and still prints an ordinary amount', () => {
    const ws = cellsOf(doc([['Charged', 2400]]));
    expect(Object.values(ws).some((c) => c.v === 2400 && c.t === 'n')).toBe(true);
  });
});

describe('the application export', () => {
  /* THE FOUR COLUMNS MATT NAMED still pass '' from exportsService; this
     records that the blanking lives there and the rendering lives in the
     template, so a future reader does not fix the same thing twice. */
  it('blanks the four columns at source, and the template keeps them blank', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const ex = readFileSync(join(process.cwd(), 'src/data/exportsService.ts'), 'utf8');
    expect(ex).toContain("a.rent ? money(a.rent) : ''");
    expect(ex).toContain("unfinished ? '' : money(feeBaseFor(a))");
    const tpl = readFileSync(join(process.cwd(), 'src/data/xlsxTemplate.ts'), 'utf8');
    expect(tpl).toContain('if (isBlank(val)) return emptyNumCell(fmtFor(col.type));');
  });
});
