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
import { showsOffices } from './agencyOffices';

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
  /** THE SUPPLIER THIS PERSON WORKS FOR, where they work for one.
   *
   *  Matt, 2026-10-03: "Reporting and League, referrer lists: a supplier's
   *  own staff are labelled with their supplier (e.g. 'Kestrel Lettings'),
   *  not with the agency or branch they last referred for."
   *
   *  A list and not a string for the same reason `agencies` is one: it is
   *  gathered across the person's rows, and a row whose users join RLS
   *  withheld contributes nothing rather than an empty name. */
  suppliers?: string[];
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
export function whereTheyWork({ reader, agencies, branches, suppliers }: WhereTheyWork): string {
  /* A SUPPLIER'S OWN STAFF ARE THEIR SUPPLIER'S, wherever they referred.
     Matt, 2026-10-03: Kestrel's own director referred for Frost
     Partnership, one of Kestrel's agencies, and the board labelled him
     "Frost Partnership, Frost Mayfair" -- the company whose tenant it was,
     not the company he works for. Two Kestrel people referring into two
     different agencies read as two strangers.

     FIRST, AND INSTEAD OF THE REST, because it answers the same question:
     adding the agency after it would print the place the referral went
     beside the company the person is from, and the reader has no way to
     tell which is which. The agency is on the row's own Agency column
     already, and on the Agencies board.

     AND IT IGNORES `reader`, including 'one-branch'. The three readers are
     a rule about OUR estate's offices -- a single-office agency gets no
     line because every row would say the same thing -- and a supplier's
     name is not an office. An agency reading a board that includes a
     supplier's staff still needs to know they are not theirs. */
  const sup = clean(suppliers ?? []);
  if (sup.length) return sup.join(', ');
  const br = clean(branches);
  // A single-branch agency: every row would say the same thing, which is the
  // definition of a line worth removing. The same reasoning that took the
  // level off.
  if (reader === 'one-branch') return '';
  if (reader === 'multi-branch') return br.join(', ');
  /* An admin's list spans agencies, so the agency is the half that
     disambiguates and is never dropped.

     NM-P. THE OFFICE HALF IS DROPPED FOR A SINGLE-OFFICE AGENCY, which
     for an admin means the line becomes the agency's name alone. Note
     what is NOT done here: no fourth WhereReader value is added. The
     READER has not changed -- an admin is still an admin -- the AGENCY
     has, and that is a different subject. A reader value would have made
     the two questions one, and neither would be answerable afterwards. */
  const ag = clean(agencies);
  /* NO ESTATE TO PASS, and none needed. `showsOffices` takes one since
     2026-10-01 so two same-named agencies in two estates can answer
     differently, and this caller holds names alone.

     THE REASON GIVEN HERE USED TO BE "only Opndoor's own estate has
     people", and that was wrong: a supplier's own staff refer, and on
     2026-10-03 one of them turned up on this line wearing a Kestrel agency's
     name. They no longer reach this branch at all -- `suppliers` is answered
     above -- so what is left here really is our estate's people, and the
     conclusion holds for the narrower reason. */
  const offices = ag.length === 1 && !showsOffices(ag[0]) ? [] : br;
  return [...ag, ...offices].join(', ');
}
