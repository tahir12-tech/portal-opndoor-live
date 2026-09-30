/* =====================================================================
   TWO INTERNAL HELPERS ARE NOT BROWSER RPCs.

   A correction to 20261007060000, which is applied, so it goes in a new
   file rather than an edit.

   `supplier_agent_rate` and `supplier_settles_its_own_agents` were
   granted to `authenticated` out of habit. Nothing in the browser calls
   either: both exist to be called from INSIDE
   `commission_statement_lines` and `supplier_statement_lines`, which are
   SECURITY DEFINER and owned by postgres, so the caller's own EXECUTE
   privilege is never consulted for them. The supplier Commission tab
   reads the setting off the hydrated partner row, not through an RPC.

   `definer_grants.test.sql` caught it by name, which is the whole reason
   that file asserts set equality in both directions rather than only
   "nothing outside the list is exposed". The allowlist and its ceiling
   are unchanged: neither of these ever belonged on it.

   AND THE REVOKE NAMES PUBLIC, which the first draft of this migration
   did not, and `migrationPatterns.test.ts` refused it: "a revoke that
   leaves PUBLIC holding EXECUTE is not a revoke". It was harmless here,
   because 20261007060000 revokes from public and anon before granting,
   so PUBLIC was not holding EXECUTE. The check cannot see that and
   should not have to: Postgres grants EXECUTE to PUBLIC on every new
   function, and a `revoke ... from authenticated` written in good faith
   leaves has_function_privilege answering TRUE. That is the defect that
   put 193 functions in front of `authenticated` and took a pgTAP file to
   find, so the crude rule wins over the specific argument.
   ===================================================================== */
revoke execute on function public.supplier_agent_rate(uuid) from public, anon, authenticated;
revoke execute on function public.supplier_settles_its_own_agents(uuid) from public, anon, authenticated;
