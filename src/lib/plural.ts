/* =====================================================================
   ONE PLACE THAT KNOWS HOW TO COUNT THINGS.

   Matt, 2026-10-01, verbatim: "Use singular and plural correctly
   everywhere counts are shown (1 referral, 2 referrals; 1 branch, 2
   branches; 1 person, 2 people), with a shared helper and a check."

   THE HELPER AND THE CHECK ARE BOTH THE INSTRUCTION. The helper so
   there is one place; the check so the next hand-rolled `s` is caught
   on the way in rather than found on a screen. `theCountsReadAsEnglish
   .test.ts` is the check, and it reads the source.

   =====================================================================
   WHY `name + 's'` IS NOT ENOUGH, which is the whole reason for a file
   =====================================================================

   Matt's three examples are three different rules and he picked them
   that way:

     referral -> referrals    the easy one
     branch   -> branches     a sibilant takes -es, not -s
     person   -> people       no rule reaches this at all

   Thirty call sites were each solving whichever of the three they
   happened to need, and the ones solving it with `=== 1 ? '' : 's'`
   were right until the noun changed under them. A "1 branchs" is one
   careless edit away from any of them.

   SO THE PLURAL IS DERIVED, AND OVERRIDABLE. The rules below cover the
   regular English cases; anything they cannot reach is in IRREGULAR or
   is passed explicitly. A caller that passes both words is always
   obeyed: this file is a convenience, never an authority on somebody
   else's noun.
   ===================================================================== */

/** Plurals no rule produces. Keyed on the lower-cased singular. */
const IRREGULAR: Record<string, string> = {
  person: 'people',
  // Deliberately here rather than left to the -y rule, which would give
  // "pennies" -- correct for coins, wrong for an amount of money.
  penny: 'pence',
};

/** Nouns that are already their own plural, so a rule must not touch them. */
const UNCHANGED = new Set(['data', 'staff']);

const ENDS_SIBILANT = /(s|x|z|ch|sh)$/i;
const ENDS_CONSONANT_Y = /[^aeiou]y$/i;

/**
 * The plural of one English noun.
 *
 * Case is preserved on the first letter, so "Branch" gives "Branches"
 * rather than "branches": several call sites start a sentence with the
 * count's noun and would otherwise have to re-capitalise it by hand,
 * which is the class of thing this file exists to stop.
 */
export function pluralOf(singular: string): string {
  const s = singular.trim();
  if (!s) return s;
  const lower = s.toLowerCase();
  const keep = (word: string) => (s[0] === s[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word);
  if (UNCHANGED.has(lower)) return s;
  if (IRREGULAR[lower]) return keep(IRREGULAR[lower]);
  if (ENDS_CONSONANT_Y.test(s)) return `${s.slice(0, -1)}ies`;
  if (ENDS_SIBILANT.test(s)) return `${s}es`;
  return `${s}s`;
}

/**
 * The right form of a noun for this many of them. ZERO IS PLURAL, which
 * is English and not an oversight: "0 referrals", never "0 referral".
 */
export function plural(n: number, singular: string, many?: string): string {
  return n === 1 ? singular : (many ?? pluralOf(singular));
}

/**
 * The count and its noun together: `countOf(1, 'referral')` is
 * "1 referral", `countOf(2, 'branch')` is "2 branches".
 *
 * THE FORM MOST CALL SITES WANT, and the reason it exists beside
 * `plural` is that the number and the word are one thing on the screen:
 * a site that writes `{n} {plural(n, 'branch')}` can still put the
 * wrong number in front of the right word. There is nothing to get
 * wrong here.
 *
 * Grouped with separators, because these are counts people read:
 * "1,284 referrals", not "1284 referrals".
 */
export function countOf(n: number, singular: string, many?: string): string {
  return `${n.toLocaleString('en-GB')} ${plural(n, singular, many)}`;
}
