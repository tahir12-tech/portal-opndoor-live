/* THE TENANT IS NOT COVERED UNTIL THEY SIGN, AND THE EMAIL SAYS SO.
 *
 * Matt, 2026-10-03: "Tenant 'ready to sign' email (including resends): don't
 * say 'Your guarantee is in place' before the deed is signed; say 'Your
 * guarantee fee is paid and your Deed of Guarantee is ready to sign. Signing
 * puts your guarantee in place.' If the deed was reissued after a start-date
 * correction, say so: 'This replaces your earlier deed; the tenancy start is
 * now 29 December 2026.' Use the same header as the other tenant emails."
 *
 * THE OLD SENTENCE TOLD THE TENANT THEY WERE COVERED while asking them to do
 * the thing that covers them: "Your guarantee is in place and the Deed of
 * Guarantee is ready for your signature. Signing is the last step." It is the
 * one line in this email that could cost somebody a tenancy, and a tenant who
 * believed it had no reason to hurry.
 *
 * AND THE HEADER WAS THE WRONG PRODUCT. `audience` defaults to "portal", and
 * this message never set it, so the only email in the tenant's journey that
 * came from `pandadoc.ts` rather than `emailTemplates.ts` was headed
 * GUARANTEE REFERRAL PORTAL -- a product the tenant has never heard of --
 * while every other message they get says GUARANTOR APPLICATION.
 *
 * SOURCE ASSERTIONS, because these are Deno edge functions: Deno is not
 * installed here, so they are syntax-checked with esbuild and cannot be
 * executed by vitest. What is pinned is the wording, the header and the fact
 * that the correction sentence is conditional rather than always sent.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const PANDADOC = read('supabase/functions/_shared/pandadoc.ts');
const RESEND = read('supabase/functions/pandadoc-resend/index.ts');

describe('the ready-to-sign email', () => {
  it('says the fee is paid and signing is what puts the guarantee in place', () => {
    expect(PANDADOC).toContain(
      'Your guarantee fee is paid and your Deed of Guarantee is ready to sign. Signing puts your guarantee in place.',
    );
  });

  /* THE EXACT SENTENCE THAT WAS WRONG, named so it cannot come back by
     someone restoring "the friendlier opening". */
  it('and never claims the guarantee is already in place', () => {
    expect(PANDADOC).not.toContain('Your guarantee is in place and the Deed of Guarantee is ready for your signature');
  });

  it('and is headed as a tenant email, like the rest of their journey', () => {
    const fn = PANDADOC.slice(PANDADOC.indexOf('async function emailSigningLink'));
    expect(fn.slice(0, fn.indexOf('\n}'))).toContain('audience: "tenant"');
  });
});

describe('when a correction replaced the deed', () => {
  it('the email says so, in Matt’s words and his date format', () => {
    expect(PANDADOC).toContain('This replaces your earlier deed; the tenancy start is now ${longDate(');
  });

  /* CONDITIONAL, not always. A tenant whose deed was never corrected must not
     be told their earlier deed has been replaced; there was no earlier deed. */
  it('and only then', () => {
    expect(PANDADOC).toContain('...(ctx.replacesEarlierDeed');
  });

  /* "29 December 2026", not "29 Dec 2026". The short form beside it is for
     the deed and the expiries file, where a column has to stay narrow. */
  it('and spells the month, which the short formatter beside it does not', () => {
    expect(PANDADOC).toContain('function longDate(iso: string): string {');
    expect(PANDADOC).toContain('"July", "August", "September", "October", "November", "December"');
  });
});

describe('how the resend knows it was a correction', () => {
  /* THE ACTIVITY LOG, WHICH IS WHERE THE FACT ALREADY IS. The delivery
     columns cannot answer it: `deed_delivery_superseded_at` is only set when
     there was a delivery to supersede, and a deed corrected while still
     unsigned never had one -- which is exactly the case Matt reported. */
  it('reads the correction event rather than the delivery columns', () => {
    expect(RESEND).toContain(".eq(\"kind\", \"tenancy_correction_applied\")");
    expect(RESEND).toContain('replacesEarlierDeed,');
  });

  /* AND IT STILL CARRIES, THROUGH A DIFFERENT DOOR. Rewritten 2026-10-04.
     This used to assert `tenancyStart: app.tenancy_start` on the
     remindSignature call, which was how the corrected date reached
     PandaDoc's message. Matt (ai) moved the send to Opndoor, so there is no
     remindSignature call to inspect: `deliverSigningInvite` reads the date
     off the application itself, which is a strictly better place for it --
     the row cannot be stale by the time the email is built.

     WHAT MUST STILL HOLD is the fact underneath, and it is the same fact:
     the resend knows this is a correction, and the email says so with the
     corrected date on it. Asserted at both ends rather than on one call's
     argument list, because the argument list was the implementation and the
     two ends are the behaviour. */
  it('and the corrected date reaches the email, now read off the application', () => {
    // This end: the resend tells the invite it is a reissue.
    expect(RESEND).toContain('reissue: replacesEarlierDeed,');
    // The other end: the invite reads and spells the date itself.
    const INVITE = read('supabase/functions/_shared/signingInvite.ts');
    expect(INVITE).toContain('tenancy_start');
    expect(INVITE).toContain('spelledDate(app.tenancy_start)');
    expect(INVITE).toContain('reissue: opts.reissue === true');
  });
});
