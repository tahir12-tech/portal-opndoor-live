/* THE ORIGIN A LINK IS BUILT ON IS OURS, OR THERE IS NO LINK.
 *
 * Every function that emails somebody a link builds it on an origin. If that
 * origin can come from the request, then whoever makes the request chooses
 * where a genuine Opndoor-branded email points -- a password reset, an
 * invitation, a payment page.
 *
 * APP_URL is the answer. The only concession is localhost, because a
 * developer with no APP_URL set still has to be able to click the link they
 * just generated, and a localhost URL is useless to an attacker: it resolves
 * to the victim's own machine.
 *
 * AND NULL IS A REAL ANSWER. When APP_URL is unset and the caller is not on
 * localhost this returns null and the caller sends NOTHING. A reset email
 * nobody can use is better than one somebody else can. That reasoning is
 * tenant-auth's, where this function was written; it is here so the other
 * senders share it rather than each keeping their own slightly different
 * version -- which is how create-referral ended up preferring the caller's
 * origin outright (round 7 backlog M1).
 */
export function safeOrigin(supplied: unknown): string | null {
  const configured = (Deno.env.get("APP_URL") ?? "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  const raw = String(supplied ?? "").trim().replace(/\/+$/, "");
  try {
    const u = new URL(raw);
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return `${u.protocol}//${u.host}`;
  } catch { /* not a URL: refuse */ }
  return null;
}
