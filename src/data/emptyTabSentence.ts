/* =====================================================================
   WHAT AN EMPTY APPLICATIONS TAB SAYS.

   Matt, 2026-10-03: "when a status tab is empty, say which, e.g. 'No
   direct applications awaiting a decision', instead of 'No applications
   match your filters'."

   "MATCH YOUR FILTERS" IS TRUE AND USELESS. The reader has just pressed
   a tab; what they want to know is whether THAT tab is empty, and the
   old sentence made them look back at the chips to work out which of
   seven things it was talking about. Matt's own example names two of
   them -- the origin and the tab -- and that is the shape here.

   IT IS A PHRASE PER TAB, NOT A LABEL. The tab strip's labels are
   <Pill> elements and several read as adjectives on their own ("Paid",
   "Declined"); dropped into a sentence they give "No applications Paid".
   So each tab carries a clause written to follow "applications", and
   the few that cannot be said that way get their own sentence.

   THE "All" TAB KEEPS THE OLD WORDS, deliberately. Nothing is selected
   there, so the filters really are the only thing that can be excluding
   anything, and naming them is the useful answer.
   ===================================================================== */

/** A clause that follows "No [origin] applications ...", per tab id. */
const TAB_CLAUSE: Record<string, string> = {
  draft: 'in progress',
  invited: 'invited but not yet registered',
  'fee-unpaid': 'waiting on the guarantee fee',
  referencing: 'awaiting a decision',
  declined: 'declined',
  sent: 'sent and not yet paid',
  paid: 'paid',
  deed: 'with a deed issued',
  refunded: 'refunded',
  awaiting: 'awaiting signature',
  withdrawn: 'withdrawn',
  expired: 'expired',
  'delivery-failed': 'whose deed could not be sent',
  'cannot-deliver': 'with nowhere to send the deed',
};

/**
 * The sentence an empty Applications list should show.
 *
 * `status` is the active tab id; `originWord` is the origin filter in the
 * reader's words ("direct", "agency") or null for the whole book; `searching`
 * is true when a search term is narrowing the list, because then the term IS
 * the likeliest reason and saying so beats naming the tab.
 */
export function emptyTabSentence(
  status: string,
  originWord: string | null,
  searching: boolean,
): string {
  /* A SEARCH BEATS EVERYTHING. Somebody who has typed a name wants to know
     the name found nothing, not which tab they happen to be on. */
  if (searching) return 'Nothing matches that search.';

  const who = originWord ? `${originWord} applications` : 'applications';
  if (status === 'all' || !status) return `No ${who} match your filters.`;

  const clause = TAB_CLAUSE[status];
  // A tab nobody has worded yet still reads, and still names the filters
  // rather than pretending to name the tab.
  if (!clause) return `No ${who} match your filters.`;
  return `No ${who} ${clause}.`;
}
