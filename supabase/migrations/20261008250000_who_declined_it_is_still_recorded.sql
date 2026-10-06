-- WHO DECLINED IT IS STILL RECORDED, JUST NOT ON THE CUSTOMER'S SCREEN.
--
-- A follow-on from 20261008240000, which made decline_application's
-- activity line say "Application declined by opndoor" for (bm).
--
-- THAT LINE WAS THE ONLY PLACE THE DECLINER WAS RECORDED. mark_withdrawn,
-- changed in the same breath, already writes `withdrawn_by` from the
-- caller, so masking its activity line costs nothing: the identity is on
-- the application row. decline_application wrote only
-- `decided_by_kind = 'staff'`. Masking the name there, and stopping,
-- would have been
-- deleting an audit record to satisfy a rule about copy -- which (bm) is
-- not, and which nobody would have noticed until they needed it.
--
-- SO THE COLUMN GOES IN FIRST AND THE MASK IS KEPT. Additive: a new
-- nullable column, granted like every other (applications is an explicit
-- column-grant table and applications_column_grants fails a new one that
-- is not). It is a uuid, not a name: a customer who selected it would
-- have an opaque id they cannot resolve, because an opndoor staff row has
-- partner_id null and no customer's RLS reaches it.
--
-- NOT BACKFILLED. The rows already declined have the decliner's name in
-- activity_log.actor, written before 20261008240000, and inventing a
-- decided_by for them from a text match on a name would be a guess
-- recorded as a fact.
alter table public.applications add column if not exists decided_by uuid references public.users(id);
grant select (decided_by) on public.applications to authenticated;
comment on column public.applications.decided_by is
  'Which opndoor staff member declined or decided this. The customer-facing activity line says "by opndoor" (bm); this is where the answer is actually kept.';

CREATE OR REPLACE FUNCTION public.decline_application(p_ref text, p_reason text DEFAULT NULL::text)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications; who text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where guarantee_ref = p_ref;
  if not coalesce(found, false) then raise exception 'application not found'; end if;
  if not coalesce(public.is_opndoor_staff(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  if a.status <> 'referencing' then
    raise exception 'Only an application awaiting a decision can be declined.' using errcode = '42501';
  end if;

  update public.applications
    set status = 'declined', decided_at = now(), decided_by_kind = 'staff',
        -- (bm) KEEPS WHAT THE ACTIVITY LINE NO LONGER SAYS. See the
        -- migration header: the line now says "by opndoor", and without
        -- this column that would have been the only record of which of
        -- us declined, deleted to satisfy a copy rule.
        decided_by = auth.uid(),
        decline_reason = nullif(btrim(coalesce(p_reason,'')), '')
    where id = a.id returning * into a;

  /* (bm) UNCONDITIONALLY 'opndoor' HERE, unlike mark_withdrawn: the guard
     above is is_opndoor_staff(), so there is no non-opndoor caller to
     name. A coalesce to a person's name would be dead code that reads
     like a live case. */
  who := 'opndoor';
  insert into public.activity_log(application_id, kind, message, actor, visibility)
  values (a.id, 'application_declined',
    'Application declined by opndoor'
      || case when a.decline_reason is not null then ' (' || a.decline_reason || ')' else '' end || '.',
    who, 'business');
  return public.rates_for_reader(a);
end $function$;
