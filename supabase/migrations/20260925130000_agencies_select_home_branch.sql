-- An unscoped agent-rail user resolves from their HOME BRANCH.
--
-- THE BUG. agencies_select falls back to partner_can_reach_agency for a caller
-- with no user_scopes row. On the supplier rail that is right: one partner is one
-- customer. On the agent rail it is meaningless -- every independent agency hangs
-- off the one house partner and reachability comes from partner_agency_relationships,
-- which a negotiator has nothing to do with. Tom Reddy, whose home branch is
-- Northgate Central, could see Harborview Lettings and the Unattached placeholder
-- and could NOT see Northgate Lettings, the one agency he actually works for.
--
-- THE FIX. On the agent rail an unscoped caller resolves from home_branch_id:
-- their own agency, and nothing else. app_scoped_agencies already encodes exactly
-- that (position, plus the agency of a negotiator's home branch), so this reuses
-- it rather than inventing a second rule. SUPPLIER RAIL UNCHANGED: its arm is
-- still partner_can_reach_agency.
--
-- Widening is impossible here: every arm is a subset of what the caller could
-- already reach on their own partner, and the group/branch policies are untouched.
drop policy if exists agencies_select on public.agencies;
create policy agencies_select on public.agencies for select to authenticated
using (
  public.is_admin()
  or (public.app_role() = any (array['management','referrer','developer'])
      and public.app_reachable_agency(id))
);

-- branches follows the same rule, so a negotiator sees the branches of their own
-- agency rather than a placeholder's. Scoped callers are unchanged: for them
-- app_reachable_agency is the same position ladder app_scope_branches expands.
drop policy if exists branches_select on public.branches;
create policy branches_select on public.branches for select to authenticated
using (
  public.is_admin()
  or (public.app_role() = any (array['management','referrer','developer'])
      and (
        public.app_reachable_agency(agency_id)
        -- a scoped caller keeps exactly the branch set their position expands to
        or (public.app_has_scope() and id in (select public.app_scope_branches()))
      ))
);
