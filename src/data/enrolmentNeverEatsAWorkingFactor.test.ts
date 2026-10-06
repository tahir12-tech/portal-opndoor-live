/* ENROLMENT NEVER DESTROYS A WORKING AUTHENTICATOR.
 *
 * Raised while reading this path for Matt's reset-two-factor report of
 * 2026-10-01. It is NOT that bug -- the reset itself is sound, see
 * a_reset_revokes_the_old_authenticator.test.sql -- but it is the same shape
 * of hazard and was one caller away from being real.
 *
 * `enrolTotp` cleared stale factors before enrolling, to dodge the duplicate
 * friendly-name collision that used to strand invitees. It cleared ALL of
 * them, verified ones included, on the strength of a comment: "enrolTotp is
 * only reached when the user has NO verified factor". Both callers do check
 * that first. A third, or a stale read of `hasVerifiedFactor` from a cached
 * session, would have had this silently unenrol somebody's working
 * authenticator -- locking them out of their own account, with no admin
 * action and nothing in any audit trail to say why.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listFactors = vi.fn();
const unenroll = vi.fn();
const enroll = vi.fn();

vi.mock('@/lib/supabase', () => ({
  SUPABASE_ENABLED: true,
  supabase: null,
  sb: () => ({ auth: { mfa: { listFactors, unenroll, enroll } } }),
}));

const { enrolTotp } = await import('./authService');

beforeEach(() => {
  listFactors.mockReset(); unenroll.mockReset(); enroll.mockReset();
  unenroll.mockResolvedValue({ error: null });
  enroll.mockResolvedValue({
    data: { id: 'new-factor', totp: { qr_code: '<svg/>', secret: 'NEWSECRET', uri: 'otpauth://totp/x' } },
    error: null,
  });
});
afterEach(() => { vi.clearAllMocks(); });

const factor = (id: string, status: string) => ({ id, status, friendly_name: id, factor_type: 'totp' });

describe('clearing the way for a new factor', () => {
  /* THE REASON THE CLEARING EXISTS: an abandoned attempt leaves an
     unverified factor whose empty friendly name collides with the next
     enrolment, and that used to strand invitees at the two-factor step. */
  it('removes an abandoned, unverified factor', async () => {
    listFactors.mockResolvedValue({ data: { totp: [factor('stale', 'unverified')] } });
    await enrolTotp();
    expect(unenroll).toHaveBeenCalledWith({ factorId: 'stale' });
  });

  /* AND NEVER A WORKING ONE. */
  it('but never a verified one, whatever the caller believed', async () => {
    listFactors.mockResolvedValue({ data: { totp: [factor('live', 'verified')] } });
    await enrolTotp();
    expect(unenroll).not.toHaveBeenCalled();
  });

  it('and clears only the stale half of a mixed set', async () => {
    listFactors.mockResolvedValue({
      data: { totp: [factor('live', 'verified'), factor('stale', 'unverified')] },
    });
    await enrolTotp();
    expect(unenroll).toHaveBeenCalledTimes(1);
    expect(unenroll).toHaveBeenCalledWith({ factorId: 'stale' });
  });

  /* AND IT STILL ENROLS, so the guard has not turned into a refusal: the
     collision it was written for is on the NAME, and the name is unique
     per attempt. */
  it('and goes on to enrol either way', async () => {
    listFactors.mockResolvedValue({ data: { totp: [factor('live', 'verified')] } });
    const r = await enrolTotp();
    expect(r.ok).toBe(true);
    expect(r.factorId).toBe('new-factor');
  });

  /* THE FACTOR VERIFIED IS THE ONE JUST CREATED, which is Matt's
     "enrolment must verify against the newly created factor only": the id
     handed back is enroll's, never one read off the existing list. */
  it('and hands back the NEW factor’s id, never an existing one', async () => {
    listFactors.mockResolvedValue({ data: { totp: [factor('live', 'verified')] } });
    const r = await enrolTotp();
    expect(r.factorId).not.toBe('live');
    expect(r.secret).toBe('NEWSECRET');
  });
});
