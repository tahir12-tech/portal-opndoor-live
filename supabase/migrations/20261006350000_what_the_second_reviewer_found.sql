-- WHAT THE SECOND REVIEWER FOUND.
--
-- A fresh agent, given only the five isolation rules and the code, with no
-- sight of the first review or of any of the work above. It confirmed the
-- sweep had landed -- zero surviving `not app_has_scope() or` and zero bare
-- `else true` outside comments, every reach predicate resolving to
-- app_scoped_agencies with no partner-wide arm -- and then found four things
-- that were still open. Three are below; the fourth is an HTML-escaping
-- defect in the email layout and is fixed in _shared/emailLayout.ts.
--
-- The lesson in two of them is the same and worth writing down: a migration
-- that NAMES the sites it is fixing is not the same as a migration that fixes
-- them. 20261006340000's own heading listed all four contact RPCs and the
-- consequence ("setting another agency's primary contact redirects their
-- deeds"), and then rewrote two. The reviewer found the other two in the
-- half-hour after they were quietly fixed. The tests are what closed that
-- gap, not the prose.

-- ===========================================================================
-- H2. A NAME-TO-UUID ORACLE FOR EVERY AGENCY ON THE ROUTE
-- ===========================================================================
-- create_referral_target turns an agency name and an office name into a
-- branch uuid. 20261005200000 added two guards to it, and both refuse
-- CREATION: "a new agency is set up by opndoor". The LOOKUP that runs first
-- was left as `where partner_id = app_partner() and lower(name) = ...`, which
-- on the house route is every agency we carry -- read by a definer function,
-- so straight past agencies_select.
--
-- Reachable by a NEGOTIATOR: the only tests above the lookup are is_aal2()
-- and a non-null partner. Three distinguishable answers made it a clean
-- oracle -- unknown agency, known agency with an unknown office, and a uuid.
--
-- And the uuid is the input the contact RPCs needed. Two findings that are
-- each survivable alone chain into one path, which is the argument for
-- fixing both ends rather than the more severe one.
--
-- Narrowing the LOOKUP rather than adding a third refusal message is what
-- collapses the oracle: an agency you do not hold now behaves exactly like an
-- agency that does not exist.
-- create_referral_target(text,text,text,text,text,text,text,text,text)
CREATE OR REPLACE FUNCTION public.create_referral_target(p_agency text, p_branch text, p_agency_email text DEFAULT NULL::text, p_agency_contact_name text DEFAULT NULL::text, p_agency_phone text DEFAULT NULL::text, p_branch_email text DEFAULT NULL::text, p_branch_contact_name text DEFAULT NULL::text, p_branch_phone text DEFAULT NULL::text, p_partner_slug text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  pid uuid; me uuid := auth.uid(); who text;
  ag_id uuid; br_id uuid; ag_new boolean := false; br_new boolean := false;
  v_admin boolean := public.is_admin();
  v_state text;
  v_slug text := nullif(btrim(coalesce(p_partner_slug,'')), '');
  v_slug_id uuid;
  v_branch text := coalesce(nullif(btrim(coalesce(p_branch,'')), ''), 'Head office');
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if btrim(coalesce(p_agency,'')) = '' then raise exception 'Agency is required' using errcode = '22023'; end if;
  who := coalesce((select full_name from public.users where id = me), 'a referrer');
  pid := public.app_partner();
  if pid is not null then
    v_state := 'pending_review';
    -- NARROWED TO WHAT THE CALLER HOLDS. This resolved any agency NAME on the
    -- partner to its uuid, and on the house route that is every agency we
    -- carry -- reachable by a Negotiator, because the only tests above are
    -- is_aal2() and a non-null partner. Being definer, it read straight past
    -- agencies_select. It was also a three-way oracle: unknown agency, known
    -- agency with an unknown office, and a uuid. Narrowing the LOOKUP (rather
    -- than adding a fourth message) collapses the first two into one answer.
    select a.id into ag_id from public.agencies a
     where a.partner_id = pid and lower(a.name) = lower(btrim(p_agency))
       and (not public.is_our_estate_partner(pid) or a.id in (select public.app_scoped_agencies()))
     limit 1;
  else
    if not v_admin then raise exception 'Not permitted.' using errcode = '42501'; end if;
    v_state := 'confirmed';
    if v_slug is not null then select id into v_slug_id from public.partners where slug = v_slug; end if;
    select a.id, a.partner_id into ag_id, pid
      from public.agencies a
      where lower(a.name) = lower(btrim(p_agency)) and (v_slug_id is null or a.partner_id = v_slug_id)
      order by (a.review_state = 'confirmed') desc, a.created_at asc limit 1;
    if ag_id is null then
      if v_slug is null then raise exception 'Select a specific partner before creating a new agency on the fly.' using errcode = '22023'; end if;
      if v_slug_id is null then raise exception 'Unknown partner.' using errcode = '22023'; end if;
      pid := v_slug_id;
    end if;
  end if;
  if ag_id is null then
    -- THE GUARD, on the path the referral form submits through. v_admin, not
    -- is_admin() inline, because this function already asked and the answer is
    -- the same one the admin arm above was decided on.
    if not v_admin and public.is_our_estate_partner(pid) then
      raise exception 'A new agency is set up by opndoor, not on a referral. Choose one of your own agencies.'
        using errcode = '42501';
    end if;
    insert into public.agencies(name, partner_id, review_state, created_by)
    values (btrim(p_agency), pid, v_state, me) returning id into ag_id;
    ag_new := true;
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('agency', ag_id, 'created', btrim(p_agency), who, me);
  end if;
  select id into br_id from public.branches where agency_id = ag_id and lower(name) = lower(v_branch) limit 1;
  if br_id is null then
    -- THE SECOND GUARD. Reached when the agency is one of ours and the office is
    -- not, which is the likelier of the two in practice: a real agency, a
    -- mistyped or genuinely new office.
    if not v_admin and public.is_our_estate_partner(pid) then
      raise exception 'A new office is set up by opndoor, not on a referral. Choose one of your own offices.'
        using errcode = '42501';
    end if;
    insert into public.branches(name, agency_id, partner_id, review_state, created_by)
    values (v_branch, ag_id, pid, v_state, me) returning id into br_id;
    br_new := true;
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('branch', br_id, 'created', v_branch, who, me);
  end if;
  if ag_new and coalesce(btrim(p_agency_email),'') <> '' then
    insert into public.agent_contacts(agency_id, partner_id, name, email, phone, is_primary, created_by)
    values (ag_id, pid, btrim(coalesce(p_agency_contact_name,'')), btrim(p_agency_email), nullif(btrim(p_agency_phone),''), true, me);
  end if;
  if br_new and coalesce(btrim(p_branch_email),'') <> '' then
    insert into public.agent_contacts(branch_id, partner_id, name, email, phone, is_primary, created_by)
    values (br_id, pid, btrim(coalesce(p_branch_contact_name,'')), btrim(p_branch_email), nullif(btrim(p_branch_phone),''), true, me);
  end if;
  return br_id;
end $function$;

-- create_referral_target(text,text,text,text,text,text,text,text)
CREATE OR REPLACE FUNCTION public.create_referral_target(p_agency text, p_branch text, p_agency_email text DEFAULT NULL::text, p_agency_contact_name text DEFAULT NULL::text, p_agency_phone text DEFAULT NULL::text, p_branch_email text DEFAULT NULL::text, p_branch_contact_name text DEFAULT NULL::text, p_branch_phone text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pid uuid; me uuid := auth.uid(); who text; ag_id uuid; br_id uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  pid := public.app_partner();
  if pid is null then
    raise exception 'Creating an agency or branch on the fly is only available to partner users; opndoor admins should pick an existing branch.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_agency,'')) = '' or btrim(coalesce(p_branch,'')) = '' then
    raise exception 'Agency and branch are required' using errcode = '22023';
  end if;

  who := coalesce((select full_name from public.users where id = me), 'a referrer');

  -- NARROWED TO WHAT THE CALLER HOLDS. This resolved any agency NAME on the
  -- partner to its uuid, and on the house route that is every agency we
  -- carry -- reachable by a Negotiator, because the only tests above are
  -- is_aal2() and a non-null partner. Being definer, it read straight past
  -- agencies_select. It was also a three-way oracle: unknown agency, known
  -- agency with an unknown office, and a uuid. Narrowing the LOOKUP (rather
  -- than adding a fourth message) collapses the first two into one answer.
  select a.id into ag_id from public.agencies a
   where a.partner_id = pid and lower(a.name) = lower(btrim(p_agency))
     and (not public.is_our_estate_partner(pid) or a.id in (select public.app_scoped_agencies()))
   limit 1;
  if ag_id is null then
    -- THE GUARD. Mirrors agencies_insert, which this function's DEFINER rights
    -- would otherwise walk straight past, including its is_admin() arm.
    if not public.is_admin() and public.is_our_estate_partner(pid) then
      raise exception 'A new agency is set up by opndoor, not on a referral. Choose one of your own agencies.'
        using errcode = '42501';
    end if;
    insert into public.agencies(name, partner_id, review_state, created_by)
    values (btrim(p_agency), pid, 'pending_review', me) returning id into ag_id;
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('agency', ag_id, 'created', btrim(p_agency), who, me);
  end if;

  select id into br_id from public.branches where agency_id = ag_id and lower(name) = lower(btrim(p_branch)) limit 1;
  if br_id is null then
    -- Mirrors branches_insert, for the same reason.
    if not public.is_admin() and public.is_our_estate_partner(pid) then
      raise exception 'A new office is set up by opndoor, not on a referral. Choose one of your own offices.'
        using errcode = '42501';
    end if;
    insert into public.branches(name, agency_id, partner_id, review_state, created_by)
    values (btrim(p_branch), ag_id, pid, 'pending_review', me) returning id into br_id;
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('branch', br_id, 'created', btrim(p_branch), who, me);
  end if;

  -- Agency-default contact: only when an email was given and the agency has none yet.
  if coalesce(btrim(p_agency_email),'') <> '' and not exists (select 1 from public.agent_contacts where agency_id = ag_id) then
    insert into public.agent_contacts(agency_id, partner_id, name, email, phone, is_primary, created_by)
    values (ag_id, pid, coalesce(nullif(btrim(p_agency_contact_name),''), btrim(p_agency_email)), btrim(p_agency_email), nullif(btrim(p_agency_phone),''), true, me);
  end if;

  -- Optional branch contact.
  if coalesce(btrim(p_branch_email),'') <> '' then
    insert into public.agent_contacts(branch_id, partner_id, name, email, phone, is_primary, created_by)
    values (br_id, pid, coalesce(nullif(btrim(p_branch_contact_name),''), btrim(p_branch_email)), btrim(p_branch_email), nullif(btrim(p_branch_phone),''), true, me);
  end if;

  return br_id;
end $function$;


-- ===========================================================================
-- H3. THE RENEWAL NOTICE IGNORED THE RAIL, THE LADDER AND LIVEMODE
-- ===========================================================================
-- fire_renewal_notices is the one scheduled email 20261006160000 did not
-- revisit, and it has the exact fault that migration was written to fix,
-- twelve months later in the lifecycle:
--
--   THE DIRECT RAIL. Its contact is
--     coalesce(a.landlord_email, effective_primary_contact(a.branch_id).email)
--   with no channel test. landlord_email is only ever written by the
--   agency-staff send_deed_to_landlord path, which a direct application can
--   never reach, so the fallback ALWAYS fires -- and a direct application's
--   branch_id points at a real agency branch chosen by the auto-matcher
--   (20260904130000). So the tenant's name, property and guarantee end date
--   went to an agency person picked by automatic matching. That is rule 2,
--   word for word.
--
--   THE AGENCY RAIL. It emails the branch's agent_contacts mailbox plus the
--   referrer, not agency_notification_recipients, so ticked users in scope
--   get nothing and a shared mailbox gets a copy.
--
--   LIVEMODE. No a.livemode. Every sibling cron has one. A sandbox
--   application that reaches status='deed' would send real branded email to
--   whatever addresses were in the sandbox payload, a year later.
--
-- The function now says WHICH RAIL each row is on and resolves the contact
-- accordingly; the edge function asks the ladder for the agency ones, the way
-- expiry-reminders does, and parks with an alert rather than widening.
-- Dropped and recreated rather than replaced: the OUT row type gains a
-- `channel` column, which create-or-replace cannot do.
drop function if exists public.fire_renewal_notices(date);
create or replace function public.fire_renewal_notices(p_today date)
returns table(application_id uuid, guarantee_ref text, tenant_name text, property_addr text,
              end_date date, tenant_email text, contact_name text, contact_email text,
              referrer_name text, referrer_email text, channel text)
language plpgsql security definer set search_path to ''
as $function$
#variable_conflict use_column
begin
  return query
  with due as (
    select a.id
    from public.applications a
    where a.status = 'deed'
      -- ADDED. A sandbox guarantee must never send real email.
      and a.livemode
      and coalesce(a.payment_state, '') <> 'refunded'
      and a.tenancy_start is not null
      and (a.tenancy_start + interval '12 months' - interval '1 day')::date between p_today and (p_today + 30)
      and not exists (select 1 from public.guarantee_renewal_notices g where g.application_id = a.id)
  ),
  ins as (
    insert into public.guarantee_renewal_notices (application_id)
    select id from due
    on conflict (application_id) do nothing
    returning application_id
  )
  select
    a.id,
    a.guarantee_ref,
    btrim(concat_ws(' ', nullif(btrim(coalesce(a.tenant_title, '')), ''), a.tenant_first_name, a.tenant_last_name)),
    btrim(a.prop_addr1 || case when coalesce(a.prop_postcode, '') <> '' then ', ' || a.prop_postcode else '' end),
    (a.tenancy_start + interval '12 months' - interval '1 day')::date,
    a.tenant_email,
    -- THE CONTACT, BY RAIL.
    case public.application_channel(a.id)
      -- Agent referral: nobody here. The caller asks the ladder, because the
      -- answer is a list and it is per-position.
      when 'Agent referral' then null
      -- Direct: the tenant's OWN nominated contact, and if they have none
      -- then nobody. Never the branch the matcher happened to point at.
      when 'Direct' then nullif(btrim(coalesce(d.agency_name, '')), '')
      -- Supplier and provider hand-over: the branch mailbox, as before.
      else epc.name
    end,
    case public.application_channel(a.id)
      when 'Agent referral' then null
      when 'Direct' then d.email
      else coalesce(nullif(btrim(coalesce(a.landlord_email, '')), ''), epc.email)
    end,
    ru.full_name,
    ru.email,
    public.application_channel(a.id)
  from ins
  join public.applications a on a.id = ins.application_id
  left join public.application_delivery_contacts d on d.application_id = a.id
  left join lateral public.effective_primary_contact(a.branch_id) epc on true
  left join public.users ru on ru.id = a.referrer_id;
end $function$;

-- The drop took its grants with it. Cron-only, as before.
revoke all on function public.fire_renewal_notices(date) from public, anon, authenticated;
grant execute on function public.fire_renewal_notices(date) to service_role;

-- ===========================================================================
-- M1. THE ORG TREE'S COMMISSION RATES WERE HYDRATED INTO EVERY BROWSER
-- ===========================================================================
-- applications.partner_rate/agent_rate came off the authenticated grant in
-- 20260811180000 and partners.* in 20260815030000, each replaced by a definer
-- RPC gated on may_see_commission(). The three ORG tables never got the same
-- treatment: 20261005220000 wrote it down under "STILL OPEN, DELIBERATELY"
-- and nothing closed it. hydrate.ts selects agencies.partner_rate,
-- agency_groups.partner_rate and branches.agent_rate for every signed-in
-- user, so a Negotiator reads their agency's commission rate -- the one
-- number may_see_commission() withholds everywhere else.
--
-- Same shape as the two that were already fixed: revoke the columns, serve
-- them through a function that asks.
create or replace function public.org_rate_tiers()
returns table(level text, org_id uuid, partner_rate numeric, agent_rate numeric)
language sql stable security definer set search_path to ''
as $function$
  select 'group', g.id, g.partner_rate, g.agent_rate
    from public.agency_groups g
   where public.may_see_commission() and public.app_reachable_group(g.id, g.partner_id)
  union all
  select 'agency', a.id, a.partner_rate, a.agent_rate
    from public.agencies a
   where public.may_see_commission() and public.app_reachable_agency(a.id)
  union all
  select 'branch', b.id, null::numeric, b.agent_rate
    from public.branches b
   where public.may_see_commission() and public.app_may_reach_branch(b.id)
$function$;

comment on function public.org_rate_tiers() is
  'The group/agency/branch commission tiers, for a reader entitled to see commission and only for the orgs they reach. Replaces three table-level column grants that hydrate read for every role.';

revoke all on function public.org_rate_tiers() from public, anon;
grant execute on function public.org_rate_tiers() to authenticated, service_role;

revoke select (partner_rate, agent_rate) on public.agencies from anon, authenticated;
revoke select (partner_rate, agent_rate) on public.agency_groups from anon, authenticated;
revoke select (agent_rate) on public.branches from anon, authenticated;
-- The WRITE path is set_agency_rates / set_group_rates / set_node_rate, all of
-- which are definer and ask may_see_commission. Nothing writes these columns
-- through PostgREST, so the update grant goes too rather than being left as a
-- column somebody may write but not read.
revoke insert (partner_rate, agent_rate), update (partner_rate, agent_rate) on public.agencies from anon, authenticated;
revoke insert (partner_rate, agent_rate), update (partner_rate, agent_rate) on public.agency_groups from anon, authenticated;
revoke insert (agent_rate), update (agent_rate) on public.branches from anon, authenticated;

-- ===========================================================================
-- M2. REMOVE POSITION CHECKED CONTAINMENT BUT NOT SENIORITY
-- ===========================================================================
-- My own policy from 20261006340000, and the reviewer was right about it.
-- user_within_caller_scope is SYMMETRIC between two people who hold the same
-- agency position -- 20261006150000 says so in as many words -- so an
-- agency-scoped Manager satisfied it against the Director sitting beside
-- them, and positionsService.ts:349 deletes the row by plain PostgREST call
-- with the id already in the browser. Every other person-control calls
-- assert_may_act_on_user, which is strictly-below. This one now does too,
-- through may_act_on_user because a policy cannot raise.
drop policy if exists user_scopes_delete on public.user_scopes;
create policy user_scopes_delete on public.user_scopes
  for delete
  using (
    public.is_admin()
    or (public.app_role() = 'management'
        and public.app_may_reach_user(user_id)
        and public.user_within_caller_scope(user_id)
        and public.may_act_on_user(user_id)
        and exists (select 1 from public.user_scopes s
                     where s.user_id = auth.uid() and s.kind in ('group','agency')))
  );

-- ===========================================================================
-- LOW. The rest, each a line
-- ===========================================================================
-- count_pending_tenancy_corrections was the last definer function gated on
-- the partner with no reach predicate: a scalar count of pending corrections
-- across every agency on the house route. An activity oracle rather than a
-- data leak, but it is the same expression this whole batch is about.
create or replace function public.count_pending_tenancy_corrections()
returns integer
language sql stable security definer set search_path to ''
as $function$
  select count(*)::int
  from public.tenancy_correction_tokens t
  join public.applications a on a.id = t.application_id
  where a.livemode
    and t.submitted_at is not null and t.resolved_at is null
    and public.is_aal2()
    and (public.is_admin()
         or (public.app_role() = 'management'
             and a.partner_id = public.app_partner()
             and public.app_may_reach_application_org(a.partner_id, a.agency_id, a.branch_id)));
$function$;

-- deed_delivery_target's DIRECT arm falls through the tenant's own contact to
-- the route contact and then the branch mailbox. Unreachable today, because
-- application_delivery_contacts.email is NOT NULL and the matcher never sets
-- branch_id without one -- so rule 2 holds by a property of the matcher
-- rather than by a test in the resolver. Stated as a test.
create or replace function public.deed_delivery_target(p_application uuid)
returns table(email text, display_name text, source text, verified boolean, auto_send boolean)
language sql stable security definer set search_path to ''
as $function$
  select
    case when public.application_channel(a.id) = 'Direct'
         then coalesce(nr.email, d.email)
         else coalesce(nr.email, d.email, rc.email, c.email) end,
    coalesce(
      nr.display_name,
      nullif(btrim(coalesce(d.agency_name, '')), ''),
      nullif(btrim(coalesce(d.first_name, '') || ' ' || coalesce(d.last_name, '')), ''),
      case when public.application_channel(a.id) = 'Direct' then null else coalesce(rc.name, c.name) end
    ),
    case
      when nr.email is not null         then nr.rung
      when d.application_id is not null then 'delivery_contact'
      when public.application_channel(a.id) = 'Direct' then 'delivery_contact'
      when rc.id is not null            then 'route_contact'
      else 'branch_contact'
    end,
    case
      when nr.email is not null         then true
      when d.application_id is not null then d.verified_at is not null
      else true
    end,
    case
      when public.application_channel(a.id) <> 'Agent referral' then true
      else nr.email is not null
    end
  from public.applications a
  left join lateral (
    select r.email, r.display_name, r.rung
      from public.agency_notification_recipients(a.id) r
     order by case r.rung when 'referrer' then 1 when 'copy' then 2 else 3 end, r.email
     limit 1
  ) nr on true
  left join public.application_delivery_contacts d on d.application_id = a.id
  left join lateral (
    select * from public.effective_primary_contact_route(a.branch_id, a.partner_id)
  ) rc on true
  left join lateral (
    select * from public.effective_primary_contact(a.branch_id)
  ) c on true
  where a.id = p_application
$function$;

-- The AAL2 gate covers 16 tables and not these two, so a password-only
-- session read colleagues' positions and attachments before MFA step-up. No
-- cross-scope gain, and both are already agency-bounded; it is the step-up
-- rule being uneven that is the defect.
drop policy if exists require_aal2 on public.user_scopes;
create policy require_aal2 on public.user_scopes as restrictive for all to authenticated
  using (public.is_aal2()) with check (public.is_aal2());
drop policy if exists require_aal2 on public.user_agency_attachments;
create policy require_aal2 on public.user_agency_attachments as restrictive for all to authenticated
  using (public.is_aal2()) with check (public.is_aal2());
