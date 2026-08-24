/* =====================================================================
   What /login and /forgot-password carry between them.

   ONE PLACE, because the link is BUILT on one page and READ on the other. Two
   copies of "the parameter is called email and it is URL encoded" is two
   chances to disagree, and the disagreement is silent: the link still works,
   the field is just empty again, which reads as the feature never having been
   built rather than as a bug.

   WHAT IS CARRIED. The tab, so an agent who clicks "Forgot password?" lands on
   Agent. The email, so nobody retypes the address they typed ten seconds ago.
   Both directions: "Back to sign in" carries them home again.

   WHY THE QUERY STRING. Because /login and /forgot-password already seed their
   tab from ?tab=, and the staff form already passed ?email=. An address in a
   URL does reach browser history and any access log in front of this, which is
   the cost of a link somebody can be sent. It buys nothing an attacker did not
   already have: prefilling a sign-in field discloses nothing and still needs
   the password.
   ===================================================================== */

export type Audience = 'tenant' | 'agent' | 'supplier';

/** The RFC 5321 maximum. A hostile link cannot stuff the field with a novel. */
const MAX_EMAIL = 254;

/** The address carried from the other page, or '' when there is not one. */
export function carriedEmail(params: URLSearchParams): string {
  return (params.get('email') ?? '').trim().slice(0, MAX_EMAIL);
}

/** The audience carried from the other page, or null when there is not one.
    Null rather than a default: the two pages disagree about what the default
    is, deliberately, and this must not decide that for them. */
export function carriedTab(params: URLSearchParams): Audience | null {
  const t = params.get('tab');
  return t === 'tenant' || t === 'agent' || t === 'supplier' ? t : null;
}

function href(path: string, audience: Audience, email: string): string {
  const p = new URLSearchParams({ tab: audience });
  const e = email.trim().slice(0, MAX_EMAIL);
  if (e) p.set('email', e);
  return `${path}?${p}`;
}

/** /forgot-password, holding on to who they are and what they typed. */
export const forgotHref = (audience: Audience, email: string) =>
  href('/forgot-password', audience, email);

/** /login, the same journey in reverse. */
export const signInHref = (audience: Audience, email: string) =>
  href('/login', audience, email);
