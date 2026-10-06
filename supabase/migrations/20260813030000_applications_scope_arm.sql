-- ===========================================================================
-- POLICY 1 OF 3: applications_select gains a scope arm.
--
-- One policy per migration, each with its own assertion that the
-- partner-scoped answer is unchanged. app_partner() is the vocabulary of 165
-- call sites, and rewriting the RLS surface in one migration is how a tenant
-- boundary moves without anybody noticing.
--
-- The four existing arms are reproduced verbatim from
-- 20260811190000_developer_reads_partner_data.sql:36-43. Diff the top of the
-- expression against that file: nothing moved.
--
-- THE NEW ARM IS ADDITIVE AND CANNOT WIDEN ANYBODY WHO HAS NO POSITION.
-- app_has_scope() is false for everyone with no user_scopes row, which is
-- everyone today, so the arm short-circuits to false and the policy answers
-- exactly as it did. A negotiator never gets a row, so the referrer arm above
-- keeps serving them and this arm never fires for them at all.
--
-- Why the scope arm carries no role test, when every other arm does: a position
-- IS the entitlement. Somebody holding a branch position is a branch manager by
-- definition, and adding "and app_role() = 'management'" would mean maintaining
-- the same fact in two places and getting to choose which one is wrong.
-- ===========================================================================

drop policy if exists applications_select on public.applications;
create policy applications_select on public.applications for select to authenticated
  using (
    public.is_admin()
    or (public.app_role() = 'management' and partner_id = public.app_partner())
    or (public.app_role() = 'referrer'   and referrer_id = auth.uid())
    or (public.app_role() = 'developer'  and partner_id = public.app_partner())
    -- NEW: a position over a set of branches.
    or (
      public.app_has_scope()
      and partner_id = public.app_partner()      -- a position never crosses the partner
      and branch_id in (select public.app_scope_branches())
    )
  );

comment on policy applications_select on public.applications is
  'Admin, management over their partner, a referrer over their own, a developer over their partner, or anybody holding a POSITION over the branch. The position arm is scoped to the caller''s partner as well as their branches: a scope row is not a way out of the tenant.';

-- ---------------------------------------------------------------------------
-- Prove it changed nothing.
--
-- Nobody holds a position, so the new arm must be false for every row and every
-- caller. Checked structurally: with user_scopes empty, app_scope_branches()
-- returns nothing, so `branch_id in (...)` cannot be true for any row.
-- ---------------------------------------------------------------------------
do $$
declare v_scopes int; v_def text;
begin
  select count(*) into v_scopes from public.user_scopes;
  if v_scopes > 0 then
    raise exception 'user_scopes is not empty, so this migration cannot prove it changed nothing. Assert the new visibility deliberately instead.';
  end if;

  select pg_get_expr(polqual, polrelid) into v_def
  from pg_policy where polrelid = 'public.applications'::regclass and polname = 'applications_select';

  -- The four original arms must still be present, word for word in the form
  -- Postgres normalises them to. A dropped arm is the failure this whole
  -- one-policy-at-a-time approach exists to catch.
  if position('(app_role() = ''management''::text) AND (partner_id = app_partner())' in v_def) = 0
     or position('(app_role() = ''referrer''::text) AND (referrer_id = auth.uid())' in v_def) = 0
     or position('(app_role() = ''developer''::text) AND (partner_id = app_partner())' in v_def) = 0
     or position('is_admin()' in v_def) = 0 then
    raise exception 'applications_select lost one of its original arms: %', v_def;
  end if;

  if position('app_scope_branches()' in v_def) = 0 then
    raise exception 'the scope arm is not present';
  end if;
end $$;
