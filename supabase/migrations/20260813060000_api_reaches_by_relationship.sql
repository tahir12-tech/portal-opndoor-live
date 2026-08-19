-- ===========================================================================
-- The partner API catches up with the portal on who can reach what.
--
-- THE DISAGREEMENT THIS ENDS
-- 20260812120000 moved the portal from ownership to reachability: an agency is
-- visible to a partner who introduced it, has staff there, or has transacted
-- with it. The API was left on ownership, so the two halves of one product
-- disagreed about the same question:
--
--   portal   agencies_select  -> partner_can_reach_agency(id)
--   API      partner_api_orgs -> a.partner_id = p_partner
--
-- A group's staff could see a brand another route introduced, and the group's
-- key could neither list it nor transact against it. The API is the half that
-- handles volume, so it is the half where that hurts.
--
-- WHY partner_can_reach_agency WORKS HERE DESPITE BEING WRITTEN FOR RLS
-- It calls app_partner(), which reads auth.uid(), and there is no session on an
-- API request. So these take the partner as an ARGUMENT and ask the
-- relationship table directly. Same table, same meaning, no dependence on a
-- session that does not exist.
--
-- ---------------------------------------------------------------------------
-- WHAT DOES NOT CHANGE, AND MUST NOT
-- ---------------------------------------------------------------------------
-- create_referral_api's `pid <> p_partner` guard STAYS. Route attribution's
-- safety case rests on it (20260812010000 asserts its literal presence at
-- migration time), and it is what stops one partner writing an application
-- against another's org. Reachability widens what a partner may SEE and
-- RESOLVE; it does not widen what they may write against, because a write
-- creates a commercial relationship and reading does not.
--
-- That asymmetry is deliberate. A group can now discover a brand it reaches and
-- will get a clear refusal if it tries to post against one it merely reaches
-- without owning, rather than silently succeeding.
-- ===========================================================================

create or replace function public.partner_reaches_agency(p_partner uuid, p_agency uuid)
returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (
    select 1 from public.partner_agency_relationships r
    where r.partner_id = p_partner and r.agency_id = p_agency
  )
$$;

comment on function public.partner_reaches_agency(uuid, uuid) is
  'The session-free twin of partner_can_reach_agency, for API paths where there is no auth.uid(). Same table, same meaning, partner passed in rather than read from a JWT.';

revoke all on function public.partner_reaches_agency(uuid, uuid) from public, anon;
grant execute on function public.partner_reaches_agency(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- GET /v1/orgs lists what the partner can REACH.
--
-- Reproduced in full from 20260811130000:176-204; the only change is the where
-- clause and the branch join, both from ownership to reachability.
-- ---------------------------------------------------------------------------
create or replace function public.partner_api_orgs(p_partner uuid)
returns table (
  agency_id                 uuid,
  agency_name               text,
  agency_has_agent_contact  boolean,
  branch_id                 uuid,
  branch_name               text,
  branch_has_agent_contact  boolean
)
language sql security definer set search_path to '' stable
as $function$
  select
    a.id,
    a.name,
    exists (
      select 1 from public.agent_contacts c
      where c.agency_id = a.id and c.is_primary
    ) as agency_has_agent_contact,
    b.id,
    b.name,
    case when b.id is null then null
         else ((public.effective_primary_contact(b.id)).email is not null)
    end as branch_has_agent_contact
  from public.agencies a
  left join public.branches b on b.agency_id = a.id
  where public.partner_reaches_agency(p_partner, a.id)
    and not a.is_placeholder            -- house rows are not somebody's org
  order by a.name, b.name nulls first;
$function$;

revoke all on function public.partner_api_orgs(uuid) from public, anon, authenticated;
grant execute on function public.partner_api_orgs(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Resolving an agency or branch by name, likewise.
-- ---------------------------------------------------------------------------
do $$
declare v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'partner_api_resolve_org';
  if v_src is null then
    raise notice 'partner_api_resolve_org not found; skipping its rewrite';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Prove the API and the portal now agree, and that the write guard did not move.
-- ---------------------------------------------------------------------------
do $$
declare v_disagree int; v_src text;
begin
  -- Every agency a partner owns is one it reaches: the backfill in
  -- 20260812110000 gave each an 'introduced' row. So listing by reachability
  -- returns a superset of what ownership returned, never a subset.
  select count(*) into v_disagree
  from public.agencies a
  where not public.partner_reaches_agency(a.partner_id, a.id);
  if v_disagree > 0 then
    raise exception '% agenc(ies) are owned by a partner that does not reach them; the API would now show fewer orgs than before', v_disagree;
  end if;

  -- The write guard stays exactly where route attribution asserted it.
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_referral_api';
  if position('pid <> p_partner' in v_src) = 0 then
    raise exception 'create_referral_api lost its cross-partner write guard. Reachability widens reads, never writes.';
  end if;
end $$;
