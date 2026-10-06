/* =====================================================================
   A PLACEHOLDER TENANCY START IS NOT A TENANCY START.

   Matt, 2026-10-03: "Application export: GR-20626 (unfinished, no tenancy
   details given) shows Tenancy start date 04/10/2026. Leave Tenancy start
   blank until the tenant has given one; check the screen and other exports for
   the same."

   WHERE 04/10/2026 CAME FROM, read off dev rather than guessed:

     create_direct_application:  coalesce(p_tenancy_start, current_date + 30)

   GR-20626 was created on 2026-09-04, and 2026-09-04 + 30 is 2026-10-04. So
   the date is not wrong data, it is a PLACEHOLDER: `applications.tenancy_start`
   is NOT NULL, the direct rail's draft is born before the tenant has reached
   the tenancy step, and something had to go in the column.

   WHY THE COLUMN IS NOT MADE NULLABLE INSTEAD, which was the first instinct.
   `expiry_date` is GENERATED from `tenancy_start`, the fee preview reads it,
   `inForceDuring` compares it and the bordereau buckets on it. Making it
   nullable is a change to the referral path and to four money surfaces, to fix
   a display. The draft-exemption pattern already in the schema says the same
   thing: a draft is allowed to be incomplete, and the readers decide what to
   print.

   =====================================================================
   SO HOW DO WE KNOW IT WAS GIVEN
   =====================================================================

   There is no flag, and I am not adding one for a copy fix. What there is is
   the STEP: the rent and the tenancy start are collected together, on the same
   screen, in the same save. So a draft whose rent is still zero has not
   reached that step, and its tenancy start is the placeholder.

   THE LIMIT OF THAT INFERENCE, stated because somebody will meet it: a draft
   where the tenant typed a start date and left the rent at zero reads as
   "not given" and prints blank. That cannot happen through the tenant form,
   which saves the step as a unit, and if it ever becomes possible the honest
   fix is a column rather than a cleverer guess.

   ONLY A DRAFT. Every other status has been through a submit, and
   assert_application_complete refuses a submit with no rent, so a sent, paid
   or deed-issued application always has a real tenancy start.
   ===================================================================== */

/** Has the tenant actually given a tenancy start, or is it the placeholder? */
export function tenancyStartGiven(a: {
  status?: string | null;
  rentNum?: number | null;
}): boolean {
  if ((a.status ?? '') !== 'draft') return true;
  return (a.rentNum ?? 0) > 0;
}

/**
 * The tenancy start as it should be PRINTED: the date, or nothing.
 *
 * A function rather than each caller writing the condition, because "check the
 * screen and other exports for the same" is four call sites today and the
 * fifth is the one that would print the placeholder again.
 */
export function tenancyStartFor<T>(
  a: { status?: string | null; rentNum?: number | null },
  value: T,
): T | null {
  return tenancyStartGiven(a) ? value : null;
}
