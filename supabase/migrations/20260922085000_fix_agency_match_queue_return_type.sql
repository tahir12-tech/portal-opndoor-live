-- The testing database can already contain the older agency_match_queue()
-- return shape. PostgreSQL cannot change OUT/RETURNS TABLE columns with
-- CREATE OR REPLACE FUNCTION, so replace the old function explicitly.

drop function if exists public.agency_match_queue();

create function public.agency_match_queue()
returns table(
  application_id uuid,
  guarantee_ref text,
  tenant_name text,
  property text,
  typed_name text,
  auto_agency_id uuid,
  auto_agency_name text,
  candidates jsonb,
  state text,
  matched_by text,
  resolved_branch_name text,
  created_at timestamp with time zone
)
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not public.is_opndoor_staff() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return query
    select
      m.application_id,
      a.guarantee_ref,
      btrim(
        coalesce(a.tenant_first_name, '') || ' ' ||
        coalesce(a.tenant_last_name, '')
      ),
      btrim(
        coalesce(a.prop_city, '') || ' ' ||
        coalesce(a.prop_postcode, '')
      ),
      m.typed_name,
      m.auto_agency_id,
      ag.name,
      m.candidates,
      m.state,
      m.matched_by,
      rb.name,
      m.created_at
    from public.application_agency_match m
    join public.applications a
      on a.id = m.application_id
    left join public.agencies ag
      on ag.id = m.auto_agency_id
    left join public.branches rb
      on rb.id = m.resolved_branch_id
    where m.state = 'needs_review'
       or (
         m.state = 'resolved'
         and m.matched_by = 'email'
         and m.resolved_at > now() - interval '14 days'
       )
    order by
      (m.state = 'needs_review') desc,
      coalesce(m.resolved_at, m.created_at) desc;
end $function$;

comment on function public.agency_match_queue() is
  'Opendoor staff agency matching queue, including recent email-resolved matches.';