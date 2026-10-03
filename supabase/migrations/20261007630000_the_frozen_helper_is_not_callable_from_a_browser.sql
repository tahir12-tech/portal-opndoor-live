/* =====================================================================
   THE FROZEN-ARRANGEMENT HELPER IS NOT CALLABLE FROM A BROWSER.

   `settles_its_own_agents_frozen` was created in 20261007620000 and, like
   every function, was born with EXECUTE granted to PUBLIC. `npm run
   drift` caught it in the same two lines it has caught this on before:

     EXECUTE settles_its_own_agents_frozen(boolean,uuid): dev lets anon
             call it, the files do not
     EXECUTE ... dev lets authenticated call it, the files do not

   A NEW MIGRATION RATHER THAN AN EDIT, which is the standing rule: a
   correction to an earlier migration goes forward, because re-running one
   makes dev disagree with a clean filename-order apply and every test
   then measures the wrong database.

   NOBODY NEEDS TO CALL IT DIRECTLY. Its two callers --
   `supplier_statement_lines` and `commission_statement_lines` -- are
   SECURITY DEFINER and run as the owner, so revoking it from every
   browser role costs them nothing. It takes an application's frozen flag
   and a partner id and answers a question about Opndoor's own
   arrangement; the same reasoning that keeps `freeze_commission_lines`
   and `supplier_settles_its_own_agents` off the browser applies to it.

   `from public, anon, authenticated` names all three deliberately.
   20261007080000 exists because an earlier revoke named anon and
   authenticated and not PUBLIC, which grants to both of them through
   their membership and left the function callable.
   ===================================================================== */
revoke all on function public.settles_its_own_agents_frozen(boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.settles_its_own_agents_frozen(boolean, uuid)
  to service_role;
