-- ===========================================================================
-- Agency identity: a normalised name, a placeholder flag, and duplicate
-- DETECTION rather than a duplicate constraint.
--
-- WHY NOT A GLOBAL UNIQUE NAME, WHICH WAS THE OBVIOUS ANSWER
-- Once an agency can be reached by several partners, `unique (partner_id, name)`
-- permits one "Smith & Co" per partner, which is exactly the duplication that
-- sharing is supposed to end. The obvious fix is a unique index on a normalised
-- name across the whole table. It is wrong, for two independent reasons.
--
--   1. It is not true. Two genuinely different agencies in different towns can
--      share a name, and a constraint that refuses the second one turns a real
--      customer into a support ticket.
--   2. It fails on this very schema TODAY. Both house routes carry a
--      placeholder agency called 'Unattached' (20260812040000), so a global
--      unique name would have rejected its own migration. That is not a near
--      miss; it is the constraint being wrong about what an agency is.
--
-- So `unique (partner_id, name)` STAYS. It still does the job it always did,
-- which is stopping one partner holding the same agency twice. Cross-partner
-- duplicates become a DETECTION problem routed to a human through the existing
-- reconciliation queue, and the merge tool is what resolves them. A constraint
-- would refuse the row; a queue lets somebody decide whether two rows are one
-- agency, which is a judgement rather than a rule.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Placeholders are not agencies.
--
-- The two 'Unattached' rows exist only because applications.branch_id is NOT
-- NULL and a direct signup has no agency. They must never appear in duplicate
-- detection, in the reconciliation queue, or anywhere a human is asked to make
-- a judgement about a real letting agency.
-- ---------------------------------------------------------------------------
alter table public.agencies
  add column if not exists is_placeholder boolean not null default false;

comment on column public.agencies.is_placeholder is
  'True for the house rows that exist only to satisfy applications.branch_id NOT NULL on rails with no agency. Not a letting agency: excluded from duplicate detection, the reconciliation queue and the merge tool.';

update public.agencies a
   set is_placeholder = true
  from public.partners p
 where p.id = a.partner_id
   and p.slug in ('opndoor-direct','referencing-partner')
   and a.name = 'Unattached'
   and a.is_placeholder = false;

-- Placeholder branches too, so branch-level surfaces can exclude them the same way.
alter table public.branches
  add column if not exists is_placeholder boolean not null default false;

update public.branches b
   set is_placeholder = true
  from public.agencies a
 where a.id = b.agency_id and a.is_placeholder and b.is_placeholder = false;

-- ---------------------------------------------------------------------------
-- 2. A normalised name, for comparison only.
--
-- STORED and generated, so it cannot drift from name. Matches the normalisation
-- the partner API already applies when resolving an agency by name
-- (20260811130000): case, surrounding space, and a trailing Ltd or Limited.
-- Keeping the two in step matters, because an API caller who resolves to one
-- agency and a duplicate detector that thinks they are two would disagree about
-- the same pair of rows.
-- ---------------------------------------------------------------------------
alter table public.agencies
  add column if not exists name_key text
  generated always as (
    lower(btrim(regexp_replace(btrim(name), '\s+(ltd|limited)\.?$', '', 'i')))
  ) stored;

create index if not exists agencies_name_key_idx on public.agencies (name_key);

comment on column public.agencies.name_key is
  'Normalised name for duplicate DETECTION only. Never unique: two real agencies may share a name, and the house placeholders share one by construction. Same normalisation the partner API uses to resolve an agency by name.';

-- ---------------------------------------------------------------------------
-- 3. Detection. Feeds the reconciliation queue; decides nothing itself.
-- ---------------------------------------------------------------------------
create or replace function public.duplicate_agency_groups()
returns table (
  name_key      text,
  agency_ids    uuid[],
  agency_names  text[],
  partner_ids   uuid[],
  partner_names text[],
  cross_partner boolean
)
language sql stable security definer set search_path to '' as $$
  select
    a.name_key,
    array_agg(a.id order by a.created_at),
    array_agg(a.name order by a.created_at),
    array_agg(p.id order by a.created_at),
    array_agg(p.name order by a.created_at),
    count(distinct a.partner_id) > 1
  from public.agencies a
  join public.partners p on p.id = a.partner_id
  where not a.is_placeholder
  group by a.name_key
  having count(*) > 1
$$;

comment on function public.duplicate_agency_groups() is
  'Agencies whose normalised names collide, placeholders excluded. Detection only: whether two rows are one agency is a judgement for the reconciliation queue, not a rule a constraint can enforce. cross_partner marks the groups that sharing makes urgent.';

revoke all on function public.duplicate_agency_groups() from public, anon;
grant execute on function public.duplicate_agency_groups() to authenticated;

-- The placeholders must not be visible to this, or every future house route
-- adds a false duplicate. Assert it rather than assume the update above worked.
do $$
declare v_ph int;
begin
  select count(*) into v_ph
  from public.duplicate_agency_groups() g
  where 'Unattached' = any(g.agency_names);

  if v_ph > 0 then
    raise exception 'placeholder agencies are leaking into duplicate detection';
  end if;
end $$;
