/* =====================================================================
   THE ROWS THAT WERE ALREADY WRITTEN SAY "GUARANTEE FEE" TOO.

   Matt, 2026-10-03: "the activity log still says 'guarantor fee still
   unpaid'; reminders should say 'guarantee fee'."

   MEASURED BEFORE CHANGING ANYTHING, because the obvious reading of that
   sentence -- something still GENERATES the old words -- is wrong, and
   fixing a generator that is already right would have left the complaint
   exactly where it was:

     functions on dev whose definition contains "guarantor fee"   NONE
     edge functions                                   one comment, no copy
     activity_log rows that do                                      20

   So 20261007570000 fixed the feed for everything written after it, and the
   reminders already say "guarantee fee" in the email itself. What Matt is
   looking at is HISTORY: twenty rows written before that migration, in three
   system-generated shapes.

   REWRITING A LOG IS NORMALLY WRONG and that is why this is narrowed to the
   three sentences this product generated itself. Every one of the twenty was
   written by 'System' or 'Stripe', never by a person; none of them is
   somebody's note; and the correction is one word in our own vocabulary for
   the same fee, not a change to what happened. A row a human typed is not
   touched, which the WHERE clause is careful to guarantee by matching the
   exact sentences rather than the word.

   THE THREE SHAPES, from 20260811250000, 20261005240000 and the Stripe
   webhook respectively:

     Application expired: guarantor fee unpaid 15 days after referral.    8
     Guarantor fee paid (£X) via Stripe.                                  7
     Payment reminder sent to the tenant: guarantor fee still unpaid ...  5
   ===================================================================== */

update public.activity_log
   set message = replace(replace(message, 'Guarantor fee', 'Guarantee fee'),
                                          'guarantor fee', 'guarantee fee')
 where message ilike '%guarantor fee%'
   and (
     message like 'Application expired: guarantor fee unpaid%'
     or message like 'Guarantor fee paid (%) via Stripe.'
     or message like 'Payment reminder sent to the tenant: guarantor fee still unpaid%'
   );
