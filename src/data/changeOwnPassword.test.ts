/* THE FOUR REFUSALS, EACH WITH ITS OWN SENTENCE.
 *
 * Matt, 2026-10-13: "Find the actual error ... and make the dialog show a
 * specific message for each case: wrong current password, new password
 * doesn't meet the rules (say which), same as the old one, and session needs
 * re-signing in."
 *
 * THE CODES BELOW WERE READ OFF DEV, by driving each refusal for real against
 * nfufwcpgrhfgwtphegca rather than by guessing at GoTrue's vocabulary:
 *
 *   invalid_credentials  the current password is not theirs
 *   weak_password        "Password should be at least 6 characters."
 *   same_password        "New password should be different from the old password."
 *   session_not_found    "Session from session_id claim in JWT does not exist"
 *
 * The mapping is on the CODE, not the message: a message is prose and changes
 * between releases. The one exception is the rules case, where GoTrue's own
 * sentence is passed through, because the policy lives on the project and only
 * that sentence knows which rule was broken.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateUser = vi.fn();
const getUser = vi.fn();
const probeSignIn = vi.fn();
const probeSignOut = vi.fn();

vi.mock('@/lib/supabase', () => ({
  SUPABASE_ENABLED: true,
  sb: () => ({ auth: { getUser: () => getUser(), updateUser: (a: unknown) => updateUser(a) } }),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: (a: unknown) => probeSignIn(a),
      signOut: (a: unknown) => probeSignOut(a),
    },
  }),
}));

const { changeOwnPassword } = await import('./authService');

const err = (code: string, message: string) => ({ error: { code, message } });

beforeEach(() => {
  updateUser.mockReset(); getUser.mockReset(); probeSignIn.mockReset(); probeSignOut.mockReset();
  getUser.mockResolvedValue({ data: { user: { email: 'rosa@regent.test' } } });
  probeSignIn.mockResolvedValue({ error: null });
  probeSignOut.mockResolvedValue({ error: null });
  updateUser.mockResolvedValue({ error: null });
});
afterEach(() => vi.clearAllMocks());

describe('the happy path', () => {
  it('verifies the current password, then changes it', async () => {
    const r = await changeOwnPassword('theoldone', 'longenough1');
    expect(r).toEqual({ ok: true });
    expect(probeSignIn).toHaveBeenCalledWith({ email: 'rosa@regent.test', password: 'theoldone' });
    expect(updateUser).toHaveBeenCalledWith({ password: 'longenough1' });
  });

  /* THE ORDER MATTERS: a wrong current password must cost nothing. */
  it('and does not touch updateUser when the current password is wrong', async () => {
    probeSignIn.mockResolvedValue(err('invalid_credentials', 'Invalid login credentials'));
    await changeOwnPassword('wrong', 'longenough1');
    expect(updateUser).not.toHaveBeenCalled();
  });

  /* THE BUG MATT REPORTED, pinned on the call itself. signOut() defaults to
     scope 'global', which revokes every session the user has including their
     own; measured on dev as 200 then 403. */
  it('and signs the probe out with the local scope, never the default', async () => {
    await changeOwnPassword('theoldone', 'longenough1');
    expect(probeSignOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(probeSignOut).not.toHaveBeenCalledWith();
    expect(probeSignOut).not.toHaveBeenCalledWith({ scope: 'global' });
  });
});

describe('Matt’s four cases', () => {
  it('1. wrong current password says so, and nothing else', async () => {
    probeSignIn.mockResolvedValue(err('invalid_credentials', 'Invalid login credentials'));
    const r = await changeOwnPassword('wrong', 'longenough1');
    expect(r.problem).toBe('wrong_current');
    expect(r.error).toBe('That is not your current password.');
  });

  /* 2. AND IT SAYS WHICH RULE. GoTrue's own sentence names it, and it has to:
     the policy is a project setting, so a sentence hardcoded here would be
     wrong the day somebody raises the minimum or turns on the breach check. */
  it('2. a rejected password passes GoTrue’s own reason through', async () => {
    updateUser.mockResolvedValue(err('weak_password', 'Password should be at least 10 characters.'));
    const r = await changeOwnPassword('theoldone', 'longenough1');
    expect(r.problem).toBe('rejected');
    expect(r.error).toBe('Password should be at least 10 characters.');
  });

  it('2b. including a breached one, which is a different rule and says so', async () => {
    updateUser.mockResolvedValue(err('weak_password', 'This password has been found in a data breach.'));
    const r = await changeOwnPassword('theoldone', 'longenough1');
    expect(r.problem).toBe('rejected');
    expect(r.error).toContain('data breach');
  });

  it('3. the same password as before says that, not "rejected"', async () => {
    updateUser.mockResolvedValue(err('same_password', 'New password should be different from the old password.'));
    const r = await changeOwnPassword('theoldone', 'longenough1');
    expect(r.problem).toBe('same_as_old');
    expect(r.error).toBe('That is the password you already have. Choose a different one.');
  });

  it.each([
    ['session_not_found', 'Session from session_id claim in JWT does not exist'],
    ['session_expired', 'Session has expired'],
    ['insufficient_aal', 'AAL2 required'],
    ['reauthentication_needed', 'A nonce is required'],
  ])('4. a session that cannot be used (%s) asks for a fresh sign-in', async (code, message) => {
    updateUser.mockResolvedValue(err(code, message));
    const r = await changeOwnPassword('theoldone', 'longenough1');
    expect(r.problem).toBe('needs_sign_in');
    expect(r.error).toBe('Your session has expired. Sign in again, then change your password.');
  });
});

describe('the edges', () => {
  it('refuses fewer than 8 characters without calling anything', async () => {
    const r = await changeOwnPassword('theoldone', 'short');
    expect(r.problem).toBe('rejected');
    expect(r.error).toBe('Use at least 8 characters.');
    expect(probeSignIn).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('says so when there is no session to read an email off', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const r = await changeOwnPassword('theoldone', 'longenough1');
    expect(r.problem).toBe('not_signed_in');
  });

  /* A THROTTLE IS NOT A WRONG PASSWORD. Telling somebody their own password is
     wrong when the server simply refused to look is how an afternoon is lost,
     and a sign-in attempt IS rate limited -- which is a property worth having
     here, because the threat is an unattended tab guessing. */
  it('and tells a throttled attempt apart from a wrong password', async () => {
    probeSignIn.mockResolvedValue(err('over_request_rate_limit', 'Request rate limit reached'));
    const r = await changeOwnPassword('theoldone', 'longenough1');
    expect(r.problem).toBe('failed');
    expect(r.error).toContain('Too many attempts');
    expect(updateUser).not.toHaveBeenCalled();
  });

  /* AND AN UNRECOGNISED FAILURE CARRIES ITS REAL MESSAGE. The generic
     sentence on its own is what hid this bug for a day. */
  it('and reports anything else as itself', async () => {
    updateUser.mockResolvedValue(err('unexpected_failure', 'Database error updating user'));
    const r = await changeOwnPassword('theoldone', 'longenough1');
    expect(r.problem).toBe('failed');
    expect(r.error).toBe('We could not change your password: Database error updating user');
  });
});
