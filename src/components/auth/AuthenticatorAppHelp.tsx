/* =====================================================================
   WHERE TO GET AN AUTHENTICATOR, said the same way everywhere it is said.

   There are two screens that enrol a factor, and they are not the same screen:

     Login          a returning user who has no factor yet
     ResetPassword  the INVITE landing, which is the first thing a brand new
                    person ever sees of the portal

   The second matters more and had the worse copy. It read "(Google
   Authenticator, 1Password, Authy)", and 1Password is paid: a required security
   step must never be gated behind somebody buying software. Login had been
   corrected for that months earlier and this screen was missed, which is exactly
   what happens to copy that exists twice.

   So it exists once. The store links were already constants in Login for the
   same reason, with a comment asking whoever changes them to change the invite
   email too; that comment now has one fewer place to be forgotten.

   THE INVITE EMAIL IS THE THIRD PLACE AND CANNOT IMPORT THIS. It runs on Deno
   (supabase/functions/_shared/emailTemplates.ts, staffInviteEmail), so its copy
   is necessarily a separate string. If the words here change, change that too.
   ===================================================================== */

/** Google Authenticator, the free authenticator we point people at. Both are the
    vendor's own store pages. */
export const APP_STORE_GA = 'https://apps.apple.com/app/google-authenticator/id388497605';
export const GOOGLE_PLAY_GA = 'https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2';

/**
 * The block that sits above the QR code.
 *
 * ONLY FREE APPS ARE NAMED. Google Authenticator is free on both stores and an
 * iPhone already has one built in, so between them nobody has to spend anything
 * to sign in.
 *
 * The links open in a new tab deliberately: navigating away from an enrol step
 * abandons the enrolment, and the unverified factor it started with it, which is
 * the state enrolTotp then has to clean up.
 *
 * The cloud-backup line is here rather than on a settings page because enrolment
 * is the only moment it can be acted on cheaply. Losing a phone with no backup
 * costs an admin reset and a fresh enrolment; one tap now avoids it.
 */
export function AuthenticatorAppHelp() {
  return (
    <p className="auth__apps">
      You need an authenticator app. Google Authenticator is free:{' '}
      <a className="auth__app-link" href={APP_STORE_GA} target="_blank" rel="noreferrer">App Store</a>
      <span aria-hidden="true"> · </span>
      <a className="auth__app-link" href={GOOGLE_PLAY_GA} target="_blank" rel="noreferrer">Google Play</a>
      <br />
      On an iPhone, the built-in Passwords app works too.
      <br />
      Turn on your authenticator app's cloud backup, so a new phone keeps your codes.
    </p>
  );
}
