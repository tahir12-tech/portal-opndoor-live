-- Defect 15: the activity log message says fifteen days, matching the code.
--
-- THE PREDICATE IS NOT CHANGED, deliberately. It compares sent_at against
-- midnight of the current day minus fourteen days, so an application sent at any
-- hour on the 1st lapses on the 16th: fifteen days. Changing it to match the
-- words would shorten the window for every application already in flight, which
-- is a policy decision with real tenants on the other end of it.
--
-- The behaviour is the thing that has been running for months. The words are
-- what is wrong.
--
-- Reproduced from 20260705115059 with the message corrected and nothing else
-- changed.

create or replace function public.expire_stale_applications(p_today date)
returns integer
language plpgsql security definer set search_path to ''
as $function$
declare n integer;
begin
  with expired as (
    update public.applications
      set status = 'expired', expired_at = now()
      where status = 'sent'
        and sent_at is not null
        -- Fifteen days, not fourteen: the comparison is against MIDNIGHT of
        -- p_today, so the fourteen-day interval lands on the sixteenth calendar
        -- day. Left exactly as it was; only the message below changed.
        and sent_at < (p_today::timestamptz - interval '14 days')
      returning id
  ),
  logged as (
    insert into public.activity_log(application_id, kind, message, actor, visibility)
    select id, 'expired', 'Application expired: guarantor fee unpaid 15 days after referral.', 'System', 'business'
    from expired
    returning 1
  )
  select count(*) into n from logged;
  return coalesce(n, 0);
end $function$;
