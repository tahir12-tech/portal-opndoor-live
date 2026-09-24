-- One RPC the agreement panel reads: the deal, its bands, its tiers, and where
-- the party's counter currently sits.
create or replace function public.agreement_for_agency(p_agency uuid)
returns table (
  agreement_id uuid, scope_level text, period text, counting_scope text,
  is_standard boolean, note text, effective_from date,
  period_start date, volume int,
  bands jsonb, tiers jsonb, next_rate numeric, next_basis numeric
)
language sql stable security definer set search_path to ''
as $function$
  with b1 as (
    select b.id as branch_id, b.partner_id from public.branches b
    where b.agency_id = p_agency order by b.created_at limit 1
  ),
  r as (
    select * from public.resolve_pricing_agreement(
      (select branch_id from b1), (select partner_id from b1), 1)
  )
  select pa.id, pa.scope_level, pa.period, pa.counting_scope, pa.is_standard, pa.note, pa.effective_from,
         public.agreement_period_start(pa.id),
         public.agreement_volume(pa.id, (select branch_id from b1)),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'min', bd.min_tenants, 'max', bd.max_tenants,
             'weeks', bd.fee_basis_weeks, 'rate', bd.agent_rate) order by bd.min_tenants), '[]'::jsonb)
            from public.pricing_agreement_bands bd where bd.agreement_id = pa.id),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'from', t.from_count, 'to', t.to_count, 'rate', t.agent_rate) order by t.from_count), '[]'::jsonb)
            from public.commission_tiers t where t.agreement_id = pa.id),
         (select agent_rate from r), (select fee_basis_weeks from r)
  from public.pricing_agreements pa
  where pa.id = (select id from r)
$function$;

revoke all on function public.agreement_for_agency(uuid) from public, anon;
grant execute on function public.agreement_for_agency(uuid) to authenticated;
