-- THE WEEKLY DIGEST COUNTS ONE AGENCY, NOT ONE PARTNER.
--
-- partner_weekly_digest groups by partner: `left join base on base.partner_id
-- = p.id ... group by p.id`. On the supplier rail that is a company's week. On
-- the agency rail every agency shares the house partner, so every figure in
-- the email -- referrals sent, fees taken, deeds issued, and the named "top
-- branch" -- was the sum of four unrelated competitors, sent to all of them.
-- An agency reading "£14,200 in fees this week" was reading mostly somebody
-- else's.
--
-- This is the same aggregate grouped one level down, so the two cannot
-- disagree about what a week is: same base CTE, same filters, same livemode
-- gate, same top-branch tie-break. Only the grouping key changes.
--
-- The caller sums these over the agencies a reader actually covers
-- (staff_notification_scopes), which is what makes the CONTENT scoped and not
-- just the address list.

create or replace function public.agency_weekly_digest(p_start timestamptz, p_end timestamptz)
returns table (
  agency_id uuid, agency_name text, partner_id uuid,
  sent integer, sent_paid integer, paid integer, fees numeric,
  deeds integer, awaiting integer, top_branch text, top_branch_fees numeric
)
language plpgsql security definer set search_path to ''
as $function$
begin
  return query
  with base as (
    select a.agency_id, a.partner_id, a.status, a.sent_at, a.paid_at, a.deed_issued_at,
           a.deed_state, a.monthly_rent, a.fee_amount, b.name as branch_name
    from public.applications a
    left join public.branches b on b.id = a.branch_id
    where a.livemode
  ),
  per_agency as (
    select ag.id as aid, ag.name as aname, ag.partner_id as apid,
      count(*) filter (where base.status <> 'withdrawn' and base.sent_at >= p_start and base.sent_at < p_end)::int as v_sent,
      count(*) filter (where base.status <> 'withdrawn' and base.sent_at >= p_start and base.sent_at < p_end and base.paid_at is not null)::int as v_sent_paid,
      count(*) filter (where base.paid_at >= p_start and base.paid_at < p_end)::int as v_paid,
      coalesce(sum(coalesce(base.fee_amount, base.monthly_rent)) filter (where base.paid_at >= p_start and base.paid_at < p_end), 0) as v_fees,
      count(*) filter (where base.deed_issued_at >= p_start and base.deed_issued_at < p_end)::int as v_deeds,
      count(*) filter (where base.deed_state = 'awaiting_tenant')::int as v_awaiting
    from public.agencies ag
    left join base on base.agency_id = ag.id
    where not ag.is_placeholder
    group by ag.id, ag.name, ag.partner_id
  ),
  branch_agg as (
    select base.agency_id as aid, base.branch_name as bname,
      coalesce(sum(coalesce(base.fee_amount, base.monthly_rent)) filter (where base.paid_at >= p_start and base.paid_at < p_end), 0) as bf
    from base
    where base.branch_name is not null
    group by base.agency_id, base.branch_name
  ),
  top_branch as (
    select ba.aid, ba.bname, ba.bf,
      row_number() over (partition by ba.aid order by ba.bf desc, ba.bname asc) as rn
    from branch_agg ba
  )
  select pa.aid, pa.aname, pa.apid, pa.v_sent, pa.v_sent_paid, pa.v_paid, pa.v_fees,
         pa.v_deeds, pa.v_awaiting, tb.bname, tb.bf
  from per_agency pa
  left join top_branch tb on tb.aid = pa.aid and tb.rn = 1;
end $function$;

comment on function public.agency_weekly_digest(timestamptz, timestamptz) is
  'The weekly digest figures grouped by AGENCY. partner_weekly_digest groups by partner, which on the house route sums four competing agencies into one email sent to all of them. Same base, same filters, same tie-break; only the grouping key differs.';

revoke all on function public.agency_weekly_digest(timestamptz, timestamptz) from public;
grant execute on function public.agency_weekly_digest(timestamptz, timestamptz) to service_role;
