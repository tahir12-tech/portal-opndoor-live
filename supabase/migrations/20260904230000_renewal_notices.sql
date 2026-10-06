-- Renewal notices. A month before a guarantee ends, tell the tenant, the agent
-- or landlord on the application, and the referrer where there is one, so cover
-- can continue if the tenancy is. One notice per application (the ledger below).
-- Additive: the Rightmove referral path is untouched.

create table if not exists public.guarantee_renewal_notices (
  application_id uuid primary key references public.applications(id) on delete cascade,
  sent_at timestamptz not null default now()
);

-- Guarantees whose end date (tenancy start + 12 months - 1 day) falls within the
-- next 30 days and have not yet been noticed. Claims each into the ledger as it
-- returns it, so a second run the same day (the 07:00/08:00 pair) sends nothing,
-- and resolves the three recipients: tenant, the landlord if one was recorded
-- else the branch's agent contact, and the referrer.
create or replace function public.fire_renewal_notices(p_today date)
returns table (
  application_id uuid, guarantee_ref text, tenant_name text, property_addr text, end_date date,
  tenant_email text, contact_name text, contact_email text, referrer_name text, referrer_email text
)
language plpgsql security definer set search_path to ''
as $function$
-- The OUT columns share names with table columns (application_id, end_date, …);
-- resolve any ambiguity to the column, so `returning application_id` in the
-- ledger insert is the table's column, not the OUT variable.
#variable_conflict use_column
begin
  return query
  with due as (
    select a.id
    from public.applications a
    where a.status = 'deed'
      and coalesce(a.payment_state, '') <> 'refunded'
      and a.tenancy_start is not null
      and (a.tenancy_start + interval '12 months' - interval '1 day')::date between p_today and (p_today + 30)
      and not exists (select 1 from public.guarantee_renewal_notices g where g.application_id = a.id)
  ),
  ins as (
    insert into public.guarantee_renewal_notices (application_id)
    select id from due
    on conflict (application_id) do nothing
    returning application_id
  )
  select
    a.id,
    a.guarantee_ref,
    btrim(concat_ws(' ', nullif(btrim(coalesce(a.tenant_title, '')), ''), a.tenant_first_name, a.tenant_last_name)),
    btrim(a.prop_addr1 || case when coalesce(a.prop_postcode, '') <> '' then ', ' || a.prop_postcode else '' end),
    (a.tenancy_start + interval '12 months' - interval '1 day')::date,
    a.tenant_email,
    coalesce(nullif(btrim(coalesce(a.landlord_name, '')), ''), epc.name),
    coalesce(nullif(btrim(coalesce(a.landlord_email, '')), ''), epc.email),
    ru.full_name,
    ru.email
  from ins
  join public.applications a on a.id = ins.application_id
  left join lateral public.effective_primary_contact(a.branch_id) epc on true
  left join public.users ru on ru.id = a.referrer_id;
end $function$;

revoke all on function public.fire_renewal_notices(date) from public, anon;
grant execute on function public.fire_renewal_notices(date) to service_role;
