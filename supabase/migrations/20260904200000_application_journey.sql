-- The staff journey view for one agent-rail application: the nine-stage progress,
-- read in one call. PROGRESS ONLY, never content -- it returns timestamps and
-- done/not-done booleans (and the current form step), never a single answer, a
-- document, or a financial figure. Visibility mirrors applications_select exactly,
-- so a scoped manager can read the journey only for an application they can see.
-- Keyed by guarantee_ref (the detail page is ref-based). Dropped-and-created in
-- case an earlier uuid-arg version exists.
drop function if exists public.application_journey(uuid);
create or replace function public.application_journey(p_ref text)
returns table (
  referencing_mode  text,
  status            text,
  invited_at        timestamptz,
  registered_at     timestamptz,
  property_done     boolean,
  about_done        boolean,
  fee_paid_at       timestamptz,
  id_done           boolean,
  financials_done   boolean,
  submitted_at      timestamptz,
  decided_at        timestamptz,
  decision          text,
  decline_reason    text,
  guarantee_paid_at timestamptz,
  deed_at           timestamptz,
  deed_state        text,
  current_step      text
)
language plpgsql stable security definer set search_path to ''
as $function$
declare a public.applications;
begin
  select * into a from public.applications where guarantee_ref = p_ref;
  if not found then return; end if;
  if not (public.is_admin()
    or (public.app_role() = 'referrer'  and a.referrer_id = auth.uid())
    or (public.app_role() = 'developer' and a.partner_id = public.app_partner())
    or (public.app_role() = 'management' and a.partner_id = public.app_partner()
        and (not public.app_has_scope() or a.branch_id in (select public.app_scope_branches())))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return query select
    a.referencing_mode,
    a.status,
    (select max(ti.created_at) from public.tenant_invites ti where ti.application_id = a.id),
    (select ap.created_at from public.applicants ap where ap.id = a.applicant_id),
    (coalesce(btrim(a.prop_addr1),'') <> '' and coalesce(a.monthly_rent,0) > 0 and a.tenancy_start is not null),
    exists (select 1 from public.application_profiles pr where pr.application_id = a.id and pr.nationality is not null),
    (select ep.paid_at from public.application_eligibility_payments ep where ep.application_id = a.id),
    exists (select 1 from public.application_documents d where d.application_id = a.id and d.kind = 'id_document'),
    (exists (select 1 from public.application_documents d where d.application_id = a.id and d.kind = 'bank_connection')
       or (select count(*) from public.application_documents d where d.application_id = a.id and d.kind = 'bank_statement') >= 3),
    (select pr.completed_at from public.application_profiles pr where pr.application_id = a.id),
    a.decided_at,
    case when a.status = 'declined' then 'declined'
         when a.decided_at is not null or a.status in ('sent','paid','deed') then 'approved'
         else null end,
    a.decline_reason,
    a.paid_at,
    coalesce(a.deed_executed_at, a.deed_issued_at),
    a.deed_state,
    a.current_step;
end $function$;

revoke all on function public.application_journey(text) from public, anon;
grant execute on function public.application_journey(text) to authenticated;
