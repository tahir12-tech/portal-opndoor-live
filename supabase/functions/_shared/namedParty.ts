/* WHICH PARTY DO WE NAME TO SOMEBODY OUTSIDE OPNDOOR?
 *
 * WALK FIX 33: "it says 'invited you to the portal for Opndoor Agents',
 * naming the hidden house account. It must name the agency or supplier the
 * person is joining (e.g. Regent's Lettings), and Opndoor staff invites
 * should say Opndoor."
 *
 * THE LEAK IS IN THE CALLER, NOT THE TEMPLATE. invite-user reads
 * `partners.name` for the invitee's partner and passes it straight through.
 * On the agency rail every agency is carried by the house partner
 * `opndoor-agents`, whose name is "Opndoor Agents" -- so every agency invite
 * named a company that does not exist outside our own schema. channel.ts
 * exists to stop exactly that surfacing, and this email was the one place
 * it still did.
 *
 * AND IT IS NOT ONLY THE INVITE. Checking "every other email for the house
 * account name", as item 33 asks, found the same leak on the tenant's
 * PAYMENT PAGE: `partnerRow?.name ?? "your letting agent"`, shown to a
 * tenant on the screen where they hand over a card. Hence the general name;
 * the two callers differ only in what they do with an empty answer.
 *
 * ITS OWN FILE for the same reason as invitePosition.ts: the edge functions
 * are Deno and `npm test` cannot collect them, but this file imports
 * nothing, so a vitest test in src/ can import it and assert the real logic
 * rather than grepping the source for it.
 */

/** The house / plumbing partners. Mirrored from src/data/channel.ts, which
 *  this file cannot import (different runtime). Stable slugs, set by
 *  migration. If one changes, change both. */
const HOUSE_SLUGS = ["opndoor-direct", "referencing-partner", "opndoor-agents"];

export interface PartyToName {
  /** The partner slug the row is carried on, or null for Opndoor's own staff. */
  partnerSlug: string | null;
  /** The partner record's name. Never printed for a house partner. */
  partnerName: string | null;
  /** The agency behind it, where one is known. */
  agencyName: string | null;
}

/**
 * The name to print, or '' for "we have no party to name".
 *
 * THREE CASES, AND THE EMPTY ONE IS A REAL ANSWER rather than a failure.
 * Somebody joining the Opndoor team is joining Opndoor, and "the opndoor
 * portal for opndoor" is not a sentence, so the invite drops the clause.
 * The payment page says "your letting agent". Each caller decides what an
 * empty answer reads as; what neither may do is fall back to the plumbing,
 * which is the bug.
 */
export function namedParty(p: PartyToName): string {
  const slug = (p.partnerSlug ?? "").trim();
  // Opndoor's own staff have no partner at all.
  if (!slug) return "";
  if (HOUSE_SLUGS.includes(slug)) {
    // The agency, or nothing. NEVER the house partner's own name.
    return (p.agencyName ?? "").trim();
  }
  // A real supplier is its own company and its name is the right one.
  return (p.partnerName ?? "").trim();
}
