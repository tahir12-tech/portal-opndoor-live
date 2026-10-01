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
 * By name because that is what the surfaces have: an application row, a
 * statement line and a league row all carry `agency` as a string, and
 * Matt's ruling of 2026-08-17 is that an agency exists once across
 * partners and is identified by its name.
 *
 * Read across ALL_PARTNERS rather than the reader's scope, for the same
 * reason: the agency is one party whichever route the row came down, and
 * scoping the count would make the same agency answer differently on two
 * screens. Isolation is not this function's job and it exposes nothing --
 * it returns a count, and only for an agency already named on a row the
 * reader was allowed to see.
 */
export function agencyOffices(agencyName: string | null | undefined): AgencyOffices {
  const name = (agencyName ?? '').trim();
  if (!name) return { known: false };
  const agency = getAgencies(ALL_PARTNERS).find((a) => a.name === name);
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
 * THE ONE QUESTION EVERY SURFACE ASKS. May this surface say "branch", show
 * an office name, or count one for this agency?
 *
 * True for a multi-office agency, for an agency with no office at all, and
 * for an agency we do not know. False only where we KNOW there is exactly
 * one, which is the one case Matt's rule is about.
 */
export function showsOffices(agencyName: string | null | undefined): boolean {
  const r = agencyOffices(agencyName);
  return !r.known || !r.singleOffice;
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
): string {
  /* THE PLACEHOLDER IS NOT A NAME. A direct signup has an "Unattached"
     agency AND an "Unattached" branch, so both halves below resolved to it
     and the cell read "Unattached Unattached". Dropped here rather than at
     the call site because this function is what every branch-shaped cell,
     payee and document line asks, and the next caller should inherit the
     answer rather than rediscover the question. */
  const branch = isPlaceholderOrg(branchName) ? '' : (branchName ?? '').trim();
  const agency = isPlaceholderOrg(agencyName) ? '' : (agencyName ?? '').trim();
  if (!showsOffices(agencyName)) return agency || branch || '-';
  return branch || agency || '-';
}
