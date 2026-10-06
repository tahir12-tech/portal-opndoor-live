-- THIRTEEN DEFINER FUNCTIONS THAT LET ONE AGENCY REACH ANOTHER.
--
-- Found by MEASUREMENT, not by reading. The sweep flagged 52 definer functions
-- as bounding data by partner; calling each of them on dev as Rosa Vance -- a
-- Manager positioned at Regent's Lettings -- against a Northgate object showed
-- most already refuse. These thirteen did not.
--
-- These are worse than the RLS leaks fixed in 20261006170000, and in a
-- different way. A definer function has no read policy in front of it, so
-- there is no "unpositioned" precondition: Rosa is positioned, correctly
-- scoped everywhere else, and could still do all of this.
--
--   admin_add_branch                add a branch to another agency
--   set_agency_group                move another agency under a group
--   attach_user_to_agency           attach somebody to another agency
--   detach_user_from_agency         detach them from it
--   agreement_for_agency            read another agency's commercial agreement
--   deed_target                     read another agency's tenant names and shares
--   tenancy_tenant_names            the same names, one level down
--   application_commission_rates    every agency's per-application rates (24 rows on dev)
--   commission_preview              model a rate change on another agency
--   referrer_league                 rank another agency's negotiators, by name
--   admin_add_agency                create an agency on the shared house partner
--   create_agency_group             create a group on it
--   set_referrer_leaderboard_mode   set how every agency's leaderboard behaves
--
-- THREE OF THEM ARE NOT ABOUT REACH BUT ABOUT OWNERSHIP. Creating an agency,
-- creating a group and setting the leaderboard mode are acts on the PARTNER.
-- On the supplier rail the partner is the caller's own company and those are
-- theirs to perform. On the house route the partner is Opndoor's, shared by
-- every agency, so the management arm is withdrawn there and left intact
-- everywhere else.
--
-- The rest gain a call to one of the four reach predicates from
-- 20261006220000. Each body below is otherwise byte-for-byte what
-- pg_get_functiondef returned, so the diff is the guard and nothing else.

CREATE OR REPLACE FUNCTION public.admin_add_agency(p_name text, p_group text DEFAULT NULL::text, p_partner_slug text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text, p_contact_name text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid(); who text; pid uuid; ag_id uuid;
  v_admin boolean := public.is_admin();
  v_slug text := nullif(btrim(coalesce(p_partner_slug,'')),''); v_email text := btrim(coalesce(p_contact_email,''));
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  /* ON OUR OWN ESTATE, CREATING AN AGENCY IS OPNDOOR'S ACT. The house partner
     is shared, so a Manager creating an agency on it is creating a sibling
     beside their own, not adding to their own book. A SUPPLIER's manager
     still creates agencies under their own partner, which is their book. */
  if not (v_admin or (public.app_role() = 'management'
                      and not public.is_our_estate_partner(public.app_partner()))) then raise exception 'Not permitted.' using errcode = '42501'; end if;
  if btrim(coalesce(p_name,'')) = '' then raise exception 'Agency name is required' using errcode = '22023'; end if;
  if v_email = '' then raise exception 'An agency contact email is required.' using errcode = '22023'; end if;
  if v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then raise exception 'Enter a valid agency contact email.' using errcode = '22023'; end if;
  pid := public.app_partner();
  if pid is null then
    if v_slug is null then raise exception 'Select a specific partner before adding an agency.' using errcode = '22023'; end if;
    select id into pid from public.partners where slug = v_slug;
    if pid is null then raise exception 'Unknown partner.' using errcode = '22023'; end if;
  end if;
  -- A deliberate org-tool add by admin OR management lands confirmed (instant).
  if exists (select 1 from public.agencies where partner_id = pid and lower(name) = lower(btrim(p_name))) then
    raise exception 'An agency with that name already exists for this partner.' using errcode = '23505';
  end if;
  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  insert into public.agencies(name, group_name, partner_id, review_state, created_by)
  values (btrim(p_name), nullif(btrim(coalesce(p_group,'')),''), pid, 'confirmed', me) returning id into ag_id;
  insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
  values ('agency', ag_id, 'created', btrim(p_name), who, me);
  insert into public.agent_contacts(agency_id, partner_id, name, email, phone, is_primary, created_by)
  values (ag_id, pid, btrim(coalesce(p_contact_name,'')), v_email, nullif(btrim(p_contact_phone),''), true, me);
  return ag_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.admin_add_branch(p_agency_id uuid, p_name text, p_area text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text, p_contact_name text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid(); who text; pid uuid; br_id uuid; v_admin boolean := public.is_admin(); v_email text := btrim(coalesce(p_contact_email,''));
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if btrim(coalesce(p_name,'')) = '' then raise exception 'Branch name is required' using errcode = '22023'; end if;
  select partner_id into pid from public.agencies where id = p_agency_id;
  if pid is null then raise exception 'Agency not found.' using errcode = '22023'; end if;
  if not (v_admin or (public.app_role() = 'management' and pid = public.app_partner()
                      and public.app_may_reach_agency(p_agency_id))) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  if v_email <> '' and v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Enter a valid branch contact email, or leave it blank.' using errcode = '22023';
  end if;
  -- A deliberate org-tool add by admin OR management lands confirmed (instant).
  if exists (select 1 from public.branches where agency_id = p_agency_id and lower(name) = lower(btrim(p_name))) then
    raise exception 'A branch with that name already exists for this agency.' using errcode = '23505';
  end if;
  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  insert into public.branches(name, agency_id, partner_id, area, review_state, created_by)
  values (btrim(p_name), p_agency_id, pid, nullif(btrim(coalesce(p_area,'')),''), 'confirmed', me) returning id into br_id;
  insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
  values ('branch', br_id, 'created', btrim(p_name), who, me);
  if v_email <> '' then
    insert into public.agent_contacts(branch_id, partner_id, name, email, phone, is_primary, created_by)
    values (br_id, pid, btrim(coalesce(p_contact_name,'')), v_email, nullif(btrim(p_contact_phone),''), true, me);
  end if;
  return br_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.agreement_for_agency(p_agency uuid)
 RETURNS TABLE(agreement_id uuid, scope_level text, coverage text, period text, counting_scope text, is_standard boolean, note text, effective_from date, period_start date, volume integer, bands jsonb, tiers jsonb, next_rate numeric, next_basis numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with b1 as (
    select b.id as branch_id, b.partner_id from public.branches b
    -- AN AGREEMENT IS COMMERCIALLY SENSITIVE and this had no org test at all:
    -- any manager on the house partner could read any other agency's deal.
    where b.agency_id = p_agency and public.app_may_reach_agency(p_agency)
    order by b.created_at limit 1
  ),
  r as (
    select * from public.resolve_pricing_agreement(
      (select branch_id from b1), (select partner_id from b1), 1)
  )
  select pa.id, pa.scope_level, pa.coverage, pa.period, pa.counting_scope, pa.is_standard, pa.note, pa.effective_from,
         public.agreement_period_start(pa.id),
         public.agreement_volume(pa.id, (select branch_id from b1)),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'min', bd.min_tenants, 'max', bd.max_tenants,
             'weeks', bd.fee_basis_weeks, 'unit', bd.fee_basis_unit, 'rate', bd.agent_rate) order by bd.min_tenants), '[]'::jsonb)
            from public.pricing_agreement_bands bd where bd.agreement_id = pa.id),
         (select coalesce(jsonb_agg(jsonb_build_object(
             'from', t.from_count, 'to', t.to_count, 'rate', t.agent_rate) order by t.from_count), '[]'::jsonb)
            from public.commission_tiers t where t.agreement_id = pa.id),
         (select agent_rate from r), (select fee_basis_weeks from r)
  from public.pricing_agreements pa
  where pa.id = (select id from r)
$function$
;

CREATE OR REPLACE FUNCTION public.application_commission_rates(p_partner uuid DEFAULT NULL::uuid)
 RETURNS TABLE(application_id uuid, partner_rate numeric, agent_rate numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select a.id, a.partner_rate, a.agent_rate
  from public.applications a
  where public.is_aal2()
    and public.may_see_commission()
    and (p_partner is null or a.partner_id = p_partner)
    and (
      public.is_admin()
      or (public.app_role() = 'management' and a.partner_id = public.app_partner()
          and public.app_may_reach_application_org(a.partner_id, a.agency_id, a.branch_id))
    )
$function$
;

CREATE OR REPLACE FUNCTION public.attach_user_to_agency(p_user uuid, p_agency uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_target public.users; v_agency public.agencies;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  select * into v_target from public.users where id = p_user;
  if not found then raise exception 'User not found' using errcode = '22023'; end if;
  select * into v_agency from public.agencies where id = p_agency;
  if not found then raise exception 'Agency not found' using errcode = '22023'; end if;

  -- Who may attach: an opndoor admin, or a manager acting within their own
  -- partner. A branch manager cannot: attaching somebody to an agency is a
  -- statement about the whole brand, which is above their position.
  if not (
    public.is_admin()
    or (
      public.app_role() = 'management'
      and v_target.partner_id = public.app_partner()
      and public.app_may_reach_agency(p_agency)
      and public.user_within_caller_scope(p_user)
      and (
        not public.app_has_scope()
        or exists (select 1 from public.user_scopes s
                    where s.user_id = auth.uid() and s.kind in ('group','agency'))
      )
    )
  ) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  insert into public.user_agency_attachments (user_id, agency_id, created_by)
  values (p_user, p_agency, auth.uid())
  on conflict (user_id, agency_id) do nothing;
end $function$
;

CREATE OR REPLACE FUNCTION public.commission_preview(p_level text, p_id uuid, p_rate numeric)
 RETURNS TABLE(worst_total numeric, worst_branch text, branches_affected integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with affected as (
    select b.id, b.name, b.agent_rate as branch_rate, b.partner_id,
           a.id as agency_id, a.name as agency_name, a.agent_rate as agency_rate,
           g.id as group_id, g.name as group_name, g.agent_rate as group_rate
    from public.branches b
    join public.agencies a on a.id = b.agency_id
    left join public.agency_groups g on g.id = a.group_id
    where public.may_see_commission()
      -- The preview walked every branch under the named party with no test that
      -- the caller reaches it.
      and public.app_may_reach_agency(a.id)
      and ((p_level = 'branch' and b.id = p_id)
        or (p_level = 'agency' and b.agency_id = p_id)
        or (p_level = 'group'  and a.group_id = p_id))
  ),
  totals as (
    select f.name,
           (select coalesce(sum(r.rate), 0)
              from public.commission_split_rule(
                f.agency_id, f.agency_name,
                case when p_level = 'agency' then p_rate else f.agency_rate end,
                f.id, f.name,
                case when p_level = 'branch' then p_rate else f.branch_rate end,
                f.group_id, f.group_name,
                case when p_level = 'group'  then p_rate else f.group_rate end,
                (select p2.agent_rate from public.partners p2 where p2.id = f.partner_id)
              ) r) as total
    from affected f
  )
  select coalesce(max(total), 0),
         (select name from totals order by total desc nulls last limit 1),
         count(*)::int
  from totals
$function$
;

CREATE OR REPLACE FUNCTION public.create_agency_group(p_partner_slug text, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := auth.uid(); pid uuid; gid uuid; nm text := btrim(coalesce(p_name, ''));
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if nm = '' then raise exception 'Group name is required' using errcode = '22023'; end if;
  if public.is_admin() then
    select id into pid from public.partners where slug = p_partner_slug;
    if pid is null then raise exception 'Select a valid partner for this group.' using errcode = '22023'; end if;
  -- Same as admin_add_agency: a group on the shared house partner is an
  -- Opndoor-level object, not one agency's.
  elsif public.app_role() = 'management'
        and not public.is_our_estate_partner(public.app_partner()) then
    pid := public.app_partner();
    if pid is null then raise exception 'Unknown partner.' using errcode = '22023'; end if;
  else
    raise exception 'not permitted' using errcode = '42501';
  end if;
  -- name_key is a generated column; do not write it.
  insert into public.agency_groups(partner_id, name, created_by)
  values (pid, nm, me) returning id into gid;
  insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
  values ('agency_group', gid, 'created', nm, coalesce((select full_name from public.users where id = me), 'an administrator'), me);
  return gid;
exception when unique_violation then
  raise exception 'A group with that name already exists for this partner.' using errcode = '23505';
end $function$
;

CREATE OR REPLACE FUNCTION public.deed_target(p_application uuid)
 RETURNS TABLE(application_id uuid, ready boolean, tenant_names text, co_tenant_names text, tenant_count integer, unpaid_count integer, share_amount numeric, share_percent numeric, tenancy_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- WHO A DEED IS FOR, and it had no org test: any manager on the house
  -- partner could read another agency's tenant names and share amounts.
  with me as (select * from public.applications
               where id = p_application and public.app_may_reach_application(p_application))
  select
    m.id,
    -- THIS TENANT'S OWN GATE. A tenant who has paid gets their deed; a tenant
    -- who has not, does not; and nobody waits on anybody else. For a tenancy of
    -- one this is exactly the gate it always was.
    m.paid_at is not null,
    -- ALL the names, for the document to say whose tenancy it is. Null on a
    -- tenancy of one, which is what keeps a single-tenant deed byte-identical:
    -- createAndSend falls back to the applicant's own name, as before.
    case when m.tenancy_id is null then null else public.tenancy_tenant_names(m.id) end,
    -- The OTHERS, for the co-tenant merge field. Null when there are none.
    case when m.tenancy_id is null then null else (
      select nullif(string_agg(
               btrim(o.tenant_first_name || ' ' || o.tenant_last_name),
               ', ' order by o.tenancy_position nulls last, o.created_at), '')
        from public.applications o
       where o.tenancy_id = m.tenancy_id and o.id <> m.id) end,
    -- A tenancy of one IS a tenancy of one. `a.tenancy_id = null` matches no
    -- row and returns 0, not null, so coalesce never fires: the solo case has to
    -- be named. The old function had the same coalesce and the same hole.
    case when m.tenancy_id is null then 1
         else (select count(*)::int from public.applications a
                where a.tenancy_id = m.tenancy_id) end,
    case when m.tenancy_id is null then (case when m.paid_at is null then 1 else 0 end)
         else (select count(*)::int from public.applications a
                where a.tenancy_id = m.tenancy_id and a.paid_at is null) end,
    -- What this deed covers. A tenancy of one covers the whole rent, which is
    -- what share_amount is null for and monthly_rent answers.
    coalesce(m.share_amount, m.monthly_rent),
    coalesce(m.share_percent, 100),
    m.tenancy_id
  from me m
$function$
;

CREATE OR REPLACE FUNCTION public.detach_user_from_agency(p_user uuid, p_agency uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_target public.users;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into v_target from public.users where id = p_user;
  if not found then raise exception 'User not found' using errcode = '22023'; end if;

  if not (public.is_admin()
          or (public.app_role() = 'management' and v_target.partner_id = public.app_partner()
              and public.app_may_reach_agency(p_agency)
              and public.user_within_caller_scope(p_user))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- The trigger recomputes user_attached for the pair and deletes the
  -- relationship row when nothing else holds it up.
  delete from public.user_agency_attachments where user_id = p_user and agency_id = p_agency;
end $function$
;

CREATE OR REPLACE FUNCTION public.referrer_league(p_start timestamp with time zone, p_end timestamp with time zone, p_scope text DEFAULT 'company'::text)
 RETURNS TABLE(name text, refs integer, fees numeric, is_self boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pid uuid := public.app_partner(); me uuid := auth.uid(); v_mode text; v_branches uuid[];
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if public.app_role() not in ('superadmin','management','referrer','developer') then return; end if;
  if pid is null then return; end if;
  select referrer_leaderboard_mode into v_mode from public.partners where id = pid;
  v_mode := coalesce(v_mode, 'full');

  -- The caller's own branch set, computed ONLY when narrowing. A positioned user
  -- expands their group/agency/branch scope; a negotiator (no position) uses the
  -- branches they have referred at. Left NULL for the 'company' scope, which the
  -- predicates below read as "no branch filter".
  /* ON OUR OWN ESTATE THE AGENCY IS ALWAYS THE BOUNDARY, whatever scope was
     asked for. The board is per partner, and on the house route that is every
     agency: one agency's negotiators were ranked against another's, by name.
     Narrowing here rather than in each arm below, because every predicate
     already honours v_branches. */
  if public.is_our_estate_partner(pid) and not public.is_admin() then
    select array_agg(b.id) into v_branches
      from public.branches b
     where b.agency_id in (select public.app_scoped_agencies());
    v_branches := coalesce(v_branches, array[]::uuid[]);
  elsif p_scope = 'mine' then
    if public.app_has_scope() then
      select array_agg(b) into v_branches from public.app_scope_branches() b;
    else
      select array_agg(distinct a.branch_id) into v_branches
      from public.applications a
      where a.livemode and a.partner_id = pid and a.referrer_id = me;
    end if;
    v_branches := coalesce(v_branches, array[]::uuid[]);
  end if;

  if v_mode = 'private' then
    return query
    select coalesce(u.full_name, 'You'),
           (select count(*)::int from public.applications a
              where a.livemode and a.partner_id = pid and a.referrer_id = me and a.status not in ('withdrawn','expired') and a.sent_at between p_start and p_end
                and (v_branches is null or a.branch_id = any(v_branches))),
           (select coalesce(sum(coalesce(a.fee_amount, a.monthly_rent)), 0) from public.applications a
              where a.livemode and a.partner_id = pid and a.referrer_id = me and a.paid_at between p_start and p_end and a.payment_state is distinct from 'refunded'
                and (v_branches is null or a.branch_id = any(v_branches))),
           true
    from public.users u where u.id = me;
    return;
  end if;

  return query
  with agg as (
    select a.referrer_id as rid,
           count(*) filter (where a.status not in ('withdrawn','expired') and a.sent_at between p_start and p_end) as ct,
           coalesce(sum(coalesce(a.fee_amount, a.monthly_rent)) filter (where a.paid_at between p_start and p_end and a.payment_state is distinct from 'refunded'), 0) as amt
    from public.applications a
    where a.livemode and a.partner_id = pid and a.referrer_id is not null
      and (v_branches is null or a.branch_id = any(v_branches))
    group by a.referrer_id
  ),
  peers as (
    select u.full_name as rname, agg.ct::int as rrefs,
           case when v_mode = 'rankings' then 0::numeric else agg.amt end as rfees,
           agg.amt as ramt, (agg.rid = me) as rself, agg.rid as rrid
    from agg join public.users u on u.id = agg.rid
    where u.role <> 'superadmin' and agg.ct > 0
  ),
  self_row as (
    select coalesce(u.full_name, 'You') as rname,
           (select count(*)::int from public.applications a
              where a.livemode and a.partner_id = pid and a.referrer_id = me and a.status not in ('withdrawn','expired') and a.sent_at between p_start and p_end
                and (v_branches is null or a.branch_id = any(v_branches))) as rrefs,
           (select coalesce(sum(coalesce(a.fee_amount, a.monthly_rent)), 0) from public.applications a
              where a.livemode and a.partner_id = pid and a.referrer_id = me and a.paid_at between p_start and p_end and a.payment_state is distinct from 'refunded'
                and (v_branches is null or a.branch_id = any(v_branches))) as ramt,
           true as rself, me as rrid
    from public.users u where u.id = me
  )
  select x.rname, x.rrefs, x.rfees, x.rself
  from (
    select p.rname, p.rrefs, p.rfees, p.ramt, p.rself, p.rrid from peers p where p.rrid <> me
    union all
    select s.rname, s.rrefs, case when v_mode = 'rankings' then 0::numeric else s.ramt end as rfees, s.ramt, s.rself, s.rrid from self_row s
  ) x
  order by x.ramt desc, x.rrefs desc, x.rname asc;
end $function$
;

CREATE OR REPLACE FUNCTION public.set_agency_group(p_agency uuid, p_group uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := auth.uid(); a_pid uuid; g_pid uuid; v_rate numeric; v_name text; v_agr uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select partner_id into a_pid from public.agencies where id = p_agency;
  if a_pid is null then raise exception 'Agency not found' using errcode = '22023'; end if;
  if not (public.is_admin() or (public.app_role() = 'management' and a_pid = public.app_partner()
                                and public.app_may_reach_agency(p_agency))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_group is not null then
    select partner_id into g_pid from public.agency_groups where id = p_group;
    if g_pid is null then raise exception 'Group not found' using errcode = '22023'; end if;
    if g_pid <> a_pid then raise exception 'The group and the agency are under different partners.' using errcode = '22023'; end if;

    -- Moving an all-in agency under a group that already charges is the same
    -- breach as adding the charge above it, and touches no rate, so no rate
    -- trigger would see it.
    v_agr := public.active_agreement_on('agency', p_agency);
    if v_agr is not null and (select coverage from public.pricing_agreements where id = v_agr) = 'all_in' then
      select g.agent_rate, g.name into v_rate, v_name from public.agency_groups g where g.id = p_group;
      if v_rate is not null then
        raise exception '%', public.all_in_breach_sentence(
          v_name, v_rate,
          (select name from public.agencies where id = p_agency),
          public.agreement_max_rate(v_agr)) using errcode = '22023';
      end if;
    end if;
  end if;

  update public.agencies set group_id = p_group where id = p_agency;
  insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
  values ('agency', p_agency, 'group_set', coalesce((select name from public.agency_groups where id = p_group), 'detached'),
    coalesce((select full_name from public.users where id = me), 'an administrator'), me);
end $function$
;

CREATE OR REPLACE FUNCTION public.set_referrer_leaderboard_mode(p_slug text, p_mode text)
 RETURNS partners
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur public.partners; res public.partners; who text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_mode not in ('full','rankings','private') then raise exception 'Invalid leaderboard mode' using errcode = '22023'; end if;
  select * into cur from public.partners where slug = p_slug;
  if cur.id is null then raise exception 'Partner not found' using errcode = '22023'; end if;
  /* THE MODE IS THE PARTNER'S, and on the house route the partner is every
     agency Opndoor carries: one agency's Manager could set how every other
     agency's leaderboard behaves. */
  if not (public.is_admin() or (public.app_role() = 'management' and cur.id = public.app_partner()
                                and not public.is_our_estate_partner(cur.id))) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  who := coalesce((select full_name from public.users where id = auth.uid()), 'an administrator');
  if cur.referrer_leaderboard_mode is distinct from p_mode then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'referrer_leaderboard', cur.referrer_leaderboard_mode, p_mode, who);
  end if;
  update public.partners set referrer_leaderboard_mode = p_mode where id = cur.id returning * into res;
  return res;
end $function$
;

CREATE OR REPLACE FUNCTION public.tenancy_tenant_names(p_application uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  /* SERVICE ROLE PASSES THROUGH. The deed generation path calls this with no
     JWT at all, so the gate is on there BEING a caller: a signed-in user must
     reach the application, and the cron/webhook path is unaffected. */
  with t as (select tenancy_id from public.applications
              where id = p_application
                and (auth.uid() is null or public.app_may_reach_application(p_application)))
  select case
    when (select tenancy_id from t) is null
      then (select btrim(coalesce(tenant_first_name,'') || ' ' || coalesce(tenant_last_name,''))
              from public.applications where id = p_application)
    else (select string_agg(btrim(coalesce(a.tenant_first_name,'') || ' ' || coalesce(a.tenant_last_name,'')),
                            ', ' order by a.tenancy_position nulls last, a.created_at, a.id)
            from public.applications a, t where a.tenancy_id = t.tenancy_id)
  end
$function$
;
