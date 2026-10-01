-- =========================================================================
-- THE SAME NAME IN TWO ESTATES IS NOT A DUPLICATE.
--
-- Matt, 2026-10-01: "The same real company can exist in both estates
-- (Frost as Opndoor's client and Frost under Rightmove). They are two
-- separate records that never link, share nothing, and never show each
-- other's data. Remove the duplicate-name warning across estates; keep it
-- only within one estate."
--
-- WHAT WAS THERE. `duplicate_agency_groups()` grouped by name_key across
-- the whole table and returned `cross_partner` to mark the groups where
-- the collision spanned two partners. Its own comment called those "the
-- groups that sharing makes urgent" -- urgent because under the ruling of
-- 2026-08-17 an agency existed once and two partner rows of one name were
-- a thing to merge. That ruling is gone. Two partner rows of one name are
-- now the designed state, and a detector that reports them is a queue of
-- work nobody should ever do.
--
-- WHAT IT IS NOW. The same detector, per estate: group by partner AND
-- name_key, so it reports two Frosts under Rightmove (a real duplicate
-- somebody should merge) and says nothing about Opndoor's Frost beside
-- Rightmove's. `cross_partner` goes rather than becoming a column that is
-- always false, because a false column is still a question being asked.
-- `partner_ids`/`partner_names` stay: one value each now, and the caller
-- still has to be told which estate the duplicate is in.
--
-- THE SCREEN WAS ALREADY RIGHT. The reconciliation queue the admin
-- actually reads is `reconciliation_queue()`, which has always matched a
-- pending name against confirmed ones `where a.partner_id = p.partner_id`.
-- Nothing on screen changes today. This closes the other door, which is
-- service-role only and has no caller in the repo: the next person to
-- reach for a duplicate report must get the per-estate answer, not a
-- cross-estate one that reads as a defect.
--
-- GRANTS: service_role only, as 20261006330000 left it. Not widened here.
-- =========================================================================

drop function if exists public.duplicate_agency_groups();

create or replace function public.duplicate_agency_groups()
returns table (
  name_key      text,
  partner_id    uuid,
  partner_name  text,
  agency_ids    uuid[],
  agency_names  text[]
)
language sql stable security definer set search_path to '' as $$
  select
    a.name_key,
    a.partner_id,
    min(p.name),
    array_agg(a.id order by a.created_at),
    array_agg(a.name order by a.created_at)
  from public.agencies a
  join public.partners p on p.id = a.partner_id
  where not a.is_placeholder
  group by a.name_key, a.partner_id
  having count(*) > 1
$$;

comment on function public.duplicate_agency_groups() is
  'Agencies whose normalised names collide WITHIN ONE ESTATE, placeholders excluded. Two estates holding the same name are two separate records by design (Matt, 2026-10-01) and are not reported. Detection only: whether two rows in one estate are one agency is a judgement for the reconciliation queue, not a rule a constraint can enforce.';

revoke all on function public.duplicate_agency_groups() from public, anon, authenticated;
grant execute on function public.duplicate_agency_groups() to service_role;

-- The placeholders must stay invisible to this, or every future house route
-- adds a false duplicate. Asserted when the function was written and
-- re-asserted here, because the grouping changed underneath it.
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

-- AND THE THING THIS MIGRATION EXISTS FOR, asserted against the real
-- table: two estates holding one name must not be reported. Built and
-- rolled back inside the DO block so the check leaves nothing behind.
do $$
declare
  v_ours uuid;
  v_theirs uuid;
  v_hits int;
begin
  select id into v_ours from public.partners where slug = 'opndoor-agents';
  select id into v_theirs from public.partners
   where slug <> 'opndoor-agents' and not public.is_house_partner_id(id)
   order by created_at limit 1;

  if v_ours is null or v_theirs is null then
    raise notice 'two-estate check skipped: no second estate on this database';
    return;
  end if;

  insert into public.agencies (partner_id, name, review_state)
  values (v_ours, 'Zzz Estate Probe', 'confirmed'),
         (v_theirs, 'Zzz Estate Probe', 'confirmed');

  select count(*) into v_hits
  from public.duplicate_agency_groups() g
  where 'Zzz Estate Probe' = any(g.agency_names);

  delete from public.agencies where name = 'Zzz Estate Probe';

  if v_hits > 0 then
    raise exception 'the same name in two estates is still reported as a duplicate';
  end if;
end $$;
