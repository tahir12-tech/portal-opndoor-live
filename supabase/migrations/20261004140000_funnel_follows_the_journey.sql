-- THE FUNNEL FOLLOWS THE JOURNEY, NOT THE ESTATE.
--
-- The dashboard decided between the nine-stage funnel and the three-stage one
-- from the PARTNER's referencing_mode. That was the same answer for as long as
-- every agency of ours had its tenants checked by us.
--
-- Regent are one of ours — so their partner is opndoor-agents, and the partner
-- says opndoor_referenced — but they reference their own tenants, so their
-- applicants never enter Invited, Registered, Details, Fee, Documents,
-- Submitted or Approved. Their manager would have opened the dashboard to nine
-- stages, seven of them permanently zero, and no way to tell whether that meant
-- "not yet" or "never".
--
-- This is the OPPOSITE direction from the channel fix in 20261004110000, and
-- deliberately so. How a referral ARRIVED is a fact about the relationship (the
-- estate). What HAPPENS TO THE TENANT next is a fact about who checks them (the
-- journey). The dashboard funnel is the second question.
--
-- Scoped like everything else: a manager sees their own agencies, an admin sees
-- the partner they are looking at. A partner that runs BOTH journeys — as
-- opndoor-agents now does, with Northgate on eligibility and Regent
-- pre-referenced — answers true for an admin viewing the whole partner, because
-- the nine stages are real for part of what they are looking at, and false for a
-- manager scoped to Regent alone.
create or replace function public.viewer_runs_eligibility_journey(p_partner_slug text default null)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  with reachable as (
    select a.id, a.referencing_mode, p.referencing_mode as partner_mode
    from public.agencies a
    join public.partners p on p.id = a.partner_id
    where
      -- A scoped user: only the agencies their positions actually reach.
      case
        when public.app_has_scope()
          then a.id in (select b.agency_id from public.branches b
                         where b.id in (select public.app_scope_branches()))
        when public.is_admin()
          then p_partner_slug is null or p.slug = p_partner_slug
        else a.partner_id = public.app_partner()
      end
  )
  -- The agency's own choice wins over its partner's, exactly as
  -- resolve_referencing_mode does for a referral.
  select coalesce(
    (select bool_or(coalesce(r.referencing_mode, r.partner_mode) = 'opndoor_referenced')
       from reachable r),
    false)
$function$;

comment on function public.viewer_runs_eligibility_journey(text) is
  'Does anything this viewer can see run the nine-stage eligibility journey? Decides between the nine-stage dashboard funnel and the three-stage one. Keyed on the JOURNEY (the agency''s own referencing route, falling back to its partner''s), not on the estate: an agency of ours that checks its own tenants has three stages, not nine.';

revoke all on function public.viewer_runs_eligibility_journey(text) from public, anon;
grant execute on function public.viewer_runs_eligibility_journey(text) to authenticated;
