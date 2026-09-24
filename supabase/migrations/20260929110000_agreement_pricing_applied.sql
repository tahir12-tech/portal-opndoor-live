-- M4, part 2. The agreement actually prices the referral.
--
-- A WEEK OF RENT is monthly_rent * 12 / 52, as ruled. That is deliberately NOT
-- how the standard fee is computed: 4.35 weeks on that definition is
-- rent * 1.0038, and using it would move every standard price by 0.38% while
-- claiming nothing had changed. So standard terms remain exactly one month's
-- rent, and only a NEGOTIATED basis is arithmetic.
--
-- is_standard is what tells them apart. The universal agreements seeded in M2
-- describe what was already true and are marked standard; anything an admin
-- negotiates is not.
alter table public.pricing_agreements
  add column if not exists is_standard boolean not null default false;

comment on column public.pricing_agreements.is_standard is
  'True for the seeded universal agreements that merely describe standard terms. Their fee is one month''s rent exactly, never recomputed from weeks. A negotiated agreement computes its fee from its basis.';

-- The M2 seeds: one partner-scoped 4.35-week agreement each, no rate.
update public.pricing_agreements pa
   set is_standard = true
 where pa.scope_level = 'partner'
   and pa.is_standard = false
   and exists (select 1 from public.pricing_agreement_bands b
               where b.agreement_id = pa.id and b.fee_basis_weeks = 4.35 and b.agent_rate is null);

-- ---------------------------------------------------------------------------
-- The fee a referral is charged. One place.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_fee(p_branch uuid, p_route_partner uuid, p_rent numeric, p_tenant_count int default 1)
returns table (fee_amount numeric, fee_basis_weeks numeric, agreement_id uuid, agent_rate numeric)
language sql stable security definer set search_path to ''
as $function$
  select
    case
      when r.id is null then p_rent                       -- no agreement: standard
      when pa.is_standard then p_rent                     -- standard terms: one month, exactly
      else round(p_rent * 12.0 / 52.0 * r.fee_basis_weeks, 2)   -- negotiated: weeks of rent
    end,
    coalesce(r.fee_basis_weeks, 4.35),
    r.id,
    r.agent_rate
  from (select 1) one
  left join lateral public.resolve_pricing_agreement(p_branch, p_route_partner, p_tenant_count) r on true
  left join public.pricing_agreements pa on pa.id = r.id
$function$;

comment on function public.resolve_fee(uuid, uuid, numeric, int) is
  'The guarantee fee for a referral: one month''s rent under standard terms, else the negotiated basis in weeks (monthly_rent * 12 / 52 * weeks). Also returns the agreement and the rate it resolved, so create_referral freezes all of it together.';

revoke all on function public.resolve_fee(uuid, uuid, numeric, int) from public, anon;
grant execute on function public.resolve_fee(uuid, uuid, numeric, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- commission_split takes the tenant count, so an agreement's rate reaches the
-- rule as an INPUT. The rule itself is untouched and still pure.
--
-- An agreement's rate replaces STANDARD TERMS: it is passed into the rule's
-- standard slot, so a node that has explicitly set its own rate still wins, and
-- explicit group and branch lines still add. Nothing composes across agreements.
-- ---------------------------------------------------------------------------
drop function if exists public.commission_split(uuid, uuid);
create or replace function public.commission_split(
  p_branch uuid, p_route_partner uuid, p_tenant_count int default 1
)
returns table (level text, org_id uuid, org_name text, rate numeric)
language sql stable security definer set search_path to ''
as $function$
  select r.level, r.org_id, r.org_name, r.rate
  from public.partners p
  left join public.branches b on b.id = p_branch
  left join public.agencies a on a.id = b.agency_id
  left join public.agency_groups g on g.id = a.group_id
  left join lateral public.resolve_pricing_agreement(p_branch, p_route_partner, p_tenant_count) ag on true
  cross join lateral public.commission_split_rule(
    a.id, a.name, a.agent_rate,
    b.id, b.name, b.agent_rate,
    g.id, g.name, g.agent_rate,
    -- The negotiated rate stands in for standard terms.
    coalesce(ag.agent_rate, p.agent_rate)
  ) r
  where p.id = p_route_partner
$function$;

revoke all on function public.commission_split(uuid, uuid, int) from public, anon;
grant execute on function public.commission_split(uuid, uuid, int) to authenticated, service_role;

create or replace function public.commission_total(p_branch uuid, p_route_partner uuid, p_tenant_count int default 1)
returns numeric
language sql stable security definer set search_path to '' as $function$
  select coalesce(sum(rate), 0) from public.commission_split(p_branch, p_route_partner, p_tenant_count)
$function$;
revoke all on function public.commission_total(uuid, uuid, int) from public, anon;
grant execute on function public.commission_total(uuid, uuid, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- THE 50% CAP against the WORST BAND an agreement can produce, at save time.
-- ---------------------------------------------------------------------------
create or replace function public.assert_agreement_within_cap(p_agreement uuid)
returns numeric
language plpgsql stable security definer set search_path to ''
as $function$
declare v_worst numeric;
begin
  -- The worst case is the highest rate the agreement can yield (any band, any
  -- tier) added to whatever explicit node lines its branches already carry.
  select max(t.total) into v_worst
  from (
    select coalesce(b2.agent_rate, 0)
         + coalesce(g2.agent_rate, 0)
         + greatest(
             coalesce((select max(bd.agent_rate) from public.pricing_agreement_bands bd where bd.agreement_id = pa.id), 0),
             coalesce((select max(ti.agent_rate) from public.commission_tiers ti where ti.agreement_id = pa.id), 0),
             coalesce(a2.agent_rate, 0)
           ) as total
    from public.pricing_agreements pa
    join public.branches b2 on true
    join public.agencies a2 on a2.id = b2.agency_id
    left join public.agency_groups g2 on g2.id = a2.group_id
    where pa.id = p_agreement
      and ((pa.scope_level = 'agency'  and a2.id = pa.scope_id)
        or (pa.scope_level = 'group'   and a2.group_id = pa.scope_id)
        or (pa.scope_level = 'partner' and b2.partner_id = pa.scope_id))
  ) t;

  if v_worst is not null and v_worst > 0.50 then
    raise exception 'This agreement could take a branch to % of the guarantee fee. The most a branch may pay out in total is 50%%.',
      to_char(round(v_worst * 100, 2), 'FM999990.00') || '%' using errcode = '22023';
  end if;
  return coalesce(v_worst, 0);
end $function$;

revoke all on function public.assert_agreement_within_cap(uuid) from public, anon;
grant execute on function public.assert_agreement_within_cap(uuid) to authenticated, service_role;
-- The 2-arg commission_total is now ambiguous with the 3-arg defaulted version:
-- a 2-argument call matches both. The 3-arg one supersedes it.
drop function if exists public.commission_total(uuid, uuid);
