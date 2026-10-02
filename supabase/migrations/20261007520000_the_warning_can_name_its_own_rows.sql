-- ===========================================================================
-- "column reference application_id is ambiguous".
--
-- The third and last correction to the thirty-day close. The function
-- RETURNS TABLE (application_id uuid, ...), which declares an OUT variable
-- of that name, and its body also names the column `application_id` on
-- draft_closing_notices. PL/pgSQL resolves the variable, so the insert's
-- RETURNING and the final join both failed at run time -- not at creation,
-- which is why the first dry run against dev is what found it.
--
-- `#variable_conflict use_column` is how fire_renewal_notices, which has
-- the same shape and the same clash, already answers this; the RETURNING is
-- table-qualified as well so the one line that must mean the column cannot
-- be read as the variable whatever the setting.
-- ===========================================================================
create or replace function public.fire_draft_closing_notices(p_today date)
returns table (
  application_id uuid, guarantee_ref text, tenant_email text,
  tenant_first_name text, prop_addr1 text, prop_postcode text,
  days_quiet integer, closes_on date
)
language plpgsql security definer set search_path to '' as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select a.id
      from public.applications a
      join public.partners p on p.id = a.partner_id
     where a.livemode
       and a.status = 'draft'
       and p.slug = 'opndoor-direct'
       -- Nowhere to send it is not a warning, it is a silent failure.
       and coalesce(btrim(a.tenant_email), '') <> ''
       and (p_today - a.last_activity_at::date) >= 25
       and not exists (select 1 from public.draft_closing_notices d where d.application_id = a.id)
  ),
  ins as (
    insert into public.draft_closing_notices (application_id, days_quiet)
    select a.id, (p_today - a.last_activity_at::date)::integer
      from due join public.applications a on a.id = due.id
    on conflict (application_id) do nothing
    returning draft_closing_notices.application_id
  )
  select a.id, a.guarantee_ref, a.tenant_email, a.tenant_first_name,
         a.prop_addr1, a.prop_postcode,
         (p_today - a.last_activity_at::date)::integer,
         -- The day it actually closes, so the email states a date and a
         -- number of days left rather than assuming five: a draft already
         -- quiet for 28 days when this first runs has two days, not five.
         (a.last_activity_at::date + 30)
    from public.applications a
    join ins on ins.application_id = a.id;
end $$;

revoke all on function public.fire_draft_closing_notices(date) from public, anon, authenticated;
grant execute on function public.fire_draft_closing_notices(date) to service_role;
