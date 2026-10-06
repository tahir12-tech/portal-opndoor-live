-- AN AGENCY INSIDE A SUPPLIER'S ESTATE IS PRICED BY THE SUPPLIER'S DEAL.
--
-- Matt (kk), and again as (cj): "Commission tab of an agency inside a
-- supplier's estate (e.g. Example Lettings as Kestrel Management): it
-- shows Opndoor's agency standard ... which is wrong. Show the
-- supplier's deal for this agency instead, e.g. 'On Kestrel Lettings'
-- agency deal: 10% (1 to 5 tenants), 15% (6 to 10)', and who pays it
-- per the supplier's current setting."
--
-- WHY THE TAB SHOWED THE STANDARD. `agreement_for_agency` resolves with
-- resolve_pricing_agreement's DEFAULT kind, which is 'commission' --
-- what opndoor pays the ROUTE. On the agency rail that is the agency's
-- own deal and the tab is right. On the supplier rail the agency is not
-- the route: the supplier is, and what the AGENCY gets is the
-- 'agent_share' kind. So the tab was answering a different question
-- correctly and printing it under the agency's name.
--
-- A SEPARATE FUNCTION RATHER THAN A KIND ARGUMENT ON THAT ONE.
-- agreement_for_agency returns volume counters, period starts and a
-- next-rate projection that all belong to the agency's own deal; none
-- of them is meaningful for a deal that belongs to the supplier and is
-- shared with its other agencies. Bending it would have produced a row
-- where half the columns quietly described somebody else.
--
-- THE PAYER IS THE CURRENT SETTING, NOT THE FROZEN FLAG, and Matt said
-- so himself: "per the supplier's current setting". On a statement the
-- wording follows what was frozen, because that is what was paid; this
-- page describes the arrangement as it stands, and there is no referral
-- here to freeze. The two rules look contradictory and are not.
create or replace function public.supplier_deal_for_agency(p_agency uuid)
returns table(supplier_name text, supplier_slug text, opndoor_pays_agents boolean,
              agreement_id uuid, is_default boolean, bands jsonb, tiers jsonb,
              flat_rate numeric)
language plpgsql
stable security definer
set search_path = ''
as $$
declare v_branch uuid; v_partner uuid;
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  -- THE SAME TWO TESTS agreement_for_agency MAKES, and for the same
  -- reason: a deal is commercially sensitive AND is a commission
  -- figure, so reaching the org is not enough on its own.
  if not coalesce(public.app_may_reach_agency(p_agency), false)
     or not coalesce(public.may_see_commission(), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  select b.id, b.partner_id into v_branch, v_partner
    from public.branches b where b.agency_id = p_agency
   order by b.created_at limit 1;
  if v_branch is null then return; end if;

  -- NOTHING TO SAY ON OUR OWN ESTATE. There the agency's own deal IS
  -- the answer and agreement_for_agency already gives it; returning a
  -- row here would put a second, emptier answer on the same tab.
  if not exists (
    select 1 from public.partners p
     where p.id = v_partner and p.partner_kind = 'supplier'
  ) then return; end if;

  return query
  select p.name, p.slug, p.opndoor_pays_agents,
         r.id,
         -- Whether this is the supplier's default deal or one this
         -- agency is named on, which is what the sentence calls it.
         coalesce(pa.is_default_share, false),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'min', bd.min_tenants, 'max', bd.max_tenants,
             'weeks', bd.fee_basis_weeks, 'unit', bd.fee_basis_unit, 'rate', bd.agent_rate)
             order by bd.min_tenants), '[]'::jsonb)
            from public.pricing_agreement_bands bd where bd.agreement_id = r.id),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'from', t.from_count, 'to', t.to_count, 'rate', t.agent_rate)
             order by t.from_count), '[]'::jsonb)
            from public.commission_tiers t where t.agreement_id = r.id),
         /* THE FALLBACK RATE WHERE THERE IS NO DEAL AT ALL. resolve_rates
            already falls through agency, group and partner for exactly
            this, and a tab that said "no deal" while referrals were being
            priced at the partner's flat rate would be the (cl) fault
            again: an absence reported where there is an answer. */
         coalesce(r.agent_rate, a.agent_rate, g.agent_rate, p.agent_rate)
    from public.partners p
    left join lateral public.resolve_pricing_agreement(v_branch, v_partner, 1, 'agent_share') r on true
    left join public.pricing_agreements pa on pa.id = r.id
    left join public.agencies a on a.id = p_agency
    left join public.agency_groups g on g.id = a.group_id
   where p.id = v_partner;
end $$;

revoke all on function public.supplier_deal_for_agency(uuid) from public, anon;
grant execute on function public.supplier_deal_for_agency(uuid) to authenticated;
