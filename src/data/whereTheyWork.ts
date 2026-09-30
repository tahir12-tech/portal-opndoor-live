/* =====================================================================
   WHERE A REFERRER WORKS, said differently to different readers.

   Walk fix 21: "the line under each name shows their level (Negotiator,
   Director), which is irrelevant. Show where they work instead, depending on
   who's looking: Opndoor admin sees agency and branch; an agency with more
   than one branch sees the branch; a single-branch agency sees just the
   name, nothing underneath. Same rule anywhere else referrers are listed
   (League, exports)."

   A FUNCTION OF THE READER AND THE PERSON, not a field on either. The same
   referrer's line differs by who has the page open, which is why it cannot
   be computed once and stored on the row.

   ITS OWN FILE because Matt's last sentence is "same rule anywhere else
   referrers are listed": the dashboard chart, League and the exports each
   build their rows separately, and a rule copied into three of them is
   three rules.
   ===================================================================== */

/** Who is reading, as far as this line is concerned.
 *
 *  Three readers and not a role: an agency Director and an agency Negotiator
 *  read the same line, and what separates the two agency cases is the SHAPE
 *  of the agency rather than anybody's permissions. */
export type WhereReader = 'opndoor' | 'multi-branch' | 'one-branch';

export interface WhereTheyWork {
  reader: WhereReader;
  /** The distinct agencies this person's referrals came from. Usually one. */
  agencies: string[];
  /** The distinct branches. Usually one. */
  branches: string[];
}

const clean = (xs: string[]): string[] =>
  [...new Set(xs.map((x) => (x ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

/**
 * The line to print under a referrer's name, or '' for no line at all.
 *
 * MORE THAN ONE PLACE IS PRINTED AS MORE THAN ONE PLACE. Somebody who moved
 * office has referrals from both, and picking one would state as a fact
 * something that is half wrong. Both is the truth and is short.
 *
 * AND NOTHING IS PRINTED RATHER THAN PUNCTUATION. A missing agency must not
 * leave a comma with nothing on one side of it.
 */
export function whereTheyWork({ reader, agencies, branches }: WhereTheyWork): string {
  const br = clean(branches);
  // A single-branch agency: every row would say the same thing, which is the
  // definition of a line worth removing. The same reasoning that took the
  // level off.
  if (reader === 'one-branch') return '';
  if (reader === 'multi-branch') return br.join(', ');
  // An admin's list spans agencies, so the agency is the half that
  // disambiguates and is never dropped.
  return [...clean(agencies), ...br].join(', ');
}
