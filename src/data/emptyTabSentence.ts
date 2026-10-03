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

/* EACH CLAUSE DESCRIBES THE SET, NOT THE TAB'S NAME.

   Matt, 2026-10-03: "the Paid tab should say 'No [direct] applications paid
   and waiting for a deed', not 'No … applications paid'. Check each tab's
   empty message matches exactly what that tab holds."

   THAT CORRECTS THE FIRST VERSION OF THIS FILE, written the same morning from
   his earlier instruction ("say which tab"). Naming the tab and describing
   the set are not the same thing, and Paid is where they come apart: the tab
   is `status = 'paid'`, and a deed has its own status, so the tab holds
   applications that have paid and have NOT got a deed. "No applications paid"
   describes a superset that includes every deed in the book -- and when there
   are deeds on the next tab along, it reads as false.

   READING EVERY CLAUSE AGAINST ITS OWN FILTER, which is the rest of his
   instruction, found two more:

     awaiting           `r.awaitingSignature`, which is deed_state =
                        'awaiting_tenant': the deed is with the TENANT and
                        unsigned. "awaiting signature" did not say whose, and
                        on a joint tenancy that is the question.
     delivery-failed    `deliveryStateOf(r) === 'failed'`, which means the
                        deed WAS sent and the address bounced -- deliveryState
                        is explicit that a row with nobody to send to is
                        'cannot_deliver' instead. "could not be sent" is the
                        other tab's meaning, so the two clauses described one
                        state between them and left the real distinction
                        unsaid.

   AND THE REST CHECK OUT. `sent` and `fee-unpaid` are the SAME filter
   (`status = 'sent'`) worded from two directions, which is right: one tab is
   the funnel step and the other is the chase list, and both sentences are
   true of it. `refunded` and the two delivery tabs are flags rather than
   statuses, so their rows can sit at any step, and their clauses say nothing
   about where. */
/** A clause that follows "No [origin] applications ...", per tab id. */
const TAB_CLAUSE: Record<string, string> = {
  draft: 'in progress',
  invited: 'invited but not yet registered',
  'fee-unpaid': 'waiting on the guarantee fee',
  referencing: 'awaiting a decision',
  declined: 'declined',
  sent: 'sent and not yet paid',
  paid: 'paid and waiting for a deed',
  deed: 'with a deed issued',
  refunded: 'refunded',
  awaiting: 'waiting for a tenant to sign their deed',
  withdrawn: 'withdrawn',
  expired: 'expired',
  'delivery-failed': 'whose signed deed was sent and did not arrive',
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
