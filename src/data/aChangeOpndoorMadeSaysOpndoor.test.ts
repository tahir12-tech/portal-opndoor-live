/* =====================================================================
   "BY OPNDOOR", NEVER WHICH OF US -- THE EDGE-FUNCTION HALF.

   Matt (bm), verbatim: "Customer-facing emails and screens: when Opndoor
   staff make a change (start date, withdrawal, anything), say 'by
   opndoor', never the staff member's name. Check every email template
   and activity line shown to agency and supplier users."

   The SQL half -- mark_withdrawn and decline_application -- is asserted
   against dev in a_change_opndoor_made_says_opndoor.test.sql. What is
   left is two Deno functions, which cannot be executed here, so they are
   read.

   =====================================================================
   WHAT THE SWEEP FOUND, WHICH IS MORE THAN THE ITEM ASKED ABOUT
   =====================================================================

   1. THE START DATE, which is the case Matt names. amend-tenancy-start
      resolves `actor` once from the caller's full_name, and that one
      value reaches FIVE customer-facing sentences: two activity
      messages, the activity rows' own actor column, the "corrected deed
      sent (by X)" line through deliverSigningInvite, and the referrer's
      "the tenancy start date has changed ... by X" email. Fixing it at
      the source is one change; fixing it at the five is five chances to
      miss one.

   2. THE TWO-FACTOR RESET EMAIL, which was wrong in a second way nobody
      had asked about. It said "<name> at opndoor has reset the
      two-factor authentication on your account" -- but
      authorise_mfa_reset_notice admits an admin OR the party's OWN
      management, so most of these are sent because an agency Director
      reset their own negotiator, and the email told the negotiator their
      Director worked for opndoor. Sweeping for the staff name is how the
      misattribution turned up.

   AND NOT FOR A CUSTOMER'S OWN PEOPLE, which is the half an eager fix
   gets wrong: an agency Manager amending their own referral is still
   named, because that is a colleague and the agency has every reason to
   know. Both functions ask is_opndoor_staff() rather than comparing role
   strings, so neither can drift from the definition the rest of the
   product authorises with.
   ===================================================================== */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('a start-date amendment', () => {
  const SRC = read('supabase/functions/amend-tenancy-start/index.ts');

  it('says "opndoor" when one of us made it', () => {
    expect(SRC).toContain('const { data: isStaff } = await userClient.rpc("is_opndoor_staff");');
    expect(SRC).toContain('actor = "opndoor";');
  });

  /* THE CUSTOMER'S OWN NAME SURVIVES. Deleting the full_name read
     altogether would have passed the assertion above and taken an
     agency's own manager off their own amendment. */
  it('and still names a customer who made it themselves', () => {
    expect(SRC).toContain('if (prof?.full_name) actor = prof.full_name;');
  });

  /* ONE SOURCE, FIVE SENTENCES. If a later change stops routing them
     through `actor`, this is the assertion that notices. */
  it('through the one value every sentence is built from', () => {
    expect(SRC).toContain('by ${actor}');
    expect(SRC).toContain('by: actor');
    expect(SRC).toContain('{ reissue: true, by: actor }');
  });
});

describe('the two-factor reset email', () => {
  const TPL = read('supabase/functions/_shared/emailTemplates.ts');
  const FN = read('supabase/functions/send-mfa-reset-notice/index.ts');

  it('no longer calls the reader’s own Director "at opndoor"', () => {
    expect(TPL).not.toContain('at opndoor has reset the two-factor');
  });

  it('says opndoor for us and the person for their own management', () => {
    expect(TPL).toContain('const didIt = p.byOpndoor ? "opndoor" : who;');
    expect(TPL).toContain('${didIt} has reset the two-factor authentication on your account.');
  });

  /* THE FLAG HAS TO BE ANSWERED BY THE CALLER, and answered about the
     CALLER: asked with the service key it would answer for nobody. */
  it('and the caller is the one asked', () => {
    expect(FN).toContain('const { data: staff } = await asCaller.rpc("is_opndoor_staff");');
    expect(FN).toContain('twoFactorResetEmail({ actorName, byOpndoor })');
  });
});
