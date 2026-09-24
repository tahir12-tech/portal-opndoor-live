-- M4. AN AGREEMENT IS WHAT WAS NEGOTIATED.
--
-- M2 shipped pricing_agreements as one row per tenant-count band, which cannot
-- express "Regent's pay 3 weeks at 20% for a single tenant, 5 weeks at 25% for
-- two or more, and their rate steps down after 200 paid a year". So the agreement
-- becomes a CONTAINER and the negotiated detail moves into children:
--
--   pricing_agreements        the deal: who it is with, how volume is counted,
--                             when it runs, who set it.
--   pricing_agreement_bands   tenant-count bands: fee basis and rate.
--   commission_tiers          volume tiers: rate by cumulative paid volume.
--
-- NOTHING COMPOSES ACROSS AGREEMENTS. A party resolves to at most one, and
-- standard terms (one month's rent, 10%) apply only where none exists. Within one
-- agreement, bands and tiers combine explicitly: the BAND always supplies the fee
-- basis; the RATE comes from the tier the party's volume lands in when tiers
-- exist, else from the band, else standard.
--
-- NEVER RETROSPECTIVE. Volume is counted at the moment the agent sends, and the
-- resolved rate is frozen onto the application. Crossing a band tomorrow does not
-- re-price what was sold today.

-- ---------------------------------------------------------------------------
-- 1. The container.
-- ---------------------------------------------------------------------------
alter table public.pricing_agreements
  add column if not exists period text not null default 'lifetime',
  add column if not exists counting_scope text not null default 'agency',
  add column if not exists note text,
  add column if not exists created_by uuid references public.users(id) on delete set null;

alter table public.pricing_agreements drop constraint if exists pricing_agreements_period_check;
alter table public.pricing_agreements add constraint pricing_agreements_period_check
  check (period in ('week','month','year','lifetime'));
alter table public.pricing_agreements drop constraint if exists pricing_agreements_counting_scope_check;
alter table public.pricing_agreements add constraint pricing_agreements_counting_scope_check
  check (counting_scope in ('group','agency','branch'));

comment on column public.pricing_agreements.period is
  'The window volume is counted over, from the agreement''s effective_from: week, month, year or lifetime.';
comment on column public.pricing_agreements.counting_scope is
  'Whose volume counts towards a tier: the group, the agency, or the single branch.';
comment on column public.pricing_agreements.created_by is
  'Who set this agreement. Custom terms are the exception and are audited.';

-- ---------------------------------------------------------------------------
-- 2. Tenant-count bands. The fee basis always comes from here.
-- ---------------------------------------------------------------------------
create table if not exists public.pricing_agreement_bands (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.pricing_agreements(id) on delete cascade,
  min_tenants int not null default 1 check (min_tenants >= 1),
  max_tenants int check (max_tenants is null or max_tenants >= min_tenants),
  fee_basis_weeks numeric(4,2) not null check (fee_basis_weeks > 0),
  agent_rate numeric(5,4) check (agent_rate is null or (agent_rate >= 0 and agent_rate <= 1)),
  created_at timestamptz not null default now()
);
create index if not exists pab_agreement_idx on public.pricing_agreement_bands (agreement_id);

comment on table public.pricing_agreement_bands is
  'Tenant-count bands within one agreement: 1..1 at 3 weeks/20%, 2..null at 5 weeks/25%. The band always supplies the fee basis; its rate applies unless a volume tier overrides it.';

-- ---------------------------------------------------------------------------
-- 3. Volume tiers. Rate only: a tier never changes the fee basis.
-- ---------------------------------------------------------------------------
create table if not exists public.commission_tiers (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.pricing_agreements(id) on delete cascade,
  from_count int not null check (from_count >= 0),
  to_count   int check (to_count is null or to_count > from_count),
  agent_rate numeric(5,4) not null check (agent_rate >= 0 and agent_rate <= 1),
  created_at timestamptz not null default now()
);
create index if not exists ct_agreement_idx on public.commission_tiers (agreement_id);

comment on table public.commission_tiers is
  'Rate by cumulative PAID volume within the agreement''s period and counting scope. from_count is inclusive, to_count exclusive, null meaning "and above". Resolved at send and frozen; never retrospective.';

-- Move M2's inline band data into the band table, then drop the inline columns.
insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, agent_rate)
select pa.id, coalesce(pa.min_tenants, 1), pa.max_tenants, pa.fee_basis_weeks, pa.agent_rate
from public.pricing_agreements pa
where not exists (select 1 from public.pricing_agreement_bands b where b.agreement_id = pa.id);

alter table public.pricing_agreements
  drop column if exists min_tenants,
  drop column if exists max_tenants,
  drop column if exists fee_basis_weeks,
  drop column if exists agent_rate;

alter table public.pricing_agreement_bands enable row level security;
alter table public.commission_tiers enable row level security;

create policy pab_select on public.pricing_agreement_bands for select to authenticated
using (public.is_aal2() and exists (select 1 from public.pricing_agreements pa where pa.id = agreement_id));
create policy pab_admin_write on public.pricing_agreement_bands for all to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy ct_select on public.commission_tiers for select to authenticated
using (public.is_aal2() and exists (select 1 from public.pricing_agreements pa where pa.id = agreement_id));
create policy ct_admin_write on public.commission_tiers for all to authenticated
using (public.is_admin()) with check (public.is_admin());

revoke all on public.pricing_agreement_bands, public.commission_tiers from anon;
grant select on public.pricing_agreement_bands, public.commission_tiers to authenticated;

-- ---------------------------------------------------------------------------
-- 4. THE VOLUME COUNTER. Resolved OUTSIDE the split rule and passed in, so the
--    rule stays a pure function of rates.
--
--    Volume = applications PAID (the guarantee fee cleared) within the
--    agreement's period, counted from its effective_from, in its counting scope.
-- ---------------------------------------------------------------------------
-- Whole periods elapsed since the agreement began, so a "year" is the
-- agreement's year rather than the calendar's.
create or replace function public.months_elapsed(p_from date, p_to date)
returns int language sql immutable set search_path to '' as $function$
  select (extract(year from age(p_to, p_from)) * 12 + extract(month from age(p_to, p_from)))::int
$function$;

create or replace function public.agreement_period_start(p_agreement uuid)
returns date
language sql stable security definer set search_path to ''
as $function$
  select case pa.period
    when 'lifetime' then pa.effective_from
    when 'year'  then (pa.effective_from + ((public.months_elapsed(pa.effective_from, current_date) / 12) || ' years')::interval)::date
    when 'month' then (pa.effective_from + (public.months_elapsed(pa.effective_from, current_date) || ' months')::interval)::date
    when 'week'  then pa.effective_from + (((current_date - pa.effective_from) / 7) * 7)
  end
  from public.pricing_agreements pa where pa.id = p_agreement
$function$;

create or replace function public.agreement_volume(p_agreement uuid, p_branch uuid)
returns int
language sql stable security definer set search_path to ''
as $function$
  with pa as (select * from public.pricing_agreements where id = p_agreement),
  ctx as (
    select b.id as branch_id, b.agency_id, a.group_id
    from public.branches b left join public.agencies a on a.id = b.agency_id
    where b.id = p_branch
  )
  select count(*)::int
  from public.applications ap
  join public.branches b2 on b2.id = ap.branch_id
  left join public.agencies a2 on a2.id = b2.agency_id
  cross join pa cross join ctx
  where ap.paid_at is not null
    and ap.paid_at::date >= public.agreement_period_start(p_agreement)
    and case pa.counting_scope
          when 'branch' then b2.id = ctx.branch_id
          when 'agency' then b2.agency_id = ctx.agency_id
          else a2.group_id is not distinct from ctx.group_id and ctx.group_id is not null
        end
$function$;

comment on function public.agreement_volume(uuid, uuid) is
  'Applications PAID within this agreement''s current period and counting scope. The number a volume tier is resolved against, computed at send and then frozen onto the application.';

revoke all on function public.agreement_volume(uuid, uuid) from public, anon;
grant execute on function public.agreement_volume(uuid, uuid) to authenticated, service_role;
revoke all on function public.agreement_period_start(uuid) from public, anon;
grant execute on function public.agreement_period_start(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. THE RESOLUTION. One agreement, one band, optionally one tier.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_pricing_agreement(
  p_branch uuid, p_route_partner uuid, p_tenant_count int default 1
)
returns table (id uuid, scope_level text, fee_basis_weeks numeric, agent_rate numeric)
language sql stable security definer set search_path to ''
as $function$
  with ctx as (
    select b.agency_id, a.group_id
    from public.branches b left join public.agencies a on a.id = b.agency_id
    where b.id = p_branch
  ),
  agreement as (
    select pa.*
    from public.pricing_agreements pa, ctx
    where pa.effective_from <= current_date
      and (pa.effective_to is null or pa.effective_to >= current_date)
      and (
        (pa.scope_level = 'agency'  and pa.scope_id = ctx.agency_id)
        or (pa.scope_level = 'group'   and ctx.group_id is not null and pa.scope_id = ctx.group_id)
        or (pa.scope_level = 'partner' and pa.scope_id = p_route_partner)
      )
    order by case pa.scope_level when 'agency' then 1 when 'group' then 2 else 3 end,
             pa.effective_from desc
    limit 1
  ),
  band as (
    select b.* from public.pricing_agreement_bands b, agreement ag
    where b.agreement_id = ag.id
      and b.min_tenants <= p_tenant_count
      and (b.max_tenants is null or b.max_tenants >= p_tenant_count)
    order by b.min_tenants desc
    limit 1
  ),
  tier as (
    -- The tier the party's CURRENT volume lands in. Rate only.
    select t.* from public.commission_tiers t, agreement ag
    where t.agreement_id = ag.id
      and public.agreement_volume(ag.id, p_branch) >= t.from_count
      and (t.to_count is null or public.agreement_volume(ag.id, p_branch) < t.to_count)
    order by t.from_count desc
    limit 1
  )
  select ag.id, ag.scope_level,
         (select fee_basis_weeks from band),
         coalesce((select agent_rate from tier), (select agent_rate from band))
  from agreement ag
$function$;

comment on function public.resolve_pricing_agreement(uuid, uuid, int) is
  'The one agreement that prices a referral, with its tenant-count band and the volume tier its party currently sits in. The band supplies the fee basis; the tier supplies the rate when there is one, else the band does. Null rate means standard terms.';

revoke all on function public.resolve_pricing_agreement(uuid, uuid, int) from public, anon;
grant execute on function public.resolve_pricing_agreement(uuid, uuid, int) to authenticated, service_role;
