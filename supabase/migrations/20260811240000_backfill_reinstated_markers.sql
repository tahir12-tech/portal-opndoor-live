-- Defect 10, part two: the backfill, and the constraint that stops it recurring.
--
-- ===========================================================================
-- RUN THIS DELIBERATELY. It edits historical rows.
-- ===========================================================================
-- Separated from the function fix on purpose. That one changes behaviour going
-- forward and is safe to apply anywhere. This one rewrites existing data, and
-- whoever applies it to production should do so having looked at what it will
-- touch rather than as a side effect of deploying something else.
--
-- Size it first. This is exactly how many reinstatements have already happened:
--
--   select count(*) from public.applications
--    where status in ('paid','deed')
--      and (expired_at is not null or withdrawn_at is not null);
--
-- If that number is zero, this migration is a no-op and the constraint below is
-- free. If it is not, read a few of the rows before continuing.
--
-- WHAT IS LOST: nothing that is not recorded elsewhere. Each of these rows has
-- an 'expired' or 'withdrawn' activity_log entry and a 'payment_reinstated'
-- entry, which is the history. The columns being cleared are state, not history,
-- and they currently describe a state the row is no longer in.

update public.applications
   set expired_at          = null,
       withdrawn_at        = null,
       withdrawn_reason    = null,
       withdrawn_note      = null,
       withdrawn_by        = null,
       withdrawn_by_tenant = false
 where status in ('paid', 'deed')
   and (expired_at is not null or withdrawn_at is not null);

-- Now it cannot recur. A paid or deed-issued application carrying either marker
-- is rejected at write time rather than left for a future report to trip over.
--
-- Deliberately NOT a partial index or a tidy view. Both hide the contradiction
-- instead of removing it, and the next person to write SQL against the base
-- table falls into the same trap, which is the actual cost of this defect.
alter table public.applications drop constraint if exists applications_no_stale_closure_markers;
alter table public.applications add constraint applications_no_stale_closure_markers
  check (
    status not in ('paid', 'deed')
    or (expired_at is null and withdrawn_at is null)
  );

do $$
declare v int;
begin
  select count(*) into v from public.applications
   where status in ('paid','deed') and (expired_at is not null or withdrawn_at is not null);
  if v > 0 then
    raise exception 'Backfill did not clear every row: % remain.', v;
  end if;
  raise notice 'Reinstated markers cleared and the constraint is in force.';
end $$;
