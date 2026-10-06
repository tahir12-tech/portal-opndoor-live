-- WHAT THE THIRD REVIEWER FOUND.
--
-- A third fresh agent, rules and code only, no sight of the first two reviews
-- or of any of the work. Four of its five findings are MINE: two introduced by
-- the migrations above, one left behind by them, and one regression that
-- stopped managers inviting anybody at all. That is the argument for running
-- the loop rather than stopping after the reviewer that finds nothing new.
--
-- Every one reproduced on dev before this migration.

-- ===========================================================================
-- 0. THE REGRESSION FIRST: NOBODY COULD BE INVITED ONTO OUR ESTATE
-- ===========================================================================
-- Not a leak, and worse than one for a Monday. The chain the reviewer traced:
--
--   invite-user calls create_invited_user as the inviter
--     -> create_invited_user calls set_user_scope
--       -> set_user_scope calls assert_may_act_on_user(new person)
--         -> that needs level_rank_of(new person) to be non-null
--           -> level_rank_of is gated on app_may_reach_user
--             -> which, since 20261006310000, locates somebody on our estate
--                THROUGH POSITIONS ALONE
--               -> and a person being invited has no position yet.
--
-- So every management and negotiator invite on the house estate failed with
-- "That person has no agency level, so only opndoor may act on them", and
-- invite-user then deleted the half-made auth account. Before 20261006310000
-- the invitee was located by their home_branch_id, which invite-user passes.
-- Removing that arm was right; it was also the only thing locating them.
--
-- THE REAL MISTAKE IS THE ONE UNDERNEATH: create_invited_user called
-- set_user_scope, and set_user_scope asks the wrong question about somebody
-- who does not exist yet. "May I act on this person" is a LADDER question and
-- needs a person with a level. Creating one is a GRANT question, and the test
-- for it is assert_may_grant_level, which invite-user already runs. So the
-- containment half is extracted and both callers use it, and only the caller
-- acting on an EXISTING person asks the ladder.

-- ===========================================================================
-- 1. AND THE CONTAINMENT TEST WAS VACUOUS FOR A BRANCHLESS AGENCY (high)
-- ===========================================================================
-- Extracting it is also the chance to fix it, because as written it passes
-- when it has nothing to check:
--
--   if exists (select ... from (<branches under the target>) granted
--               where granted.branch_id not in (select app_scope_branches()))
--   then raise
--
-- "no branch of the target lies outside my scope" is TRUE of an agency with
-- no branches. 20260927100000 made the first branch optional on purpose, so
-- that a group can be stood up as a skeleton: during any onboarding there are
-- branchless agencies belonging to other companies sitting there.
--
-- Reproduced on dev: a Regent's Director placed their own Negotiator onto a
-- branchless agency they do not reach. ALLOWED. The same call against an
-- agency that has branches was refused, which is what kept it hidden.
--
-- The fix asks about the TARGET, not only about what hangs below it. A
-- branchless agency has an owner and a partner, so app_may_reach_agency
-- answers for it. The branch containment stays as well, because the two
-- catch different things: the target test catches a foreign agency, and the
-- branch test catches a group of mine that has grown a branch I do not hold.
create or replace function public.assert_may_grant_position(p_kind text, p_target uuid)
returns void
language plpgsql stable security definer set search_path to ''
as $function$
declare v_partner uuid;
begin
  if p_kind not in ('group','agency','branch') then
    raise exception 'A position is a group, a brand or a branch.' using errcode = '22023';
  end if;
  if p_target is null then
    raise exception 'Choose the group, brand or branch for this position.' using errcode = '22023';
  end if;
  if public.is_admin() then return; end if;

  -- Only a group or agency position can grant positions at all. A branch
  -- manager granting one would be a way out of the branch they were given.
  if not exists (select 1 from public.user_scopes s
                  where s.user_id = auth.uid() and s.kind in ('group','agency')) then
    raise exception 'Only a brand or group manager places people.' using errcode = '42501';
  end if;

  -- THE TARGET ITSELF. This is the arm that was missing, and it is the one
  -- that answers for a target with nothing under it yet.
  if p_kind = 'agency' then
    if not public.app_may_reach_agency(p_target) then
      raise exception 'You can only place somebody inside your own part of the business.' using errcode = '42501';
    end if;
  elsif p_kind = 'branch' then
    if not public.app_may_reach_branch(p_target) then
      raise exception 'You can only place somebody inside your own part of the business.' using errcode = '42501';
    end if;
  else
    select partner_id into v_partner from public.agency_groups where id = p_target;
    if v_partner is null then raise exception 'Group not found' using errcode = '22023'; end if;
    if not public.app_reachable_group(p_target, v_partner) then
      raise exception 'You can only place somebody inside your own part of the business.' using errcode = '42501';
    end if;
  end if;

  -- AND the branch set below it, unchanged. A group I hold that has grown a
  -- branch I do not is still a position I may not hand out.
  if exists (
    select 1 from (
      select b.id from public.agencies a
       join public.branches b on b.agency_id = a.id
      where p_kind = 'agency' and a.id = p_target
      union all
      select b.id from public.agency_groups g
       join public.agencies a on a.group_id = g.id
       join public.branches b on b.agency_id = a.id
      where p_kind = 'group' and g.id = p_target
      union all
      select p_target where p_kind = 'branch'
    ) granted(branch_id)
    where granted.branch_id not in (select public.app_scope_branches())
  ) then
    raise exception 'You can only place somebody inside your own part of the business.'
      using errcode = '42501';
  end if;
end $function$;

comment on function public.assert_may_grant_position(text, uuid) is
  'May the caller hand out this position. Asks about the TARGET first, because the branch-containment test alone passes vacuously for an agency or group that has no branches yet, and 20260927100000 made a branchless agency a normal state.';

revoke all on function public.assert_may_grant_position(text, uuid) from public, anon;
grant execute on function public.assert_may_grant_position(text, uuid) to authenticated, service_role;

-- set_user_scope keeps the ladder test, because it acts on somebody who
-- exists, and delegates the containment.
create or replace function public.set_user_scope(p_user uuid, p_kind text, p_target uuid)
returns void
language plpgsql security definer set search_path to ''
as $function$
declare v_target public.users;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  select * into v_target from public.users where id = p_user;
  if not found then raise exception 'User not found' using errcode = '22023'; end if;

  if not (public.is_admin()
          or (public.app_role() = 'management' and v_target.partner_id = public.app_partner())) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- The ladder: this person exists and has a level, so it is a fair question.
  perform public.assert_may_act_on_user(p_user);
  -- The containment, shared with create_invited_user.
  perform public.assert_may_grant_position(p_kind, p_target);

  delete from public.user_scopes where user_id = p_user;
  insert into public.user_scopes (user_id, kind, group_id, agency_id, branch_id, created_by)
  values (p_user, p_kind,
          case when p_kind = 'group'  then p_target end,
          case when p_kind = 'agency' then p_target end,
          case when p_kind = 'branch' then p_target end,
          auth.uid());

  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values ('user', p_user, 'position_set', p_kind || ':' || p_target::text,
          (select full_name from public.users where id = auth.uid()), auth.uid());
end $function$;

-- create_invited_user writes both rows itself. The level was authorised by
-- assert_may_grant_level, which is the right test for somebody who does not
-- exist yet; the position by the shared containment above.
create or replace function public.create_invited_user(
  p_id uuid, p_email text, p_full_name text, p_role text, p_partner uuid,
  p_home_branch uuid, p_sees_commission boolean,
  p_scope_kind text, p_scope_target uuid
) returns void
language plpgsql security definer set search_path to ''
as $function$
declare v_estate boolean; v_level text;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;

  select p.referencing_mode = 'opndoor_referenced' into v_estate
    from public.partners p where p.id = p_partner;
  v_estate := coalesce(v_estate, false);

  if not (public.is_admin()
          or (public.app_role() = 'management' and p_partner = public.app_partner())) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if v_estate and (p_scope_kind is null or p_scope_target is null) then
    raise exception 'Everybody on our estate is invited into a position: a group, a brand or a branch. Choose one.'
      using errcode = '22023';
  end if;

  -- THE LADDER, asked the only way it can be asked about somebody who does
  -- not exist: on the LEVEL they are being given. invite-user asks this too,
  -- before it mints an auth account; asking again here is what makes the
  -- rule a property of the function rather than of one caller.
  v_level := case when p_role = 'referrer' then 'Negotiator'
                  when coalesce(p_sees_commission, false) then 'Director'
                  else 'Manager' end;
  if p_role in ('management', 'referrer') then
    perform public.assert_may_grant_level(v_level);
  end if;

  if p_scope_kind is not null then
    perform public.assert_may_grant_position(p_scope_kind, p_scope_target);
  end if;

  insert into public.users (id, email, full_name, role, partner_id, status,
                            home_branch_id, sees_commission)
  values (p_id, p_email, p_full_name, p_role, p_partner, 'pending',
          p_home_branch, p_role = 'management' and coalesce(p_sees_commission, false));

  if p_scope_kind is not null then
    insert into public.user_scopes (user_id, kind, group_id, agency_id, branch_id, created_by)
    values (p_id, p_scope_kind,
            case when p_scope_kind = 'group'  then p_scope_target end,
            case when p_scope_kind = 'agency' then p_scope_target end,
            case when p_scope_kind = 'branch' then p_scope_target end,
            auth.uid());
    insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
    values ('user', p_id, 'position_set', p_scope_kind || ':' || p_scope_target::text,
            (select full_name from public.users where id = auth.uid()), auth.uid());
  end if;
end $function$;

-- ===========================================================================
-- 2. THE COMMISSION-COLUMN REVOKES WERE NO-OPS (high)
-- ===========================================================================
-- 20261006350000 wrote
--
--   revoke select (partner_rate, agent_rate) on public.agencies from anon, authenticated;
--
-- and changed nothing, because a COLUMN-level revoke cannot subtract from a
-- TABLE-level grant. Postgres accepts the statement in silence. This repo
-- already knew: 20260811180000 says so in as many words and does it the only
-- way that works, which is to drop the table grant and re-grant per column.
-- I wrote the wrong form anyway and asserted nothing, so nothing said so.
--
-- Measured on dev after that migration: has_column_privilege('authenticated',
-- 'public.agencies','partner_rate','select') = TRUE, while the same question
-- about applications.agent_rate, done properly in 20260811180000, = FALSE.
-- And reproduced with data: Regent's own Negotiator read
-- "Regent's Park = 0.1750" straight off public.branches.
--
-- Generated from information_schema rather than typed, so a column added to
-- one of these tables later is granted rather than silently dropped from
-- every screen.
do $rates$
declare t text; cols text; withheld text[];
begin
  foreach t in array array['agencies', 'agency_groups', 'branches'] loop
    withheld := case when t = 'branches' then array['agent_rate']
                     else array['partner_rate','agent_rate'] end;

    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns
     where table_schema = 'public' and table_name = t
       and not (column_name = any (withheld));

    if cols is null or cols = '' then
      raise exception 'Refusing to proceed: no columns found on public.%.', t;
    end if;

    -- Table-level FIRST, or the per-column grant below is subsumed by it.
    execute format('revoke select on public.%I from anon, authenticated', t);
    execute format('grant select (%s) on public.%I to authenticated', cols, t);

    -- The write grants go the same way. The rate write path is
    -- set_agency_rates / set_group_rates / set_node_rate, all definer and all
    -- asking may_see_commission; nothing writes these columns over PostgREST.
    execute format('revoke insert, update on public.%I from anon, authenticated', t);
    execute format('grant insert (%s), update (%s) on public.%I to authenticated', cols, cols, t);
  end loop;
end $rates$;

-- Prove it, rather than assume it, which is the step whose absence let the
-- broken version through. has_column_privilege is the question PostgREST asks.
do $proof$
begin
  if has_column_privilege('authenticated', 'public.agencies', 'partner_rate', 'SELECT')
     or has_column_privilege('authenticated', 'public.agencies', 'agent_rate', 'SELECT')
     or has_column_privilege('authenticated', 'public.agency_groups', 'partner_rate', 'SELECT')
     or has_column_privilege('authenticated', 'public.agency_groups', 'agent_rate', 'SELECT')
     or has_column_privilege('authenticated', 'public.branches', 'agent_rate', 'SELECT') then
    raise exception 'A commission rate column on the org tree is still selectable by authenticated.';
  end if;
  if not has_column_privilege('authenticated', 'public.agencies', 'name', 'SELECT')
     or not has_column_privilege('authenticated', 'public.branches', 'name', 'SELECT')
     or not has_column_privilege('authenticated', 'public.agency_groups', 'name', 'SELECT') then
    raise exception 'The re-grant is too narrow: an ordinary column is no longer selectable.';
  end if;
  if not has_column_privilege('authenticated', 'public.agencies', 'name', 'INSERT') then
    raise exception 'The re-grant is too narrow: agencies can no longer be created through the product.';
  end if;
end $proof$;

-- ===========================================================================
-- 3. A DIRECTOR COULD REWRITE A SUBORDINATE'S DELIVERY ADDRESS (medium)
-- ===========================================================================
-- public.users keeps its table UPDATE grant, and seven columns are guarded by
-- triggers: id, role, status, sees_commission, receives_commission_statements,
-- receives_notifications and home_branch_id. email and full_name are not.
--
-- users.email is not a profile field. It is the address the executed deed is
-- sent to (agency_notification_recipients, every rung), the address the
-- commission statement is sent to, and the address the weekly digest and the
-- expiry-cohort CSV of tenant names, addresses and rents are sent to.
--
-- Reproduced on dev: a Regent's Director PATCHed their own Negotiator's row
-- and the deed address became attacker@evil.test. Containment held, so it
-- does not cross the agency boundary; what it does is persistent, silent and
-- unaudited, where admin_update_user_name writes a user_audit row.
--
-- This codebase's own sentence, from 20261005140000: "A guarded RPC beside an
-- open UPDATE path is not a guard, it is a suggestion."
-- EMAIL ONLY, AND full_name DELIBERATELY NOT.
--
-- The reviewer named both. They are not the same thing. users.email is the
-- address a legal instrument is DELIVERED to; users.full_name is a label that
-- appears on screens and in the league table. Locking the name as well was my
-- first version of this, and three existing tests failed on it -- tests
-- written to assert that users_mgmt_update is "narrow", that is, that a
-- manager may still edit an ordinary field on somebody they may act on. That
-- property was deliberate and I am not quietly removing it to gain an audit
-- row on a cosmetic column. admin_update_user_name remains the audited path
-- for anyone who wants one.
create or replace function public.users_identity_guard()
returns trigger
language plpgsql
as $function$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if new.email is distinct from old.email and not public.is_admin() then
    raise exception 'An email address is where a deed is delivered, so only opndoor changes it.'
      using errcode = '42501';
  end if;
  return new;
end $function$;

drop trigger if exists users_identity_guard on public.users;
create trigger users_identity_guard
  before update of email on public.users
  for each row
  when (new.email is distinct from old.email)
  execute function public.users_identity_guard();

-- ===========================================================================
-- 4. AN AGREEMENT IS A COMMISSION FIGURE (medium)
-- ===========================================================================
-- agreement_for_agency returns bands, tiers and the next rate: the negotiated
-- commercial terms. 20261006230000 gave it an org test and no LEVEL test, so
-- a Manager (management, sees_commission false) reading their own agency's
-- agreement got the rates. Every sibling asks may_see_commission, and
-- AgencyHome.tsx:452 only calls it when canSeeCommission, so the intent was
-- never in doubt and only the SQL was missing it.
--
-- Reproduced on dev: Nadia, Regent's Manager, got 1 row back.
create or replace function public.agreement_for_agency(p_agency uuid)
returns table(agreement_id uuid, scope_level text, coverage text, period text, counting_scope text,
              is_standard boolean, note text, effective_from date, period_start date, volume integer,
              bands jsonb, tiers jsonb, next_rate numeric, next_basis numeric)
language sql stable security definer set search_path to ''
as $function$
  with b1 as (
    select b.id as branch_id, b.partner_id from public.branches b
    -- AN AGREEMENT IS COMMERCIALLY SENSITIVE, and it is also a commission
    -- figure: the org test was here and the level test was not.
    where b.agency_id = p_agency
      and public.app_may_reach_agency(p_agency)
      and public.may_see_commission()
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
$function$;

-- ===========================================================================
-- 5. ONE MISSING STEP-UP (low)
-- ===========================================================================
-- agency_match_queue asks is_opndoor_staff() and not is_aal2(), while its two
-- siblings resolve_agency_match and dismiss_agency_match ask both. Staff-only
-- either way, so this is the step-up rule being uneven rather than exposure.
do $aal$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'agency_match_queue';
  if d is null then raise exception 'agency_match_queue not found'; end if;
  if position('is_aal2' in d) > 0 then return; end if;
  -- Inserted beside the staff test rather than retyping the body, because the
  -- body is a long projection and retyping it from memory is how a function
  -- loses an arm.
  d := replace(d, 'public.is_opndoor_staff()', 'public.is_opndoor_staff() and public.is_aal2()');
  execute d;
end $aal$;
