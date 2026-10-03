/* THE AGENT GETS THE CORRECTED DEED, AUTOMATICALLY.
 *
 * Matt, 2026-10-03, pulling it to the front of the queue: "the corrected-deed
 * blocker (the agent doesn't receive the corrected signed deed after a
 * start-date correction)". And, the day before: "pressing 'Resend deed'
 * manually sends the correct corrected deed (29 Dec, '1 of 2 signed'), so the
 * document is right and only the automatic send on signing is blocked as a
 * 'replay'."
 *
 * =====================================================================
 * THE ACTIVITY LOG FOR GR-23853, WHICH IS THE WHOLE DIAGNOSIS
 * =====================================================================
 *
 *   01 Oct 20:21:35  deed_signed
 *   01 Oct 20:21:39  deed_delivered     to joe@joe.com, automatic
 *   01 Oct 20:25:32  tenancy_correction_applied   19/10/2026 -> 29/12/2026
 *   03 Oct 11:28:43  deed_signed        the CORRECTED deed
 *   03 Oct 11:28:44  deed_delivered     "Completion replayed; the signed
 *                                        deed already went to joe..."
 *   03 Oct 11:30:33  deed_delivered     sent by Nicholas Dwyer, manually
 *
 * 20261007350000 already knew a corrected deed is a new deed. It asked:
 *
 *     deed_delivered_at is not null and not (deed_issued_at > deed_delivered_at)
 *
 * `deed_issued_at` is when the deed was EXECUTED, and the completion handler
 * WRITES it -- while `app` was read at the top of that same handler. So the
 * value under test was the row as it stood before this completion: nulled by
 * the correction, or the previous signing four seconds before the previous
 * delivery. Either way "not reissued", and the corrected deed was refused.
 *
 * The rule was right. The fact it asked was written by the thing asking.
 *
 * AND THE CORRECTION NEVER CLEARED THE DELIVERY. Both correction paths reset
 * deed_issued_at, deed_executed_at, executed_pdf_path, pandadoc_document_id
 * and deed_viewed_at, and neither touched deed_delivered_at -- so the row went
 * on claiming a delivery of a PDF it had just archived.
 *
 * THE FIX IS TO STOP COMPARING TIMESTAMPS WRITTEN BY DIFFERENT HANDLERS. A
 * correction moves the delivery into deed_delivery_superseded_at/_to
 * (20261007640000), and "has the current deed been delivered" becomes one
 * column with one answer and no window between a write and a read.
 *
 * WHY THESE ARE SOURCE ASSERTIONS. The three changed files are Deno edge
 * functions; Deno is not installed here, so they are syntax-checked with
 * esbuild and cannot be executed by vitest. What can be pinned is the shape
 * of the thing that was wrong: a reset that forgets a column, and a guard
 * that compares two. Both are read off the source. The database half --
 * that `send_deed_to_agent` still refuses a genuine duplicate -- is covered
 * by one_delivery_per_signed_deed.test.sql, which is unchanged and passing.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const CORRECTION_PATHS = [
  'supabase/functions/tenancy-correction/index.ts',
  'supabase/functions/amend-tenancy-start/index.ts',
];

describe('every path that archives and reissues a deed', () => {
  /* BOTH, because there are two and the first fix of this family went into
     one of them. A correction reachable from the agent's link and a
     correction reachable from the admin screen must leave the same row. */
  it('moves the old delivery aside rather than leaving it on the row', () => {
    for (const p of CORRECTION_PATHS) {
      const src = read(p);
      expect(src, `${p}: does not record the superseded delivery`)
        .toContain('deed_delivery_superseded_at: app.deed_delivered_at');
      expect(src, `${p}: does not clear the current delivery`)
        .toContain('deed_delivered_at: null, deed_delivered_to: null, deed_resent_at: null,');
    }
  });

  /* A COLUMN THE UPDATE NAMES AND THE SELECT OMITS READS AS UNDEFINED, which
     PostgREST writes as null -- so the superseded delivery would be silently
     lost by the very statement meant to keep it. The reset and the select
     have to agree, and nothing in the type system makes them. */
  it('and selects the columns it moves, so none of them reads as undefined', () => {
    for (const p of CORRECTION_PATHS) {
      const src = read(p);
      expect(src, `${p}: reset references columns the select does not fetch`)
        .toContain('deed_delivered_at, deed_delivered_to, deed_delivery_superseded_at, deed_delivery_superseded_to');
    }
  });
});

describe('the completion handler', () => {
  const SRC = read('supabase/functions/pandadoc-webhook/index.ts');

  it('asks one column, not a comparison across two', () => {
    expect(SRC).toContain('} else if (deliverable && mayEmail && app.deed_delivered_at) {');
  });

  /* THE EXACT EXPRESSION THAT WAS WRONG, named so it cannot come back by
     someone restoring "the reissue check" without knowing why it went. */
  it('and no longer tests deed_issued_at against deed_delivered_at', () => {
    expect(SRC).not.toContain('new Date(app.deed_issued_at) > new Date(app.deed_delivered_at)');
  });

  /* THE HALF THAT MUST NOT MOVE. A genuine PandaDoc redelivery of the same
     completion is still refused: that was Matt's original report on GR-20846,
     two copies of one deed two minutes apart, and this change must not undo
     it. The guard is still there and still reached. */
  it('while a real replay of the same deed is still refused', () => {
    expect(SRC).toContain('Completion replayed');
  });
});
