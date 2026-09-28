-- A STATEMENT REFERENCE BELONGS TO ITS PAYEE.
--
-- csr_select read, in full:
--
--   using (is_aal2())
--
-- Any signed-in user who has completed a second factor could read every
-- statement reference on the system. Measured on dev as Rosa Vance, a Manager
-- at Regent's: she reads Northgate Lettings' reference as well as her own.
--
-- A reference is (statement_month, payee_key, seq). It is not money, but the
-- payee_key names the party and the seq is the document number on their
-- paperwork, so it says who Opndoor pays and roughly how many statements they
-- have had. It belongs to the payee.
--
-- payee_key is '<partner slug>|<level>:<org uuid>' -- the shape
-- commission_statement_party builds and buildCommissionStatementDoc addresses.
-- Rather than parse it in a policy, the org id is split out and handed to the
-- reach predicates, which already know what an agency, a branch and a group
-- are. A key that does not parse is admin-only, which is the safe direction:
-- a malformed key is not somebody's to read by default.

drop policy if exists csr_select on public.commission_statement_refs;
create policy csr_select on public.commission_statement_refs
  for select
  using (
    public.is_aal2()
    and (
      public.is_admin()
      or public.app_role() = 'opndoor_manager'
      or (
        -- '<partner>|<level>:<uuid>' -> the uuid after the last colon.
        split_part(payee_key, ':', 2) ~ '^[0-9a-f-]{36}$'
        and (
          case split_part(split_part(payee_key, '|', 2), ':', 1)
            when 'agency' then public.app_may_reach_agency(split_part(payee_key, ':', 2)::uuid)
            when 'branch' then public.app_may_reach_branch(split_part(payee_key, ':', 2)::uuid)
            when 'group'  then exists (
              select 1 from public.agencies a
               where a.group_id = split_part(payee_key, ':', 2)::uuid
                 and public.app_may_reach_agency(a.id))
            else false
          end
        )
      )
    )
  );

comment on policy csr_select on public.commission_statement_refs is
  'A statement reference is readable by the payee it belongs to, and by Opndoor. It used to be readable by anybody with a second factor: the policy was is_aal2() and nothing else.';
