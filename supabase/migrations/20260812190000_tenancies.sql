-- ===========================================================================
-- Joint tenancies: several applicants, one tenancy, one guarantee.
--
-- THE COMMERCIAL SHAPE, as decided
--   Opndoor guarantees 100% of the tenancy, not a share of it.
--   Applicants may hold varying percentages.
--   Eligibility is a GROUP test: they must cover 100% between them, individually
--     or together. One applicant covering everything and another covering
--     nothing passes, and each still holds the percentage assigned.
--   The eligibility fee is per applicant, since each is referenced separately.
--   The guarantee fee is one per tenancy, apportioned by share.
--   One deed, naming all tenants.
--
-- WHY ONE DEED
-- The guarantee is a single obligation over a single tenancy and there is one
-- fee for it, so one deed matches one guarantee matches one fee. Two deeds each
-- guaranteeing 100% would be either duplicative or ambiguous about aggregate
-- liability, and the landlord should hold one instrument rather than N. Since
-- recovery against tenants is the insurer's problem, the percentages never need
-- to be legally operative in the deed at all: they are an internal apportionment
-- of the fee.
--
-- ---------------------------------------------------------------------------
-- ADDITIVE: tenancy_id is NULLABLE and null on every application that exists.
-- ---------------------------------------------------------------------------
-- A referral-path application is a tenancy of one with no tenancy row, and the
-- existing per-application deed columns keep working untouched. Nothing on the
-- referral path reads any of this.
-- ===========================================================================

create table if not exists public.tenancies (
  id uuid primary key default gen_random_uuid(),

  -- The whole rent for the property, which is what the guarantee covers and
  -- what the group test must reach. Distinct from any applicant's share.
  monthly_rent  numeric(10,2) not null check (monthly_rent >= 0),
  tenancy_start date not null,

  prop_addr1   text not null,
  prop_addr2   text,
  prop_city    text,
  prop_county  text,
  prop_postcode text,

  -- The deed lives here rather than on each application, because there is one
  -- deed for the tenancy. Mirrors the per-application columns deliberately, so
  -- the deed code can be pointed at either without learning a new vocabulary.
  deed_state        text check (deed_state in ('awaiting_tenant','executed','declined','voided','error')),
  pandadoc_document_id text,
  deed_issued_at    timestamptz,
  executed_pdf_path text,

  created_at timestamptz not null default now()
);

alter table public.applications
  add column if not exists tenancy_id uuid references public.tenancies(id) on delete set null;

create index if not exists applications_tenancy_idx on public.applications (tenancy_id);

-- The per-applicant apportionment. Percentage is the commercial fact; the
-- amount is derived and stored so the basis a reference was assessed against
-- cannot drift when the rent is later corrected.
alter table public.applications
  add column if not exists share_percent numeric(6,3)
    check (share_percent is null or (share_percent >= 0 and share_percent <= 100));
alter table public.applications
  add column if not exists share_amount numeric(10,2)
    check (share_amount is null or share_amount >= 0);

-- THE COLUMN GRANTS. The table grant on applications is per column since
-- 20260811180000, so a new column is invisible to the client until granted.
grant select (tenancy_id)     on public.applications to authenticated;
grant select (share_percent)  on public.applications to authenticated;
grant select (share_amount)   on public.applications to authenticated;

comment on column public.applications.tenancy_id is
  'The joint tenancy this application belongs to, NULL for a tenancy of one. Nullable permanently: this is what keeps joint tenancies additive for the referral path.';
comment on column public.applications.share_percent is
  'This applicant''s assigned share of the rent. A share of ZERO is a real answer: on a joint tenancy one applicant may carry nothing and be covered by the others, and they still hold the percentage assigned.';

alter table public.tenancies enable row level security;

-- Visible when any application on it is visible. Written as an EXISTS against
-- applications so it can never drift from the route-scoped rule there.
drop policy if exists tenancies_select on public.tenancies;
create policy tenancies_select on public.tenancies for select to authenticated
  using (exists (select 1 from public.applications a where a.tenancy_id = id));

comment on table public.tenancies is
  'One tenancy, several applicants, one guarantee and one deed. Opndoor guarantees 100% of the rent; shares are an internal apportionment of the fee, not separate guarantees.';

-- ---------------------------------------------------------------------------
-- The shares must describe the whole tenancy.
--
-- A CHECK cannot span rows, so this is a constraint trigger, deferred to the
-- end of the transaction: applicants are added one at a time and the sum is
-- only meaningful once they all are.
-- ---------------------------------------------------------------------------
create or replace function public.assert_tenancy_shares() returns trigger
language plpgsql security definer set search_path to '' as $function$
declare v_tenancy uuid; v_pct numeric; v_n int;
begin
  v_tenancy := coalesce(new.tenancy_id, old.tenancy_id);
  if v_tenancy is null then return coalesce(new, old); end if;

  select count(*), coalesce(sum(share_percent), 0) into v_n, v_pct
  from public.applications where tenancy_id = v_tenancy;

  if v_n = 0 then return coalesce(new, old); end if;

  -- Rounding tolerance, because thirds of a tenancy exist and 33.333 * 3 is not
  -- 100. Tight enough that a genuine mistake still fails.
  if abs(v_pct - 100) > 0.01 then
    raise exception 'Shares on tenancy % total %%%, not 100%%', v_tenancy, v_pct
      using errcode = '23514';
  end if;
  return coalesce(new, old);
end $function$;

drop trigger if exists applications_tenancy_shares on public.applications;
create constraint trigger applications_tenancy_shares
  after insert or update of tenancy_id, share_percent or delete on public.applications
  deferrable initially deferred
  for each row execute function public.assert_tenancy_shares();

comment on function public.assert_tenancy_shares() is
  'The shares on a tenancy must total 100%. A constraint trigger deferred to commit, because applicants are added one at a time and the sum only means anything once they all are. Tolerance is 0.01 for thirds.';

-- ---------------------------------------------------------------------------
-- The group eligibility test, wired to real applications.
--
-- === NAMED SEAM =========================================================
-- This can only be answered from what the applicants told US. It assesses each
-- against their own assigned share, which is what makes the carry case work
-- arithmetically: a zero-share applicant is judged against zero, passes, and is
-- covered by the others.
--
-- Whether the PROVIDER does the same is unknown and is the question that
-- decides whether joint tenancies work on the rails we reference. Their payload
-- carries share_percentage and share_amount, so they may already assess against
-- the share; if instead they assess every applicant against the FULL rent, the
-- zero-share applicant fails on their side and the group never forms. If they
-- return a verdict rather than an affordability figure, we cannot compute the
-- shortfall from their answer at all.
--
-- Until that is answered this function is the PREQUALIFICATION only. It must
-- not be presented as the outcome, and nothing here writes a decision.
-- ========================================================================
create or replace function public.tenancy_group_prequalification(p_tenancy uuid)
returns table (outcome text, reason text, covered numeric, shortfall numeric,
               member_count int, version text)
language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_rent numeric; v_shares numeric[]; v_incomes numeric[]; v_students boolean[];
begin
  select t.monthly_rent into v_rent from public.tenancies t where t.id = p_tenancy;
  if v_rent is null then
    raise exception 'Tenancy % not found', p_tenancy using errcode = '22023';
  end if;

  select array_agg(coalesce(a.share_amount, 0) order by a.created_at),
         array_agg(public.application_annual_income(a.id) order by a.created_at),
         array_agg(exists (
           select 1 from public.application_incomes i
           where i.application_id = a.id and i.income_type = 'student'
         ) order by a.created_at)
    into v_shares, v_incomes, v_students
  from public.applications a
  where a.tenancy_id = p_tenancy;

  -- Credit scores are deliberately not passed. We do not have one: only the
  -- provider pulls a credit file, which is why this says "nothing here rules
  -- you out" and never "you qualify".
  return query select * from public.assess_group_eligibility(v_rent, v_shares, v_incomes, null, v_students);
end $function$;

comment on function public.tenancy_group_prequalification(uuid) is
  'The group test over a real tenancy, from what the applicants declared. PREQUALIFICATION ONLY: no credit file is available to us, and whether the provider assesses against the assigned share or the full rent is an open question that decides whether joint tenancies work on the rails we reference. Never present this as the outcome.';

revoke all on function public.tenancy_group_prequalification(uuid) from public, anon;
grant execute on function public.tenancy_group_prequalification(uuid) to authenticated, service_role;
