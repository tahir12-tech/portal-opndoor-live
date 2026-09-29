-- OUR MARGIN IS NOT THEIRS, IN SQL THIS TIME.
--
-- Round 7, E. Round 6 found an agency Director's Reporting page stating
-- Opndoor's own 25% house cut on their own book and adding it to what they
-- were owed, and fixed it in liveAnalytics.ts. This is the same disclosure
-- through a door that fix did not cover: two SECURITY DEFINER functions the
-- client calls on every login.
--
-- Measured on dev, rolled back, as Regent's Director:
--   my_partner_rates()                  ->  partner_rate 0.2500
--   application_commission_rates(null)  ->  partner_rate 0.2500, all 7 rows
--
-- 0.2500 is opndoor-agents' partner_rate: on the AGENCY rail the house
-- partner's "partner rate" is Opndoor's share of the guarantee fee, which is
-- a term of OUR business and not of theirs. Rule 3 makes commercial terms
-- Director-level; it does not make our terms theirs. Exposure is exactly
-- Director-level -- a Manager gets no rows from either -- and there is no
-- cross-agency leak, which is why this is a high and not a critical.
--
-- Zeroed rather than dropped, so the shape every caller reads is unchanged
-- and an agency's own agent_rate beside it is still theirs. An admin still
-- gets the real number.

-- The predicate both functions need: is this partner one of ours? The client
-- has isHousePartner over slugs; SQL had no equivalent over ids.
create or replace function public.is_house_partner_id(p_partner uuid)
returns boolean
language sql stable security definer set search_path to '' as $$
  select coalesce((select p.is_house_route from public.partners p where p.id = p_partner), false)
$$;

revoke all on function public.is_house_partner_id(uuid) from public, anon;
grant execute on function public.is_house_partner_id(uuid) to authenticated, service_role;

-- application_commission_rates(uuid)
CREATE OR REPLACE FUNCTION public.application_commission_rates(p_partner uuid DEFAULT NULL::uuid)
 RETURNS TABLE(application_id uuid, partner_rate numeric, agent_rate numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  /* OUR MARGIN IS NOT THEIRS. Round 7, E. On a HOUSE partner `partner_rate`
     is Opndoor's own cut of the fee, not a rate the reader is party to, and
     this handed 0.2500 to every agency Director on every application they
     could see. Round 6 closed the same disclosure on the Reporting screen
     (liveAnalytics.ts) and this door was not covered by that fix.

     Zeroed rather than dropped: the column is part of the shape every caller
     already reads, and an agency's own agent_rate beside it is theirs to see.
     An admin still gets the real number. */
  select a.id,
         case when public.is_admin() then a.partner_rate
              when public.is_house_partner_id(a.partner_id) then 0::numeric
              else a.partner_rate end,
         a.agent_rate
  from public.applications a
  where public.is_aal2()
    and public.may_see_commission()
    and (p_partner is null or a.partner_id = p_partner)
    and (
      public.is_admin()
      or (public.app_role() = 'management' and a.partner_id = public.app_partner()
          and public.app_may_reach_application_org(a.partner_id, a.agency_id, a.branch_id))
    )
$function$;

-- my_partner_rates()
CREATE OR REPLACE FUNCTION public.my_partner_rates()
 RETURNS TABLE(partner_id uuid, partner_rate numeric, agent_rate numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not public.may_see_commission() then return; end if;
  if public.is_admin() then
    return query select p.id, p.partner_rate, p.agent_rate from public.partners p;
  elsif public.app_role() = 'management' then
    -- Same rule as application_commission_rates: on a house partner the
    -- partner rate is OURS. An agency Director reads their own agent_rate and
    -- a zero beside it, rather than Opndoor's margin on their own book.
    return query select p.id,
                        case when public.is_house_partner_id(p.id) then 0::numeric
                             else p.partner_rate end,
                        p.agent_rate
                 from public.partners p where p.id = public.app_partner();
  end if;
end $function$;

