-- R3. THE PREVIEW MUST SHOW WHAT IS ACTUALLY PAID.
--
-- `commission_preview` answers "if I change this rate, what would the worst
-- branch end up paying out in total?" It is the number an operator sees
-- before committing a commercial change, and it computed that number from the
-- party's own rate COLUMNS plus the partner standard, never once looking at
-- pricing agreements.
--
-- For an agreement-priced party that is not a rounding difference, it is an
-- unrelated number, and the reason is `enforce_agreement_exclusivity`: a
-- party holds a rate OR an agreement, never both. So an agreement-priced
-- agency has NO rate column at all, the preview falls through to the partner
-- standard, and the figure shown has nothing to do with what is paid.
--
-- MEASURED on a clean local apply -- one agency, one agreement, two bands:
--
--     the agreement's joint band              0.30
--     assert_agreement_within_cap sees        0.30   (correct)
--     commission_preview showed the operator  0.10   <-- this
--
-- Test: supabase/tests/the_preview_shows_what_is_actually_paid.test.sql
-- One assertion failed first; five passed throughout, two of which exist to
-- pin down the half of the finding that did NOT reproduce.
--
-- =========================================================================
-- WHAT DID NOT REPRODUCE, recorded because it was claimed and is worth
-- knowing is untrue
-- =========================================================================
--
-- The finding also said the 50% cap is not enforced for joint tenancies. It
-- is. `agreement_max_rate` takes the MAX agent_rate across EVERY band, joint
-- bands included, and `assert_agreement_within_cap` refuses on it. Measured,
-- with a 0.55 joint band, it raises by name and by figure:
--
--     "This agreement could take a branch to 55.00% of the guarantee fee.
--      The most a branch may pay out in total is 50%."
--
-- So nothing is changed about the cap. Assertions 5 and 6 of the test pin it
-- so that it cannot be quietly removed, and so the claim is not raised again.
--
-- =========================================================================
-- THE CHANGE
-- =========================================================================
--
-- One arm. Where a branch resolves to a pricing agreement, the total comes
-- from `commission_split_for` at that agreement's worst band -- which is
-- exactly what the cap already uses, so the preview and the cap can no longer
-- disagree about the same agreement. Where there is no agreement, the
-- existing `commission_split_rule` path is untouched, so every party priced
-- the old way previews exactly as before.
--
-- WHY THE WORST BAND rather than the single-tenant one: the column is called
-- `worst_total` and the question is "how bad could this get". A joint band
-- that pays more than the single band is precisely the case the operator
-- needs warning about, and it is the band the cap judges the agreement on.
--
-- The MFA gate, the reach test and the commission-capability test above are
-- 20261006470000's, unchanged.

create or replace function public.commission_preview(p_level text, p_id uuid, p_rate numeric)
returns table(worst_total numeric, worst_branch text, branches_affected integer)
language plpgsql stable security definer set search_path to ''
as $function$
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  return query
  with affected as (
    select b.id, b.name, b.agent_rate as branch_rate, b.partner_id,
           a.id as agency_id, a.name as agency_name, a.agent_rate as agency_rate,
           g.id as group_id, g.name as group_name, g.agent_rate as group_rate
    from public.branches b
    join public.agencies a on a.id = b.agency_id
    left join public.agency_groups g on g.id = a.group_id
    where public.may_see_commission()
      and public.app_may_reach_agency(a.id)
      and ((p_level = 'branch' and b.id = p_id)
        or (p_level = 'agency' and b.agency_id = p_id)
        or (p_level = 'group'  and a.group_id = p_id))
  ),
  totals as (
    select f.name,
           case
             -- PRICED BY AGREEMENT. The party has no rate column to preview,
             -- so preview the agreement, at the band the cap judges it on.
             when ag.id is not null then
               (select coalesce(sum(s.rate), 0)
                  from public.commission_split_for(
                         f.id, f.partner_id, ag.id,
                         nullif(public.agreement_max_rate(ag.id), 0)) s)
             -- PRICED BY COLUMNS. Unchanged.
             else
               (select coalesce(sum(r.rate), 0)
                  from public.commission_split_rule(
                    f.agency_id, f.agency_name,
                    case when p_level = 'agency' then p_rate else f.agency_rate end,
                    f.id, f.name,
                    case when p_level = 'branch' then p_rate else f.branch_rate end,
                    f.group_id, f.group_name,
                    case when p_level = 'group'  then p_rate else f.group_rate end,
                    (select p2.agent_rate from public.partners p2 where p2.id = f.partner_id)
                  ) r)
           end as total
    from affected f
    -- The tenant count is irrelevant to WHICH agreement applies; only to
    -- which band within it, and the band is chosen above by worst case.
    left join lateral (
      select rp.id from public.resolve_pricing_agreement(f.id, f.partner_id, 1) rp
    ) ag on true
  )
  select coalesce(max(total), 0),
         (select name from totals order by total desc nulls last limit 1),
         count(*)::int
  from totals;
end $function$;

comment on function public.commission_preview(text, uuid, numeric) is
  'Worst-case total payout for the branches under a party, shown before a rate change. Where a branch is priced by a pricing AGREEMENT the preview reads that agreement at its worst band -- the same basis assert_agreement_within_cap judges it on, so the two cannot disagree. Where a party is priced by rate columns, unchanged.';
