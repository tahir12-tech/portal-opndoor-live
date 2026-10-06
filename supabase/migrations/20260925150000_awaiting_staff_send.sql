-- "Executed but undelivered" becomes queryable.
--
-- When an agent-rail deed cannot be delivered automatically -- nobody active can
-- receive it -- the only trace was an activity_log row of kind
-- deed_delivery_failed plus the ops alert it fires. Both are good signals and both
-- stay, but neither is filterable: you could not ask "what is waiting for a staff
-- send?" without scanning activity. deed_state could not answer either; its values
-- are awaiting_tenant / executed / declined / voided / error, and 'error' means the
-- deed was never GENERATED, which is a different and mutually exclusive state.
--
-- So a flag on the application, set exactly where deed_delivery_failed is written
-- and cleared on a successful staff send. It is deliberately NOT part of deed_state:
-- the deed really is executed, and overloading that column would break every
-- existing reader of it.
alter table public.applications
  add column if not exists awaiting_staff_send boolean not null default false;

comment on column public.applications.awaiting_staff_send is
  'The deed is executed but was not delivered automatically and is waiting for a human to send it. Set where deed_delivery_failed is recorded; cleared by a successful send. Filterable queue for staff.';

-- Partial index: the queue is a handful of rows out of everything.
create index if not exists applications_awaiting_staff_send_idx
  on public.applications (awaiting_staff_send)
  where awaiting_staff_send;

-- Marking and clearing are service-role operations on the delivery path, but the
-- staff-send RPC runs as the CALLER, so clearing needs its own guarded entry point
-- with the same permission rule send_deed_to_agent already enforces.
create or replace function public.clear_awaiting_staff_send(p_app uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare a public.applications; r text; owned boolean;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where id = p_app;
  if not found then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := a.referrer_id = auth.uid();
  if not (public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and (not public.app_has_scope() or a.branch_id in (select public.app_scope_branches())))
          or (r = 'referrer'   and owned)) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  update public.applications set awaiting_staff_send = false where id = p_app;
end $function$;

revoke all on function public.clear_awaiting_staff_send(uuid) from public, anon;
grant execute on function public.clear_awaiting_staff_send(uuid) to authenticated, service_role;

-- Backfill: anything already recorded as an undelivered executed deed, and still
-- issued, joins the queue so the first view of it is not misleadingly empty.
update public.applications a
   set awaiting_staff_send = true
 where a.status = 'deed'
   and not a.awaiting_staff_send
   and exists (
     select 1 from public.activity_log l
     where l.application_id = a.id and l.kind = 'deed_delivery_failed'
   )
   -- ...unless a successful send happened after the last failure.
   and not exists (
     select 1 from public.activity_log l2
     where l2.application_id = a.id
       and l2.kind in ('deed_sent', 'deed_delivered')
       and l2.at > (select max(l3.at) from public.activity_log l3
                    where l3.application_id = a.id and l3.kind = 'deed_delivery_failed')
   );
