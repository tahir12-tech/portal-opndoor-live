/* A STATEMENT REFERENCE IS A STRING, OR IT IS A STRING.
 *
 * Matt, 2026-10-04: "Look at the 10 unhandled errors in
 * agencyDashboard.render.test.tsx: tell me in plain English what they are and
 * whether they point at anything a real user could hit."
 *
 * WHAT THEY WERE. `statementReference` is typed `Promise<string>` and handled
 * the RPC's `error` channel, but let a THROW escape. CommissionStatement runs
 * it inside a `void (async () => ...)()` effect, where nothing can catch it,
 * so the rejection surfaced as an unhandled promise rejection. The dashboard
 * test forces that state deliberately by reporting SUPABASE_ENABLED as true
 * while making `sb()` throw.
 *
 * WHY IT IS WORTH A TEST RATHER THAN A SHRUG. The loop in that effect is
 * sequential and awaits each payee in turn, so one rejection skips the
 * reference for every payee after it. A missing reference is what
 * `isPostedReference` reads, so the rendered consequence is a POSTED
 * statement labelled "Draft: not yet posted, figures may change" on a money
 * surface. That the trigger was a test-only state does not make the
 * fragility test-only.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  SUPABASE_ENABLED: true,
  supabase: null,
  sb: () => { throw new Error('no client'); },
}));

import {
  statementReference, isPostedReference, draftLabel, referenceClause,
  isUnreadableReference, REFERENCE_UNREADABLE, DRAFT_NOT_POSTED,
} from './exportsService';

describe('statementReference when the client is unusable', () => {
  /* RESOLVES. The assertion is the absence of a rejection as much as the
     value, so it is written as a resolution rather than a try/catch. */
  it('resolves rather than rejecting', async () => {
    await expect(statementReference('2026-08', 'p|partner:p')).resolves.toBeTypeOf('string');
  });

  /* RETARGETED BY THE NEXT INSTRUCTION, and the reversal is the point.

     This asserted `'-'`, on the reasoning that "two kinds of not-knowing
     should not render differently". Matt's answer was that they are not two
     kinds of the same thing at all: "nothing to show" and "we could not find
     out" are different facts, and only the first is a draft. So the failure
     now has its own sentinel and the assertion says which it is NOT, since
     the positive form is covered below. */
  it('and no longer borrows the empty sentinel', async () => {
    expect(await statementReference('2026-08', 'p|partner:p')).not.toBe('-');
  });

  /* NOT POSTED, because we did not find out that it was. */
  it('and what it returns does not read as posted', async () => {
    const ref = await statementReference('2026-08', 'p|partner:p');
    expect(isPostedReference(ref)).toBe(false);
  });
});

/* =====================================================================
   AND IT IS NOT A DRAFT EITHER.

   Matt, 2026-10-04: "When a statement's reference can't be read, don't label
   it a draft. Show 'Reference couldn't be loaded. Refresh to try again.' in
   place of the reference and status, and log it to Health."

   THIS FILE USED TO ASSERT THE OPPOSITE, two commits ago, under the heading
   "not-knowing is not posted, which is the safe way round". It was wrong in
   the way a safe-looking default usually is: a failed read says nothing
   about whether the statement went out, and "Draft: not yet posted" asserts
   that it did not. Safe in direction, false in content, on a money surface.
   ===================================================================== */
describe('an unreadable reference is a third state', () => {
  it('is its own sentinel, not the empty one', async () => {
    expect(await statementReference('2026-08', 'p|partner:p')).toBe(REFERENCE_UNREADABLE);
    expect(isUnreadableReference(REFERENCE_UNREADABLE)).toBe(true);
  });

  it('and says so in Matt\u2019s words', () => {
    expect(REFERENCE_UNREADABLE).toBe("Reference couldn't be loaded. Refresh to try again.");
  });

  /* THE INSTRUCTION ITSELF. */
  it('and carries no draft label', () => {
    expect(draftLabel('2026-08', REFERENCE_UNREADABLE)).toBeNull();
  });

  /* THE CONTRAST THAT MAKES THAT MEAN SOMETHING: a month that genuinely has
     no reference yet is still a draft, and must not have been quietened. */
  it('while a month with no reference yet is still a draft', () => {
    expect(draftLabel('2026-08', '-')).toBe(DRAFT_NOT_POSTED);
  });

  /* A PDF CANNOT BE REFRESHED. The documents get the same fact without an
     instruction their reader cannot carry out. */
  it('and a document says it without telling the reader to refresh', () => {
    const clause = referenceClause(REFERENCE_UNREADABLE);
    expect(clause).toBe('Reference unavailable');
    expect(clause).not.toMatch(/refresh/i);
  });
});
