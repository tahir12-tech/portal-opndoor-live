/* AN EXPORT EITHER DOWNLOADS OR SAYS WHY NOT.
 *
 * Matt, 2026-10-04: "Reporting -> Application export: pressing it does
 * nothing, with no download and no message. ... make any export that fails
 * show a clear message instead of doing nothing."
 *
 * TWO CAUSES, ONE SYMPTOM, AND THE FIRST WAS DELIBERATE. exportBranded
 * returned silently on a sheetless document -- "Refuse quietly, as the
 * comment always said" -- which was the right answer to a crash and the
 * wrong answer to a reader. And every caller wrote `void exportBranded(...)`,
 * so anything the function rejected with became an unhandled rejection and a
 * dead button too: the same defect as statementReference, on a second
 * surface.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ SUPABASE_ENABLED: false, supabase: null, sb: () => { throw new Error('x'); } }));

import { exportBranded } from './exportsService';

describe('exportBranded', () => {
  /* THE REFUSAL. A document with no sheets is a reader who may not have it,
     or a selection with nothing in it. Either way they get a sentence. */
  it('reports an empty document instead of returning silently', async () => {
    const out = await exportBranded({ sheets: [], filename: 'x.xlsx' });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toBe('empty');
    expect(out.ok === false && out.message).toMatch(/nothing to export/i);
  });

  /* NULL IS A REFUSAL TOO. buildApplicationDoc returns null for a reader who
     may not have the document, and the caller used to drop that on the floor
     with `if (built)`. */
  it('and treats a refused document the same way', async () => {
    const out = await exportBranded(null);
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.reason).toBe('empty');
  });

  /* IT NEVER REJECTS, which is what makes `void` at a call site safe and is
     the half that silenced a thrown workbook builder. Asserted as a
     resolution, because the absence of a rejection IS the fix. */
  it('resolves rather than rejecting, whatever it is given', async () => {
    await expect(exportBranded(null)).resolves.toBeTruthy();
    await expect(exportBranded({ sheets: [], filename: '' })).resolves.toBeTruthy();
  });

  /* THE MESSAGE IS FOR A READER, not a developer: it says what to do next
     and names no exception. */
  it('and its message tells the reader what to try', async () => {
    const out = await exportBranded(null);
    const msg = out.ok === false ? out.message : '';
    expect(msg).toMatch(/try a different period/i);
    expect(msg).not.toMatch(/undefined|null|Error|throw/);
  });
});
