-- ===========================================================================
-- sent_at IS NOT "WAS IT SENT".
--
-- 20261007490000 used `sent_at is null` to tell an application that closed
-- as an unfinished draft from one that lapsed with the fee unpaid, so that
-- signing in reopens the first and never the second. Measured on dev, that
-- test is false for every single draft: all eight carry a sent_at equal to
-- their created_at, because create_direct_application stamps it when the
-- application is born. The reopen matched nothing and said so quietly --
-- the round-trip test on dev is what caught it, not the compiler and not
-- the suite.
--
-- THE ANSWER IS TO RECORD IT RATHER THAN INFER IT. `expired_from` holds the
-- status an application was in when a sweep closed it. expire_stale_drafts
-- writes 'draft'; nothing else writes it at all, so:
--
--   expired_from = 'draft'   closed unfinished. Reopening restores exactly
--                            what the tenant left, and is theirs to trigger
--                            by signing in.
--   expired_from is null     every other expiry, including the eight rows
--                            already expired on dev and everything the
--                            fifteen-day unpaid sweep closes. Never
--                            reopened by signing in: that is a decision
--                            somebody makes, and reinstate already exists
--                            for it.
--
-- THE FIFTEEN-DAY SWEEP IS NOT CHANGED. It could write 'sent' for
-- symmetry, but nothing would read it, and touching the function that
-- lapses a referred tenant's application to tidy a column is the kind of
-- edit that gets found later by the person it surprised.
-- ===========================================================================
alter table public.applications add column if not exists expired_from text;

comment on column public.applications.expired_from is
  'The status an application held when a sweep expired it, written only by expire_stale_drafts (20261007530000). ''draft'' means it closed unfinished and reopen_expired_draft may restore it when the tenant signs in; null means every other expiry, which only a person reinstates.';

create or replace function public.expire_stale_drafts(p_today date)
returns integer language plpgsql security definer set search_path to '' as $$
declare n integer;
begin
  with gone as (
    update public.applications a
       set status = 'expired', expired_at = now(), expired_from = 'draft'
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

/* AND expired_from IS CLEARED ON THE WAY BACK, so a reopened application
   that is later closed by hand is not reopened again by the next sign-in.
   The column says how it closed THIS time or nothing at all. */
create or replace function public.reopen_expired_draft(p_applicant uuid)
returns integer language plpgsql security definer set search_path to '' as $$
declare n integer;
begin
  with back as (
    update public.applications a
       set status = 'draft', expired_at = null, expired_from = null
     where a.applicant_id = p_applicant
       and a.status = 'expired'
       and a.expired_from = 'draft'
    returning a.id
  ),
  cleared as (
    delete from public.draft_closing_notices d using back where d.application_id = back.id
    returning 1
  ),
  logged as (
    insert into public.activity_log(application_id, kind, message, actor, visibility)
    select id, 'reopened',
           'Unfinished application reopened where it left off: the tenant signed in again.',
           'System', 'business'
    from back
    returning 1
  )
  select count(*) into n from logged;
  return coalesce(n, 0);
end $$;

revoke all on function public.expire_stale_drafts(date) from public, anon, authenticated;
grant execute on function public.expire_stale_drafts(date) to service_role;
revoke all on function public.reopen_expired_draft(uuid) from public, anon, authenticated;
grant execute on function public.reopen_expired_draft(uuid) to service_role;
