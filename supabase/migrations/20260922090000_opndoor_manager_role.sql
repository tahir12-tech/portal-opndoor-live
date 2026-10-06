-- The Opndoor management role: a non-superadmin Opndoor staff role that runs the
-- day-to-day queues (the eligibility decision, the reconciliation and direct-match
-- queues) and has superadmin-equivalent READ across the estate, but NOT the
-- sensitive writes -- partner settings, commission, creating partners, changing
-- users, the Dev Centre admin surface -- which stay superadmin-only.
--
-- WHY A NEW ROLE VALUE, not a null-partner 'management' user: the
-- users_partner_by_role CHECK forbids a management account with a null partner,
-- and every existing 'management' RLS arm is partner-scoped. A brand-new role
-- value inherits NOTHING from existing policies (they test specific role strings),
-- which is the safest possible default -- opndoor_manager can do only what this
-- migration explicitly grants.
--
-- HOW ACCESS IS GRANTED, minimising risk:
--   * READ: additive `<table>_opndoor_read` SELECT policies, so existing policies
--     are never recreated (zero risk to superadmin / partner access). Commission
--     columns (partner_rate/agent_rate) are already off the `authenticated` table
--     grant, so opndoor_manager -- an authenticated role -- cannot read them.
--   * ACTIONS: the eight decision/queue RPCs swap their sole is_admin() auth gate
--     for is_opndoor_staff(). is_opndoor_staff() ⊇ is_admin(), so this never
--     removes superadmin access; it only adds opndoor_manager.
--   * WRITES stay is_admin(): partner settings, create_partner, user role changes,
--     org edits, Dev Centre admin -- untouched, so opndoor_manager cannot reach them.
--
-- Inert until an opndoor_manager account exists: with no such user, every new arm
-- matches nobody and behaviour is unchanged for everyone.

-- 1. The role value and its null-partner rule (opndoor staff belong to no partner).
alter table public.users drop constraint users_role_check;
alter table public.users add constraint users_role_check
  check (role = any (array['superadmin','management','referrer','developer','opndoor_manager']));

alter table public.users drop constraint users_partner_by_role;
alter table public.users add constraint users_partner_by_role
  check (
    ((role in ('superadmin','opndoor_manager')) and partner_id is null)
    or ((role not in ('superadmin','opndoor_manager')) and partner_id is not null)
  );

-- 2. The predicate. Superadmin OR an Opndoor management account.
create or replace function public.is_opndoor_staff()
returns boolean language sql stable security definer set search_path to '' as $function$
  select public.is_admin()
     or coalesce((select role = 'opndoor_manager' from public.users where id = auth.uid()), false)
$function$;
revoke all on function public.is_opndoor_staff() from public, anon;
grant execute on function public.is_opndoor_staff() to authenticated;

-- 3. Superadmin-equivalent READ, added additively (existing policies untouched).
--    One SELECT policy per table that superadmin can already read; commission
--    columns remain unreadable via the column-grant, not this policy.
do $$
declare t text;
begin
  foreach t in array array[
    'agencies','agency_groups','agent_contacts','app_settings','applications','branches',
    'org_audit','partner_agency_relationships','partner_audit','partners','settings_audit',
    'tenancy_correction_tokens','user_agency_attachments','user_audit','user_scopes','users'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_opndoor_read', t);
    execute format(
      'create policy %I on public.%I for select using (public.app_role() = %L)',
      t || '_opndoor_read', t, 'opndoor_manager');
  end loop;
end $$;

-- 4. Open the decision + queue RPCs to opndoor_manager. Each had exactly one
--    is_admin() auth gate (verified); it becomes is_opndoor_staff(), which still
--    admits superadmin. Bodies are otherwise reproduced verbatim from the live
--    definitions. WRITE/settings RPCs are deliberately not here.

CREATE OR REPLACE FUNCTION public.set_application_status(p_app uuid, p_status text)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_status not in ('sent','paid','deed') then raise exception 'invalid status'; end if;
  select * into a from public.applications where id = p_app;
  if not found then raise exception 'application not found'; end if;
  -- opndoor admin only. Real Stripe/PandaDoc transitions run through service-role RPCs.
  if not public.is_opndoor_staff() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  update public.applications set
    status         = p_status,
    paid_at        = case when p_status in ('paid','deed') then coalesce(paid_at, now())      else paid_at end,
    deed_issued_at = case when p_status = 'deed'           then coalesce(deed_issued_at, now()) else deed_issued_at end,
    issue_date     = case when p_status = 'deed'           then coalesce(issue_date, now()::date) else issue_date end
  where id = p_app returning * into a;
  return a;
end $function$;

CREATE OR REPLACE FUNCTION public.decline_application(p_ref text, p_reason text DEFAULT NULL::text)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications; who text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where guarantee_ref = p_ref;
  if not found then raise exception 'application not found'; end if;
  if not public.is_opndoor_staff() then raise exception 'not permitted' using errcode = '42501'; end if;
  if a.status <> 'referencing' then
    raise exception 'Only an application awaiting a decision can be declined.' using errcode = '42501';
  end if;

  update public.applications
    set status = 'declined', decided_at = now(), decided_by_kind = 'staff',
        decline_reason = nullif(btrim(coalesce(p_reason,'')), '')
    where id = a.id returning * into a;

  who := coalesce((select full_name from public.users where id = auth.uid()), 'an administrator');
  insert into public.activity_log(application_id, kind, message, actor, visibility)
  values (a.id, 'application_declined',
    'Application declined by ' || who
      || case when a.decline_reason is not null then ' (' || a.decline_reason || ')' else '' end || '.',
    who, 'business');
  return a;
end $function$;

CREATE OR REPLACE FUNCTION public.reconciliation_queue()
 RETURNS TABLE(entity_id uuid, entity_type text, name text, parent text, created_by_name text, created_at timestamp with time zone, referral_count bigint, match_name text, match_exact boolean, folded_head_office boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with pend as (
    select a.id, 'agency'::text as etype, a.name, null::text as parent, a.created_by, a.created_at, a.partner_id
    from public.agencies a where a.review_state = 'pending_review' and a.livemode
    union all
    select b.id, 'branch'::text as etype, b.name, pa.name as parent, b.created_by, b.created_at, b.partner_id
    from public.branches b join public.agencies pa on pa.id = b.agency_id
    where b.review_state = 'pending_review' and b.livemode
      -- fold the auto head-office branch of a still-pending agency into its card
      and not (pa.review_state = 'pending_review' and lower(b.name) = lower(pa.name || ', Head office'))
  )
  select
    p.id, p.etype, p.name, p.parent,
    coalesce(u.full_name, 'A referrer') as created_by_name,
    p.created_at,
    (select count(*) from public.applications ap
       where ap.livemode
         and ((p.etype = 'agency' and ap.agency_id = p.id) or (p.etype = 'branch' and ap.branch_id = p.id))) as referral_count,
    m.name as match_name,
    coalesce(m.exact, false) as match_exact,
    (p.etype = 'agency' and exists (
       select 1 from public.branches b
       where b.agency_id = p.id and b.review_state = 'pending_review' and b.livemode
         and lower(b.name) = lower(p.name || ', Head office'))) as folded_head_office
  from pend p
  left join public.users u on u.id = p.created_by
  left join lateral (
    select c.name, (lower(c.name) = lower(p.name)) as exact
    from (
      select a.name from public.agencies a where p.etype = 'agency' and a.review_state = 'confirmed' and a.partner_id = p.partner_id and a.livemode
      union all
      select b.name from public.branches b where p.etype = 'branch' and b.review_state = 'confirmed' and b.partner_id = p.partner_id and b.livemode
    ) c
    where lower(c.name) = lower(p.name)
       or lower(c.name) like '%' || lower(p.name) || '%'
       or lower(p.name) like '%' || lower(c.name) || '%'
    order by (lower(c.name) = lower(p.name)) desc
    limit 1
  ) m on true
  where public.is_aal2() and public.is_opndoor_staff()
  order by p.created_at desc;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_org_entity(p_type text, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := auth.uid(); who text; nm text; ho_id uuid; ho_name text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if not public.is_opndoor_staff() then raise exception 'not permitted' using errcode = '42501'; end if;
  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  if p_type = 'agency' then
    update public.agencies set review_state = 'confirmed'
      where id = p_id and review_state = 'pending_review' returning name into nm;
    if nm is null then raise exception 'Entity not found or already confirmed' using errcode = '22023'; end if;
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('agency', p_id, 'confirmed', nm, who, me);
    -- Sweep the self-identifying auto-created head office branch (only that exact
    -- name, still pending); other branches keep their own review.
    update public.branches set review_state = 'confirmed'
      where agency_id = p_id and review_state = 'pending_review'
        and lower(name) = lower(nm || ', Head office')
      returning id, name into ho_id, ho_name;
    if ho_id is not null then
      insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
      values ('branch', ho_id, 'confirmed', ho_name || ' (auto-confirmed with agency)', who, me);
    end if;
    return;
  elsif p_type = 'branch' then
    update public.branches set review_state = 'confirmed'
      where id = p_id and review_state = 'pending_review' returning name into nm;
    if nm is null then raise exception 'Entity not found or already confirmed' using errcode = '22023'; end if;
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('branch', p_id, 'confirmed', nm, who, me);
    return;
  else
    raise exception 'Unknown entity type' using errcode = '22023';
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.agency_match_queue()
 RETURNS TABLE(application_id uuid, guarantee_ref text, tenant_name text, property text, typed_name text, auto_agency_id uuid, auto_agency_name text, candidates jsonb, state text, matched_by text, resolved_branch_name text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_opndoor_staff() then raise exception 'not permitted' using errcode = '42501'; end if;
  return query
    select m.application_id, a.guarantee_ref,
           btrim(coalesce(a.tenant_first_name, '') || ' ' || coalesce(a.tenant_last_name, '')),
           btrim(coalesce(a.prop_city, '') || ' ' || coalesce(a.prop_postcode, '')),
           m.typed_name, m.auto_agency_id, ag.name, m.candidates,
           m.state, m.matched_by, rb.name, m.created_at
      from public.application_agency_match m
      join public.applications a  on a.id  = m.application_id
      left join public.agencies ag on ag.id = m.auto_agency_id
      left join public.branches rb on rb.id = m.resolved_branch_id
     where m.state = 'needs_review'
        or (m.state = 'resolved' and m.matched_by = 'email'
            and m.resolved_at > now() - interval '14 days')
     order by (m.state = 'needs_review') desc, coalesce(m.resolved_at, m.created_at) desc;
end $function$;

CREATE OR REPLACE FUNCTION public.agency_branches_for_match(p_agency uuid)
 RETURNS TABLE(branch_id uuid, name text, area text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_opndoor_staff() then raise exception 'not permitted' using errcode = '42501'; end if;
  return query
    select b.id, b.name, b.area
      from public.branches b
     where b.agency_id = p_agency
       and not b.is_placeholder
       and b.livemode
     order by b.name;
end $function$;

CREATE OR REPLACE FUNCTION public.resolve_agency_match(p_application uuid, p_branch uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_before uuid; v_after uuid; me uuid; who text; v_bname text;
begin
  if not public.is_aal2()  then raise exception 'MFA required'  using errcode = '42501'; end if;
  if not public.is_opndoor_staff() then raise exception 'not permitted' using errcode = '42501'; end if;

  select name into v_bname from public.branches where id = p_branch;
  if not found then raise exception 'Branch not found' using errcode = '22023'; end if;

  select partner_id into v_before from public.applications where id = p_application;
  if not found then raise exception 'Application not found' using errcode = '22023'; end if;

  update public.applications set branch_id = p_branch where id = p_application;

  -- THE PIN. Setting a branch derives agency_id but must not move the route.
  -- Commission follows how the application arrived, never whose branch it is. If
  -- this ever fires, route attribution has regressed and we refuse the write
  -- rather than silently pay the wrong partner.
  select partner_id into v_after from public.applications where id = p_application;
  if v_after is distinct from v_before then
    raise exception 'attribution changed on branch assignment (% to %); refusing', v_before, v_after
      using errcode = '42501';
  end if;

  update public.application_agency_match
     set state = 'resolved', resolved_branch_id = p_branch,
         resolved_by = auth.uid(), resolved_at = now(), updated_at = now()
   where application_id = p_application;

  me := auth.uid();
  select full_name into who from public.users where id = me;
  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values ('branch', p_branch, 'agency_match_resolved',
          format('Set direct application %s to branch "%s"', p_application, v_bname),
          coalesce(who, 'opndoor admin'), me);
end $function$;

CREATE OR REPLACE FUNCTION public.dismiss_agency_match(p_application uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid; who text;
begin
  if not public.is_aal2()  then raise exception 'MFA required'  using errcode = '42501'; end if;
  if not public.is_opndoor_staff() then raise exception 'not permitted' using errcode = '42501'; end if;

  update public.application_agency_match
     set state = 'dismissed', resolved_by = auth.uid(), resolved_at = now(), updated_at = now()
   where application_id = p_application;
  if not found then raise exception 'No match to dismiss' using errcode = '22023'; end if;

  me := auth.uid();
  select full_name into who from public.users where id = me;
  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values ('application', p_application, 'agency_match_dismissed',
          coalesce(nullif(btrim(p_note), ''), 'Not in network; left on the direct house branch'),
          coalesce(who, 'opndoor admin'), me);
end $function$;
