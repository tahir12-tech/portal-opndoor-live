-- ===========================================================================
-- THE WARNING HAS TO BE ABLE TO SAY "FIVE DAYS".
--
-- A correction to 20261007490000, in a new file because an applied
-- migration is never re-run: dev has to equal a clean filename-order apply,
-- and the one time that stopped being true a revoke that broke every user
-- invite sat green in the suite for a day.
--
-- WHAT WAS WRONG. Both sweeps compared a timestamp against MIDNIGHT of
-- p_today minus an interval, copying expire_stale_applications, whose own
-- comment records the consequence: "Fifteen days, not fourteen: the
-- comparison is against MIDNIGHT of p_today, so the fourteen-day interval
-- lands on the sixteenth calendar day."
--
-- On the fifteen-day sweep that is a documented quirk nobody reads. Here it
-- is a lie in an email. Matt asked for the warning "at 25 days with no
-- activity" saying the application "will close in 5 days"; under the
-- interval test a draft quiet for exactly 25 days does not qualify, so the
-- first one that does has been quiet 26 days and has FOUR days left. The
-- email would have said five.
--
-- SO BOTH COUNT DAYS. `(p_today - last_activity_at::date)` is a whole
-- number of calendar days, the same number the screen shows and the same
-- one the sentence uses, and 30 minus it is the days left. The warning
-- fires at exactly 25 and the close at exactly 30, which is what was asked
-- for and what the email can now state.
--
-- THE FIFTEEN-DAY SWEEP IS LEFT ALONE. Its arithmetic is wrong in the same
-- way and is not what was reported; changing it here would move the day a
-- referred tenant's application lapses as a side effect of a draft change.
-- ===========================================================================

create or replace function public.expire_stale_drafts(p_today date)
returns integer language plpgsql security definer set search_path to '' as $$
declare n integer;
begin
  with gone as (
    update public.applications a
       set status = 'expired', expired_at = now()
      from public.partners p
     where p.id = a.partner_id
       and a.livemode
       and a.status = 'draft'
       and p.slug = 'opndoor-direct'
       and (p_today - a.last_activity_at::date) >= 30
    returning a.id
  ),
  logged as (
    insert into public.activity_log(application_id, kind, message, actor, visibility)
    select id, 'expired',
           'Unfinished application closed: 30 days with no activity. It reopens where it left off if the tenant signs in again.',
           'System', 'business'
    from gone
    returning 1
  )
  select count(*) into n from logged;
  return coalesce(n, 0);
end $$;

create or replace function public.fire_draft_closing_notices(p_today date)
returns table (
  application_id uuid, guarantee_ref text, tenant_email text,
  tenant_first_name text, prop_addr1 text, prop_postcode text,
  days_quiet integer, closes_on date
)
language plpgsql security definer set search_path to '' as $$
begin
  return query
  with due as (
    select a.id
      from public.applications a
      join public.partners p on p.id = a.partner_id
     where a.livemode
       and a.status = 'draft'
       and p.slug = 'opndoor-direct'
       and coalesce(btrim(a.tenant_email), '') <> ''
       and (p_today - a.last_activity_at::date) >= 25
       and not exists (select 1 from public.draft_closing_notices d where d.application_id = a.id)
  ),
  ins as (
    insert into public.draft_closing_notices (application_id, days_quiet)
    select a.id, (p_today - a.last_activity_at::date)::integer
      from due join public.applications a on a.id = due.id
    on conflict (application_id) do nothing
    returning application_id
  )
  select a.id, a.guarantee_ref, a.tenant_email, a.tenant_first_name,
         a.prop_addr1, a.prop_postcode,
         (p_today - a.last_activity_at::date)::integer,
         (a.last_activity_at::date + 30)
    from public.applications a
    join ins on ins.application_id = a.id;
end $$;

-- `create or replace` keeps the grants, but both are re-stated so a reader
-- of this file alone can see who may call them. service_role only: the
-- browser never runs a sweep.
revoke all on function public.expire_stale_drafts(date) from public, anon, authenticated;
grant execute on function public.expire_stale_drafts(date) to service_role;
revoke all on function public.fire_draft_closing_notices(date) from public, anon, authenticated;
grant execute on function public.fire_draft_closing_notices(date) to service_role;
