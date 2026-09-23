-- ADDITIVE COMMISSION on the agent rail.
--
-- THE OLD MODEL. resolve_rates picked ONE rate per application, most specific
-- wins: the agency override, else the group override, else the Opndoor base. A
-- group rate was an inherited DEFAULT for its agencies, and exactly one org was
-- paid.
--
-- THE NEW MODEL. Every level may hold its own rate, paid to THAT level, and a
-- referral pays every rate on its chain, added together. One application can now
-- have several payees.
--
--   THE DEFAULT RULE. The referring AGENCY earns its explicit rate, or the
--   Opndoor standard when neither it NOR the referring branch has an explicit
--   rate. Branch and group rates are additive lines on top. So:
--     nothing set            -> agency 10%                        = 10%
--     group 2% only          -> agency 10% + group 2%             = 12%
--     branch 10% + group 2%  -> branch 10% + group 2%, agency 0   = 12%
--     agency 12% + group 2%  -> agency 12% + group 2%             = 14%
--   A branch rate therefore REPLACES the agency's default (the branch is doing
--   the referring) but never its explicit rate.
--
-- SUPPLIER RAIL UNTOUCHED. commission_split is agent-rail only. resolve_rates is
-- not modified by this migration and still answers for the supplier rails, where
-- partner_rate and the Rightmove model are unchanged.

-- ---------------------------------------------------------------------------
-- 1. Branch-level rate storage.
-- ---------------------------------------------------------------------------
alter table public.branches
  add column if not exists agent_rate numeric(5,4);
alter table public.branches drop constraint if exists branches_agent_rate_check;
alter table public.branches add constraint branches_agent_rate_check
  check (agent_rate is null or (agent_rate >= 0 and agent_rate <= 1));

comment on column public.branches.agent_rate is
  'This branch''s own commission line (a share of the guarantee fee, paid to the branch). Null means the branch is not in the split. Agent rail only.';

-- ---------------------------------------------------------------------------
-- 2. The split resolver. One row per PAYEE for a branch.
-- ---------------------------------------------------------------------------
create or replace function public.commission_split(p_branch uuid, p_route_partner uuid)
returns table (level text, org_id uuid, org_name text, rate numeric)
language sql stable security definer set search_path to ''
as $function$
  with ctx as (
    select b.id as branch_id, b.name as branch_name, b.agent_rate as branch_rate,
           a.id as agency_id, a.name as agency_name, a.agent_rate as agency_rate,
           g.id as group_id,  g.name as group_name,  g.agent_rate as group_rate,
           p.agent_rate as standard_rate
    from public.partners p
    left join public.branches b on b.id = p_branch
    left join public.agencies a on a.id = b.agency_id
    left join public.agency_groups g on g.id = a.group_id
    where p.id = p_route_partner
  )
  -- The agency line: its own rate, else the Opndoor standard, but only when the
  -- branch is not itself carrying an explicit rate.
  select 'agency', agency_id, agency_name,
         coalesce(agency_rate, case when branch_rate is null then standard_rate end)
  from ctx
  where agency_id is not null
    and coalesce(agency_rate, case when branch_rate is null then standard_rate end) is not null
  union all
  select 'branch', branch_id, branch_name, branch_rate from ctx where branch_rate is not null
  union all
  select 'group',  group_id,  group_name,  group_rate  from ctx where group_rate  is not null
$function$;

comment on function public.commission_split(uuid, uuid) is
  'Every commission line a referral against this branch pays, one row per payee: the agency (its own rate, else the Opndoor standard when neither it nor the branch has an explicit rate), plus an explicit branch rate, plus an explicit group rate. Additive - the payout is the sum. Agent rail only; the supplier rails still use resolve_rates.';

revoke all on function public.commission_split(uuid, uuid) from public, anon;
grant execute on function public.commission_split(uuid, uuid) to authenticated, service_role;

-- Total payout for a branch, the number the 50% guard and the editor preview use.
create or replace function public.commission_total(p_branch uuid, p_route_partner uuid)
returns numeric
language sql stable security definer set search_path to '' as $function$
  select coalesce(sum(rate), 0) from public.commission_split(p_branch, p_route_partner)
$function$;

revoke all on function public.commission_total(uuid, uuid) from public, anon;
grant execute on function public.commission_total(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The per-application snapshot. Sits ALONGSIDE applications.agent_rate, which
--    is untouched for historic rows; for a new agent-rail referral the scalar is
--    written as the TOTAL of these lines, so every existing consumer keeps
--    showing a correct total while these lines carry the payees.
-- ---------------------------------------------------------------------------
create table if not exists public.application_commission_lines (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  level          text not null check (level in ('group','agency','branch')),
  org_id         uuid,
  org_name       text not null,
  rate           numeric(5,4) not null check (rate >= 0 and rate <= 1),
  created_at     timestamptz not null default now(),
  unique (application_id, level)
);
create index if not exists acl_application_idx on public.application_commission_lines (application_id);
create index if not exists acl_org_idx on public.application_commission_lines (org_id);

comment on table public.application_commission_lines is
  'The commission split snapshotted onto an application at creation: one row per payee. Frozen like the scalar rate - never recomputed, so history cannot move.';

alter table public.application_commission_lines enable row level security;

-- Visible exactly where the application is visible, so no new reach is created.
create policy acl_select on public.application_commission_lines for select to authenticated
using (
  public.is_aal2() and exists (
    select 1 from public.applications a where a.id = application_id
  )
);
revoke all on public.application_commission_lines from anon;
grant select on public.application_commission_lines to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Setting a rate, with the 50% guard. Admin only, matching set_agency_rates.
-- ---------------------------------------------------------------------------
create or replace function public.set_node_rate(p_level text, p_id uuid, p_rate numeric)
returns numeric
language plpgsql security definer set search_path to ''
as $function$
declare v_worst numeric;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_level not in ('group','agency','branch') then
    raise exception 'Unknown level %', p_level using errcode = '22023';
  end if;
  if p_rate is not null and (p_rate < 0 or p_rate > 1) then
    raise exception 'A rate must be between 0%% and 100%%.' using errcode = '22023';
  end if;

  if p_level = 'group'  then update public.agency_groups set agent_rate = p_rate where id = p_id;
  elsif p_level = 'agency' then update public.agencies  set agent_rate = p_rate where id = p_id;
  else                          update public.branches   set agent_rate = p_rate where id = p_id;
  end if;

  -- Every branch this change can reach must still pay out 50% or less.
  select max(t.total) into v_worst
  from (
    select b.id as branch_id, public.commission_total(b.id, b.partner_id) as total
    from public.branches b
    left join public.agencies a on a.id = b.agency_id
    where (p_level = 'branch' and b.id = p_id)
       or (p_level = 'agency' and b.agency_id = p_id)
       or (p_level = 'group'  and a.group_id = p_id)
  ) t;

  if v_worst is not null and v_worst > 0.50 then
    raise exception 'That rate would take a branch to % of the guarantee fee. The most a branch may pay out in total is 50%%.',
      to_char(round(v_worst * 100, 2), 'FM999990.00') || '%' using errcode = '22023';
  end if;

  return coalesce(v_worst, 0);
end $function$;

comment on function public.set_node_rate(text, uuid, numeric) is
  'Set or clear (null) one node''s commission line. Refuses any change that takes a branch total past 50% of the guarantee fee, and returns the worst branch total the change produces.';

revoke all on function public.set_node_rate(text, uuid, numeric) from public, anon;
grant execute on function public.set_node_rate(text, uuid, numeric) to authenticated;
