-- AN AGENCY IS THE BOUNDARY. THE PARTNER IS NOT.
--
-- Every party in this system hangs off public.partners, and for a SUPPLIER that
-- is right: one supplier is one company, so `partner_id = app_partner()` is a
-- real company boundary and stays exactly as it is below.
--
-- On the AGENCY rail it is not. Every independently onboarded agency shares the
-- one house partner 'opndoor-agents' (20260904240000). On dev that partner
-- carries four unrelated, competing agencies -- Harborview, Northgate, Regent's
-- and Southbank -- and six management users between them. So on that rail
-- `partner_id = app_partner()` does not mean "my company", it means "every
-- agency Opndoor has onboarded".
--
-- THREE POLICIES ON public.applications, and they were wrong in three different
-- ways.
--
--   applications_update  no scope arm AT ALL, not even the positioned case.
--                        A Manager at Harborview could PATCH any column of any
--                        Northgate, Regent's or Southbank application straight
--                        through PostgREST: rent, tenancy_start, tenant_email,
--                        landlord_email. authenticated holds the table-level
--                        UPDATE grant, so RLS was the only thing standing here.
--
--   applications_insert  constrained only by partner_id, while agency_id and
--                        branch_id are unconstrained NOT NULL columns. A
--                        negotiator at Harborview could POST an application
--                        naming a Northgate branch, and it would land in
--                        Northgate's list, funnel, commission split and deed
--                        delivery. create_referral has guarded this since
--                        20261005200000; the raw PostgREST path beside it was
--                        left open, which is the same "a guarded RPC beside an
--                        open path is not a guard" this codebase has written
--                        down twice before.
--
--   applications_select  scoped only for a POSITIONED management user:
--                          case when app_has_scope() then ... else TRUE end
--                        so the least-configured account had the widest read.
--                        The developer arm had no scope test whatsoever.
--
-- EIGHT MORE POLICIES INHERIT THE READ. activity_log, app_notes,
-- application_documents, application_delivery_contacts,
-- application_eligibility_payments, application_provider_links,
-- application_commission_lines and tenancies all nest
-- `exists (select 1 from public.applications ...)` and restate no partner rule
-- of their own. They are deliberately NOT touched here: they inherit the fix
-- for the same reason they inherited the fault, and rewriting them into
-- definer helpers would be eight new copies of a rule that has one.
--
-- THE SHAPE OF THE FIX IS NOT NEW EITHER. 20260924120000 and 20260925130000
-- already converted agencies, branches, agent_contacts and agency_groups from
-- `partner_id = app_partner()` to app_scoped_agencies(), which resolves a
-- user's positions (branch, agency, group) AND an unpositioned negotiator's
-- home branch, and which has NO partner-wide fallback. Those four tables are
-- clean today. This applies the same helper to the three that were missed.
--
-- WHAT AN UNPOSITIONED AGENCY MANAGER SEES AFTER THIS: nothing. That is the
-- point -- it is the case that leaked -- and it costs nothing today, because
-- every management user on the house partner is positioned (checked on dev:
-- zero unpositioned). The remedy for one who is not is to give them a
-- position, which is what invite-user does. A SUPPLIER user with no position
-- still sees their whole partner, because there it is their whole company.
--
-- THIS IS THE RISKIEST MIGRATION IN THE BATCH. Get it wrong in one direction
-- and an agency sees nothing; in the other and they see each other. It wants
-- the clone rehearsal in HANDOVER section 1.3 before production, and the
-- pgTAP file beside it (an_agency_is_the_boundary.test.sql) asserts both
-- directions against real positions.

-- The one predicate, written once. An agency-rail row is bounded by the
-- AGENCY; every other rail keeps the partner, which is its company.
create or replace function public.app_may_reach_application_org(p_partner uuid, p_agency uuid, p_branch uuid)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  select case
    -- OUR ESTATE: the agency is the company. No partner-wide fallback, so an
    -- unpositioned user reaches nothing rather than reaching everything.
    when public.is_our_estate_partner(p_partner)
      then p_agency in (select public.app_scoped_agencies())
    -- A SUPPLIER with a position is narrowed to it...
    when public.app_has_scope()
      then p_branch in (select public.app_scope_branches())
    -- ...and without one sees their own company, which is the partner.
    else true
  end
$function$;

comment on function public.app_may_reach_application_org(uuid, uuid, uuid) is
  'Can the caller reach an application filed against this (partner, agency, branch)? The agency is the boundary on our own estate, where many agencies share the house partner; the partner is the boundary everywhere else, where a partner is a company. Used by the three applications policies so they cannot drift apart.';

-- ---------------------------------------------------------------------------
-- READ.
-- ---------------------------------------------------------------------------
drop policy if exists applications_select on public.applications;
create policy applications_select on public.applications
  for select
  using (
    public.is_admin()
    -- A negotiator's own referrals, unchanged and deliberately untouched: it is
    -- the one arm that never referred to the partner.
    or (public.app_role() = 'referrer' and referrer_id = auth.uid())
    or (public.app_role() = 'developer'
        and partner_id = public.app_partner()
        and public.app_may_reach_application_org(partner_id, agency_id, branch_id))
    or (public.app_role() = 'management'
        and partner_id = public.app_partner()
        and public.app_may_reach_application_org(partner_id, agency_id, branch_id))
  );

-- ---------------------------------------------------------------------------
-- WRITE. The WITH CHECK matters independently of the USING: without it a
-- manager who can see a row could still move it to another agency.
-- ---------------------------------------------------------------------------
drop policy if exists applications_update on public.applications;
create policy applications_update on public.applications
  for update
  using (
    public.is_admin()
    or (public.app_role() = 'management'
        and partner_id = public.app_partner()
        and public.app_may_reach_application_org(partner_id, agency_id, branch_id))
    or (public.app_role() = 'referrer' and referrer_id = auth.uid() and status = 'sent')
  )
  with check (
    public.is_admin()
    or (public.app_role() = 'management'
        and partner_id = public.app_partner()
        and public.app_may_reach_application_org(partner_id, agency_id, branch_id))
    or (public.app_role() = 'referrer' and referrer_id = auth.uid() and status = 'sent')
  );

-- ---------------------------------------------------------------------------
-- CREATE. partner_id alone said nothing about whose book it lands in.
-- ---------------------------------------------------------------------------
drop policy if exists applications_insert on public.applications;
create policy applications_insert on public.applications
  for insert
  with check (
    public.is_admin()
    or (public.app_role() in ('management', 'referrer')
        and referrer_id = auth.uid()
        and partner_id = public.app_partner()
        -- A negotiator holds no position, and app_scoped_agencies resolves
        -- their home branch's agency, so this admits their own office and
        -- refuses somebody else's.
        and public.app_may_reach_application_org(partner_id, agency_id, branch_id))
  );
