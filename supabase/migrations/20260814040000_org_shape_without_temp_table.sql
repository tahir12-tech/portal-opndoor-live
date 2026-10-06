-- ===========================================================================
-- Fixes my_org_shape: a STABLE function may not write, not even to a temp table.
--
-- THE DEFECT. The previous version built its working set with
--
--   create temporary table if not exists _shape_scratch ...
--   insert into _shape_scratch ...
--
-- inside a function marked STABLE. Postgres validates volatility at EXECUTION,
-- not at creation, so `supabase db push` reported success and the function
-- would have raised "INSERT is not allowed in a non-volatile function" the
-- first time anybody opened the referral form.
--
-- Worth stating plainly: a migration applying cleanly is not evidence the
-- function runs. Only calling it is.
--
-- The rule itself is unchanged. Same signature, same return type, same
-- ownership gate. This only changes how the working set is built: one CTE, no
-- writes.
-- ===========================================================================

create or replace function public.my_org_shape(p_partner uuid default null)
returns table (
  refers_own_stock  boolean,
  agency_count      int,
  branch_count      int,
  collapse_agency   boolean,
  collapse_branch   boolean,
  may_add_agency    boolean,
  only_agency_id    uuid,
  only_agency_name  text,
  only_branch_id    uuid,
  only_branch_name  text
)
language plpgsql stable security definer set search_path to '' as $$
declare
  v_partner uuid;
  v_own     boolean;
begin
  if not public.is_aal2() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if public.is_admin() and p_partner is not null then
    v_partner := p_partner;
  else
    v_partner := public.app_partner();
  end if;

  if v_partner is null then
    return;
  end if;

  select p.refers_own_stock into v_own from public.partners p where p.id = v_partner;
  v_own := coalesce(v_own, false);

  return query
  with reachable as (
    select b.id as bid, b.name as bname, a.id as aid, a.name as aname
      from public.branches b
      join public.agencies a on a.id = b.agency_id
     where a.partner_id = v_partner
       and (
         not public.app_has_scope()
         or b.id in (select s from public.app_scope_branches() s)
       )
  ),
  agg as (
    select
      count(distinct r.aid)::int      as ag,
      count(*)::int                   as br,
      (array_agg(distinct r.aid))[1]   as aid1,
      (array_agg(distinct r.aname))[1] as aname1,
      (array_agg(r.bid))[1]            as bid1,
      (array_agg(r.bname))[1]          as bname1
    from reachable r
  )
  select
    v_own,
    agg.ag,
    agg.br,
    -- An agent with one agency: it is theirs, do not ask.
    (v_own and agg.ag = 1),
    (v_own and agg.br = 1),
    -- Only a supplier invents an agency mid-referral.
    (not v_own),
    case when agg.ag = 1 then agg.aid1   end,
    case when agg.ag = 1 then agg.aname1 end,
    case when agg.br = 1 then agg.bid1   end,
    case when agg.br = 1 then agg.bname1 end
  from agg;
end $$;

revoke all on function public.my_org_shape(uuid) from public, anon;
grant execute on function public.my_org_shape(uuid) to authenticated;

comment on function public.my_org_shape(uuid) is
  'What the referral form should ask. Collapses a level only when it has one answer AND the partner owns its stock, because a supplier''s agency set is open at referral time. Respects user_scopes. No row for an admin with no partner selected.';
