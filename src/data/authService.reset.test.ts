/* authService.requestPasswordReset, WITHOUT mocking the thing under test.

   WHY THIS EXISTS. The first test written for this fix asserted that the page
   shows a failure on the staff path, but it did so by mocking
   requestPasswordReset itself. Reverting the function to its old
   `try { ... } catch {}` returning { ok: true } would have left that test green
   while Agent and Supplier went back to silently promising an email. A test
   that mocks the module it protects is protecting nothing.

   So this mocks only the Supabase client underneath and drives the real
   function. What it pins down is the split: whether an ACCOUNT EXISTS stays
   invisible, because the function answers ok for a hit and a miss alike, while
   a send we failed to make is reported. */
import { describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@/lib/supabase', () => ({
  SUPABASE_ENABLED: true,
  sb: () => ({ functions: { invoke } }),
}));

const { requestPasswordReset } = await import('./authService');

/* NO beforeEach HOOK, DELIBERATELY. Clearing this mock's call record between
   cases (mockReset or mockClear, either one) makes vitest report the rejected
   promise in the last case as an UNHANDLED rejection and fail the test, even
   though its assertions pass and the code caught the error correctly. Bisected
   against a copy of this file with the hook removed, which passes. Every case
   sets its own implementation, so there is nothing the hook was needed for, and
   the one case that cares about call count counts locally. */

describe('requestPasswordReset reports a failed send', () => {
  it('resolves when the function answers ok, whether or not the address exists', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(requestPasswordReset('anyone@example.invalid')).resolves.toEqual({ ok: true });
  });

  it('rejects when the invoke itself errored', async () => {
    // supabase-js turns any non-2xx into this, which is what the new 503 is.
    invoke.mockResolvedValue({ data: null, error: new Error('non-2xx status code') });
    await expect(requestPasswordReset('someone@example.invalid')).rejects.toThrow(/could not send/i);
  });

  it('rejects when the body says ok:false, and uses the reason it was given', async () => {
    invoke.mockResolvedValue({ data: { ok: false, error: 'Email is not configured here.' }, error: null });
    await expect(requestPasswordReset('someone@example.invalid'))
      .rejects.toThrow('Email is not configured here.');
  });

  it('never swallows: a rejection reaches the caller rather than becoming ok', async () => {
    // The exact regression. The old body was try/catch{} then `return {ok:true}`.
    let calls = 0;
    invoke.mockImplementation(() => {
      calls++;
      return Promise.reject(new Error('network down'));
    });
    let message = 'NOTHING WAS THROWN';
    try {
      await requestPasswordReset('someone@example.invalid');
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    // The old body returned { ok: true } here and told the user an email was
    // coming. Anything other than a throw is that regression.
    expect(calls).toBe(1);
    expect(message).toBe('network down');
  });
});
