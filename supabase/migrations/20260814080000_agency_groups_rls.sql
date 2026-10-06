-- ===========================================================================
-- agency_groups shipped with RLS OFF. This closes it.
--
-- THE LEAK. 20260813010000 created the table and never enabled row level
-- security, and never wrote a policy. Under Supabase's default grants that
-- leaves SELECT held by both `authenticated` and `anon`, and the anon key ships
-- in the browser bundle. So the table was readable by anyone at all.
--
-- WHAT WAS EXPOSED. Every partner's group names, which is a client list, and
-- agency_groups.partner_rate / agent_rate, which are the commercial terms of
-- somebody else's deal. The sibling table built at the same time,
-- partner_agency_relationships, got RLS for exactly this reason and said so:
-- reading it would tell one partner which other partners work with an agency.
-- The group table is that same disclosure with the rates attached.
--
-- Found by an adversarial review of a LATER design, which flagged the missing
-- RLS on a proposed new table and cited this one as the bad precedent it would
-- inherit. The proposed table was never built. This defect was real.
--
-- The two policies match the sibling table exactly rather than inventing a rule:
--   permissive  select: an admin, or your own partner
--   restrictive all:    AAL2, which every other table in this schema requires
-- ===========================================================================

alter table public.agency_groups enable row level security;

drop policy if exists agency_groups_select on public.agency_groups;
create policy agency_groups_select on public.agency_groups
  for select to authenticated
  using (public.is_admin() or partner_id = public.app_partner());

-- Restrictive, so it ANDs with the permissive policy above and with any policy
-- added later. Writes stay closed: nothing has a policy for insert, update or
-- delete, so groups are created by the security definer RPC only.
drop policy if exists require_aal2 on public.agency_groups;
create policy require_aal2 on public.agency_groups
  as restrictive for all to authenticated
  using (public.is_aal2()) with check (public.is_aal2());

revoke all on public.agency_groups from anon;

comment on table public.agency_groups is
  'A group above the agency, for a national brand family. Rates here are an override and are commercially sensitive, so this table is read only by its own partner and by an admin.';

-- ---------------------------------------------------------------------------
-- Prove it is shut.
-- ---------------------------------------------------------------------------
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.agency_groups'::regclass) then
    raise exception 'RLS is still off on agency_groups';
  end if;

  if has_table_privilege('anon', 'public.agency_groups', 'select') then
    raise exception 'anon can still select agency_groups';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'public' and tablename = 'agency_groups'
         and cmd in ('INSERT', 'UPDATE', 'DELETE')) > 0 then
    raise exception 'a write policy appeared on agency_groups; groups are created through the RPC only';
  end if;
end $$;
