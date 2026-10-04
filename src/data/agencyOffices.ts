/* =====================================================================
   NM-P. HOW MANY OFFICES DOES THIS AGENCY HAVE?

   Matt, 2026-09-30: "A single-office agency shows only as the agency, e.g.
   'Regent Property', everywhere... No '1 branch', no branch row, no branch
   name. Where the system needs an office behind the scenes, it uses the
   agency's own name and address and is never shown separately. 'Add branch'
   stays available on the agency, and as soon as a second office is added,
   both appear as branches."

   THE BRANCH ROW DOES NOT STOP EXISTING, which his second sentence says
   outright. Every referral still hangs off a branch, `branch_id` is still
   how the agency rail resolves a position, and deeds, statements and
   notifications all still route through one. This file answers a DISPLAY
   question and nothing else: may this surface say the word "branch", show
   its name, or count it.

   ---------------------------------------------------------------------
   WHY IT IS NOT viewerShape, WHICH IS THE NEAREST THING ALREADY HERE
   ---------------------------------------------------------------------

   `viewerShape` counts what is in the READER's book and answers "does this
   reader ever see more than one branch". That is a different subject. An
   Opndoor admin reading three agencies that each have one office has
   `oneBranch: false` -- their book holds three branches -- and must still
   see no office named on any of the three. The question here is about ONE
   AGENCY, whoever is looking.

   `statementColumns` is a closer relative and is deliberately not extended
   either: everything between its BEGIN/END markers is duplicated
   character-for-character into the commission-statements edge function,
   and a test fails the moment the two diverge. Growing that block grows
   the duplication.

   ---------------------------------------------------------------------
   THREE STATES, NOT TWO, AND THIS IS THE CARE IN THE FILE
   ---------------------------------------------------------------------

   "We do not know this agency's office list" is NOT "it has one office".
   An application row carries an agency NAME, and the org tree it is
   resolved against is RLS-scoped: a supplier's reader looking at a row
   from another partner, a hydrate that has not run yet, a test fixture --
   any of them can miss. Collapsing on unknown would HIDE A REAL OFFICE
   NAME on a multi-office agency, which is a silent wrong answer.

   So unknown shows the office, which is exactly today's behaviour. The
   failure direction is deliberate: the worst an unknown can do is leave
   the old screen in place.

   AND ZERO IS NOT ONE. An agency with no office is a real state --
   `orgNotSetUp` treats it as its own case and the agencies list says so.
   `<= 1` would delete that signal, so the test is `=== 1`.

   A PLACEHOLDER IS NOT AN OFFICE. The house rail carries "Unattached"
   branches that exist only so a NOT NULL foreign key resolves. Counting
   one would make a genuinely single-office agency look like two and the
   rule would never fire for it.
   ===================================================================== */
import { ALL_PARTNERS } from './types';
import { getAgencies } from './orgService';

export type AgencyOffices =
  | { known: false }
  | { known: true; offices: number; singleOffice: boolean; onlyOfficeName: string | null };

/**
 * Count an agency's REAL offices, by name.
 *
 * By name AND ESTATE, because the name alone stopped being unique on
 * 2026-10-01. The surfaces hold `agency` as a string -- an application
 * row, a statement line, a league row -- and under Matt's earlier ruling
 * of 2026-08-17 that was the whole identity. It is not any more: see the
 * estate parameter below.
 *
 * Read across ALL_PARTNERS rather than the reader's scope. The estate
 * narrows it to one record; the scope would narrow it to what the reader
 * may SEE, which would make the same agency answer differently on two
 * screens. Isolation is not this function's job and it exposes nothing --
 * it returns a count, and only for an agency already named on a row the
 * reader was allowed to see.
 */
export function agencyOffices(
  agencyName: string | null | undefined,
  /* WHICH ESTATE'S AGENCY. Matt, 2026-10-01: "The same real company can
     exist in both estates (Frost as Opndoor's client and Frost under
     Rightmove). They are two separate records that never link, share
     nothing, and never show each other's data."

     This looked an agency up by name across every partner, on the older
     ruling that an agency exists once. With two Frosts it would answer
     with whichever row came back first, so a Rightmove-estate Frost with
     three offices could decide whether OUR Frost shows a branch column.

     Optional, because several callers hold a name and nothing else -- a
     statement line, an export row -- and for them the old behaviour is
     still the best available answer. Every caller that knows the estate
     passes it. */
  estate?: string | null,
): AgencyOffices {
  const name = (agencyName ?? '').trim();
  if (!name) return { known: false };
  const all = getAgencies(ALL_PARTNERS).filter((a) => a.name === name);
  const agency = (estate ? all.find((a) => a.partner === estate) : undefined) ?? all[0];
  if (!agency) return { known: false };
  const real = (agency.branches ?? []).filter((b) => !b.isPlaceholder);
  return {
    known: true,
    offices: real.length,
    singleOffice: real.length === 1,
    onlyOfficeName: real.length === 1 ? real[0].name : null,
  };
}

/* ===========================================================================
   THE PLACEHOLDER IS NOT A NAME, AND MUST NEVER BE PRINTED AS ONE.

   Matt, 2026-10-01: 'For a direct signup with no agency, the Branch column
   shows "-" instead of "Unattached Unattached", everywhere that label
   appears.'

   WHAT IT IS. The house rails -- opndoor-direct, referencing-partner,
   opndoor-agents -- each carry an agency and a branch called "Unattached",
   created by migration (20260812040000, 20260904240000) so an application's
   NOT NULL agency_id and branch_id resolve. On dev every one of the ten
   direct applications points at them. A direct signup HAS no agency, and
   the row said so twice, in our own internal word.

   WHY BOTH LINES READ IT. The Branch cell prints the branch over the
   agency, and both are the placeholder, so the column read "Unattached
   Unattached" -- which is not even a sentence, let alone an answer.

   ASKED OF THE STORE FIRST, THE NAME SECOND. `is_placeholder` is the fact
   and it is hydrated onto every agency and branch, so that is the question
   asked. The name is a fallback for the window before the org store has
   loaded and for mock rows that carry no flag: the placeholder is created
   by migration under one fixed name, and a row that reaches a screen before
   the store does must still not print it. Belt and braces on a string that
   must never be shown to a customer.
   =========================================================================== */
/** The name the migrations give every house rail's placeholder. */
const PLACEHOLDER_NAME = 'Unattached';

export function isPlaceholderOrg(name: string | null | undefined): boolean {
  const n = (name ?? '').trim();
  if (!n) return false;
  if (n === PLACEHOLDER_NAME) return true;
  const agencies = getAgencies(ALL_PARTNERS);
  const agency = agencies.find((a) => a.name === n);
  if (agency) return agency.isPlaceholder === true;
  /* A BRANCH OF THAT NAME, under any agency. The surfaces hold branch and
     agency as bare strings, so this has to answer for either. */
  return agencies.some((a) => (a.branches ?? []).some((b) => b.name === n && b.isPlaceholder));
}

/**
 * What to print where an org name goes: the name, or "-" where there is no
 * org and a placeholder is standing in for one.
 *
 * NEVER AN EMPTY STRING, for the same reason `officeLabel` never returns
 * one: every caller prints this into a cell, and an empty one reads as a
 * missing record rather than as "there is nobody here".
 */
export function orgLabel(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  return !n || isPlaceholderOrg(n) ? '-' : n;
}

/**
 * The same question for a DOCUMENT, where the answer is nothing at all.
 *
 * Matt, 2026-10-02, about the application export: "Direct signups show
 * 'Unattached' for Agency and Branch; show blank, as on screen." And again
 * about the underwriter bordereau: "Never show the placeholder."
 *
 * WHY A SECOND FUNCTION AND NOT A PARAMETER. On a screen a hyphen is the
 * right answer, and `orgLabel` says why: an empty cell in a table of
 * records reads as a missing record rather than as "there is nobody
 * here". In a spreadsheet the reader is a person reconciling or an
 * insurer loading a file, and a hyphen in an Agency column is a value --
 * it sorts, it groups, it matches nothing. Blank is the honest cell, and
 * the two readers want different things, so they get different
 * functions rather than a flag nobody remembers to pass.
 *
 * "Unattached" IS OUR OWN PLUMBING. Each house rail carries a placeholder
 * agency and branch so an application's NOT NULL agency_id resolves. It
 * is not a company, nobody has heard of it, and it has now surfaced on
 * two documents.
 */
export function orgCell(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  return !n || isPlaceholderOrg(n) ? '' : n;
}

/**
 * THE ONE QUESTION EVERY SURFACE ASKS. May this surface say "branch", show
 * an office name, or count one for this agency?
 *
 * True for a multi-office agency, for an agency with no office at all, and
 * for an agency we do not know. False only where we KNOW there is exactly
 * one, which is the one case Matt's rule is about.
 */
/* =====================================================================
   DOES THE ONE OFFICE'S NAME TELL THE READER ANYTHING?

   Matt, 2026-10-04, choosing between the three options I put to him:
   "Office naming: apply it everywhere; show the office's own name wherever an
   office is shown."

   WHAT HE IS DECIDING. NM-P, his own ruling of 2026-09-30, collapses a
   single-office agency to the agency's name, and it rests on one sentence of
   his: "Where the system needs an office behind the scenes, it uses the
   agency's own name and address and is never shown separately."

   THAT ASSUMPTION IS TRUE OF THREE AGENCIES ON DEV AND FALSE OF FIVE.
   Measured before proposing the change, every single-office agency we hold:

     Harbour Lets          office "Harbour Lets"        repeats the agency
     Kestrel's "123"       office "123"                 repeats the agency
     New Independent       office "New Independent"     repeats the agency
     Kestrel's Frost       office "Frost Mayfair"       a real, chosen name
     our Frost             office "Frost Mayfair"       a real, chosen name
     Harborview Lettings   office "Brighton Marina"     a real, chosen name
     Regent's Lettings     office "Regent's Park"       a real, chosen name
     Southbank Residential office "Southbank Quay"      a real, chosen name

   The three that repeat are offices the system created behind the scenes,
   which is the case his sentence described. The five that do not are offices
   a person named, and hiding one of those loses a fact the reader cannot get
   back from the row: "Frost Mayfair" is where the let is.

   SO THE RULE IS HIS REASON RATHER THAN HIS PROXY: collapse when the name
   carries nothing, not merely when there is one of them. New Independent, his
   own example from the original ruling, still collapses.

   IT CHANGES REGENT, which is why it was put to him rather than done: their
   Office column now reads "Regent's Park" where it read "Regent's Lettings",
   two days before they go live. He has chosen that, in wider terms than I
   proposed -- "wherever an office is shown", not only the two places he
   reported.

   TWO SHAPES CARRY NOTHING: the office named exactly after the agency, and
   the auto "[Agency], Head office" the referral form creates. Both are the
   system using the agency's own name, which is his sentence.

   AN UNKNOWN NAME READS AS "carries nothing", which keeps NM-P's behaviour
   for the case it was written for and for any row we cannot resolve. The
   failure direction is unchanged: the worst it does is leave the old screen.
   ===================================================================== */
function officeNameAddsNothing(agencyName: string, officeName: string): boolean {
  const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');
  const a = norm(agencyName);
  const o = norm(officeName);
  if (!o) return true;
  return o === a || o === `${a}, head office`;
}

export function showsOffices(
  agencyName: string | null | undefined, estate?: string | null,
): boolean {
  const r = agencyOffices(agencyName, estate);
  if (!r.known) return true;
  if (!r.singleOffice) return true;
  return !officeNameAddsNothing((agencyName ?? '').trim(), r.onlyOfficeName ?? '');
}

/**
 * The label a branch-shaped row, cell, column or payee must carry.
 *
 * Its inseparable companion, and a projection of the same count so the two
 * can never disagree. Never returns an empty string: every caller prints
 * this into a table cell, an email or a document, and an empty one reads
 * as a missing record rather than a collapsed one.
 */
export function officeLabel(
  agencyName: string | null | undefined,
  branchName: string | null | undefined,
  estate?: string | null,
): string {
  /* THE PLACEHOLDER IS NOT A NAME. A direct signup has an "Unattached"
     agency AND an "Unattached" branch, so both halves below resolved to it
     and the cell read "Unattached Unattached". Dropped here rather than at
     the call site because this function is what every branch-shaped cell,
     payee and document line asks, and the next caller should inherit the
     answer rather than rediscover the question. */
  const branch = isPlaceholderOrg(branchName) ? '' : (branchName ?? '').trim();
  const agency = isPlaceholderOrg(agencyName) ? '' : (agencyName ?? '').trim();
  if (!showsOffices(agencyName, estate)) return agency || branch || '-';
  return branch || agency || '-';
}
