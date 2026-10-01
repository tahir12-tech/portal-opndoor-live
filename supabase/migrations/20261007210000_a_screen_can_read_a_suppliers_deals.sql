-- A SCREEN CAN READ A SUPPLIER'S TWO DEALS.
--
-- The Commission tab has to show what is in force before an admin can change
-- it. `agreement_for_agency` does exactly this job for an agency and cannot be
-- reused: it finds the agency's first branch and asks the resolver, which
-- answers with whichever deal is most specific -- for a supplier that would
-- return an AGENCY's override when one exists, and the supplier's own tab must
-- show the SUPPLIER's deal.
--
-- Tests: in supabase/tests/a_supplier_has_two_deals.test.sql
--
-- ADMIN ONLY, and at aal2, like every other commission read. A supplier's own
-- staff must not read their agents' share deal from here: what each agency
-- under them keeps is the supplier's own commercial business and is not
-- Opndoor's to publish through this function.

create or replace function public.supplier_deal(p_slug text, p_kind text default 'commission')
returns table(
  agreement_id uuid, scope_level text, coverage text, period text, counting_scope text,
  is_standard boolean, note text, effective_from date, period_start date, volume integer,
  bands jsonb, tiers jsonb
)
language plpgsql stable security definer set search_path to ''
as $function$
declare v_partner uuid; v_agreement uuid;
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  if not coalesce(public.is_admin(), false) then
    raise exception 'Only Opndoor reads a supplier''s deal.' using errcode = '42501';
  end if;
  if coalesce(p_kind, '') not in ('commission', 'agent_share') then
    raise exception 'A deal is either a commission or an agents'' share.' using errcode = '22023';
  end if;

  select p.id into v_partner from public.partners p where p.slug = p_slug;
  if v_partner is null then
    raise exception 'Supplier not found' using errcode = '22023';
  end if;

  /* THE SUPPLIER'S OWN, BY SCOPE, not the resolver's answer. An agency-scope
     override is a real deal and belongs on that agency's page; showing it here
     would tell an admin editing the supplier that the supplier holds terms it
     does not, and saving would then write them onto the supplier. */
  v_agreement := public.active_agreement_of_kind('partner', v_partner, p_kind);
  if v_agreement is null then
    return;
  end if;

  return query
  select pa.id, pa.scope_level, pa.coverage, pa.period, pa.counting_scope,
         pa.is_standard, pa.note, pa.effective_from,
         public.agreement_period_start(pa.id),
         /* VOLUME WITHOUT A BRANCH. agreement_volume takes one to decide whose
            referrals count; a supplier's own deal counts the whole route, so
            the partner is passed and the branch left null. */
         public.agreement_volume(pa.id, null, v_partner),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'min', bd.min_tenants, 'max', bd.max_tenants,
             'weeks', bd.fee_basis_weeks, 'unit', bd.fee_basis_unit, 'rate', bd.agent_rate)
             order by bd.min_tenants), '[]'::jsonb)
            from public.pricing_agreement_bands bd where bd.agreement_id = pa.id),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'from', t.from_count, 'to', t.to_count, 'rate', t.agent_rate)
             order by t.from_count), '[]'::jsonb)
            from public.commission_tiers t where t.agreement_id = pa.id)
  from public.pricing_agreements pa
  where pa.id = v_agreement;
end $function$;

revoke all on function public.supplier_deal(text, text) from public, anon;
grant execute on function public.supplier_deal(text, text) to authenticated, service_role;

comment on function public.supplier_deal(text, text) is
  'A supplier''s own live deal of one kind, for its Commission tab. Scope-exact on purpose: an agency-scope override belongs on that agency''s page, and showing it here would tell an admin the supplier holds terms it does not.';
