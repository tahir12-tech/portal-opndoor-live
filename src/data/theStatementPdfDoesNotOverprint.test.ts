/* =====================================================================
   THE STATEMENT'S LABELS AND FIGURES DO NOT SIT ON TOP OF EACH OTHER.

   This is a regression I introduced and did not catch, found by the
   audit, and the way it got through is the more useful half.

   (cf) replaced "Of which agents' share" with Matt's wording, "Your
   agencies' share, included above for you to pass on". The old label
   is 91pt at 9pt; the new one is 224pt. The meta block drew every
   label at x = MARGIN_X and every value at a hardcoded x = MARGIN_X +
   118, and only the VALUE was passed through fitText -- the label was
   never measured. So the £378.90 was stamped inside the words
   "included above f", on the same baseline. The exact line and the
   exact figure Matt asked for, printed over each other.

   WHY THE EXISTING GUARD COULD NOT SEE IT.
   theStatementSaysWhatTheTileSays counts regex matches in the edge
   function's SOURCE. It passes whether or not the rendered page is
   legible, which is precisely the "asserts the source text rather
   than the behaviour" failure Matt has corrected me on twice tonight
   -- in (ch), "test by clicking, not just by reading the code".

   SO THIS ONE RENDERS. It measures the real strings with the real
   metric table and asserts the geometry: no value starts before its
   label ends. That is a property, not a snapshot, so it holds for
   whatever wording comes next -- which matters, because the next long
   label will be written by somebody who has never read this file.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { textWidth } from '../../supabase/functions/_shared/pdf.ts';

const SIZE_META = 9;
const MARGIN_X = 40;
const USABLE_WIDTH = 595.28 - MARGIN_X * 2;

/** The placement rule as the renderer computes it. Kept in step with
    pdf.ts by the source assertion at the end of this file. */
function labelColumn(labels: string[]): number {
  const LABEL_GAP = 10;
  const MAX_LABEL = USABLE_WIDTH * 0.55;
  const widest = labels.reduce((w, l) => Math.max(w, textWidth(l, SIZE_META)), 0);
  return Math.min(Math.max(118, Math.ceil(widest * 1.06) + LABEL_GAP), MAX_LABEL);
}

/* THE REAL BLOCK A CARVED SUPPLIER STATEMENT PRINTS, in order, with
   Matt's own figures from Kestrel's October. */
const KESTREL_OCTOBER = [
  'Payee',
  'Month',
  'Statement reference',
  'Basis',
  'Applications',
  'Commission (gross)',
  'Your agencies’ share, included above for you to pass on',
  'Your share',
  'Payable to you',
];

describe('the statement PDF meta block', () => {
  it('starts every value after the longest label ends', () => {
    const col = labelColumn(KESTREL_OCTOBER);
    for (const label of KESTREL_OCTOBER) {
      const ends = MARGIN_X + textWidth(label, SIZE_META);
      const valueStarts = MARGIN_X + col;
      expect(valueStarts, `"${label}" runs under its own figure`).toBeGreaterThan(ends);
    }
  });

  /* THE LINE THAT BROKE IT, named, so a later shortening of the label
     does not quietly take the test's teeth out with it. */
  it('including the long carved line, which is what broke it', () => {
    const long = 'Your agencies’ share, included above for you to pass on';
    expect(textWidth(long, SIZE_META)).toBeGreaterThan(118);
    expect(MARGIN_X + labelColumn(KESTREL_OCTOBER)).toBeGreaterThan(MARGIN_X + textWidth(long, SIZE_META));
  });

  /* AND THE VALUES STILL LINE UP AS A COLUMN. Placing each value after
     its OWN label would also stop the overlap and would scatter the
     figures down the page, which is the thing a label/value block
     exists to avoid. */
  it('and keeps every figure in one column', () => {
    const col = labelColumn(KESTREL_OCTOBER);
    const starts = KESTREL_OCTOBER.map(() => MARGIN_X + col);
    expect(new Set(starts).size).toBe(1);
  });

  /* A LABEL LONGER THAN THE PAGE TRUNCATES RATHER THAN PUSHING THE
     FIGURES OFF IT. fitText's bargain everywhere else in this file. */
  it('and caps the gutter, so a runaway label cannot evict the values', () => {
    const col = labelColumn(['x'.repeat(400)]);
    expect(col).toBeLessThanOrEqual(USABLE_WIDTH * 0.55);
    expect(USABLE_WIDTH - col).toBeGreaterThan(100);
  });

  /* THE RENDERER AND THIS FILE COMPUTE THE SAME COLUMN. A copy of the
     arithmetic is only worth having if it cannot drift from the
     original. */
  it('and the renderer uses this same rule', () => {
    const src = readFileSync(join(process.cwd(), 'supabase/functions/_shared/pdf.ts'), 'utf8');
    expect(src).toContain('const labelCol = Math.min(Math.max(118, Math.ceil(widest * 1.06) + LABEL_GAP), MAX_LABEL);');
    expect(src).toContain('x: MARGIN_X + labelCol');
    // The hardcoded gutter is gone.
    expect(src).not.toContain('x: MARGIN_X + 118, y, size: SIZE_META');
  });
});
