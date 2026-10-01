/* =====================================================================
   HOW A PERSON IS NAMED ON SCREEN WHEN THEY HAVE NOT TOLD US THEIR NAME.

   Matt, 2026-10-01: "When someone has no name yet, show the email once
   with 'Name not set' beneath, not the email twice. I invited
   barb@barb.com with the name 'barb barb' but she shows by email: check
   invite names are saved on every invite form and fix it."

   TWO FAULTS, ONE SENTENCE. The second is the invite, fixed where the
   name is composed. The first is here: every people list wrote
   `{u.name || u.email}` above `{u.email}`, so a person with no name
   appeared as their address twice, in two sizes.

   AND A ROW NAMED AFTER ITS OWN EMAIL IS THE SAME CASE. invite-user used
   to fall back to the email when no name was given, so there are rows in
   the database whose full_name IS their address -- barb@barb.com is one.
   They are not named, whatever the column says, and "the name happens to
   be the email" is not a state worth distinguishing on screen.

   Returning `unnamed` rather than a formatted string, because the three
   callers draw it differently: a table has two lines, a card has one,
   and an avatar needs initials that do not read "BA" from "barb@".
   ===================================================================== */

export interface PersonLabel {
  /** The line that leads: their name, or their email if we have none. */
  title: string;
  /** The line under it: their email, or the fact that we have no name. */
  sub: string;
  /** True when we do not know their name. */
  unnamed: boolean;
}

export function personLabel(name: string | null | undefined, email: string | null | undefined): PersonLabel {
  const n = (name ?? '').trim();
  const e = (email ?? '').trim();
  const named = n !== '' && n.toLowerCase() !== e.toLowerCase();
  if (named) return { title: n, sub: e, unnamed: false };
  /* No email either is a row that should not exist, and a blank cell is
     worse than a word: say what is missing rather than nothing at all. */
  return { title: e || 'Unknown', sub: 'Name not set', unnamed: true };
}

/**
 * Up to two initials for an avatar.
 *
 * From the NAME where there is one. From the local part of the email where
 * there is not, split on the punctuation people put in addresses, so
 * `rosa.vance@` reads RV and `barb@` reads B rather than BA, which looks
 * like a surname nobody has.
 */
export function personInitials(label: PersonLabel): string {
  const source = label.unnamed ? label.title.split('@')[0] : label.title;
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}
