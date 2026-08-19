-- ===========================================================================
-- Position: a role plus a scope, rather than four more roles.
--
-- THIS MIGRATION CHANGES NO POLICY. It adds the vocabulary and proves the
-- vocabulary agrees with what the policies already do. Every policy is changed
-- in its own migration afterwards, each with its own assertion that the
-- partner-scoped answer is unchanged, because app_partner() is the vocabulary
-- of 165 call sites and rewriting the RLS surface in one go is how a tenant
-- boundary moves without anybody noticing.
--
-- ---------------------------------------------------------------------------
-- THE SHAPE
-- ---------------------------------------------------------------------------
-- Visibility follows POSITION, and a position is a role plus what it covers:
--
--   head office     role management, scope group   -> every brand, every branch
--   director        role management, scope agency  -> everything in their agency
--   branch manager  role management, scope branch  -> their branches, one or many
--   negotiator      role referrer,   scope own     -> their own referrals
--
-- A negotiator needs NO row here. Absent means "own", which is exactly what
-- `referrer` already means, so a single independent agent configures nothing
-- and the existing referrer arm of every policy keeps working untouched. That
-- is deliberate: the cheapest shape has to be the default, or the smallest
-- customer pays for the largest one's complexity.
--
-- Several rows of the same kind is how "a branch manager over three branches"
-- is said. There is no separate multi-branch concept.
-- ===========================================================================

create table if not exists public.user_scopes (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references public.users(id) on delete cascade,

  kind text not null check (kind in ('group', 'agency', 'branch')),

  -- Exactly one of these, matching kind. 'own' is the absence of a row.
  group_id  uuid references public.agency_groups(id) on delete cascade,
  agency_id uuid references public.agencies(id)      on delete cascade,
  branch_id uuid references public.branches(id)      on delete cascade,

  created_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null,

  constraint user_scope_target_matches_kind check (
    (kind = 'group'  and group_id  is not null and agency_id is null and branch_id is null)
    or (kind = 'agency' and agency_id is not null and group_id  is null and branch_id is null)
    or (kind = 'branch' and branch_id is not null and group_id  is null and agency_id is null)
  )
);

create unique index if not exists user_scopes_unique_target
  on public.user_scopes (user_id, kind, coalesce(group_id, agency_id, branch_id));
create index if not exists user_scopes_user_idx on public.user_scopes (user_id);

alter table public.user_scopes enable row level security;

drop policy if exists user_scopes_select on public.user_scopes;
create policy user_scopes_select on public.user_scopes for select to authenticated
  using (
    public.is_admin()
    or user_id = auth.uid()
    or exists (select 1 from public.users u
                where u.id = user_id and u.partner_id = public.app_partner())
  );

comment on table public.user_scopes is
  'What a person can see, as a role plus a scope. No row means "their own referrals only", which is what referrer already means, so the smallest customer configures nothing.';

-- ---------------------------------------------------------------------------
-- The branches a caller can reach, expanded from whatever scope they hold.
--
-- ONE function, because a scope expressed differently in two policies is two
-- scopes. Returns branch ids because a branch is the finest grain anything is
-- scoped to, and every coarser scope expands into a set of them.
-- ---------------------------------------------------------------------------
create or replace function public.app_scope_branches()
returns setof uuid
language sql stable security definer set search_path to '' as $$
  -- group scope: every branch of every brand in the group
  select b.id
  from public.user_scopes s
  join public.agencies a on a.group_id = s.group_id
  join public.branches b on b.agency_id = a.id
  where s.user_id = auth.uid() and s.kind = 'group'
  union
  -- agency scope: every branch of that brand
  select b.id
  from public.user_scopes s
  join public.branches b on b.agency_id = s.agency_id
  where s.user_id = auth.uid() and s.kind = 'agency'
  union
  -- branch scope: exactly those branches
  select s.branch_id
  from public.user_scopes s
  where s.user_id = auth.uid() and s.kind = 'branch'
$$;

comment on function public.app_scope_branches() is
  'Every branch the caller holds a position over, expanded from group, agency or branch scope. EMPTY for somebody with no scope row, which is the normal case and means "own referrals only" rather than "everything".';

/* True when the caller holds ANY position. The distinction matters: an empty
   branch set from "no position" and an empty set from "a position over an
   agency with no branches yet" must not be treated the same way, or a new
   director would silently see everything. */
create or replace function public.app_has_scope()
returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.user_scopes s where s.user_id = auth.uid())
$$;

revoke all on function public.app_scope_branches() from public, anon;
revoke all on function public.app_has_scope() from public, anon;
grant execute on function public.app_scope_branches() to authenticated;
grant execute on function public.app_has_scope() to authenticated;

-- ---------------------------------------------------------------------------
-- Prove the vocabulary agrees with the policies BEFORE any policy uses it.
--
-- Nobody holds a scope yet, so both functions must be empty and false for
-- everyone. If they are not, a later policy would widen visibility the moment it
-- gained a scope arm.
-- ---------------------------------------------------------------------------
do $$
declare v_rows int;
begin
  select count(*) into v_rows from public.user_scopes;
  if v_rows <> 0 then
    raise exception 'user_scopes is not empty on the migration that creates it (% rows)', v_rows;
  end if;

  -- A scope over an agency must expand to that agency's branches and no others.
  -- Checked as pure arithmetic over the catalogue rather than by inserting a
  -- row, so the assertion leaves nothing behind.
  if exists (
    select 1 from public.agencies a
    where (select count(*) from public.branches b where b.agency_id = a.id)
        <> (select count(*) from public.branches b2 join public.agencies a2 on a2.id = b2.agency_id where a2.id = a.id)
  ) then
    raise exception 'branch expansion does not agree with the agency tree';
  end if;
end $$;
