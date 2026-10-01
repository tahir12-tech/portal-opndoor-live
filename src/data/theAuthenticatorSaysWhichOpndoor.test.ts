/* THE AUTHENTICATOR ENTRY SAYS WHICH OPNDOOR IT IS FOR.
 *
 * Matt, 2026-10-01, verbatim: "Authenticator labels: on dev, the issuer shows
 * as 'opndoor DEV' so dev and live entries can't be confused. On live it
 * stays 'opndoor'."
 *
 * An entry is labelled issuer + account, and the account half is the person's
 * email -- the SAME email on both projects. So anybody holding an account on
 * dev and on live had two entries reading "opndoor (rosa@regents.co.uk)":
 * identical, six digits each, no way to tell which one the screen in front of
 * them wants. This came out of the reset-two-factor investigation, where an
 * old and a new entry being indistinguishable was the best remaining
 * explanation for the symptom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL = import.meta.env.VITE_SUPABASE_URL;
/** The dev project, which is the one in NON_PRODUCTION_REFS. */
const DEV = 'https://nfufwcpgrhfgwtphegca.supabase.co';
/** Live. Named here only as a URL; nothing in this file touches it. */
const LIVE = 'https://xogpsaoyprgmxdkmcype.supabase.co';

async function issuerFor(url: string): Promise<string> {
  vi.stubEnv('VITE_SUPABASE_URL', url);
  vi.resetModules();
  const { totpIssuer } = await import('./authService');
  return totpIssuer();
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllEnvs(); vi.stubEnv('VITE_SUPABASE_URL', ORIGINAL ?? ''); vi.resetModules(); });

describe('the issuer on the QR code', () => {
  it('says DEV on the development project', async () => {
    expect(await issuerFor(DEV)).toBe('opndoor DEV');
  });

  it('and plain opndoor on live', async () => {
    expect(await issuerFor(LIVE)).toBe('opndoor');
  });

  /* UNRECOGNISED MEANS PRODUCTION, which is the rule `portalEnvironment`
     already applies and the same direction the Stripe key guard takes. It
     is the right way round here too: the live entry is the one that must
     be labelled plainly, and a new preview project wrongly reading
     "opndoor" is a smaller fault than live reading "opndoor DEV" on a real
     customer's phone. */
  it('and plain opndoor for a project nobody has listed', async () => {
    expect(await issuerFor('https://abcdefghijklmnopqrst.supabase.co')).toBe('opndoor');
  });

  it('and for no URL at all', async () => {
    expect(await issuerFor('')).toBe('opndoor');
  });

  /* ONE PREDICATE, NOT TWO. If somebody later gives the authenticator its
     own idea of which environment this is, this fails: the issuer must
     move with `portalEnvironment`, which is what the banner and the Stripe
     guard also read. */
  it('and moves with the one environment predicate, not a copy of it', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', DEV);
    vi.resetModules();
    const { totpIssuer } = await import('./authService');
    const { portalEnvironment } = await import('./devCentreService');
    expect(portalEnvironment().id).toBe('development');
    expect(totpIssuer()).toContain('DEV');
  });
});
