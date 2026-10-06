/* =====================================================================
   A CORRECTED DEED HAS NEVER BEEN DELIVERED.

   Matt, 2026-10-03: "the corrected-deed blocker (the agent doesn't
   receive the corrected signed deed after a start-date correction)", and
   earlier: "pressing 'Resend deed' manually sends the correct corrected
   deed (29 Dec, '1 of 2 signed'), so the document is right and only the
   automatic send on signing is blocked as a 'replay'."

   THE ACTIVITY LOG FOR GR-23853 SAYS IT EXACTLY:

     01 Oct 20:21:35  deed_signed
     01 Oct 20:21:39  deed_delivered     Deed sent to joe@joe.com, automatic
     01 Oct 20:25:32  tenancy_correction_applied   19/10/2026 -> 29/12/2026
     03 Oct 11:28:43  deed_signed        the CORRECTED deed
     03 Oct 11:28:44  deed_delivered     "Completion replayed; the signed
                                          deed already went to joe..."
     03 Oct 11:30:33  deed_delivered     sent by Nicholas Dwyer, manually

   WHY THE GUARD GOT IT WRONG. 20261007350000 already knew a corrected
   deed is a new deed, and asked it like this:

     deed_delivered_at is not null
       and not (deed_issued_at > deed_delivered_at)

   `deed_issued_at` is WHEN THE DEED WAS EXECUTED, and it is written by
   the completion handler -- the same handler that reads the row at the
   top and tests this near the bottom. The correction had nulled it, so
   at the moment of the test the value in hand was the row as it stood
   BEFORE this completion: null, or the previous signing four seconds
   before the previous delivery. Either way the test said "not reissued",
   and the deed read as a replay. The rule was right and the fact it
   asked was written by the thing asking.

   AND THE CORRECTION LEFT THE OLD DELIVERY IN PLACE. Both correction
   paths clear `deed_issued_at`, `deed_executed_at`, `executed_pdf_path`,
   `pandadoc_document_id` and `deed_viewed_at`, and neither clears
   `deed_delivered_at`. So the application went on claiming a delivery of
   a document that had been archived and superseded.

   THE FIX IS TO STOP COMPARING TIMESTAMPS ACROSS TWO HANDLERS. A
   correction MOVES the delivery aside, and "has this deed been
   delivered" becomes a question with one answer and no arithmetic:
   `deed_delivered_at is not null`. A fact written by the correction,
   read by the completion, in that order, with no window in between.

   THE EARLIER DELIVERY IS KEPT, not discarded. It is a real thing that
   happened -- an agent has that PDF in their inbox -- and the Delivery
   panel has to be able to say so. Matt, on the same application: "with
   the earlier delivery listed as superseded." These two columns are what
   that sentence will read; the panel itself is a later item.
   ===================================================================== */

alter table public.applications
  add column if not exists deed_delivery_superseded_at timestamptz,
  add column if not exists deed_delivery_superseded_to text;

comment on column public.applications.deed_delivery_superseded_at is
  'When a deed that HAD been delivered was archived and reissued by a tenancy correction. The delivery really happened and the agent holds that PDF; it is simply no longer the current deed. Moved here out of deed_delivered_at so that "has the current deed been delivered" has one answer and needs no comparison between columns written by different handlers.';
comment on column public.applications.deed_delivery_superseded_to is
  'Who that superseded delivery was addressed to, comma separated, as deed_delivered_to records it.';

/* READABLE, like the three delivery columns beside them. 20260811180000
   made this table a denylist: a column without a grant is refused to
   `authenticated` and takes the whole dashboard SELECT down with it, which
   is what 20261007380000 exists to correct for exactly these columns.
   applications_column_grants.test.sql is the guard. */
grant select (deed_delivery_superseded_at, deed_delivery_superseded_to)
  on public.applications to authenticated;

/* =====================================================================
   AND THE ONE THAT IS ALREADY WRONG ON DEV.

   GR-23853 carries a `deed_delivered_at` of 01 Oct 20:21:39 for a deed
   archived at 20:25:27. Matt's manual resend put the corrected deed in
   the agent's hands at 03 Oct 11:30:33, which `deed_resent_at` records,
   so the CURRENT deed has been delivered and the row should say so --
   the first delivery of this deed, by hand, after the automatic one was
   refused.

   Keyed on the archive event rather than on the reference, so it
   corrects every row in this state rather than the one that was
   reported. Narrow by construction: a row only qualifies if its last
   archive is LATER than its recorded delivery, which is precisely the
   inconsistency this migration exists to remove.
   ===================================================================== */
with corrected as (
  select a.id,
         a.deed_delivered_at,
         a.deed_delivered_to,
         a.deed_resent_at,
         (select max(l.at) from public.activity_log l
           where l.application_id = a.id and l.kind = 'deed_archived') as archived_at
    from public.applications a
   where a.deed_delivered_at is not null
)
update public.applications a
   set deed_delivery_superseded_at = c.deed_delivered_at,
       deed_delivery_superseded_to = c.deed_delivered_to,
       -- The resend after the correction IS this deed's first delivery.
       -- Where there was none, the current deed has not been delivered.
       deed_delivered_at = case when c.deed_resent_at > c.archived_at then c.deed_resent_at end,
       deed_delivered_to = case when c.deed_resent_at > c.archived_at then c.deed_delivered_to end,
       deed_resent_at    = case when c.deed_resent_at > c.archived_at then null
                                else c.deed_resent_at end
  from corrected c
 where a.id = c.id
   and c.archived_at is not null
   and c.archived_at > c.deed_delivered_at;
