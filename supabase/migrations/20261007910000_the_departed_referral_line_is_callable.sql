/* =====================================================================
   THE GRANT FOR org_departed_referrals.

   A NEW FILE AND NOT AN EDIT TO 20261007900000, which is already applied to
   dev: re-running an applied migration makes dev disagree with a clean
   filename-order run, and `npm run drift` measures exactly that difference.

   `definerAllowlistCoverage` is what catches a missing one, and it is derived
   from the migration FILES rather than from the database -- so a function that
   works on dev because Postgres grants EXECUTE to PUBLIC by default, and would
   be unreachable on a project where that default has been revoked, reads as a
   name the files never granted. Which is the right answer: the browser calls
   this, so the grant belongs in the files.

   SERVICE_ROLE TOO, matching org_deed_readiness: the Agencies page reads it as
   the signed-in user, and nothing on the server does today, but every sibling
   of this function carries both and a reader comparing them should not have to
   work out whether the difference means something.
   ===================================================================== */

GRANT EXECUTE ON FUNCTION public.org_departed_referrals() TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_departed_referrals() TO service_role;
