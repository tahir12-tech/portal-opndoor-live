-- ===========================================================================
-- A group above the agency, and the rate moving to where the deal was done.
--
-- WHY A NEW LEVEL AND NOT A NESTED AGENCY
-- A group holds several brands and each brand holds branches, so the tree needs
-- three levels and today it has two. Nesting agencies under agencies looks
-- cheaper and is not: sync_branch_partner forces branches.partner_id from the
-- agency on every insert, partner_can_reach_agency answers a flat question, and
-- GET /orgs shapes exactly agency -> branches. All three would have to become
-- recursive, and "everything in my agency" would become a recursive query in an
-- RLS predicate, on the hot path of every org screen.
--
-- WHY NOT ONE PARTNER PER BRAND, which is structurally cheapest
-- Each brand would need its own API key, its own rate-limit bucket, its own
-- webhook registry and its own developer. And head-office-sees-everything
-- becomes impossible, because every read path in both the portal and the API is
-- scoped to a single app_partner().
--
-- ---------------------------------------------------------------------------
-- WHERE THE RATE LIVES, WHICH IS A COMMERCIAL FACT AND NOT A HIERARCHY ONE
-- ---------------------------------------------------------------------------
-- A group acquires brands at different times on different terms, so the rate
-- belongs to the AGENCY where the deal was done. The group is a reporting and
-- visibility layer that MAY override, and usually does not.
--
-- Resolution, most specific first:
--   1. the group's override, when one is set
--   2. the agency's own rate, when one is set
--   3. the partner's rate, which is what every application uses today
--
-- Every level is NULLABLE and null means "inherit". That is what makes this
-- additive: no agency has a rate today, so every application resolves to the
-- partner's rate exactly as it does now, and the migration asserts it.
--
-- The group override sits ABOVE the agency deliberately. An override that lost
-- to the thing it overrides would not be one; a renegotiated group-wide term is
-- the case it exists for.
-- ===========================================================================

create table if not exists public.agency_groups (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,

  name text not null,
  -- Same normalisation as agencies, for the same reason: duplicate detection
  -- has to agree with the thing it is detecting duplicates of.
  name_key text generated always as (
    lower(btrim(regexp_replace(btrim(name), '\s+(ltd|limited)\.?$', '', 'i')))
  ) stored,

  -- The override. Null means the agency decides, which is the normal case.
  partner_rate numeric(5,4) check (partner_rate is null or (partner_rate >= 0 and partner_rate <= 1)),
  agent_rate   numeric(5,4) check (agent_rate   is null or (agent_rate   >= 0 and agent_rate   <= 1)),

  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),

  unique (partner_id, name)
);

create index if not exists agency_groups_name_key_idx on public.agency_groups (name_key);

alter table public.agencies
  add column if not exists group_id uuid references public.agency_groups(id) on delete set null;
create index if not exists agencies_group_idx on public.agencies (group_id);

-- The rate at the agency, which is where the deal was done.
alter table public.agencies
  add column if not exists partner_rate numeric(5,4) check (partner_rate is null or (partner_rate >= 0 and partner_rate <= 1)),
  add column if not exists agent_rate   numeric(5,4) check (agent_rate   is null or (agent_rate   >= 0 and agent_rate   <= 1));

comment on table public.agency_groups is
  'A brand group above the agency: many brands, each with many branches, one head office seeing across all of them. Carries an OPTIONAL rate override; the rate normally lives on the agency where the deal was done.';
comment on column public.agencies.group_id is
  'The group this brand belongs to, NULL for an agency that is not part of one. Nullable permanently: a single independent agent has no group and must never be asked to create one.';
comment on column public.agencies.partner_rate is
  'This agency''s own commission rate, NULL to inherit the partner''s. A group acquires brands on different terms, so the rate belongs where the deal was done.';

-- group_name was free text with one writer, no update path, and it appears in
-- no policy. It is kept as-is rather than migrated: HubSpot reads it and
-- rewriting that mapping is a separate job with its own blast radius. New work
-- uses group_id.
comment on column public.agencies.group_name is
  'SUPERSEDED as a structure by group_id. Free text, read only by the HubSpot mapping and the org screen. Do not use it as a key: two brands spelled differently are two groups.';

-- ---------------------------------------------------------------------------
-- The rate, resolved in one place.
--
-- Both create paths must use this or they will disagree about what an agency
-- earns, and the disagreement would be invisible because the rate is snapshotted
-- onto the application and never recomputed.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_rates(p_branch uuid, p_route_partner uuid)
returns table (partner_rate numeric, agent_rate numeric)
language sql stable security definer set search_path to '' as $$
  select
    coalesce(g.partner_rate, a.partner_rate, p.partner_rate),
    coalesce(g.agent_rate,   a.agent_rate,   p.agent_rate)
  from public.partners p
  left join public.branches b on b.id = p_branch
  left join public.agencies a on a.id = b.agency_id
  left join public.agency_groups g on g.id = a.group_id
  where p.id = p_route_partner
$$;

comment on function public.resolve_rates(uuid, uuid) is
  'Commission for an application: the group override, else the agency''s own rate, else the partner''s. Every level is nullable and null means inherit, so with no agency or group rate set this returns exactly what the partner path returned before groups existed.';

revoke all on function public.resolve_rates(uuid, uuid) from public, anon;
grant execute on function public.resolve_rates(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Nothing may have changed. No agency or group carries a rate yet, so every
-- branch must resolve to its partner's rate exactly as before.
-- ---------------------------------------------------------------------------
do $$
declare v_bad int;
begin
  select count(*) into v_bad
  from public.branches b
  join public.partners p on p.id = b.partner_id
  cross join lateral public.resolve_rates(b.id, b.partner_id) r
  where r.partner_rate is distinct from p.partner_rate
     or r.agent_rate   is distinct from p.agent_rate;
  if v_bad > 0 then
    raise exception '% branch(es) would resolve to a different rate than before groups existed', v_bad;
  end if;
end $$;
