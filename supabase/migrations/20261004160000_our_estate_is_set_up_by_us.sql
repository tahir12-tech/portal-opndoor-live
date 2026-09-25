-- OUR ESTATE IS SET UP BY US.
--
-- agencies_insert and branches_insert let any management or referrer user create
-- an agency or a branch anywhere under their own partner. On the SUPPLIER rail
-- that is the product: Rightmove's agency set is open at referral time, an
-- agent they have never sent us before turns up mid-form, and the referral must
-- not stop. my_org_shape says so — may_add_agency is `not refers_own_stock`.
--
-- On the AGENT rail the same policy reads very differently, because the partner
-- is not a supplier: it is opndoor-agents, the house route that carries every
-- one of our agencies. `partner_id = app_partner()` is therefore satisfied by
-- EVERY agency we have, and a negotiator at one of them could create a branch
-- under another one — a competitor's — and see it. That is not a policy
-- preference, it is a cross-customer hole, and it is the reason this is a
-- migration rather than a screen change.
--
-- It is also the ruling: structure decides commission, deed delivery and scope,
-- so Opndoor sets it up from the admin Agencies section. This supersedes the
-- earlier design in which a group director added their own branches on first
-- login.
--
-- SCOPED TO THE ESTATE, AND NOTHING ELSE MOVES. A supplier's insert is judged by
-- exactly the expression it was judged by before; only rows whose route partner
-- is one of ours gain a condition. is_admin() is untouched: Opndoor still sets
-- up structure, which is the whole point.
--
-- The client mirrors this in AgentBranchPicker (branch creation offered only
-- where the partner does not refer its own stock, matching may_add_agency), and
-- supabase/tests/team_scope.test.sql asserts the refusal.

-- The estate question asked of a partner directly. is_agent_estate takes a
-- branch and a route partner and is the right shape for a referral; a policy
-- deciding whether a row may be CREATED has only the partner, because the
-- branch is the thing being created.
create or replace function public.is_our_estate_partner(p_partner uuid)
returns boolean language sql stable security definer set search_path to '' as $function$
  select coalesce(
    (select p.referencing_mode = 'opndoor_referenced'
       from public.partners p where p.id = p_partner),
    false)
$function$;

comment on function public.is_our_estate_partner(uuid) is
  'Is this partner the house route carrying OUR agencies, rather than a supplier? The estate question asked of a partner alone, for policies that judge a row before its branch exists. Mirrors is_agent_estate.';

revoke all on function public.is_our_estate_partner(uuid) from public, anon;
grant execute on function public.is_our_estate_partner(uuid) to authenticated, service_role;

drop policy if exists agencies_insert on public.agencies;
create policy agencies_insert on public.agencies for insert to authenticated
with check (
  public.is_admin()
  or (
    public.app_role() in ('management', 'referrer')
    and partner_id = public.app_partner()
    and not public.is_our_estate_partner(partner_id)
  )
);

drop policy if exists branches_insert on public.branches;
create policy branches_insert on public.branches for insert to authenticated
with check (
  public.is_admin()
  or (
    public.app_role() in ('management', 'referrer')
    and partner_id = public.app_partner()
    and not public.is_our_estate_partner(partner_id)
  )
);
