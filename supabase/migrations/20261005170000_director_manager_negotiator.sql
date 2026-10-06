-- THREE LEVELS IN AN AGENCY, AND ONLY ONE OF THEM SEES THE MONEY.
--
--   DIRECTOR    everything, including commission and the monthly statement.
--   MANAGER     every referral, every branch and the team. No commission
--               figure anywhere: not on Reporting, not on an application, not
--               in an export, not in a statement, not from an RPC.
--   NEGOTIATOR  their own referrals only.
--
-- THE SCOPE MODEL DOES NOT CHANGE. A Manager is management scope without the
-- sees-commission capability, and a Negotiator is the referrer role it already
-- was. So this adds one bit rather than a third role, and every policy,
-- position and scope rule that already reasons about 'management' keeps
-- working unexamined. Inventing a third role would have meant revisiting all
-- of them to say "and this one too", which is how a role model rots.
--
-- EXISTING MANAGEMENT USERS BECOME DIRECTORS. The backfill is TRUE for them,
-- because they can see commission today and a migration must not quietly take
-- something away from somebody using it.
--
-- ---------------------------------------------------------------------------
-- WHERE A COMMISSION FIGURE CAN ACTUALLY COME FROM
--
-- The ruling says a Manager must not obtain one BY ANY ROUTE, which is a claim
-- about SQL and not about screens. applications.partner_rate and
-- applications.agent_rate are already off the authenticated table grant
-- entirely (20260815030000), so the columns cannot be selected directly. That
-- leaves the functions, and there are exactly four a signed-in user can call
-- that yield a rate:
--
--   application_commission_rates   the per-application snapshot, which feeds
--                                  every figure on every screen
--   my_partner_rates               the partner's own rates
--   commission_split_batch         the payout table on the agency page
--   commission_preview             the what-if behind the rate editor
--
-- All four are gated below.
--
-- AND FOUR MORE THAT ARE DELIBERATELY NOT GATED, which matters more than the
-- ones that are, because gating them is the obvious move and it would break
-- the product:
--
--   commission_total   create_referral and create_joint_referral call it to
--   resolve_rates      FREEZE the commission onto a new application. They run
--   commission_split   as SECURITY DEFINER but auth.uid() is still the caller,
--   freeze_commission_ so a capability test inside them would see the Manager
--     lines            and return null. A Manager would then create referrals
--                      that earn their agency nothing, silently, for ever.
--
-- The distinction is not "internal versus external". It is that these four
-- answer "what is this worth" for the purpose of RECORDING it, and the four
-- above answer it for the purpose of SHOWING it. A Manager may cause
-- commission to be computed. They may not be told the answer.

-- ---------------------------------------------------------------------------
-- 1. The capability.
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists sees_commission boolean not null default false;

comment on column public.users.sees_commission is
  'Does this person see commission figures? The one bit that separates a Director from a Manager; both are management scope. False for a Negotiator too, though their role already withholds it. Never true for opndoor_manager, who is Opndoor operations and has never seen commission.';

-- Existing management users are Directors: they can see commission today.
update public.users set sees_commission = true
 where role = 'management' and not sees_commission;

-- ---------------------------------------------------------------------------
-- 2. The one place the question is answered.
-- ---------------------------------------------------------------------------
create or replace function public.may_see_commission()
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select public.is_admin()
      or coalesce((select u.sees_commission and u.role = 'management'
                     from public.users u where u.id = auth.uid()), false)
$function$;

comment on function public.may_see_commission() is
  'May the caller be shown a commission figure? Opndoor admin always; an agency Director yes; a Manager, a Negotiator, a developer and opndoor operations no. The single predicate every commission-returning RPC consults, so the answer cannot differ between two of them. Mirrored by maySeeCommission in src/data/types.ts, which decides what to DRAW; this decides what is ANSWERED, and it is the one that counts.';

revoke all on function public.may_see_commission() from public, anon;
grant execute on function public.may_see_commission() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The four routes, closed.
--
-- Each returns NOTHING rather than raising. A refusal would turn every screen
-- that asks into an error state for a Manager, and a Manager is not doing
-- anything wrong by opening Reporting: the figure is simply not theirs. An
-- empty result is what the client already handles for a role with no
-- entitlement, so nothing downstream has to learn a new shape.
-- ---------------------------------------------------------------------------
create or replace function public.application_commission_rates(p_partner uuid default null)
returns table (application_id uuid, partner_rate numeric, agent_rate numeric)
language sql stable security definer set search_path to ''
as $function$
  select a.id, a.partner_rate, a.agent_rate
  from public.applications a
  where public.is_aal2()
    and public.may_see_commission()
    and (p_partner is null or a.partner_id = p_partner)
    and (
      public.is_admin()
      or (public.app_role() = 'management' and a.partner_id = public.app_partner())
    )
$function$;

comment on function public.application_commission_rates(uuid) is
  'The snapshotted per-application rates, for the roles entitled to them. Gated on may_see_commission as well as on scope: a Manager is management and reaches the application, and must still not be told what it earned.';

revoke all on function public.application_commission_rates(uuid) from public, anon;
grant execute on function public.application_commission_rates(uuid) to authenticated, service_role;

create or replace function public.my_partner_rates()
returns table (partner_id uuid, partner_rate numeric, agent_rate numeric)
language plpgsql stable security definer set search_path to ''
as $function$
begin
  if not public.may_see_commission() then return; end if;
  if public.is_admin() then
    return query select p.id, p.partner_rate, p.agent_rate from public.partners p;
  elsif public.app_role() = 'management' then
    return query select p.id, p.partner_rate, p.agent_rate
                 from public.partners p where p.id = public.app_partner();
  end if;
end $function$;

revoke all on function public.my_partner_rates() from public, anon;
grant execute on function public.my_partner_rates() to authenticated, service_role;

-- commission_split_batch keeps its reach test and gains the capability test.
-- Its body is otherwise the one from 20261004130000, unchanged.
create or replace function public.commission_split_batch(p_branches uuid[])
returns table (branch_id uuid, level text, org_id uuid, org_name text, rate numeric, source text)
language sql stable security definer set search_path to ''
as $function$
  select b.id, s.level, s.org_id, s.org_name, s.rate, s.source
  from public.branches b
  cross join lateral public.commission_split(b.id, b.partner_id) s
  where b.id = any(p_branches)
    and public.may_see_commission()
    -- Only branches the caller can already see; this adds no reach.
    and (public.is_admin() or public.app_reachable_agency(b.agency_id)
         or (public.app_has_scope() and b.id in (select public.app_scope_branches())))
$function$;

revoke all on function public.commission_split_batch(uuid[]) from public, anon;
grant execute on function public.commission_split_batch(uuid[]) to authenticated;

-- commission_preview is the rate editor's what-if. Setting a rate is already
-- admin only, so this is belt and braces, and belt and braces is the right
-- amount for a function whose entire output is a percentage. The body is the
-- one from its own migration, with a single guard on the outer select: gating
-- the CTEs instead would still compute the split and only hide the answer.
create or replace function public.commission_preview(p_level text, p_id uuid, p_rate numeric)
returns table (worst_total numeric, worst_branch text, branches_affected int)
language sql stable security definer set search_path to ''
as $function$
  with affected as (
    select b.id, b.name, b.agent_rate as branch_rate, b.partner_id,
           a.id as agency_id, a.name as agency_name, a.agent_rate as agency_rate,
           g.id as group_id, g.name as group_name, g.agent_rate as group_rate
    from public.branches b
    join public.agencies a on a.id = b.agency_id
    left join public.agency_groups g on g.id = a.group_id
    where public.may_see_commission()
      and ((p_level = 'branch' and b.id = p_id)
        or (p_level = 'agency' and b.agency_id = p_id)
        or (p_level = 'group'  and a.group_id = p_id))
  ),
  totals as (
    select f.name,
           (select coalesce(sum(r.rate), 0)
              from public.commission_split_rule(
                f.agency_id, f.agency_name,
                case when p_level = 'agency' then p_rate else f.agency_rate end,
                f.id, f.name,
                case when p_level = 'branch' then p_rate else f.branch_rate end,
                f.group_id, f.group_name,
                case when p_level = 'group'  then p_rate else f.group_rate end,
                (select p2.agent_rate from public.partners p2 where p2.id = f.partner_id)
              ) r) as total
    from affected f
  )
  select coalesce(max(total), 0),
         (select name from totals order by total desc nulls last limit 1),
         count(*)::int
  from totals
$function$;

revoke all on function public.commission_preview(text, uuid, numeric) from public, anon;
grant execute on function public.commission_preview(text, uuid, numeric) to authenticated, service_role;
