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

import { statementReference, isPostedReference, draftLabel } from './exportsService';

describe('statementReference when the client is unusable', () => {
  /* RESOLVES. The assertion is the absence of a rejection as much as the
     value, so it is written as a resolution rather than a try/catch. */
  it('resolves rather than rejecting', async () => {
    await expect(statementReference('2026-08', 'p|partner:p')).resolves.toBeTypeOf('string');
  });

  /* THE SAME ANSWER THE ERROR CHANNEL ALREADY GAVE. Two kinds of not-knowing
     should not render differently, and this one was previously a crash. */
  it('and gives the same answer an RPC error already gave', async () => {
    expect(await statementReference('2026-08', 'p|partner:p')).toBe('-');
  });

  /* AND NOT-KNOWING IS NOT POSTED, which is the safe way round: a statement
     whose reference could not be read is shown as a draft rather than
     asserted to have been posted. */
  it('and what it returns does not read as posted', async () => {
    const ref = await statementReference('2026-08', 'p|partner:p');
    expect(isPostedReference(ref)).toBe(false);
    expect(draftLabel('2026-08', ref)).toBeTruthy();
  });
});
