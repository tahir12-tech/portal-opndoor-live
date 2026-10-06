-- A SUPPLIER'S DEAL ACTUALLY PRICES THE REFERRAL.
--
-- 20261007190000 gave a supplier two deals and a guard that keeps the agents'
-- share inside the total. They were stored, resolvable and audited, and they
-- priced nothing: `resolve_rates`, which is what create_referral freezes onto
-- a new application, still read `partners.partner_rate` and
-- `partners.agent_rate` and never looked at an agreement.
--
-- Tests: supabase/tests/a_supplier_deal_prices_the_referral.test.sql
--
-- =========================================================================
-- THE FREEZE IS WHERE "NEW REFERRALS ONLY" COMES FROM
-- =========================================================================
--
-- Matt, 2026-10-01: "Changes apply to new referrals only, recorded with who
-- and when."
--
-- That is not a rule this migration enforces; it is a property of WHERE the
-- deal is read. create_referral resolves the rates once and writes them onto
-- the application, and every money surface afterwards reads the frozen
-- numbers. So consulting the agreement at that one point gives "new referrals
-- only" for nothing, and consulting it anywhere later would silently reprice
-- months that have already been invoiced.
--
-- THE FALLBACK IS THE FLAT PAIR, not nought. A supplier with no agreement is
-- every supplier on the estate today, and they are priced by
-- partners.partner_rate and partners.agent_rate exactly as they were. An
-- agreement overrides; its absence changes nothing.

drop function if exists public.resolve_rates(uuid, uuid);

create or replace function public.resolve_rates(
  p_branch uuid, p_route_partner uuid, p_tenant_count integer default 1
)
returns table (partner_rate numeric, agent_rate numeric)
language sql stable security definer set search_path to ''
as $function$
  select
    /* THE SUPPLIER'S OWN COMMISSION. The agreement first, then the estate's
       own overrides, then the partner's flat rate -- which is the order this
       function has always coalesced in, with the deal put at the front of it. */
    coalesce(
      (select r.agent_rate from public.resolve_pricing_agreement(
         p_branch, p_route_partner, p_tenant_count, 'commission') r
        where r.scope_level = 'partner'),
      a.partner_rate, g.partner_rate, p.partner_rate),
    /* AND THE AGENTS' SHARE OF IT. An agency-scope share deal is the
       per-agency override and beats the supplier's own, which is what
       resolve_pricing_agreement's ordering already does, so no scope test
       here: any share deal that resolves for this branch is the one. */
    coalesce(
      (select r.agent_rate from public.resolve_pricing_agreement(
         p_branch, p_route_partner, p_tenant_count, 'agent_share') r),
      a.agent_rate, g.agent_rate, p.agent_rate)
  from public.partners p
  left join public.branches b on b.id = p_branch
  left join public.agencies a on a.id = b.agency_id
  left join public.agency_groups g on g.id = a.group_id
  where p.id = p_route_partner
$function$;

revoke all on function public.resolve_rates(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.resolve_rates(uuid, uuid, integer) to service_role;

comment on function public.resolve_rates(uuid, uuid, integer) is
  'What to freeze onto a new application: the supplier''s own commission and the agents'' share of it. A partner-scope commission deal wins over the flat partner_rate; a share deal of any scope wins over agent_rate, so an agency-scope one is the per-agency override. No agreement means the flat pair, unchanged.';

/* WHY THE COMMISSION SIDE TESTS scope_level = 'partner' AND THE SHARE SIDE
   DOES NOT, which looks inconsistent and is not.

   On the AGENCY rail a commission agreement at agency or group scope is what
   that agency is paid, and `commission_total` already resolves it -- putting
   it in this column too would make the agency's own rate the supplier's
   margin and double-count it on every statement. So the first column takes a
   deal only when the deal is the SUPPLIER'S.

   A share deal has no such clash: it exists only under a supplier, and an
   agency-scope one is by definition that agency's override of it. */
