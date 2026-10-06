-- The agent-rail dashboard funnel: the nine-stage counts (Invited to Deed) plus
-- the early "stuck" counts, for one partner, in one aggregate. PROGRESS ONLY --
-- counts of applications at each stage, never any content. Scoped exactly like
-- applications_select: is_admin sees the named partner; a management user sees
-- only their own partner, narrowed to their position's branches. Agent rail only
-- (referencing_mode = 'opndoor_referenced'); a supplier partner never calls this.
create or replace function public.agent_rail_funnel(p_slug text default null)
returns table (
  invited int, registered int, details int, fee int, documents int,
  submitted int, approved int, declined int, guarantee int, deed int,
  stuck_invited int, stuck_fee int, stuck_referencing int
)
language plpgsql stable security definer set search_path to ''
as $function$
declare pid uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_slug is not null then
    if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
    select id into pid from public.partners where slug = p_slug;
  else
    pid := public.app_partner();
  end if;
  if pid is null then return; end if;
  if not public.is_admin() and not (public.app_role() = 'management' and pid = public.app_partner()) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return query
  with base as (
    select
      a.status,
      a.branch_id,
      (a.applicant_id is not null) as is_registered,
      (coalesce(btrim(a.prop_addr1),'') <> '' and coalesce(a.monthly_rent,0) > 0 and a.tenancy_start is not null) as prop_done,
      exists (select 1 from public.application_profiles pr where pr.application_id = a.id and pr.nationality is not null) as about_done,
      exists (select 1 from public.application_eligibility_payments ep where ep.application_id = a.id and ep.paid_at is not null) as fee_done,
      exists (select 1 from public.application_documents d where d.application_id = a.id and d.kind = 'id_document') as id_done,
      (exists (select 1 from public.application_documents d where d.application_id = a.id and d.kind = 'bank_connection')
        or (select count(*) from public.application_documents d where d.application_id = a.id and d.kind = 'bank_statement') >= 3) as fin_done,
      (select max(ti.created_at) from public.tenant_invites ti where ti.application_id = a.id) as invited_at,
      (select pr.completed_at from public.application_profiles pr where pr.application_id = a.id) as submitted_at
    from public.applications a
    where a.livemode and a.partner_id = pid
      and a.referencing_mode = 'opndoor_referenced'
      and (public.is_admin()
           or (public.app_role() = 'management'
               and (not public.app_has_scope() or a.branch_id in (select public.app_scope_branches()))))
  )
  select
    count(*)::int,
    count(*) filter (where is_registered)::int,
    count(*) filter (where is_registered and prop_done and about_done)::int,
    count(*) filter (where fee_done)::int,
    count(*) filter (where id_done and fin_done)::int,
    count(*) filter (where status in ('referencing','sent','paid','deed','declined'))::int,
    count(*) filter (where status in ('sent','paid','deed'))::int,
    count(*) filter (where status = 'declined')::int,
    count(*) filter (where status in ('paid','deed'))::int,
    count(*) filter (where status = 'deed')::int,
    count(*) filter (where status = 'draft' and not is_registered and invited_at < now() - interval '7 days')::int,
    count(*) filter (where status = 'draft' and is_registered and not fee_done and invited_at < now() - interval '7 days')::int,
    count(*) filter (where status = 'referencing' and submitted_at < now() - interval '7 days')::int
  from base;
end $function$;

revoke all on function public.agent_rail_funnel(text) from public, anon;
grant execute on function public.agent_rail_funnel(text) to authenticated;
