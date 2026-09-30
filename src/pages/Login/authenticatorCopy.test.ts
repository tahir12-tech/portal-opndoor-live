/* WE NEVER SEND SOMEBODY TO A PAID APP FOR A STEP THEY CANNOT SKIP.

   Two-factor authentication is required on every sign in, so an invitee cannot
   reach the portal without an authenticator. The enrolment screen used to read
   "Scan this QR code with an authenticator app (Google Authenticator, 1Password,
   Authy)". 1Password is paid. A required security step must never be gated behind
   somebody buying software, and a person who does not already have an
   authenticator is exactly the person reading that line.

   So the copy names Google Authenticator, free on both stores, with links to
   both, and the Passwords app an iPhone already has.

   WHY THIS READS THE SOURCE rather than rendering it. The copy lives in two
   places that cannot import each other: the enrolment block (React) and the
   invite email (a Deno edge function, which vitest does not load). The rule is
   about what we ship in both, so the test reads both files. It is the only way one
   assertion can cover the pair, and the pair drifting is the actual risk: somebody
   fixes the screen and leaves the email recommending a paid app.

   AND THE DRIFT ALREADY HAPPENED, on the third surface this did not know about.
   There are TWO screens that enrol a factor: the sign-in page and the invite
   landing (ResetPassword), which is the first thing a brand new person ever sees.
   This file asserted the sign-in page only, so the invite landing sat
   recommending 1Password for months while these assertions passed.

   The copy is now one component, AuthenticatorAppHelp, and the two screens are
   asserted to USE it rather than to contain the words. That is the assertion that
   would have caught it: a third enrolment screen that writes its own copy fails
   here, where a fourth file full of the right words would not.

   The enrolment screen's BEHAVIOUR is covered separately; this is about the words. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const BLOCK = read('src/components/auth/AuthenticatorAppHelp.tsx');
const EMAIL = read('supabase/functions/_shared/emailTemplates.ts');
/** Every screen that enrols a factor. Both must use the shared block. */
const ENROL_SCREENS = [
  'src/pages/Login/Login.tsx',
  'src/pages/auth/ResetPassword.tsx',
];

const APP_STORE = 'https://apps.apple.com/app/google-authenticator/id388497605';
const GOOGLE_PLAY = 'https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2';

/** Authenticators that cost money, or whose authenticator is a paid tier. Naming
    any of these in this copy is the defect. */
const PAID = ['1Password', 'LastPass', 'Dashlane', 'Keeper', 'RoboForm', 'NordPass'];

/** The only surface that may be affected is the copy, so compare on the file
    minus its comments: this test's own explanation names 1Password, and so does
    the note in the screen recording what was removed. */
function copyOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');
}

describe('the authenticator copy on the enrolment screen', () => {
  const copy = copyOnly(BLOCK);

  it('says an authenticator is needed and that Google Authenticator is free', () => {
    expect(copy).toContain('You need an authenticator app. Google Authenticator is free:');
  });

  it('links both stores', () => {
    expect(copy).toContain(APP_STORE);
    expect(copy).toContain(GOOGLE_PLAY);
  });

  it('mentions the app an iPhone already has', () => {
    expect(copy).toMatch(/On an iPhone, the built-in Passwords app works too\./);
  });

  it('names no paid app', () => {
    for (const app of PAID) expect(copy).not.toContain(app);
  });

  /* THE ASSERTION THAT WOULD HAVE CAUGHT THE DRIFT. Both enrolment screens must
     render the shared block rather than their own words, and neither may name a
     paid app anywhere in its own source. */
  it('is used by every screen that enrols a factor, not written out again', () => {
    for (const path of ENROL_SCREENS) {
      const src = read(path);
      expect(src, `${path} does not render the shared block`).toContain('<AuthenticatorAppHelp />');
      expect(src, `${path} writes its own copy instead of using the block`)
        .not.toContain('You need an authenticator app. Google Authenticator is free:');
    }
  });

  it('leaves no paid app named on either enrolment screen', () => {
    for (const path of ENROL_SCREENS) {
      const src = copyOnly(read(path));
      for (const app of PAID) expect(src, `${path} names ${app}`).not.toContain(app);
    }
  });
});

describe('the same copy in the invite email', () => {
  const copy = copyOnly(EMAIL);

  /* WALK FIX 32 merged two sentences into one. This asserted the second of
     them word for word -- "You need an authenticator app. Google
     Authenticator is free:" -- which followed "You will need an
     authenticator app" four lines above it and was the duplication Matt
     reported. The PROPERTY is that the email tells somebody they need one
     and names a free one, which is what it asserts now; the exact sentence
     was never the point. */
  it('says the same thing, because the invite arrives before the screen does', () => {
    expect(copy).toMatch(/need an authenticator app/i);
    expect(copy).toContain('Google Authenticator is free:');
    expect(copy).toMatch(/On an iPhone, the built-in Passwords app works too\./);
  });

  /* AND SAYS IT ONCE. The merge is the fix, so the count is the assertion. */
  it('and says it once rather than twice', () => {
    expect((copy.match(/authenticator app/gi) ?? []).length).toBe(1);
  });

  it('carries both store links', () => {
    expect(copy).toContain(APP_STORE);
    expect(copy).toContain(GOOGLE_PLAY);
  });

  /* WALK FIX 31 REVERSED THE REASONING HERE, so the assertion is inverted
     rather than deleted.

     It used to require the URL to BE the link text: renderText stripped
     tags and substituted nothing, so an anchor reading "App Store" would
     have left a text-only reader the words and not the address. True at the
     time, and it produced the two things Matt reported -- the address
     printed twice in the HTML, and (because rich()'s href pattern could not
     match a URL containing o, u or t) the whole tag arriving as escaped
     text.

     renderText prints "label: address" for an anchor now, so the plain-text
     reader keeps the URL and the HTML reader gets one clean link. The
     requirement is therefore the opposite: the link text must be the STORE
     NAME, not the address. Asserted in behaviour, not in source text, by
     inviteEmailReadsAsEnglish.test.ts. */
  it('uses the store name as the link text, not the address', () => {
    expect(copy).toContain('>App Store</a>');
    expect(copy).toContain('>Google Play</a>');
    expect(copy).not.toContain('${APP_STORE_GA}</a>');
    expect(copy).not.toContain('${GOOGLE_PLAY_GA}</a>');
  });

  it('names no paid app', () => {
    for (const app of PAID) expect(copy).not.toContain(app);
  });
});
