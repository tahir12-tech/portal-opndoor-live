/* =====================================================================
   WHERE THE DEED ACTUALLY WENT, RECOVERED FROM THE RECORD THAT HAS IT.

   Matt, 2026-09-30, verbatim: "Application detail: the Delivery panel
   must show where the deed was actually sent and when, from the send
   record, never who it would go to under today's rules. If it hasn't
   been sent, say who it will go to. On GR-20845 it should show
   manager@regent.dev.test."

   THE PANEL'S BUG IS IN THE CLIENT and is fixed there: the `delivered`
   arm read `attemptedTo ?? (dlvWouldGo || '-')`, so an application with
   no recorded address showed, under the label "Sent to", whoever the
   ladder resolves to TODAY. That is the sentence above, exactly.

   THIS MIGRATION IS THE OTHER HALF: there is a record, and the column is
   not it. `record_delivery_attempt` and `delivery_attempted_to` were
   added by 20261005100000 and wired into both delivery paths, so every
   send from then on writes the address down. Three applications on dev
   were delivered BEFORE that wiring and carry nothing in the column --
   including GR-20845, sent 2026-09-27.

   THEY ARE NOT UNRECORDED. `activity_log` has carried the answer all
   along, as a `deed_delivered` row reading "Deed sent to
   manager@regent.dev.test . automatic". That IS the send record: written
   at the time, by the path that did the sending, naming the address it
   used. Reading it back is recovering what happened, which is the
   opposite of re-resolving a ladder that may since have changed.

   NARROW ON PURPOSE. It fills only where the column is null, only from a
   `deed_delivered` row whose message matches the exact shape that path
   writes, and takes the LAST such row per application, because a
   redelivery is a later send to a possibly different address. A row that
   does not match is left alone rather than guessed at: an empty Delivery
   field is honest and a wrong one is not.

   THE SOURCE RUNG IS NOT RECOVERABLE and is not invented. The log records
   how the send was triggered ("automatic", "sent by Tom Reeve"), not
   which rung of the ladder supplied the address, and `delivery_source`
   means the second thing. It stays null, and the panel simply omits the
   "Address from" line, which is what it already does for a null.
   ===================================================================== */

with recovered as (
  select distinct on (l.application_id)
         l.application_id,
         substring(l.message from '^Deed sent to ([^ ]+@[^ ]+)') as email
  from public.activity_log l
  where l.kind = 'deed_delivered'
    and l.message ~ '^Deed sent to [^ ]+@[^ ]+'
  order by l.application_id, l.at desc
)
update public.applications a
   set delivery_attempted_to = r.email
  from recovered r
 where a.id = r.application_id
   and a.delivery_attempted_to is null
   and r.email is not null
   /* ONLY WHERE SOMETHING WAS ACTUALLY SENT. A `deed_delivered` line with
      no deed_sent_at would be a contradiction, and this is not the place
      to resolve one: leave it and let the panel say nothing. */
   and a.deed_sent_at is not null;
