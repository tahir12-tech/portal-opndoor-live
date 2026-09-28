-- THE REST OF BOTH REVIEWS.
--
-- Everything the two reviews found that was not the home-branch escalation,
-- the fail-open class or the grant sweep. Grouped by what is wrong rather
-- than by which review said it, because several were reported twice from
-- different ends and are one fix.

-- ===========================================================================
-- 1. A NEGOTIATOR COULD MOVE THEIR OWN APPLICATION INTO A COMPETITOR'S BOOK
-- ===========================================================================
-- The worst of the remaining findings, and a WRITE. applications_update reads,
-- in its third arm:
--
--     app_role() = 'referrer' and referrer_id = auth.uid() and status = 'sent'
--
-- with no org test in USING and none in WITH CHECK. 20261006170000 fixed the
-- management arm and applications_insert and left this one exactly as it was.
-- A referrer's own application is theirs, so the arm looked complete: the
-- thing it does not say is that agency_id is a COLUMN, and nothing stopped
-- them setting it to somebody else's agency.
--
-- Reproduced on dev as Regent's negotiator, on their own sent application:
--
--     update public.applications set agency_id = <Northgate> where id = <mine>
--     -> MOVED, 1 row.  The application now belongs to: Northgate Lettings
--
-- The sweep found the other half independently: partner_agency_rel_select
-- handed every agency uuid on the house route to any agency user, which is
-- the input this needs. Both are closed, and either alone would have left a
-- path.
--
-- WITH CHECK is what does the work here: it is evaluated against the NEW row,
-- so the move fails on the agency the row is moving TO.
drop policy if exists applications_update on public.applications;
create policy applications_update on public.applications
  for update
  using (
    public.is_admin()
    or (public.app_role() = 'management'
        and partner_id = public.app_partner()
        and public.app_may_reach_application_org(partner_id, agency_id, branch_id))
    or (public.app_role() = 'referrer'
        and referrer_id = auth.uid()
        and status = 'sent'
        and public.app_may_reach_application_org(partner_id, agency_id, branch_id))
  )
  with check (
    public.is_admin()
    or (public.app_role() = 'management'
        and partner_id = public.app_partner()
        and public.app_may_reach_application_org(partner_id, agency_id, branch_id))
    or (public.app_role() = 'referrer'
        and referrer_id = auth.uid()
        and status = 'sent'
        and public.app_may_reach_application_org(partner_id, agency_id, branch_id))
  );

-- And the partner follows the org on BOTH columns. The sync trigger fired
-- `before insert or update of branch_id` only, so changing agency_id alone
-- left partner_id pointing at the old route -- a row whose three org columns
-- disagreed, which is the state every predicate above assumes cannot happen.
drop trigger if exists applications_sync_partner on public.applications;
create trigger applications_sync_partner
  before insert or update of branch_id, agency_id on public.applications
  for each row execute function public.sync_application_partner();

-- ===========================================================================
-- 2. THREE MORE POLICIES BOUNDED BY THE ROUTE
-- ===========================================================================
-- user_audit is the people lifecycle trail: demotions, deactivations, MFA
-- resets, cancelled invites, password-reset authorisations, with the actor's
-- name. Its partner_id column is the TARGET's partner, and its own comment
-- says "management read scoping" -- true when a partner was a company. This
-- one does not even need the unpositioned state: a fully positioned branch
-- manager at Harborview read Northgate's.
drop policy if exists user_audit_read on public.user_audit;
create policy user_audit_read on public.user_audit
  for select
  using (
    public.is_admin()
    or (public.app_role() = 'management'
        and partner_id = public.app_partner()
        and public.app_may_reach_user(target_user))
  );

-- Which agency a person works for. Same shape, same route.
drop policy if exists user_agency_attachments_select on public.user_agency_attachments;
create policy user_agency_attachments_select on public.user_agency_attachments
  for select
  using (
    public.is_admin()
    or (public.app_may_reach_user(user_id) and public.app_may_reach_agency(agency_id))
  );

-- A nested policy is only as narrow as its own test. tct_read reaches THROUGH
-- applications, which would inherit the fixed applications_select -- except
-- that it re-tests `a.partner_id = app_partner()` itself, and a nested
-- subquery in a policy is evaluated with RLS on the referenced table, so the
-- extra arm can only widen what the join already allowed. It is the agency
-- test that was missing.
drop policy if exists tct_read on public.tenancy_correction_tokens;
create policy tct_read on public.tenancy_correction_tokens
  for select
  using (
    public.is_admin()
    or exists (
      select 1 from public.applications a
      where a.id = tenancy_correction_tokens.application_id
        and public.app_role() = 'management'
        and a.partner_id = public.app_partner()
        and public.app_may_reach_application_org(a.partner_id, a.agency_id, a.branch_id)
    )
  );

-- ===========================================================================
-- 3. REMOVE POSITION HAD NO POLICY TO WORK THROUGH
-- ===========================================================================
-- user_scopes carried SELECT policies and nothing else, so every write went
-- through set_user_scope and the Team screen's "Remove position" had no path
-- at all: RLS refused it silently and the button did nothing. Granting a
-- DELETE is the honest fix, scoped the same way granting one is -- and the
-- constraint trigger from 20261006300000 is what refuses removing somebody's
-- LAST position, with a sentence that says to place or deactivate them.
drop policy if exists user_scopes_delete on public.user_scopes;
create policy user_scopes_delete on public.user_scopes
  for delete
  using (
    public.is_admin()
    or (public.app_role() = 'management'
        and public.app_may_reach_user(user_id)
        and public.user_within_caller_scope(user_id)
        and exists (select 1 from public.user_scopes s
                     where s.user_id = auth.uid() and s.kind in ('group','agency')))
  );

-- ===========================================================================
-- 4. THE COMMISSION CAPABILITY WAS GUARDED ON UPDATE ONLY
-- ===========================================================================
-- users_commission_capability_is_admin_only is BEFORE UPDATE. sees_commission
-- is what separates a Director from a Manager, so a row that arrives with it
-- already true was never checked -- and create_invited_user writes exactly
-- that column at insert time. It is authorised there by assert_may_grant_level
-- and this is the belt to that brace, because the next insert path will not
-- remember to call it.
create or replace function public.users_commission_capability_is_admin_only()
returns trigger
language plpgsql
as $function$
begin
  if tg_op = 'INSERT' then
    -- Nothing to compare against, so the test is on the value itself.
    if coalesce(new.sees_commission, false)
       and current_user not in ('service_role', 'postgres', 'supabase_admin')
       and not public.is_admin()
       and not public.may_act_on_user(new.id) then
      raise exception 'Only an opndoor admin, or a manager above them, may create somebody who sees commission.'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.sees_commission is distinct from old.sees_commission then
    if coalesce(current_setting('app.setting_commission_capability', true), 'off') <> 'on'
       and current_user not in ('service_role', 'postgres', 'supabase_admin')
       and not public.is_admin() then
      raise exception 'Whether somebody sees commission is a level, changed through the level control.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $function$;

drop trigger if exists users_commission_capability_is_admin_only on public.users;
create trigger users_commission_capability_is_admin_only
  before insert or update on public.users
  for each row execute function public.users_commission_capability_is_admin_only();

-- ===========================================================================
-- 5. THE FOUR CONTACT RPCs
-- ===========================================================================
-- org_add_contact, org_update_contact, org_remove_contact and
-- org_set_primary_contact each end their authorisation at
-- `pid = public.app_partner()`. A contact is the email an executed deed is
-- sent to, so this is not only a read: setting another agency's primary
-- contact redirects their deeds.
--
-- app_may_reach_contact already exists, was written for exactly this, and
-- keeps the supplier rail on its original partner test.
-- org_add_contact and org_update_contact, rewritten from pg_get_functiondef
-- so only the authorisation line changes. These two were described in the
-- heading above and then not written: the reach suite pointed them at
-- another agency and they both still succeeded, which is the argument for
-- a test per function rather than a test per intention.
CREATE OR REPLACE FUNCTION public.org_add_contact(p_agency_id uuid, p_branch_id uuid, p_name text, p_role text, p_email text, p_phone text, p_primary boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := auth.uid(); pid uuid; new_id uuid; v_email text := btrim(coalesce(p_email,''));
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  if (p_agency_id is null) = (p_branch_id is null) then
    raise exception 'A contact must belong to exactly one agency or branch.' using errcode = '22023';
  end if;
  if v_email = '' then raise exception 'A contact email is required.' using errcode = '22023'; end if;
  if v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Enter a valid contact email.' using errcode = '22023';
  end if;
  if p_agency_id is not null then select partner_id into pid from public.agencies where id = p_agency_id;
  else select partner_id into pid from public.branches where id = p_branch_id; end if;
  if pid is null then raise exception 'Owner not found.' using errcode = '22023'; end if;
  if not (public.is_admin()
          or (public.app_role() = 'management' and pid = public.app_partner()
              and public.app_may_reach_contact(p_agency_id, p_branch_id, pid))) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  insert into public.agent_contacts(agency_id, branch_id, name, email, phone, contact_role, is_primary, created_by)
  values (p_agency_id, p_branch_id, btrim(coalesce(p_name,'')), v_email, nullif(btrim(coalesce(p_phone,'')),''), nullif(btrim(coalesce(p_role,'')),''), coalesce(p_primary,false), me)
  returning id into new_id;
  return new_id;
end $function$;

CREATE OR REPLACE FUNCTION public.org_update_contact(p_id uuid, p_name text, p_role text, p_email text, p_phone text, p_primary boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pid uuid; a_id uuid; b_id uuid; v_email text := btrim(coalesce(p_email,'')); has_primary boolean;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select partner_id, agency_id, branch_id into pid, a_id, b_id from public.agent_contacts where id = p_id;
  if pid is null then raise exception 'Contact not found.' using errcode = '22023'; end if;
  if not (public.is_admin()
          or (public.app_role() = 'management' and pid = public.app_partner()
              and public.app_may_reach_contact(a_id, b_id, pid))) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  if v_email = '' then raise exception 'A contact email is required.' using errcode = '22023'; end if;
  if v_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Enter a valid contact email.' using errcode = '22023';
  end if;
  update public.agent_contacts
    set name = btrim(coalesce(p_name,'')), email = v_email, phone = nullif(btrim(coalesce(p_phone,'')),''),
        contact_role = nullif(btrim(coalesce(p_role,'')),''), is_primary = coalesce(p_primary,false)
    where id = p_id;
  select exists (select 1 from public.agent_contacts
    where ((a_id is not null and agency_id = a_id) or (b_id is not null and branch_id = b_id)) and is_primary) into has_primary;
  if not has_primary then
    update public.agent_contacts set is_primary = true where id = (
      select id from public.agent_contacts
      where (a_id is not null and agency_id = a_id) or (b_id is not null and branch_id = b_id)
      order by created_at asc, id asc limit 1);
  end if;
end $function$;

create or replace function public.org_set_primary_contact(p_id uuid)
returns void language plpgsql security definer set search_path to ''
as $function$
declare pid uuid; a_id uuid; b_id uuid;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select partner_id, agency_id, branch_id into pid, a_id, b_id
    from public.agent_contacts where id = p_id;
  if pid is null then raise exception 'Contact not found.' using errcode = '22023'; end if;
  if not (public.is_admin()
          or (public.app_role() = 'management' and pid = public.app_partner()
              and public.app_may_reach_contact(a_id, b_id, pid))) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  -- Single-row update; agent_contacts_maintain_primary demotes the old primary.
  update public.agent_contacts set is_primary = true where id = p_id;
end $function$;

create or replace function public.org_remove_contact(p_id uuid)
returns void language plpgsql security definer set search_path to ''
as $function$
declare pid uuid; a_id uuid; b_id uuid; n int;
begin
  if not public.is_aal2() then raise exception 'MFA required' using errcode = '42501'; end if;
  select partner_id, agency_id, branch_id into pid, a_id, b_id
    from public.agent_contacts where id = p_id;
  if pid is null then raise exception 'Contact not found.' using errcode = '22023'; end if;
  if not (public.is_admin()
          or (public.app_role() = 'management' and pid = public.app_partner()
              and public.app_may_reach_contact(a_id, b_id, pid))) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  if a_id is not null then
    select count(*) into n from public.agent_contacts where agency_id = a_id;
    if n <= 1 then
      raise exception 'This is the agency''s only contact. Add a replacement contact before removing it.' using errcode = '22023';
    end if;
  end if;
  -- agent_contacts_promote_on_delete promotes the oldest remaining if the
  -- deleted contact was the owner's primary.
  delete from public.agent_contacts where id = p_id;
end $function$;

-- ===========================================================================
-- 6. ATTACH AND DETACH DID NOT ASK THE LADDER
-- ===========================================================================
-- Both test containment (user_within_caller_scope) and neither tests
-- SENIORITY, so a Manager could attach or detach a Director sitting in their
-- own agency. Every other person-control on this estate calls
-- assert_may_act_on_user; these two were written before it existed.
create or replace function public.detach_user_from_agency(p_user uuid, p_agency uuid)
returns void language plpgsql security definer set search_path to ''
as $function$
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
  perform public.assert_may_act_on_user(p_user);

  -- The trigger recomputes user_attached for the pair and deletes the
  -- relationship row when nothing else holds it up.
  delete from public.user_agency_attachments where user_id = p_user and agency_id = p_agency;
end $function$;

-- ===========================================================================
-- 7. A GROUP YOU DO NOT REACH
-- ===========================================================================
-- set_agency_group tests that you reach the AGENCY and that the group is on
-- the same partner. It never tests that you reach the GROUP, so a manager
-- could file their own agency under a competitor's brand group -- which on
-- this rail is how an agency joins somebody else's reporting and rate tier.
create or replace function public.set_agency_group(p_agency uuid, p_group uuid)
returns void language plpgsql security definer set search_path to ''
as $function$
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

    -- THE MISSING TEST, and the only line added to this function.
    if not (public.is_admin() or public.app_reachable_group(p_group, g_pid)) then
      raise exception 'You can only file an agency under a group you hold.' using errcode = '42501';
    end if;

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
end $function$;

-- ===========================================================================
-- 8. THE ELIGIBILITY WIDENER
-- ===========================================================================
-- viewer_runs_eligibility_journey decides whether the reader's estate runs
-- the eligibility journey, and its last arm is `else a.partner_id =
-- app_partner()`: on the house route, every agency we have onboarded. It
-- answers a boolean, so it leaks a bit rather than a list -- but it is the
-- bit that decides which journey a referral takes, read across the route.
create or replace function public.viewer_runs_eligibility_journey(p_partner_slug text default null)
returns boolean
language sql stable security definer set search_path to ''
as $function$
  with reachable as (
    select a.id, a.referencing_mode, p.referencing_mode as partner_mode
    from public.agencies a
    join public.partners p on p.id = a.partner_id
    where
      case
        when public.is_admin()
          then p_partner_slug is null or p.slug = p_partner_slug
        -- OUR ESTATE: the agencies the reader's positions actually reach.
        when public.is_our_estate_partner(a.partner_id)
          then a.id in (select public.app_scoped_agencies())
        -- THE SUPPLIER RAIL: the partner is the company. WAS the `else` arm,
        -- which on the house route meant every agency on it.
        when not public.is_our_estate_partner(a.partner_id)
          then a.partner_id = public.app_partner()
        else false
      end
  )
  -- The agency's own choice wins over its partner's, exactly as
  -- resolve_referencing_mode does for a referral.
  select coalesce(
    (select bool_or(coalesce(r.referencing_mode, r.partner_mode) = 'opndoor_referenced')
       from reachable r),
    false)
$function$;

-- ===========================================================================
-- 9. THE STATEMENT NUMBER WAS MINTABLE FOR ANY PAYEE
-- ===========================================================================
-- commission_statement_ref takes a payee_key and returns -- or MINTS -- that
-- payee's statement number for a month. No reach test at all, and minting is
-- a write that consumes the next sequence number for the month, so calling it
-- for somebody else both reads their reference and moves the counter.
-- 20261006260000 scoped the commission_statement_refs TABLE to its payee and
-- left the function that writes it open.
create or replace function public.commission_statement_ref(p_month text, p_payee_key text)
returns text language plpgsql security definer set search_path to ''
as $function$
declare v_seq int; v_try int := 0; v_kind text; v_id uuid;
begin
  if p_month !~ '^\d{4}-\d{2}$' then
    raise exception 'A statement month is YYYY-MM.' using errcode = '22023';
  end if;

  -- A payee key is '<kind>:<uuid>'. Whoever is asking must reach that party.
  v_kind := split_part(p_payee_key, ':', 1);
  begin
    v_id := nullif(split_part(p_payee_key, ':', 2), '')::uuid;
  exception when others then
    raise exception 'That is not a payee.' using errcode = '22023';
  end;
  if not (public.is_admin() or public.app_role() = 'opndoor_manager' or (
            case v_kind
              when 'group'  then public.app_reachable_group(v_id, public.app_partner())
              when 'agency' then public.app_may_reach_agency(v_id)
              when 'branch' then public.app_may_reach_branch(v_id)
              when 'user'   then public.app_may_reach_user(v_id)
              else false
            end)) then
    raise exception 'You can only read a statement for a party you hold.' using errcode = '42501';
  end if;

  loop
    select seq into v_seq from public.commission_statement_refs
     where statement_month = p_month and payee_key = p_payee_key;
    if found then
      return 'STMT-' || p_month || '-' || lpad(v_seq::text, 4, '0');
    end if;

    begin
      insert into public.commission_statement_refs (statement_month, payee_key, seq)
      select p_month, p_payee_key,
             coalesce((select max(r.seq) from public.commission_statement_refs r
                        where r.statement_month = p_month), 0) + 1;
      -- Fall through to the select at the top of the next turn, so the answer
      -- always comes from the stored row rather than from what we just tried.
    exception when unique_violation then
      -- Somebody else took that number between our max() and our insert.
      v_try := v_try + 1;
      if v_try > 20 then raise; end if;
    end;
  end loop;
end $function$;

-- ===========================================================================
-- 10. TWO LEVEL READERS, OPEN TO ANY UUID
-- ===========================================================================
-- level_rank_of and agency_level_of answer "how senior is this person" for
-- any uuid, and both are granted to authenticated because users_mgmt_update
-- calls level_rank_of inside the policy. A rank is a small thing to leak, but
-- it is leaked for a person on another agency, and it is the reconnaissance
-- for every ladder decision above.
--
-- The reach test costs the policy nothing: users_mgmt_update only evaluates
-- this for rows it has already narrowed with user_within_caller_scope.
--
-- `auth.uid() is null` FIRST, and it is not decoration. These are called from
-- cron bodies, from pgTAP and from service_role edge functions, none of which
-- has a JWT -- and app_may_reach_user answers false for all of them, so the
-- gate without this arm turns every internal rank lookup into NULL. The
-- level-ladder suite said so immediately: "a Director ranks 1" came back null.
-- A definer function cannot use `current_user` for this, because inside one
-- current_user is the OWNER; that mistake is what made the first home-branch
-- guard pass everybody.
create or replace function public.level_rank_of(p_user uuid)
returns integer
language sql stable security definer set search_path to ''
as $function$
  select case
           when u.role in ('superadmin','opndoor_manager') then 0
           when u.role = 'management' and u.sees_commission then 1
           when u.role = 'management' then 2
           when u.role in ('referrer','developer') then 3
         end
    from public.users u
   where u.id = p_user
     and (auth.uid() is null or u.id = auth.uid() or public.app_may_reach_user(u.id))
$function$;

create or replace function public.agency_level_of(p_user uuid)
returns text
language sql stable security definer set search_path to ''
as $function$
  select case
           when u.role = 'management' and u.sees_commission then 'Director'
           when u.role = 'management' then 'Manager'
           when u.role = 'referrer' then 'Negotiator'
         end
    from public.users u
   where u.id = p_user
     and (auth.uid() is null or u.id = auth.uid() or public.app_may_reach_user(u.id))
$function$;
