-- M2. AGREEMENTS, AT TODAY'S NUMBERS.
--
-- What an org has agreed to pay, and on what basis, becomes a row rather than an
-- assumption spread across three Stripe call sites. This migration changes no
-- price: it seeds one universal agreement per partner that says exactly what is
-- already true — the fee is one month's rent (4.35 weeks) — and asserts that
-- resolving it for every branch produces the number already being charged.
--
-- WHY agent_rate IS NULL HERE. The additive split (commission_split_rule) is the
-- only implementation of the commission rule, and it stays that way in this pass.
-- An agreement that also carried a rate would be a SECOND source of truth for the
-- same number, and the two would drift — which is the exact failure the split was
-- built to end. So the agreement governs the FEE now; the column exists because
-- deal-shape pricing (M4) needs somewhere to put the rate, and it stays null until
-- one resolver owns both.
--
-- EFFECTIVE DATING is here from the start because re-pricing must never rewrite
-- history: a new agreement supersedes by date, and applications keep the
-- agreement id they were priced under.
create table if not exists public.pricing_agreements (
  id uuid primary key default gen_random_uuid(),

  -- Most-specific-wins, the same ladder the org tree uses everywhere else.
  scope_level text not null check (scope_level in ('partner','group','agency')),
  scope_id    uuid not null,

  -- The deal shape this agreement prices. 1..1 and 2..null is the stated example;
  -- max_tenants null means "and above".
  min_tenants int not null default 1 check (min_tenants >= 1),
  max_tenants int check (max_tenants is null or max_tenants >= min_tenants),

  -- The fee, expressed as weeks of rent. 4.35 = 52/12 = one month.
  fee_basis_weeks numeric(4,2) not null check (fee_basis_weeks > 0),

  -- Deferred to M4. See the header: null means "the additive split decides".
  agent_rate numeric(5,4) check (agent_rate is null or (agent_rate >= 0 and agent_rate <= 1)),

  effective_from date not null default current_date,
  effective_to   date check (effective_to is null or effective_to >= effective_from),

  created_at timestamptz not null default now()
);

create index if not exists pricing_agreements_scope_idx
  on public.pricing_agreements (scope_level, scope_id);

comment on table public.pricing_agreements is
  'What an org agreed to pay: the fee basis (weeks of rent) per tenant-count band, resolved most-specific-wins (agency, then group, then partner) and effective-dated so re-pricing never rewrites history. agent_rate is null until M4; the additive split owns the rate.';

alter table public.pricing_agreements enable row level security;

-- Readable by anyone who can see the org it prices; written by admins only. The
-- read is deliberately permissive-by-scope rather than clever: a rate an agency
-- is charged is not a secret from that agency.
create policy pricing_agreements_select on public.pricing_agreements for select to authenticated
using (
  public.is_aal2() and (
    public.is_admin()
    or (scope_level = 'agency' and public.app_reachable_agency(scope_id))
    or (scope_level = 'group'  and exists (
          select 1 from public.agency_groups g
          where g.id = scope_id and public.app_reachable_group(g.id, g.partner_id)))
    or (scope_level = 'partner' and scope_id = public.app_partner())
  )
);
create policy pricing_agreements_admin_write on public.pricing_agreements for all to authenticated
using (public.is_admin()) with check (public.is_admin());

revoke all on public.pricing_agreements from anon;
grant select on public.pricing_agreements to authenticated;

-- ---------------------------------------------------------------------------
-- Which agreement prices this referral? Most specific wins, in date, for the
-- tenant count. Returns at most one row.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_pricing_agreement(
  p_branch uuid, p_route_partner uuid, p_tenant_count int default 1
)
returns table (id uuid, scope_level text, fee_basis_weeks numeric, agent_rate numeric)
language sql stable security definer set search_path to ''
as $function$
  with ctx as (
    select b.agency_id, a.group_id
    from public.branches b
    left join public.agencies a on a.id = b.agency_id
    where b.id = p_branch
  )
  select pa.id, pa.scope_level, pa.fee_basis_weeks, pa.agent_rate
  from public.pricing_agreements pa, ctx
  where pa.min_tenants <= p_tenant_count
    and (pa.max_tenants is null or pa.max_tenants >= p_tenant_count)
    and pa.effective_from <= current_date
    and (pa.effective_to is null or pa.effective_to >= current_date)
    and (
      (pa.scope_level = 'agency'  and pa.scope_id = ctx.agency_id)
      or (pa.scope_level = 'group'   and ctx.group_id is not null and pa.scope_id = ctx.group_id)
      or (pa.scope_level = 'partner' and pa.scope_id = p_route_partner)
    )
  order by case pa.scope_level when 'agency' then 1 when 'group' then 2 else 3 end,
           pa.effective_from desc
  limit 1
$function$;

comment on function public.resolve_pricing_agreement(uuid, uuid, int) is
  'The agreement that prices a referral: most specific scope wins (agency, then group, then partner), within its effective dates and tenant-count band. One row or none.';

revoke all on function public.resolve_pricing_agreement(uuid, uuid, int) from public, anon;
grant execute on function public.resolve_pricing_agreement(uuid, uuid, int) to authenticated, service_role;

-- The agreement an application was priced under, frozen like the fee and the split.
alter table public.applications
  add column if not exists pricing_agreement_id uuid references public.pricing_agreements(id) on delete set null;
grant select (pricing_agreement_id) on public.applications to authenticated;

comment on column public.applications.pricing_agreement_id is
  'Which agreement priced this application. Frozen at creation: re-pricing an org never re-prices what it already sold.';

-- ---------------------------------------------------------------------------
-- SEED: one universal agreement per partner, saying what is already true.
-- ---------------------------------------------------------------------------
insert into public.pricing_agreements (scope_level, scope_id, min_tenants, max_tenants, fee_basis_weeks, agent_rate, effective_from)
select 'partner', p.id, 1, null, 4.35, null, '2000-01-01'::date
from public.partners p
where not exists (
  select 1 from public.pricing_agreements pa
  where pa.scope_level = 'partner' and pa.scope_id = p.id
);

-- ---------------------------------------------------------------------------
-- INERTNESS GUARD. Every branch must resolve to an agreement, and that agreement
-- must describe the fee already being charged: one month, 4.35 weeks.
-- ---------------------------------------------------------------------------
do $$
declare v_unpriced int; v_wrong int; v_total int;
begin
  select count(*) into v_total from public.branches;

  select count(*) into v_unpriced
  from public.branches b
  where not exists (select 1 from public.resolve_pricing_agreement(b.id, b.partner_id, 1));

  select count(*) into v_wrong
  from public.branches b
  cross join lateral public.resolve_pricing_agreement(b.id, b.partner_id, 1) r
  where r.fee_basis_weeks is distinct from 4.35
     or r.agent_rate is not null;   -- a rate here would be a second source of truth

  if v_unpriced > 0 or v_wrong > 0 then
    raise exception 'REFUSING: % of % branches resolve to no agreement, % to an agreement that would change pricing.',
      v_unpriced, v_total, v_wrong;
  end if;
  raise notice 'Pricing agreements seeded: % branches all resolve to one month (4.35 weeks), no rate override.', v_total;
end $$;
