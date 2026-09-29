-- WHAT THE FIFTH REVIEWER FOUND, the database half.
--
-- The critical it found is fixed in 20261006440000 and the deed gap in
-- 20261006450000. This is the rest of the SQL.
--
-- Four of the six below are the same shape: a rule added in one place and not
-- to its neighbours. may_see_commission() went onto three child tables and
-- not the parent. The level test went into the COMMENT of
-- commission_statement_recipients and not into its SQL. The agency predicate
-- went onto four dev_* functions and not onto application_journey. And
-- set_agency_level asks two questions where admin_update_user_role asked one.

-- ===========================================================================
-- H2. THE PARENT TABLE WAS NOT GIVEN THE POLICY ITS CHILDREN GOT
-- ===========================================================================
-- 20261005220000 added a RESTRICTIVE may_see_commission() policy to
-- application_commission_lines, pricing_agreement_bands and commission_tiers.
-- pricing_agreements, the table those bands and tiers hang off, did not get
-- one.
--
-- THE REVIEWER'S STATED IMPACT WAS WRONG AND THE FINDING IS STILL RIGHT. It
-- said the table "carries agent_rate numeric(5,4) and fee_basis_weeks". It
-- does not: checked against information_schema, its columns are id,
-- scope_level, scope_id, effective_from, effective_to, created_at, period,
-- counting_scope, note, created_by, is_standard, coverage, ended_at. Every
-- rate lives in the two child tables and both are already gated, so a
-- Negotiator could not read a rate off it.
--
-- What they COULD read is that a negotiated agreement exists for their
-- agency, on what coverage, over what period, counted at what scope. Those
-- are commercial terms, which rule 3 puts at Director level, and they are the
-- context the gated numbers are meaningless without. Closing it costs
-- nothing: nothing in src selects this table (checked), and the two functions
-- that read it, agreement_for_agency and resolve_pricing_agreement, are
-- SECURITY DEFINER and so unaffected by RLS.
--
-- A restrictive policy ANDs with the permissive one already there, so the org
-- test in pricing_agreements_select is untouched and this only subtracts.
drop policy if exists pa_commission_readers_only on public.pricing_agreements;
create policy pa_commission_readers_only on public.pricing_agreements
  as restrictive for select to authenticated
  using (public.may_see_commission());

-- ===========================================================================
-- The six functions, as they now stand
-- ===========================================================================
-- Written out literally rather than patched by string surgery. That technique
-- has cost this branch two defects: a return type frozen from a stale
-- snapshot, and an inverted guard that let a password-only session read the
-- direct-rail queue. A migration should read as the answer, not as a recipe
-- for computing it.

-- M8. The second door to the level ladder. It asked "may I act on them" and not "may I hand out the level they land at", and wrote role without touching sees_commission, so a Manager could turn a Negotiator whose row still carried the flag into a Director above themselves.
CREATE OR REPLACE FUNCTION public.admin_update_user_role(p_user uuid, p_role text)
 RETURNS users
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur public.users; res public.users; who text; me uuid := auth.uid();
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_role not in ('superadmin','management','referrer','developer') then
    raise exception 'Invalid role' using errcode = '22023';
  end if;
  select * into cur from public.users where id = p_user;
  if cur.id is null then raise exception 'User not found' using errcode = '22023'; end if;
  /* NO DEVELOPER ON OUR OWN ESTATE, BY ANY PATH. invite-user has refused to
     CREATE one since the estate arrived, and 20261006270000 refuses the API
     key and the webhook endpoint a developer exists to hold. This function
     could still PROMOTE somebody into the role, which is the same account by
     a different door: invite them as a Negotiator, then change the role. A
     developer is pinned to a partner, and on the house route the partner is
     every agency we carry. */
  if p_role = 'developer' and public.is_our_estate_partner(cur.partner_id) then
    raise exception 'The developer role is for a supplier''s own API integration. There is no API on the agency rail, so there is nobody for it to be.'
      using errcode = '22023';
  end if;
  if not (public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and public.app_may_reach_user(cur.id))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform public.assert_may_act_on_user(p_user);
  /* AND THE LEVEL THEY WOULD END UP AT. set_agency_level asks both questions;
     this asked only "may I act on them". role and sees_commission together
     are the level, and this function writes role alone, so a Manager could
     call it on a Negotiator (2 < 3, allowed) and, if that row already carried
     sees_commission = true from an earlier demotion through this same door,
     turn them into a DIRECTOR one rank above the Manager who did it. The
     commission trigger never fired, because sees_commission did not change. */
  perform public.assert_may_grant_level(
    case when p_role = 'referrer' then 'Negotiator'
         when p_role = 'management' and cur.sees_commission then 'Director'
         when p_role = 'management' then 'Manager'
         else 'Negotiator' end);
  /* AND THE STRAY BIT IS CLEARED. sees_commission is meaningless on a
     referrer or a developer, and leaving it set is what armed the promotion
     above. may_see_commission() reads role AND the flag, so this changes no
     answer today; it stops the row being a loaded gun. */
  if p_role <> 'management' and cur.sees_commission then
    perform set_config('app.setting_commission_capability', 'on', true);
    update public.users set sees_commission = false where id = p_user;
    perform set_config('app.setting_commission_capability', 'off', true);
  end if;
  -- WAS: `if not public.is_admin() and public.app_has_scope() then`, so an
  -- unpositioned manager SKIPPED this narrowing rather than being refused by
  -- it. The same class as the arms above, wearing a different face.
  if not public.is_admin() then
    if not exists (select 1 from public.user_scopes s
                    where s.user_id = me and s.kind in ('group','agency')) then
      raise exception 'A branch manager cannot change roles.' using errcode = '42501';
    end if;
  end if;
  if cur.role = 'superadmin' and p_role <> 'superadmin' then
    raise exception 'An opndoor admin cannot be reassigned to a partner role.' using errcode = '22023';
  end if;
  if cur.role <> 'superadmin' and p_role not in ('management','referrer','developer') then
    raise exception 'A partner user can only be Management, Referrer or Developer.' using errcode = '22023';
  end if;
  if p_user = me and p_role <> cur.role then
    raise exception 'You cannot change your own role.' using errcode = '42501';
  end if;
  if cur.role = 'superadmin' and p_role <> 'superadmin'
     and (select count(*) from public.users where role = 'superadmin' and status = 'active') <= 1 then
    raise exception 'At least one active opndoor admin must remain.' using errcode = '42501';
  end if;
  if cur.role = p_role then return cur; end if;
  update public.users set role = p_role where id = p_user returning * into res;
  select full_name into who from public.users where id = me;
  insert into public.user_audit(target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'role', cur.role, p_role, coalesce(who, 'opndoor admin'), me);
  return res;
end $function$;

-- H5. An agency's negotiated volume is its own business. A direct application is given a branch by the automatic matcher, so it landed in that agency's count and could push them into a better commission band. Sandbox rows were counted too.
CREATE OR REPLACE FUNCTION public.agreement_volume(p_agreement uuid, p_branch uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with pa as (select * from public.pricing_agreements where id = p_agreement),
  ctx as (
    select b.id as branch_id, b.agency_id, a.group_id
    from public.branches b left join public.agencies a on a.id = b.agency_id
    where b.id = p_branch
  )
  select count(*)::int
  from public.applications ap
  join public.branches b2 on b2.id = ap.branch_id
  left join public.agencies a2 on a2.id = b2.agency_id
  cross join pa cross join ctx
  where ap.paid_at is not null
    -- AGENCY-RAIL BUSINESS ONLY. A direct application is given a branch by
    -- the automatic matcher, so it landed inside that agency's negotiated
    -- volume and could push them into a better commission band. Opndoor's own
    -- direct business is not the matched agency's.
    and public.application_channel(ap.id) = 'Agent referral'
    and ap.livemode
    and ap.paid_at::date >= public.agreement_period_start(p_agreement)
    and case pa.counting_scope
          when 'branch' then b2.id = ctx.branch_id
          when 'agency' then b2.agency_id = ctx.agency_id
          else a2.group_id is not distinct from ctx.group_id and ctx.group_id is not null
        end
$function$;

-- M9. The developer arm the dev_* sweep missed. Four siblings were given an agency predicate in 20261006410000 and this one was not; on the house route the partner is every agency.
CREATE OR REPLACE FUNCTION public.application_journey(p_ref text)
 RETURNS TABLE(referencing_mode text, status text, invited_at timestamp with time zone, registered_at timestamp with time zone, property_done boolean, about_done boolean, fee_paid_at timestamp with time zone, id_done boolean, financials_done boolean, submitted_at timestamp with time zone, decided_at timestamp with time zone, decision text, decline_reason text, guarantee_paid_at timestamp with time zone, deed_at timestamp with time zone, deed_state text, current_step text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications;
begin
  select * into a from public.applications where guarantee_ref = p_ref;
  if not found then return; end if;
  if not (public.is_admin()
    or (public.app_role() = 'referrer'  and a.referrer_id = auth.uid())
    or (public.app_role() = 'developer' and a.partner_id = public.app_partner()
          -- The same agency predicate its four dev_* siblings were given in
          -- 20261006410000. On the house route the partner is every agency.
          and public.app_may_reach_application_org(a.partner_id, a.agency_id, a.branch_id))
    or (public.app_role() = 'management' and a.partner_id = public.app_partner()
        and public.app_may_reach_branch(a.branch_id))) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return query select
    a.referencing_mode,
    a.status,
    (select max(ti.created_at) from public.tenant_invites ti where ti.application_id = a.id),
    (select ap.created_at from public.applicants ap where ap.id = a.applicant_id),
    (coalesce(btrim(a.prop_addr1),'') <> '' and coalesce(a.monthly_rent,0) > 0 and a.tenancy_start is not null),
    exists (select 1 from public.application_profiles pr where pr.application_id = a.id and pr.nationality is not null),
    (select ep.paid_at from public.application_eligibility_payments ep where ep.application_id = a.id),
    exists (select 1 from public.application_documents d where d.application_id = a.id and d.kind = 'id_document'),
    (exists (select 1 from public.application_documents d where d.application_id = a.id and d.kind = 'bank_connection')
       or (select count(*) from public.application_documents d where d.application_id = a.id and d.kind = 'bank_statement') >= 3),
    (select pr.completed_at from public.application_profiles pr where pr.application_id = a.id),
    a.decided_at,
    case when a.status = 'declined' then 'declined'
         when a.decided_at is not null or a.status in ('sent','paid','deed') then 'approved'
         else null end,
    a.decline_reason,
    a.paid_at,
    coalesce(a.deed_executed_at, a.deed_issued_at),
    a.deed_state,
    a.current_step;
end $function$;

-- H4. The level test that 20261006410000 put in the comment and not in the SQL. A statement IS a commission figure; the tick says which of the people entitled to one want the email, it does not confer the entitlement.
CREATE OR REPLACE FUNCTION public.commission_statement_recipients(p_level text, p_org_id uuid)
 RETURNS TABLE(email text, full_name text, source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with party as (
    select case when p_level = 'group'  then p_org_id end as group_id,
           case when p_level = 'agency' then p_org_id end as agency_id,
           case when p_level = 'branch' then p_org_id end as branch_id
  ),
  -- The party itself plus every party ABOVE it. Upwards only: see the header.
  chain as (
    select coalesce(pa.group_id, ag.group_id, bag.group_id) as group_id,
           coalesce(pa.agency_id, br.agency_id)             as agency_id,
           pa.branch_id                                     as branch_id
    from party pa
    left join public.agencies ag  on ag.id  = pa.agency_id
    left join public.branches br  on br.id  = pa.branch_id
    left join public.agencies bag on bag.id = br.agency_id
  ),
  found as (
    select u.email, u.full_name, 'person'::text as source
    from chain c
    join public.user_scopes s
      on (s.kind = 'group'  and s.group_id  = c.group_id)
      or (s.kind = 'agency' and s.agency_id = c.agency_id)
      or (s.kind = 'branch' and s.branch_id = c.branch_id)
    join public.users u on u.id = s.user_id
    -- AND THEY MUST BE ENTITLED TO SEE COMMISSION. The admin-set tick was the
    -- only test, so a Director demoted to Manager kept receiving a PDF of
    -- every commission line for their party: the one figure withheld from a
    -- Manager on every other surface. The LEVEL is the rule; the tick only
    -- says which of the people at that level want the email.
    -- ACTIVE, not "not deactivated". A pending invite has never signed in, so
    -- the portal link in the statement goes somewhere they cannot open. The run
    -- reports a payee it could not address rather than mailing a dead account.
    where u.receives_commission_statements
      -- THE LEVEL, which 20261006410000 claimed in a comment and did not add.
      -- The tick says which of the people entitled to a statement want the
      -- email; it does not confer the entitlement. A Manager or Negotiator
      -- holding it was being posted every commission line for their party.
      and u.role = 'management' and u.sees_commission
      and u.status = 'active'
      and coalesce(btrim(u.email), '') <> ''
    union all
    select f.finance_email, null, 'finance'
    from (
      select ag.finance_email from public.agencies ag, party pa
       where p_level = 'agency' and ag.id = pa.agency_id
      union all
      select gr.finance_email from public.agency_groups gr, party pa
       where p_level = 'group' and gr.id = pa.group_id
    ) f
    where coalesce(btrim(f.finance_email), '') <> ''
  )
  -- One address, once. A finance mailbox that is also somebody's login would
  -- otherwise receive the statement twice, from two different reasons.
  select distinct on (lower(btrim(r.email))) btrim(r.email), r.full_name, r.source
  from found r
  order by lower(btrim(r.email)), r.source desc
$function$;

-- LOW. The league ranked people who have left, unlike agency_weekly_climber.
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
    where u.role <> 'superadmin'
      -- Not somebody who has left, the same rule agency_weekly_climber uses.
      and u.status = 'active' and agg.ct > 0
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
end $function$;

-- M14. The tick could be put on somebody who may not see commission, where it sat looking as though it did something.
CREATE OR REPLACE FUNCTION public.set_receives_commission_statements(p_user uuid, p_on boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_target public.users;
  v_actor  text;
  v_level  text;
  v_org    uuid;
  v_org_name text;
  v_on     boolean := coalesce(p_on, false);
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  select * into v_target from public.users where id = p_user;
  if not found then raise exception 'User not found' using errcode = '22023'; end if;

  /* THE LEVEL. A statement IS a commission figure, so only somebody who may
     see commission may be addressed one. Refusing the tick here means the row
     on screen and the recipient list agree; leaving it settable put a tick on
     a Manager that looked like it did something and, until
     commission_statement_recipients gained its own level test, did. */
  if v_on and not (v_target.role = 'management' and v_target.sees_commission) then
    raise exception 'Only a Director receives a commission statement. Change their level first.'
      using errcode = '22023';
  end if;

  select c.level, c.org_id, c.org_name into v_level, v_org, v_org_name
  from public.commission_statement_party(p_user) c;
  if v_level is null then
    raise exception 'This person is not attached to a group, agency or branch, so there is no commission statement for them to receive.'
      using errcode = '22023';
  end if;

  -- OPNDOOR ONLY. Was: admin, OR a positioned manager over somebody wholly
  -- inside their own position. The second arm is withdrawn. The message says
  -- why rather than 'not permitted', because this is not a privilege somebody
  -- might have been expected to hold: it is a record Opndoor keeps.
  if not public.is_admin() then
    raise exception 'Who receives a commission statement is set by Opndoor, not by the agency.'
      using errcode = '42501';
  end if;

  select full_name into v_actor from public.users where id = auth.uid();

  perform set_config('app.setting_commission_tick', 'on', true);
  update public.users set receives_commission_statements = v_on where id = p_user;
  perform set_config('app.setting_commission_tick', 'off', true);

  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values (
    v_level, v_org,
    case when v_on then 'commission_statements_on' else 'commission_statements_off' end,
    coalesce(nullif(btrim(v_target.full_name), ''), v_target.email)
      || case when v_on then ' now receives ' else ' no longer receives ' end
      || coalesce(v_org_name, 'this party') || '''s monthly commission statement',
    coalesce(v_actor, 'an administrator'), auth.uid()
  );

  return v_on;
end $function$;

