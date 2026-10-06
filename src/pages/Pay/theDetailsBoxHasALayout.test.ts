/* THE PAYMENT PAGE'S DETAILS BOX IS A LAYOUT, NOT A SPACE-BETWEEN.
 *
 * Matt (bh): 'the "Property" row has no gap between label and value and the
 * address wraps under the label. Give it the same layout as the other rows
 * (label left, value right-aligned, wrapping within its own column), on
 * desktop and mobile.'
 *
 * WHY ONLY THAT ROW LOOKED BROKEN, and why the fix is on the ROW rather than
 * on Property: Reference, Amount and the rest are short enough that two flex
 * items pushed to opposite edges read as a laid-out row. An address is not,
 * so it is the first content to reveal that there was no layout underneath.
 *
 * THE THREE THINGS THAT WERE MISSING are each load-bearing. No `gap`, so the
 * two items met with nothing between them. Nothing saying which takes the
 * slack, so the value had no column. And `min-width: auto` -- the flexbox
 * default -- means a flex item cannot shrink below its longest word, which
 * is what turned "wrap" into "overflow and run back under the label".
 *
 * A CSS TEST, because the bug is in the stylesheet and jsdom computes no
 * layout: rendering the component would prove the markup, which was never
 * the problem.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CSS = readFileSync(resolve(process.cwd(), 'src/pages/Pay/Pay.css'), 'utf8');
const rule = (sel: string) => {
  const i = CSS.indexOf(sel + ' {');
  expect(i, `${sel} is missing`).toBeGreaterThan(-1);
  return CSS.slice(i, CSS.indexOf('}', i));
};

describe('the details row', () => {
  it('separates the label from the value', () => {
    expect(rule('.pay__rrow')).toMatch(/gap:\s*\d+px/);
  });

  it('lets the label keep its own width, whatever the screen', () => {
    expect(rule('.pay__rk')).toContain('flex: 0 0 auto');
    // No fixed width: "on desktop and mobile" rules one out.
    expect(rule('.pay__rk')).not.toMatch(/width:\s*\d/);
  });

  it('gives the value a column of its own, right-aligned', () => {
    const v = rule('.pay__rv');
    expect(v).toContain('flex: 1 1 auto');
    expect(v).toContain('text-align: right');
  });

  /* THE ONE THAT ACTUALLY FIXES IT. Without min-width: 0 a flex item will
     not shrink below its longest word, so the value overflows instead of
     wrapping and the overflow lands back under the label. */
  it('and may actually shrink, which is what makes it wrap', () => {
    const v = rule('.pay__rv');
    expect(v).toContain('min-width: 0');
    expect(v).toContain('overflow-wrap: anywhere');
  });
});
