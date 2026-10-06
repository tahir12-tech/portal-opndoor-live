-- AN UNPOSITIONED NEGOTIATOR WORKS AT ONE OFFICE, NOT AT ALL OF THEM.
--
-- Reported from the walk as Tom, a Negotiator with no position row and a home
-- branch of Regent's Park: New application asked "Brand and branch" and offered
-- an agency select and an office select. It should have asked nothing at all.
--
-- WHY. my_org_shape narrows its reachable set like this:
--
--   and (not public.app_has_scope()
--        or b.id in (select s from public.app_scope_branches() s))
--
-- A Negotiator is placed by their HOME BRANCH and holds no user_scopes row, by
-- design: invite-user grants a position to a manager and leaves a negotiator to
-- their home branch. So app_has_scope() is false, `not false` is true, and the
-- predicate stops narrowing anything. Every branch under the caller's partner
-- becomes reachable, and on the agent rail the partner is opndoor-agents, the
-- house route that carries EVERY one of our agencies. Measured on dev as Tom:
--
--   refers_own_stock | agency_count | branch_count | collapse_agency
--   true             | 5            | 6            | false
--
-- Five agencies and six offices, for a man who works at one.
--
-- NOT A DATA LEAK, and worth saying precisely because the shape of the bug
-- invites the assumption. RLS on public.agencies held throughout: Tom could read
-- exactly one agency, his own, so the selects the form drew were populated from
-- his own hydrated store and listed only Regent's Lettings. What escaped was the
-- COUNTS, and what broke was the form: it asked a question with one answer, and
-- section 4 appeared where the office should have been one line under Tenancy.
--
-- THE FALLBACK LADDER, in order, and each rung is a different fact:
--
--   a POSITION            the user_scopes row says which branches. Unchanged.
--   a HOME BRANCH         no position, but we know where they work. One branch.
--   neither, on OUR       they have no place on our estate, so they get the
--   estate                "nothing is set up for your account yet" state rather
--                         than the whole house route. Falling through to the
--                         estate is how somebody files a referral against a
--                         competitor's office.
--   neither, a SUPPLIER   unchanged, and deliberately: a supplier's agency set is
--                         OPEN at referral time, so "everything under my partner"
--                         is the right answer there and always was.
--
-- app_has_scope() and app_scope_branches() are NOT touched. They are shared by
-- every reach test in the schema and changing either would widen or narrow
-- visibility far beyond this form. The ladder is local to my_org_shape, which is
-- the one function whose job is "what should the referral form ask".

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
  v_home    uuid;
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

  -- Where this person works when nothing has positioned them. Read once rather
  -- than inside the predicate, which is evaluated per row.
  select u.home_branch_id into v_home from public.users u where u.id = auth.uid();

  return query
  with reachable as (
    select b.id as bid, b.name as bname, a.id as aid, a.name as aname
      from public.branches b
      join public.agencies a on a.id = b.agency_id
     where a.partner_id = v_partner
       and (
         case
           -- A position says which branches, and says it best.
           when public.app_has_scope() then b.id in (select s from public.app_scope_branches() s)
           -- No position, but we know the office they sit in.
           when v_home is not null     then b.id = v_home
           -- No position and no office, on our own estate: no place at all. The
           -- aggregate below still returns one row, with zero counts, which is
           -- the "nothing is set up for your account yet" state the client draws.
           -- Returning the estate instead is the bug this migration closes.
           when v_own                  then false
           -- A supplier, whose set is open. Exactly as before.
           else true
         end
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

comment on function public.my_org_shape(uuid) is
  'What the referral form should ask. Collapses a level only when it has one answer AND the partner owns its stock, because a supplier''s agency set is open at referral time. Reach comes from a position, else from the home branch, else (on our own estate) from nothing at all: an unpositioned negotiator works at one office and must never be offered the whole house route. No row for an admin with no partner selected.';

revoke all on function public.my_org_shape(uuid) from public, anon;
grant execute on function public.my_org_shape(uuid) to authenticated;
