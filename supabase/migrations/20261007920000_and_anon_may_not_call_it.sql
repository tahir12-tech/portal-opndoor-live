/* =====================================================================
   ANON MAY NOT CALL org_departed_referrals.

   `npm run drift` caught it: "dev lets anon call it, the files do not."

   POSTGRES GRANTS EXECUTE TO PUBLIC BY DEFAULT, and `anon` is in PUBLIC, so a
   new function is callable by an unauthenticated browser the moment it exists
   unless a migration says otherwise. 20261006330000 is the migration that
   found this across the whole schema and its note is the one to read: "revoke
   ... from authenticated on its own has been giving false comfort", because
   the PUBLIC grant survives it. So both are named here.

   THE FUNCTION WOULD HAVE REFUSED ANYWAY -- it opens with
   `coalesce(public.is_aal2(), false)` and anon has no AAL at all -- which is
   exactly why the drift check matters more than the reasoning. Two defences
   named in two places is the shape every sibling has; one defence and an
   argument is how the next function goes out with neither.
   ===================================================================== */

/* ONE STATEMENT NAMING BOTH, which is what `migrationPatterns` insists on and
   is the shape 20261006330000 emits. Written as two it is the same revoke and
   reads as a smaller one: the check looks for `public` in each revoke's FROM
   list precisely because a line that names only `anon` is the mistake that
   sweep existed to find. The database cannot tell the two spellings apart, and
   the next person reading the file can. */
REVOKE EXECUTE ON FUNCTION public.org_departed_referrals() FROM public, anon;
