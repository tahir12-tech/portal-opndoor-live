-- ===========================================================================
-- Correcting my_org_shape: counting is not enough, ownership gates the collapse.
--
-- THE BUG IN THE PREVIOUS MIGRATION. It collapsed any level with one option.
-- Run against real data that produced:
--
--   otherpartner  supplier  1 agency  1 branch  -> "ask nothing"
--
-- which is wrong, and wrong in the direction that loses data. A supplier refers
-- on behalf of agencies it does NOT own. The fact that it has dealt with one
-- agency so far says nothing about the next referral, which is very likely for
-- an agency that is not in the list yet. Collapsing the agency step would have
-- silently filed that referral against whichever agency happened to be first.
--
-- An AGENT is the opposite. Its agencies are its own. One agency means one
-- agency, and asking is asking somebody to confirm a fact about themselves.
--
-- SO THE RULE IS TWO RULES.
--   Agent:    collapse any level that has one option. The org tree is closed.
--   Supplier: NEVER collapse the agency step, however few agencies exist,
--             because the set is open. Collapse the branch step only once an
--             agency is chosen and that agency has exactly one branch.
--
-- This is what the owner meant by "agencies would only ever have branches,
-- suppliers would have both agencies and branches". The difference is not how
-- many rows exist today. It is whether the set can grow at referral time.
--
-- Return type changes, so this drops rather than replaces: create or replace
-- refuses a return-type change with 42P13.
-- ===========================================================================

drop function if exists public.my_org_shape(uuid);

create function public.my_org_shape(p_partner uuid default null)
returns table (
  refers_own_stock  boolean,
  agency_count      int,
  branch_count      int,
  -- The two answers the form actually needs. Computed here so the UI cannot
  -- reimplement the rule and drift from it.
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
  v_ag      int;
  v_br      int;
  v_aid     uuid; v_aname text;
  v_bid     uuid; v_bname text;
begin
  if not public.is_aal2() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if public.is_admin() and p_partner is not null then
    v_partner := p_partner;
  else
    v_partner := public.app_partner();
  end if;

  -- An admin with no partner chosen reaches every partner, so nothing can
  -- collapse. No row says that, and the caller falls back to the full picker.
  if v_partner is null then
    return;
  end if;

  select p.refers_own_stock into v_own from public.partners p where p.id = v_partner;

  create temporary table if not exists _shape_scratch (
    bid uuid, bname text, aid uuid, aname text
  ) on commit drop;
  delete from _shape_scratch;

  insert into _shape_scratch (bid, bname, aid, aname)
  select b.id, b.name, a.id, a.name
    from public.branches b
    join public.agencies a on a.id = b.agency_id
   where a.partner_id = v_partner
     and (
       not public.app_has_scope()
       or b.id in (select s from public.app_scope_branches() s)
     );

  select count(distinct s.aid), count(*) into v_ag, v_br from _shape_scratch s;

  select s.aid, s.aname into v_aid, v_aname from _shape_scratch s limit 1;
  if v_ag <> 1 then v_aid := null; v_aname := null; end if;

  select s.bid, s.bname into v_bid, v_bname from _shape_scratch s limit 1;
  if v_br <> 1 then v_bid := null; v_bname := null; end if;

  return query select
    coalesce(v_own, false),
    v_ag,
    v_br,
    -- An agent with exactly one agency: it is theirs, so do not ask.
    -- A supplier: always ask, because the set is open.
    (coalesce(v_own, false) and v_ag = 1),
    -- One branch reachable, and the agency step already resolved. For a
    -- supplier this stays false at form load and the picker decides per agency
    -- once one is chosen, which is the behaviour that already exists.
    (coalesce(v_own, false) and v_br = 1),
    -- Only a supplier invents an agency mid-referral. For an agent a new agency
    -- is an acquisition, and that belongs to an admin, not to a referral form.
    (not coalesce(v_own, false)),
    v_aid, v_aname, v_bid, v_bname;
end $$;

revoke all on function public.my_org_shape(uuid) from public, anon;
grant execute on function public.my_org_shape(uuid) to authenticated;

comment on function public.my_org_shape(uuid) is
  'What the referral form should ask. Collapses a level only when it has one answer AND the partner owns its stock, because a supplier''s agency set is open at referral time. Respects user_scopes. No row for an admin with no partner selected.';
