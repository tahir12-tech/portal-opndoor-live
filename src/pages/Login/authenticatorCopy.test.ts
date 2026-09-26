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
   places that cannot import each other: the enrolment screen (React) and the
   invite email (a Deno edge function, which vitest does not load). The rule is
   about what we ship in both, so the test reads both files. It is the only way one
   assertion can cover the pair, and the pair drifting is the actual risk: somebody
   fixes the screen and leaves the email recommending a paid app.

   The enrolment screen's BEHAVIOUR is covered separately; this is about the words. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const SCREEN = read('src/pages/Login/Login.tsx');
const EMAIL = read('supabase/functions/_shared/emailTemplates.ts');

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
  const copy = copyOnly(SCREEN);

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
});

describe('the same copy in the invite email', () => {
  const copy = copyOnly(EMAIL);

  it('says the same thing, because the invite arrives before the screen does', () => {
    expect(copy).toContain('You need an authenticator app. Google Authenticator is free:');
    expect(copy).toMatch(/On an iPhone, the built-in Passwords app works too\./);
  });

  it('carries both store links', () => {
    expect(copy).toContain(APP_STORE);
    expect(copy).toContain(GOOGLE_PLAY);
  });

  /* renderText strips tags to build the plain-text half of every email and
     substitutes nothing, so an anchor reading "App Store" would leave a text-only
     reader the words and not the address. The URL has to be the link text. */
  it('puts the URL in the link text, so the plain-text email keeps it', () => {
    // The anchor text is the SAME constant as the href, so stripping the tag
    // leaves the address rather than the words "App Store".
    expect(copy).toContain('${APP_STORE_GA}</a>');
    expect(copy).toContain('${GOOGLE_PLAY_GA}</a>');
  });

  it('names no paid app', () => {
    for (const app of PAID) expect(copy).not.toContain(app);
  });
});
