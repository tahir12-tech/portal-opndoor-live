-- The commission-rate application RPC is SECURITY DEFINER and browser-callable.
-- It must never expose sandbox applications to signed-in callers.

create or replace function public.commission_rates_for_applications()
returns table (
  application_id uuid,
  guarantee_ref text,
  partner_id uuid,
  partner_rate numeric,
  agent_rate numeric
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    a.id,
    a.guarantee_ref,
    a.partner_id,
    a.partner_rate,
    a.agent_rate
  from public.applications a
  where a.livemode = true
    and public.is_aal2()
    and (
      public.is_admin()
      or (
        public.app_role() = 'management'
        and a.partner_id = public.app_partner()
      )
    );
$function$;

comment on function public.commission_rates_for_applications() is
  'Snapshotted per-application commission rates: live applications only; all for opndoor admin, own partner for Management, no rows for a Referrer. AAL2 required.';

revoke execute on function public.commission_rates_for_applications() from public, anon;
grant execute on function public.commission_rates_for_applications() to authenticated;