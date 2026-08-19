-- ===========================================================================
-- POLICY 2 AND 3 OF 3: agencies_select and branches_select gain a scope arm.
--
-- Together because they are one question asked at two grains: reaching an
-- agency and reaching its branches are the same entitlement, and splitting them
-- across two migrations would leave a state where somebody could see branches
-- of an agency they could not see.
--
-- Both existing expressions are reproduced verbatim from
-- 20260812120000_org_visibility_by_relationship.sql:49-68.
--
-- WHY A POSITION HOLDER NEEDS AN ARM HERE AT ALL. Reachability answers "may
-- this PARTNER reach this agency". A position answers "may this PERSON". A
-- branch manager at a group whose partner reaches fifty agencies should see
-- three branches, not fifty agencies, and the reachability arm alone would show
-- them everything their employer can reach.
--
-- So the arm here NARROWS rather than widens: it is only consulted for somebody
-- who holds a position, and for them it is the answer. Somebody with no
-- position keeps the reachability arm exactly as before.
-- ===========================================================================

drop policy if exists agencies_select on public.agencies;
create policy agencies_select on public.agencies for select to authenticated
  using (
    public.is_admin()
    or (
      public.app_role() in ('management','referrer','developer')
      and (
        case
          -- A position is the answer when there is one.
          when public.app_has_scope()
            then id in (select b.agency_id from public.branches b
                         where b.id in (select public.app_scope_branches()))
          -- Otherwise unchanged: what the partner can reach.
          else public.partner_can_reach_agency(id)
        end
      )
    )
  );

drop policy if exists branches_select on public.branches;
create policy branches_select on public.branches for select to authenticated
  using (
    public.is_admin()
    or (
      public.app_role() in ('management','referrer','developer')
      and (
        case
          when public.app_has_scope() then id in (select public.app_scope_branches())
          else public.partner_can_reach_agency(agency_id)
        end
      )
    )
  );

comment on policy agencies_select on public.agencies is
  'Admin, or a staff role who either holds a POSITION covering one of this agency''s branches, or whose partner can reach it. The position NARROWS: a branch manager sees their branches, not everything their employer can reach.';

do $$
declare v_scopes int; v_a text; v_b text;
begin
  select count(*) into v_scopes from public.user_scopes;
  if v_scopes > 0 then
    raise exception 'user_scopes is not empty, so this migration cannot prove it changed nothing.';
  end if;

  select pg_get_expr(polqual, polrelid) into v_a from pg_policy
   where polrelid = 'public.agencies'::regclass and polname = 'agencies_select';
  select pg_get_expr(polqual, polrelid) into v_b from pg_policy
   where polrelid = 'public.branches'::regclass and polname = 'branches_select';

  -- Reachability must still be the answer for everyone without a position.
  if position('partner_can_reach_agency' in v_a) = 0 or position('partner_can_reach_agency' in v_b) = 0 then
    raise exception 'a reachability arm was lost: agencies=%, branches=%', v_a, v_b;
  end if;
  if position('app_scope_branches' in v_a) = 0 or position('app_scope_branches' in v_b) = 0 then
    raise exception 'a scope arm is missing';
  end if;

  -- And CONTACTS must still be untouched. Same guard as 20260812120000: sharing
  -- an agency never shares a contact book, and a position must not become the
  -- loophole that reachability was refused.
  if position('app_scope_branches' in (
        select pg_get_expr(polqual, polrelid) from pg_policy
         where polrelid = 'public.agent_contacts'::regclass and polname = 'contacts_select')) > 0 then
    raise exception 'contacts_select has gained a scope arm. A position must not share a contact book any more than reachability may.';
  end if;
end $$;
