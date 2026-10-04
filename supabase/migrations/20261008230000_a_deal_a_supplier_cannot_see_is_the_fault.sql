-- EVERY DEAL IN A SUPPLIER'S ESTATE, INCLUDING THE ONES ITS OWN TAB WROTE
-- NONE OF.
--
-- Matt (gg): "The Commission tab must also still show any agency- or
-- group-scope deal that already exists, so nothing can be hidden."
--
-- supplier_share_deals asks `scope_level = 'partner' and kind =
-- 'agent_share'`, which is every deal that tab can write -- and therefore
-- exactly the set that cannot contain the problem. e4b75778 on dev is
-- scope_level 'agency', kind 'commission', live since 2026-10-01, sitting
-- on Kestrel's own Kestrel Lettings: invisible to the supplier's tab, to
-- the agency's tab after (gg) removes its editor, and to everyone except
-- resolve_pricing_agreement, which prices referrals from it.
--
-- SO THIS IS THE OTHER HALF OF (gg) AND NOT A CONVENIENCE. Removing the
-- editor stops new ones; this shows the ones already written. A deal the
-- screen cannot show is the fault being fixed.
--
-- IT REPORTS, IT DOES NOT RESOLVE. No judgement about which deal wins is
-- made here: that is resolve_pricing_agreement's, and a second opinion
-- about the money is how two screens come to disagree. This answers "what
-- exists", and the screen says plainly that it is not set on this tab.
create or replace function public.supplier_offtab_deals(p_slug text)
returns table(agreement_id uuid, scope_level text, scope_name text, kind text,
              coverage text, period text, effective_from date, note text,
              bands jsonb, tiers jsonb)
language plpgsql
stable security definer
set search_path = ''
as $$
declare v_partner uuid;
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  -- THE SAME READER AS supplier_share_deals. A supplier's deals are
  -- opndoor's commercial business; this adds no new audience.
  if not coalesce(public.is_admin(), false) then
    raise exception 'Only Opndoor reads a supplier''s deals.' using errcode = '42501';
  end if;

  select p.id into v_partner from public.partners p where p.slug = p_slug;
  if v_partner is null then
    raise exception 'Supplier not found' using errcode = '22023';
  end if;

  return query
  select pa.id, pa.scope_level,
         coalesce(ag.name, gr.name, '(unknown)'),
         pa.kind, pa.coverage, pa.period, pa.effective_from, pa.note,
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
  left join public.agencies ag
         on pa.scope_level = 'agency' and ag.id = pa.scope_id
  left join public.agency_groups gr
         on pa.scope_level = 'group' and gr.id = pa.scope_id
  where pa.scope_level in ('agency', 'group')
    -- IN THIS SUPPLIER'S ESTATE, by the agency's or group's own partner.
    -- The deal does not record whose estate it is in; the thing it prices
    -- does.
    and coalesce(ag.partner_id, gr.partner_id) = v_partner
    -- LIVE ONLY, on the same test resolve_pricing_agreement applies. An
    -- ended deal is history and prices nothing; listing it would make a
    -- card about a hidden live deal mostly noise.
    and pa.ended_at is null
    and not pa.is_standard
    and pa.effective_from <= current_date
    and (pa.effective_to is null or pa.effective_to >= current_date)
  order by pa.scope_level, coalesce(ag.name, gr.name), pa.effective_from desc, pa.id;
end $$;

revoke all on function public.supplier_offtab_deals(text) from public, anon;
grant execute on function public.supplier_offtab_deals(text) to authenticated;
