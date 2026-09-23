-- Convert group rates to per-agency lines, BY INTENT.
--
-- Under the old most-specific-wins model a group rate was an inherited DEFAULT:
-- "every agency under Meridian earns 2% unless it says otherwise", and the money
-- was paid to the AGENCY. Under the additive model the same row would mean
-- something entirely different -- "the GROUP earns 2% on top" -- and every agency
-- that had been relying on it as its default would drop to earning nothing.
--
-- So the rows are migrated by what they MEANT, not by where they sat: each group
-- rate is written onto the agencies that were inheriting it, at the same number,
-- and the group slot is cleared. An agency that already had its own rate was
-- already overriding the group and is left alone.
--
-- Afterwards a group rate means the new thing, and only a deliberate new one is
-- ever an additive line paid to the group.
create or replace function public.migrate_group_rates_to_agency_lines()
returns table (agencies_updated int, groups_cleared int)
language plpgsql security definer set search_path to ''
as $function$
declare v_ag int; v_gr int;
begin
  -- Agencies that were inheriting their group's rate take it as their own.
  with moved as (
    update public.agencies a
       set agent_rate = g.agent_rate
      from public.agency_groups g
     where g.id = a.group_id
       and g.agent_rate is not null
       and a.agent_rate is null
    returning a.id
  )
  select count(*) into v_ag from moved;

  -- The group slot is cleared: it no longer means "the default for my agencies".
  with cleared as (
    update public.agency_groups set agent_rate = null
     where agent_rate is not null
    returning id
  )
  select count(*) into v_gr from cleared;

  return query select v_ag, v_gr;
end $function$;

comment on function public.migrate_group_rates_to_agency_lines() is
  'One-off conversion from most-specific-wins to the additive split: every group rate is pushed down onto the agencies that were inheriting it (same number, same payee) and the group slot is cleared. Idempotent - a second run finds nothing to move.';

revoke all on function public.migrate_group_rates_to_agency_lines() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Run it, with the payout-invariance assertion the change stands or falls on.
-- ---------------------------------------------------------------------------
do $$
declare v_before int; v_changed int; v_ag int; v_gr int; v_apps_before bigint; v_apps_after bigint;
begin
  create temp table _payout_before on commit drop as
  select b.id as branch_id,
         (select r.agent_rate from public.resolve_rates(b.id, b.partner_id) r) as old_rate
  from public.branches b
  join public.partners p on p.id = b.partner_id
  where p.referencing_mode = 'opndoor_referenced';

  select count(*) into v_before from _payout_before;

  -- Applications must not move at all. Their snapshots are frozen.
  select count(*) into v_apps_before from public.applications where agent_rate is not null;

  select m.agencies_updated, m.groups_cleared into v_ag, v_gr
  from public.migrate_group_rates_to_agency_lines() m;

  -- Every branch must pay out exactly what it paid out before.
  select count(*) into v_changed
  from _payout_before pb
  join public.branches b on b.id = pb.branch_id
  where coalesce(public.commission_total(b.id, b.partner_id), -1)
        is distinct from coalesce(pb.old_rate, -1);

  if v_changed > 0 then
    raise exception 'REFUSING: % of % agent-rail branches would change payout. Migration aborted.',
      v_changed, v_before;
  end if;

  select count(*) into v_apps_after from public.applications where agent_rate is not null;
  if v_apps_after is distinct from v_apps_before then
    raise exception 'REFUSING: application snapshots changed (% -> %).', v_apps_before, v_apps_after;
  end if;

  raise notice 'Group rates migrated: % agency rate(s) written, % group slot(s) cleared, % branches all paying out unchanged.',
    v_ag, v_gr, v_before;
end $$;
