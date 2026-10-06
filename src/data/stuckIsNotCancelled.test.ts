/* =====================================================================
   A CANCELLED GUARANTEE IS NOT STUCK, IT IS OVER.

   Matt (bp)(2): '"Stuck at Paid (awaiting deed)" says 15 while
   Reporting says 4 awaiting signature. Check what it counts; refunded
   and cancelled ones must not be included.'

   "CHECK WHAT IT COUNTS" FIRST, because the honest answer might have
   been that the two figures are not the same question and must stop
   reading as though they are. Measured on dev before changing
   anything:

     status paid, no deed, not refunded                      15
     ... and deed_state is not 'cancelled'                    4
     Reporting's "awaiting signature"                         4

   They are the same question. The eleven are deeds cancelled for a
   refund whose own `refunded_at` never landed, so the refund test
   alone did not catch them -- which is why the count drifted so far
   from the one beside it.

   WHY IT MATTERS MORE THAN A WRONG NUMBER. "Stuck" is a work queue.
   Every one of those eleven sends somebody to chase a deed that was
   deliberately ended, and the four that genuinely need chasing are
   hidden among them.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(process.cwd(), 'src/data/liveAnalytics.ts'), 'utf8');

/** The predicate as liveAggregate applies it. */
const isStuck = (a: { status: string; deedAt: unknown; refunded: boolean; deedState?: string | null }) =>
  a.status === 'paid' && !a.deedAt && !a.refunded && a.deedState !== 'cancelled';

describe('stuck at Paid', () => {
  it('counts one that really is waiting for a deed', () => {
    expect(isStuck({ status: 'paid', deedAt: null, refunded: false, deedState: 'awaiting_tenant' })).toBe(true);
  });

  /* THE ELEVEN. Cancelled, and NOT refunded as far as the row is
     concerned -- which is exactly why the existing refund test let
     them through. */
  it('but not a cancelled guarantee, even where the refund flag never landed', () => {
    expect(isStuck({ status: 'paid', deedAt: null, refunded: false, deedState: 'cancelled' })).toBe(false);
  });

  it('nor a refunded one, as before', () => {
    expect(isStuck({ status: 'paid', deedAt: null, refunded: true, deedState: 'awaiting_tenant' })).toBe(false);
  });

  it('nor one whose deed has issued', () => {
    expect(isStuck({ status: 'paid', deedAt: new Date(), refunded: false, deedState: 'executed' })).toBe(false);
  });

  /* A DEED STATE WE DO NOT RECOGNISE IS STILL STUCK. The failure
     direction matters on a work queue: an unknown state left OUT would
     silently drop real work, where leaving it in shows somebody a row
     they can dismiss. */
  it('and an unrecognised deed state stays in the queue', () => {
    expect(isStuck({ status: 'paid', deedAt: null, refunded: false, deedState: 'something_new' })).toBe(true);
    expect(isStuck({ status: 'paid', deedAt: null, refunded: false, deedState: null })).toBe(true);
  });

  it('and the aggregate applies this predicate', () => {
    expect(SRC).toContain("app.status === 'paid' && !app.deedAt && !app.refunded && app.deedState !== 'cancelled'");
  });
});
