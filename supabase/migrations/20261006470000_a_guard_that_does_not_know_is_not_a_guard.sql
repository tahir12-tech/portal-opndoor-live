-- A GUARD THAT DOES NOT KNOW IS NOT A GUARD.
--
-- Found while asserting M9. A Regent Negotiator was allowed to read the
-- journey of a DIRECT application -- another company's tenant -- and to mint a
-- 90-day payment-page token for it. Measured on dev, not reasoned about:
--
--   a direct application with no referrer    GR-20626
--   a Negotiator reads its journey           ALLOWED
--   and mints a 90-day payment token for it  384250ed-2f5b-41f9-9d92-16b7a4233527
--
-- The gate was written the way every gate in this schema is written:
--
--   if not (public.is_admin()
--        or (public.app_role() = 'referrer' and a.referrer_id = auth.uid())
--        or (public.app_role() = 'management' and ...)) then
--     raise exception 'not permitted' using errcode = '42501';
--
-- applications.referrer_id is nullable: a direct tenant has no referrer, and
-- neither does an API application with no human sender. So for a Negotiator
-- reading one, the second arm is `true and NULL` = NULL, the OR of false and
-- NULL is NULL, `not NULL` is NULL, and IN PLPGSQL AN `if NULL then` DOES NOT
-- FIRE. The guard evaluates to "I do not know" and the function reads that as
-- "carry on".
--
-- This is the same three-valued logic that produced the inverted guard in
-- 20261006440000, arriving from the other direction. There it was an operator
-- precedence slip in one function. Here it is the shape of every authorisation
-- guard in the schema, and nothing in the language makes it visible: the
-- expression is correct SQL, reads correctly in English, and is wrong only
-- when a column happens to be NULL.
--
-- SO THIS DOES NOT PATCH THE NINE. Patching `a.referrer_id = auth.uid()`
-- closes one NULL source and leaves the others: `a.partner_id =
-- public.app_partner()` is NULL for any caller whose users row has no partner,
-- and `public.app_role() = 'management'` is NULL for a caller with no users
-- row at all. Measured:
--
--   public.is_aal2()            never null
--   public.is_admin()           never null
--   public.is_opndoor_staff()   never null
--   public.app_has_scope()      never null
--   public.may_see_commission() never null
--   public.app_role()           NULL with no claims
--   public.app_partner()        NULL with no claims
--
-- Every raising `if not <cond> then` guard in public is therefore wrapped in
-- coalesce(<cond>, false) -- all 205 of them, in 89 functions, including the
-- ones whose condition is provably total today. Wrapping only the exposed ones
-- would need a judgement per guard, and would silently reopen the day somebody
-- drops a NOT NULL. Wrapping all of them makes the rule checkable without an
-- allowlist, which is what src/data/guardsAreNullSafe.test.ts now enforces
-- over the migration files.
--
-- coalesce(X, false) can only ever turn "I do not know" into "refuse". For a
-- guard that is the conservative direction, and the_work_still_works.test.sql
-- is what proves the refusals did not land on legitimate work.
--
-- HOW THESE BODIES WERE PRODUCED. Not by hand and not by replace(). Every
-- definition below is pg_get_functiondef output with the condition of each
-- guard wrapped by a parenthesis-matching scan that ignores comments and
-- string literals, and each one is emitted only after a proof that DELETING
-- the inserted `coalesce(` and `, false)` recovers the original byte for byte.
-- If the only difference is the wrap, no other token moved, and unlike a bare
-- splice `coalesce(...)` cannot re-associate the operators around it.
--
-- TWO MORE, of a different shape. The deny-if guards (`if <cond> then raise`)
-- were audited the same way: 54 of them, and all but one are already total,
-- using `is distinct from`, `is null` or coalesce, or comparing columns that
-- are NOT NULL (applications.status, users.status, users.role,
-- tenant_invites.email, applicants.email were each checked in the catalogue).
-- The exception is set_home_branch, where `public.app_role() <> 'management'`
-- is NULL for a caller with no users row, so the role check does not fire.
--
-- And `owned := a.referrer_id = auth.uid()` is itself wrapped in the seven
-- functions that compute it, because `owned` is passed on to can_send_deed()
-- and can_amend_tenancy_start(), and a NULL argument would carry the same
-- three-valued logic into a second function's decision.

-- add_application_note(text,text): 3 guards, owned
CREATE OR REPLACE FUNCTION public.add_application_note(p_ref text, p_body text)
 RETURNS app_notes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications; r text; owned boolean; b text; n public.app_notes;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where guarantee_ref = p_ref;
  if not coalesce(found, false) then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := coalesce(a.referrer_id = auth.uid(), false);
  if not coalesce((public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and public.app_may_reach_branch(a.branch_id))
          or (r = 'referrer' and owned)), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  b := btrim(coalesce(p_body, ''));
  if b = '' then raise exception 'A note cannot be empty.' using errcode = '22023'; end if;
  insert into public.app_notes(application_id, body, author, author_id)
  values (a.id, left(b, 2000), (select full_name from public.users where id = auth.uid()), auth.uid())
  returning * into n;
  return n;
end $function$;

-- admin_add_agency(text,text,text,text,text,text): 2 guards
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
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  /* ON OUR OWN ESTATE, CREATING AN AGENCY IS OPNDOOR'S ACT. The house partner
     is shared, so a Manager creating an agency on it is creating a sibling
     beside their own, not adding to their own book. A SUPPLIER's manager
     still creates agencies under their own partner, which is their book. */
  if not coalesce((v_admin or (public.app_role() = 'management'
                      and not public.is_our_estate_partner(public.app_partner()))), false) then raise exception 'Not permitted.' using errcode = '42501'; end if;
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
end $function$;

-- admin_add_branch(uuid,text,text,text,text,text): 2 guards
CREATE OR REPLACE FUNCTION public.admin_add_branch(p_agency_id uuid, p_name text, p_area text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text, p_contact_name text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := auth.uid(); who text; pid uuid; br_id uuid; v_admin boolean := public.is_admin(); v_email text := btrim(coalesce(p_contact_email,''));
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if btrim(coalesce(p_name,'')) = '' then raise exception 'Branch name is required' using errcode = '22023'; end if;
  select partner_id into pid from public.agencies where id = p_agency_id;
  if pid is null then raise exception 'Agency not found.' using errcode = '22023'; end if;
  if not coalesce((v_admin or (public.app_role() = 'management' and pid = public.app_partner()
                      and public.app_may_reach_agency(p_agency_id))), false) then
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
end $function$;

-- admin_break_glass_revoke_key(text,text): 2 guards
CREATE OR REPLACE FUNCTION public.admin_break_glass_revoke_key(p_key_prefix text, p_reason text)
 RETURNS TABLE(revoked boolean, partner_name text, key_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare k record; v_actor uuid := auth.uid(); v_who text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;

  if btrim(coalesce(p_reason,'')) = '' or length(btrim(p_reason)) < 10 then
    raise exception 'Give a reason. It is recorded against your name and read during an incident review.'
      using errcode = '22023';
  end if;

  select key.id, key.name, key.partner_id, key.revoked_at, p.name as pname
    into k
  from public.partner_api_keys key
  join public.partners p on p.id = key.partner_id
  where key.key_prefix = btrim(p_key_prefix);

  v_who := coalesce((select full_name from public.users where id = v_actor), 'an opndoor admin');

  if k.id is null then
    -- Recorded too. An admin fishing for valid prefixes is exactly the thing
    -- this table exists to surface, and a miss is as interesting as a hit.
    perform public.record_security_event(
      'break_glass_revoke_miss', 'warn', null, v_actor, null, null,
      format('%s attempted a break-glass revoke on prefix %s, which matched no key. Reason given: %s',
             v_who, left(btrim(p_key_prefix), 18), left(btrim(p_reason), 200)));
    return query select false, null::text, null::text;
    return;
  end if;

  if k.revoked_at is not null then
    return query select false, k.pname, k.name;
    return;
  end if;

  update public.partner_api_keys set revoked_at = now() where id = k.id;

  -- Named, deliberately and permanently. "Who could have done this" should have
  -- a one-name answer, and the whole reason admin lost the panels is that it
  -- previously did not.
  perform public.record_security_event(
    'break_glass_revoke', 'critical', k.partner_id, v_actor, k.id, null,
    format('%s revoked key "%s" (%s) for %s. Reason: %s',
           v_who, k.name, left(btrim(p_key_prefix), 18), k.pname, left(btrim(p_reason), 300)));

  return query select true, k.pname, k.name;
end $function$;

-- admin_cancel_invite(uuid): 3 guards
CREATE OR REPLACE FUNCTION public.admin_cancel_invite(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur public.users; me uuid := auth.uid(); who text; em text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into cur from public.users where id = p_user;
  if not coalesce(found, false) then raise exception 'user not found'; end if;
  if cur.status <> 'pending' then raise exception 'Only a pending invite can be cancelled' using errcode = '42501'; end if;
  if not coalesce((public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and public.app_may_reach_user(cur.id))), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform public.assert_may_act_on_user(p_user);

  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  em := cur.email;
  insert into public.user_audit(target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'invite_cancelled', em, null, who, me);

  delete from auth.users where id = p_user;
end $function$;

-- admin_create_agency_and_branch(text,text,text,numeric,numeric,text,uuid): 2 guards
CREATE OR REPLACE FUNCTION public.admin_create_agency_and_branch(p_agency_name text, p_branch_name text DEFAULT NULL::text, p_branch_area text DEFAULT NULL::text, p_partner_rate numeric DEFAULT NULL::numeric, p_agent_rate numeric DEFAULT NULL::numeric, p_partner_slug text DEFAULT 'opndoor-agents'::text, p_group_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(agency_id uuid, branch_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_partner uuid; v_agency uuid; v_branch uuid;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  if coalesce(btrim(p_agency_name), '') = '' then raise exception 'An agency name is required.' using errcode = '22023'; end if;

  select id into v_partner from public.partners where slug = coalesce(nullif(btrim(p_partner_slug), ''), 'opndoor-agents');
  if v_partner is null then raise exception 'Partner not found.' using errcode = '22023'; end if;

  if p_group_id is not null and not exists (
    select 1 from public.agency_groups g where g.id = p_group_id and g.partner_id = v_partner
  ) then
    raise exception 'That group is not under this partner.' using errcode = '22023';
  end if;

  insert into public.agencies (partner_id, name, review_state, partner_rate, agent_rate, group_id)
  values (v_partner, btrim(p_agency_name), 'confirmed', p_partner_rate, p_agent_rate, p_group_id)
  returning id into v_agency;

  -- Optional: a skeleton agency waits for its manager to add branches.
  if coalesce(btrim(p_branch_name), '') <> '' then
    insert into public.branches (agency_id, partner_id, name, area, review_state)
    values (v_agency, v_partner, btrim(p_branch_name), nullif(btrim(coalesce(p_branch_area, '')), ''), 'confirmed')
    returning id into v_branch;
  end if;

  return query select v_agency, v_branch;
end $function$;

-- admin_delete_org_shape(uuid[],uuid): 2 guards
CREATE OR REPLACE FUNCTION public.admin_delete_org_shape(p_agency_ids uuid[], p_group_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(agencies_removed integer, group_removed boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_apps int; v_ag int; v_grp boolean := false;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;

  select count(*) into v_apps
  from public.applications a
  where a.agency_id = any(coalesce(p_agency_ids, '{}'::uuid[]));
  if v_apps > 0 then
    raise exception 'REFUSING: % application(s) already exist against these agencies.', v_apps
      using errcode = '22023';
  end if;

  with gone as (
    delete from public.agencies
     where id = any(coalesce(p_agency_ids, '{}'::uuid[]))
    returning id
  )
  select count(*) into v_ag from gone;

  -- The group goes only if nothing else was moved into it meanwhile.
  if p_group_id is not null
     and not exists (select 1 from public.agencies a where a.group_id = p_group_id) then
    delete from public.agency_groups where id = p_group_id;
    v_grp := true;
  end if;

  return query select v_ag, v_grp;
end $function$;

-- admin_reset_user_mfa(uuid): 2 guards
CREATE OR REPLACE FUNCTION public.admin_reset_user_mfa(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur public.users; who text; me uuid := auth.uid();
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into cur from public.users where id = p_user;
  if cur.id is null then raise exception 'User not found' using errcode = '22023'; end if;
  if not coalesce((public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and public.app_may_reach_user(cur.id))), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform public.assert_may_act_on_user(p_user);
  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  delete from auth.mfa_factors where user_id = p_user;
  delete from auth.sessions where user_id = p_user;
  insert into public.user_audit(target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'reset_mfa', 'enrolled', 'reset', who, me);
end $function$;

-- admin_set_user_status(uuid,text): 2 guards
CREATE OR REPLACE FUNCTION public.admin_set_user_status(p_user uuid, p_status text)
 RETURNS users
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur public.users; res public.users; who text; me uuid := auth.uid(); old_status text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_status not in ('active','deactivated') then raise exception 'Invalid status' using errcode = '22023'; end if;
  select * into cur from public.users where id = p_user;
  if cur.id is null then raise exception 'User not found' using errcode = '22023'; end if;
  if not coalesce((public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and public.app_may_reach_user(cur.id))), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform public.assert_may_act_on_user(p_user);
  -- Kept even though the ladder already refuses self: this message says the actual
  -- reason, and an admin (whom the ladder exempts) still must not lock themselves out.
  if p_status = 'deactivated' and p_user = me then
    raise exception 'You cannot deactivate your own account.' using errcode = '42501';
  end if;
  -- An invitation is not an account yet. Activating one would let somebody in with
  -- no password ever set; the invite is cancelled or resent, never activated.
  if cur.status = 'pending' then
    raise exception 'That invitation has not been accepted yet, so it cannot be activated or deactivated. Resend or cancel it instead.' using errcode = '42501';
  end if;
  if p_status = 'deactivated' and cur.role = 'superadmin'
     and (select count(*) from public.users where role = 'superadmin' and status = 'active') <= 1 then
    raise exception 'At least one active opndoor admin must remain.' using errcode = '42501';
  end if;
  old_status := cur.status;
  if old_status = p_status then return cur; end if;
  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  update public.users set status = p_status where id = p_user returning * into res;
  if p_status = 'deactivated' then
    update auth.users set banned_until = 'infinity' where id = p_user;
    delete from auth.sessions where user_id = p_user;
  else
    update auth.users set banned_until = null where id = p_user;
  end if;
  insert into public.user_audit(target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'status', old_status, p_status, who, me);
  return res;
end $function$;

-- admin_update_user_name(uuid,text): 2 guards
CREATE OR REPLACE FUNCTION public.admin_update_user_name(p_user uuid, p_full_name text)
 RETURNS users
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur public.users; res public.users; who text; me uuid := auth.uid(); v_name text := btrim(coalesce(p_full_name,''));
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if v_name = '' then raise exception 'A name is required.' using errcode = '22023'; end if;
  if length(v_name) > 120 then raise exception 'That name is too long.' using errcode = '22023'; end if;
  select * into cur from public.users where id = p_user;
  if cur.id is null then raise exception 'User not found' using errcode = '22023'; end if;
  if not coalesce((public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and public.app_may_reach_user(cur.id))), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_user <> me then perform public.assert_may_act_on_user(p_user); end if;
  if cur.full_name = v_name then return cur; end if;
  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  update public.users set full_name = v_name where id = p_user returning * into res;
  insert into public.user_audit(target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'name', cur.full_name, v_name, who, me);
  return res;
end $function$;

-- admin_update_user_role(uuid,text): 4 guards
CREATE OR REPLACE FUNCTION public.admin_update_user_role(p_user uuid, p_role text)
 RETURNS users
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur public.users; res public.users; who text; me uuid := auth.uid();
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
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
  if not coalesce((public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and public.app_may_reach_user(cur.id))), false) then
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
  if not coalesce(public.is_admin(), false) then
    if not coalesce(exists (select 1 from public.user_scopes s
                    where s.user_id = me and s.kind in ('group','agency')), false) then
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

-- agency_branches_for_match(uuid): 1 guard
CREATE OR REPLACE FUNCTION public.agency_branches_for_match(p_agency uuid)
 RETURNS TABLE(branch_id uuid, name text, area text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not coalesce(public.is_opndoor_staff(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  return query
    select b.id, b.name, b.area
      from public.branches b
     where b.agency_id = p_agency
       and not b.is_placeholder
       and b.livemode
     order by b.name;
end $function$;

-- agency_match_queue(): 2 guards
CREATE OR REPLACE FUNCTION public.agency_match_queue()
 RETURNS TABLE(application_id uuid, guarantee_ref text, tenant_name text, property text, typed_name text, auto_agency_id uuid, auto_agency_name text, candidates jsonb, state text, matched_by text, resolved_branch_name text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- TWO STATEMENTS, as resolve_agency_match and dismiss_agency_match have
  -- always had. They were collapsed into one by a string substitution, and
  -- `not A and B` is `(not A) and B`, so the refusal fired only for a
  -- non-staff caller WHO HAD stepped up, and let every password-only session
  -- straight through.
  if not coalesce(public.is_opndoor_staff(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
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

-- agent_rail_funnel(text): 3 guards
CREATE OR REPLACE FUNCTION public.agent_rail_funnel(p_slug text DEFAULT NULL::text)
 RETURNS TABLE(invited integer, registered integer, details integer, fee integer, documents integer, submitted integer, approved integer, declined integer, guarantee integer, deed integer, stuck_invited integer, stuck_fee integer, stuck_referencing integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pid uuid;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_slug is not null then
    if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
    select id into pid from public.partners where slug = p_slug;
  else
    pid := public.app_partner();
  end if;
  if pid is null then return; end if;
  if not coalesce(public.is_admin() and not (public.app_role() = 'management' and pid = public.app_partner()), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return query
  with base as (
    select
      a.status,
      a.branch_id,
      (a.applicant_id is not null) as is_registered,
      (coalesce(btrim(a.prop_addr1),'') <> '' and coalesce(a.monthly_rent,0) > 0 and a.tenancy_start is not null) as prop_done,
      exists (select 1 from public.application_profiles pr where pr.application_id = a.id and pr.nationality is not null) as about_done,
      exists (select 1 from public.application_eligibility_payments ep where ep.application_id = a.id and ep.paid_at is not null) as fee_done,
      exists (select 1 from public.application_documents d where d.application_id = a.id and d.kind = 'id_document') as id_done,
      (exists (select 1 from public.application_documents d where d.application_id = a.id and d.kind = 'bank_connection')
        or (select count(*) from public.application_documents d where d.application_id = a.id and d.kind = 'bank_statement') >= 3) as fin_done,
      (select max(ti.created_at) from public.tenant_invites ti where ti.application_id = a.id) as invited_at,
      (select pr.completed_at from public.application_profiles pr where pr.application_id = a.id) as submitted_at
    from public.applications a
    where a.livemode and a.partner_id = pid
      and a.referencing_mode = 'opndoor_referenced'
      and (public.is_admin()
           or (public.app_role() = 'management'
               and public.app_may_reach_branch(a.branch_id)))
  )
  select
    count(*)::int,
    count(*) filter (where is_registered)::int,
    count(*) filter (where is_registered and prop_done and about_done)::int,
    count(*) filter (where fee_done)::int,
    count(*) filter (where id_done and fin_done)::int,
    count(*) filter (where status in ('referencing','sent','paid','deed','declined'))::int,
    count(*) filter (where status in ('sent','paid','deed'))::int,
    count(*) filter (where status = 'declined')::int,
    count(*) filter (where status in ('paid','deed'))::int,
    count(*) filter (where status = 'deed')::int,
    count(*) filter (where status = 'draft' and not is_registered and invited_at < now() - interval '7 days')::int,
    count(*) filter (where status = 'draft' and is_registered and not fee_done and invited_at < now() - interval '7 days')::int,
    count(*) filter (where status = 'referencing' and submitted_at < now() - interval '7 days')::int
  from base;
end $function$;

-- amend_tenancy_start(uuid,date): 4 guards, owned
CREATE OR REPLACE FUNCTION public.amend_tenancy_start(p_app uuid, p_new_start date)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications; r text; owned boolean;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_new_start is null then raise exception 'A new tenancy start date is required' using errcode = '22023'; end if;
  if p_new_start < date '2000-01-01' or p_new_start > (current_date + interval '5 years')::date then
    raise exception 'Tenancy start date is out of range' using errcode = '22023';
  end if;
  select * into a from public.applications where id = p_app;
  if not coalesce(found, false) then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := coalesce(a.referrer_id = auth.uid(), false);
  if not coalesce((public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and public.app_may_reach_branch(a.branch_id))
          or (r = 'referrer'   and owned)), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if not coalesce(public.can_amend_tenancy_start(r, a.status, owned, a.deed_state), false) then
    raise exception 'amend not permitted for this role and status' using errcode = '42501';
  end if;
  -- Date only. expiry_date is generated from tenancy_start; the deed lifecycle is
  -- handled by the amend-tenancy-start Edge Function, not here.
  update public.applications set tenancy_start = p_new_start where id = p_app returning * into a;
  return a;
end $function$;

-- application_journey(text): 1 guard
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
  if not coalesce((public.is_admin()
    or (public.app_role() = 'referrer'  and a.referrer_id = auth.uid())
    or (public.app_role() = 'developer' and a.partner_id = public.app_partner()
          -- The same agency predicate its four dev_* siblings were given in
          -- 20261006410000. On the house route the partner is every agency.
          and public.app_may_reach_application_org(a.partner_id, a.agency_id, a.branch_id))
    or (public.app_role() = 'management' and a.partner_id = public.app_partner()
        and public.app_may_reach_branch(a.branch_id))), false) then
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

-- apply_stripe_payment(uuid,text,numeric,text): 1 guard
CREATE OR REPLACE FUNCTION public.apply_stripe_payment(p_application_id uuid, p_payment_intent text, p_amount numeric, p_session_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications;
begin
  select * into a from public.applications where id = p_application_id;
  if not coalesce(found, false) then raise exception 'application not found'; end if;
  if a.status = 'sent' then
    update public.applications set
      status = 'paid', paid_at = coalesce(paid_at, now()),
      stripe_payment_intent_id   = coalesce(p_payment_intent, stripe_payment_intent_id),
      stripe_checkout_session_id = coalesce(p_session_id, stripe_checkout_session_id),
      paid_amount   = coalesce(p_amount, paid_amount), payment_state = 'paid'
    where id = p_application_id;
  elsif a.status = 'expired' or (a.status = 'withdrawn' and a.withdrawn_by_tenant) then
    -- Late money wins: reinstate the closed application to Paid.
    update public.applications set
      status = 'paid', paid_at = coalesce(paid_at, now()),
      stripe_payment_intent_id   = coalesce(p_payment_intent, stripe_payment_intent_id),
      stripe_checkout_session_id = coalesce(p_session_id, stripe_checkout_session_id),
      paid_amount   = coalesce(p_amount, paid_amount), payment_state = 'paid',
      -- THE FIX. The row now describes what it is rather than what it was.
      --
      -- withdrawn_by_tenant resets to FALSE, not null: it is not nullable, and
      -- false is the correct reading of "this application was not withdrawn by
      -- the tenant" once it is no longer withdrawn at all.
      expired_at          = null,
      withdrawn_at        = null,
      withdrawn_reason    = null,
      withdrawn_note      = null,
      withdrawn_by        = null,
      withdrawn_by_tenant = false
    where id = p_application_id;
    insert into public.activity_log(application_id, kind, message, actor, visibility)
    values (p_application_id, 'payment_reinstated',
      'Guarantor fee paid after ' || a.status || '; application reinstated to Paid.', 'System', 'business');
  elsif a.status = 'withdrawn' then
    -- Staff withdrawal: record the intent but do NOT flip to paid; flag for refund.
    update public.applications set
      stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent),
      stripe_checkout_session_id = coalesce(stripe_checkout_session_id, p_session_id)
    where id = p_application_id;
    insert into public.activity_log(application_id, kind, message, actor, visibility)
    values (p_application_id, 'payment_anomaly',
      'Guarantor fee paid on a WITHDRAWN application. Review and refund required.', 'System', 'business');
  else
    update public.applications set
      stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent),
      paid_amount   = coalesce(paid_amount, p_amount),
      payment_state = coalesce(payment_state, 'paid')
    where id = p_application_id;
  end if;
end $function$;

-- assert_may_act_on_user(uuid): 2 guards
CREATE OR REPLACE FUNCTION public.assert_may_act_on_user(p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_caller int; v_target int;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  -- Opndoor staff sit above all three levels and manage their own team, so the
  -- ladder does not judge them. The guards that already exist for them are
  -- untouched and still apply: at least one active admin must remain, you cannot
  -- change your own role, an admin cannot be reassigned to a partner role.
  if public.is_opndoor_staff() then return; end if;

  v_caller := public.level_rank_of(auth.uid());
  if v_caller is null then
    raise exception 'Your account has no agency level, so it cannot act on people.' using errcode = '42501';
  end if;

  if not coalesce(exists (select 1 from public.users where id = p_user), false) then
    raise exception 'No such person.' using errcode = '22023';
  end if;

  -- Self is AT your own level, so the rule refuses it. Editing your own NAME is
  -- the documented exception and is handled at that one call site, not here:
  -- admin_update_user_name asks this only when the target is somebody else.
  if p_user = auth.uid() then
    raise exception 'You cannot do this to your own account.' using errcode = '42501';
  end if;

  v_target := public.level_rank_of(p_user);
  if v_target is null then
    raise exception 'That person has no agency level, so only opndoor may act on them.' using errcode = '42501';
  end if;

  if v_caller >= v_target then
    raise exception 'You can only do this to someone below your own level.' using errcode = '42501';
  end if;
end $function$;

-- assert_may_grant_level(text): 1 guard
CREATE OR REPLACE FUNCTION public.assert_may_grant_level(p_level text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_caller int; v_want int := public.agency_level_rank(p_level);
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if v_want is null then
    raise exception 'An agency level is Director, Manager or Negotiator.' using errcode = '22023';
  end if;
  if public.is_opndoor_staff() then return; end if;
  v_caller := public.level_rank_of(auth.uid());
  -- v_want < v_caller means the level asked for is MORE senior than the caller's.
  if v_caller is null or v_want < v_caller then
    raise exception 'You can only give someone a level at or below your own.' using errcode = '42501';
  end if;
end $function$;

-- assert_may_grant_position(text,uuid): 4 guards
CREATE OR REPLACE FUNCTION public.assert_may_grant_position(p_kind text, p_target uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if not coalesce(exists (select 1 from public.user_scopes s
                  where s.user_id = auth.uid() and s.kind in ('group','agency')), false) then
    raise exception 'Only a brand or group manager places people.' using errcode = '42501';
  end if;

  -- THE TARGET ITSELF. This is the arm that was missing, and it is the one
  -- that answers for a target with nothing under it yet.
  if p_kind = 'agency' then
    if not coalesce(public.app_may_reach_agency(p_target), false) then
      raise exception 'You can only place somebody inside your own part of the business.' using errcode = '42501';
    end if;
  elsif p_kind = 'branch' then
    if not coalesce(public.app_may_reach_branch(p_target), false) then
      raise exception 'You can only place somebody inside your own part of the business.' using errcode = '42501';
    end if;
  else
    select partner_id into v_partner from public.agency_groups where id = p_target;
    if v_partner is null then raise exception 'Group not found' using errcode = '22023'; end if;
    if not coalesce(public.app_reachable_group(p_target, v_partner), false) then
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

-- attach_user_to_agency(uuid,uuid): 4 guards
CREATE OR REPLACE FUNCTION public.attach_user_to_agency(p_user uuid, p_agency uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_target public.users; v_agency public.agencies;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  select * into v_target from public.users where id = p_user;
  if not coalesce(found, false) then raise exception 'User not found' using errcode = '22023'; end if;
  select * into v_agency from public.agencies where id = p_agency;
  if not coalesce(found, false) then raise exception 'Agency not found' using errcode = '22023'; end if;

  -- Who may attach: an opndoor admin, or a manager acting within their own
  -- partner. A branch manager cannot: attaching somebody to an agency is a
  -- statement about the whole brand, which is above their position.
  if not coalesce((
    public.is_admin()
    or (
      public.app_role() = 'management'
      and v_target.partner_id = public.app_partner()
      and public.app_may_reach_agency(p_agency)
      and public.user_within_caller_scope(p_user)
      and (
        exists (select 1 from public.user_scopes s
                    where s.user_id = auth.uid() and s.kind in ('group','agency'))
      )
    )
  ), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  insert into public.user_agency_attachments (user_id, agency_id, created_by)
  values (p_user, p_agency, auth.uid())
  on conflict (user_id, agency_id) do nothing;
end $function$;

-- authorise_password_reset(uuid): 2 guards
CREATE OR REPLACE FUNCTION public.authorise_password_reset(p_user uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur public.users; who text; me uuid := auth.uid();
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into cur from public.users where id = p_user;
  if cur.id is null then raise exception 'User not found' using errcode = '22023'; end if;
  if not coalesce((public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and public.app_may_reach_user(cur.id))), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform public.assert_may_act_on_user(p_user);
  if cur.status = 'pending' then
    raise exception 'That person has not accepted their invitation yet, so there is no password to reset. Resend the invitation instead.' using errcode = '42501';
  end if;
  who := coalesce((select full_name from public.users where id = me), 'an administrator');
  -- Audited in the same transaction as the authorisation, so a link that was minted
  -- always has a row and a row always means a link was authorised.
  insert into public.user_audit(target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'password_reset_sent', null, cur.email, who, me);
  return cur.email;
end $function$;

-- claim_tenant_invite(uuid,uuid): 2 guards
CREATE OR REPLACE FUNCTION public.claim_tenant_invite(p_token uuid, p_applicant uuid)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inv public.tenant_invites; ap public.applicants; a public.applications;
begin
  select * into inv from public.tenant_invites where token = p_token;
  if not coalesce(found, false) then raise exception 'This link is not valid.' using errcode = '22023'; end if;
  if inv.expires_at < now() then raise exception 'This link has expired.' using errcode = '22023'; end if;

  select * into ap from public.applicants where id = p_applicant;
  if not coalesce(found, false) then raise exception 'Account not found.' using errcode = '22023'; end if;

  -- The address must match. Otherwise a forwarded email hands somebody else's
  -- application, with their name, address and income on it, to whoever opened it.
  if lower(btrim(ap.email)) <> lower(btrim(inv.email)) then
    raise exception 'This link was sent to a different email address.' using errcode = '42501';
  end if;

  -- Already claimed BY THIS ACCOUNT is a resume, not an error: the tenant
  -- clicking the same link from a second device must land in their form.
  if inv.claimed_at is not null and inv.claimed_by is distinct from p_applicant then
    raise exception 'This link has already been used.' using errcode = '42501';
  end if;

  update public.applications set applicant_id = p_applicant
   where id = inv.application_id and applicant_id is null;

  update public.tenant_invites
     set claimed_at = coalesce(claimed_at, now()), claimed_by = p_applicant
   where token = p_token;

  select * into a from public.applications where id = inv.application_id;
  return a;
end $function$;

-- clear_awaiting_staff_send(uuid): 3 guards, owned
CREATE OR REPLACE FUNCTION public.clear_awaiting_staff_send(p_app uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications; r text; owned boolean;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where id = p_app;
  if not coalesce(found, false) then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := coalesce(a.referrer_id = auth.uid(), false);
  if not coalesce((public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and public.app_may_reach_branch(a.branch_id))
          or (r = 'referrer'   and owned)), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  update public.applications set awaiting_staff_send = false where id = p_app;
end $function$;

-- clear_branch_deed_recipient(uuid): 2 guards
CREATE OR REPLACE FUNCTION public.clear_branch_deed_recipient(p_branch uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_partner uuid;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select partner_id into v_partner from public.branches where id = p_branch;
  if v_partner is null then raise exception 'Branch not found' using errcode = '22023'; end if;
  if not coalesce((
    public.is_admin()
    or (public.app_role() = 'management'
        and v_partner = public.app_partner()
        and public.app_may_reach_branch(p_branch))
  ), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  delete from public.branch_deed_recipient where branch_id = p_branch;
end $function$;

-- commission_statement_ref(text,text): 4 guards
CREATE OR REPLACE FUNCTION public.commission_statement_ref(p_month text, p_payee_key text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_seq int; v_try int := 0;
  v_tail text; v_kind text; v_ident text; v_id uuid; v_name text;
begin
  if p_month !~ '^\d{4}-\d{2}$' then
    raise exception 'A statement month is YYYY-MM.' using errcode = '22023';
  end if;

  if public.is_admin() or public.app_role() = 'opndoor_manager' then
    -- falls through to the mint below
    null;
  else
    -- Everything after the LAST pipe, so a slug containing one cannot shift
    -- the parse.
    v_tail  := regexp_replace(coalesce(p_payee_key, ''), '^.*\|', '');
    v_kind  := split_part(v_tail, ':', 1);
    -- Everything after the FIRST colon: a name form may itself contain one.
    v_ident := substring(v_tail from position(':' in v_tail) + 1);

    if v_ident is null or v_ident = '' or v_kind = '' then
      raise exception 'That is not a payee.' using errcode = '22023';
    end if;

    if v_ident like 'name/%' then
      -- Historic: no org id was recorded, so the name is the identity. Match
      -- it against the orgs this caller actually reaches, at the right level.
      v_name := substring(v_ident from 6);
      if not coalesce(public.may_see_commission(), false) then
        raise exception 'You can only read a statement for a party you hold.' using errcode = '42501';
      end if;
      if not coalesce((
        (v_kind = 'agency' and exists (select 1 from public.agencies a
            where lower(btrim(a.name)) = v_name and public.app_may_reach_agency(a.id)))
        or (v_kind = 'branch' and exists (select 1 from public.branches b
            where lower(btrim(b.name)) = v_name and public.app_may_reach_branch(b.id)))
        or (v_kind = 'group' and exists (select 1 from public.agency_groups g
            where lower(btrim(g.name)) = v_name and public.app_reachable_group(g.id, g.partner_id)))
      ), false) then
        raise exception 'You can only read a statement for a party you hold.' using errcode = '42501';
      end if;
    else
      begin
        v_id := v_ident::uuid;
      exception when others then
        raise exception 'That is not a payee.' using errcode = '22023';
      end;
      if not coalesce(public.may_see_commission(), false) then
        raise exception 'You can only read a statement for a party you hold.' using errcode = '42501';
      end if;
      if not coalesce((case v_kind
                when 'group'  then public.app_reachable_group(v_id, (select partner_id from public.agency_groups where id = v_id))
                when 'agency' then public.app_may_reach_agency(v_id)
                when 'branch' then public.app_may_reach_branch(v_id)
                when 'user'   then public.app_may_reach_user(v_id)
                else false
              end), false) then
        raise exception 'You can only read a statement for a party you hold.' using errcode = '42501';
      end if;
    end if;
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
    exception when unique_violation then
      v_try := v_try + 1;
      if v_try > 20 then raise; end if;
    end;
  end loop;
end $function$;

-- confirm_org_entity(text,uuid): 2 guards
CREATE OR REPLACE FUNCTION public.confirm_org_entity(p_type text, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := auth.uid(); who text; nm text; ho_id uuid; ho_name text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_opndoor_staff(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
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

-- create_agency_group(text,text): 1 guard
CREATE OR REPLACE FUNCTION public.create_agency_group(p_partner_slug text, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := auth.uid(); pid uuid; gid uuid; nm text := btrim(coalesce(p_name, ''));
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
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
end $function$;

-- create_agreement(text,uuid,text,text,text,jsonb,jsonb,text,boolean,boolean): 3 guards
CREATE OR REPLACE FUNCTION public.create_agreement(p_level text, p_id uuid, p_coverage text, p_period text, p_counting_scope text, p_bands jsonb, p_tiers jsonb DEFAULT '[]'::jsonb, p_note text DEFAULT NULL::text, p_confirm_replace boolean DEFAULT false, p_confirm_breach boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid; c record; v_actor text; v_n int; b jsonb; t jsonb; v_worst numeric;
  v_detail text; v_mx numeric; r record; v_breached boolean := false;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_coverage not in ('additive','all_in') then
    raise exception 'Coverage must be additive or all-in.' using errcode = '22023';
  end if;
  if p_coverage = 'all_in' and p_level not in ('group','agency') then
    raise exception 'An all-in agreement covers everything under a group or an agency, so it cannot sit on a %.', p_level
      using errcode = '22023';
  end if;
  if jsonb_array_length(coalesce(p_bands,'[]'::jsonb)) < 1 then
    raise exception 'An agreement needs at least one tenant-count band.' using errcode = '22023';
  end if;

  select count(*) into v_n from public.agreement_conflicts(p_level, p_id, p_coverage);
  if v_n > 0 and not p_confirm_replace then
    raise exception 'This would replace % existing arrangement(s). Confirm to clear them.', v_n
      using errcode = '22023';
  end if;

  -- THE MIRROR BREACH, checked before anything is written so the refusal costs
  -- nothing. An ADDITIVE agreement above an all-in is NOT a breach and is no
  -- longer checked: it never reaches that agency's branches.
  select max((x->>'rate')::numeric) into v_mx from jsonb_array_elements(p_bands) x;
  if p_coverage = 'all_in' then
    for r in select * from public.rate_above_all_in(p_level, p_id) loop
      v_breached := true;
      v_detail := public.all_in_breach_sentence(
        r.party_name, r.rate,
        (select name from public.agencies where id = p_id), v_mx);
      if not coalesce(p_confirm_breach, false) then
        raise exception '%', v_detail using errcode = '22023';
      end if;
    end loop;
    if v_breached then perform set_config('app.confirm_all_in_breach', 'on', true); end if;
  end if;

  select full_name into v_actor from public.users where id = auth.uid();

  for c in select * from public.agreement_conflicts(p_level, p_id, p_coverage) loop
    if c.kind = 'rate' then
      insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
      values (c.level, c.node_id, 'rate_cleared_for_agreement',
              c.node_name || ' ' || c.detail || ', cleared because an agreement now prices it',
              coalesce(v_actor,'an administrator'), auth.uid());
      if c.level = 'agency'   then update public.agencies      set agent_rate = null where id = c.node_id;
      elsif c.level = 'group' then update public.agency_groups set agent_rate = null where id = c.node_id;
      else                         update public.branches      set agent_rate = null where id = c.node_id;
      end if;
    else
      insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
      values (c.level, c.node_id, 'agreement_superseded',
              coalesce(c.node_name,'A party') || ' ' || c.detail || ', ended because '
              || case when c.level = p_level and c.node_id = p_id
                      then 'a new agreement replaces it'
                      else 'an all-in agreement now covers it' end,
              coalesce(v_actor,'an administrator'), auth.uid());
      update public.pricing_agreements set ended_at = now()
       where scope_level = c.level and scope_id = c.node_id and not is_standard
         and ended_at is null;
    end if;
  end loop;

  insert into public.pricing_agreements
    (scope_level, scope_id, coverage, period, counting_scope, note, created_by, effective_from, is_standard)
  values (p_level, p_id, p_coverage, p_period, p_counting_scope, p_note, auth.uid(), current_date, false)
  returning id into v_id;

  for b in select * from jsonb_array_elements(p_bands) loop
    insert into public.pricing_agreement_bands (agreement_id, min_tenants, max_tenants, fee_basis_weeks, fee_basis_unit, agent_rate)
    values (v_id, coalesce((b->>'min')::int, 1), nullif(b->>'max','')::int,
            (b->>'weeks')::numeric,
            -- Absent means weeks, so an older client that does not send a unit
            -- writes exactly the band it always wrote.
            case when b->>'unit' = 'months' then 'months' else 'weeks' end,
            nullif(b->>'rate','')::numeric);
  end loop;
  for t in select * from jsonb_array_elements(coalesce(p_tiers,'[]'::jsonb)) loop
    insert into public.commission_tiers (agreement_id, from_count, to_count, agent_rate)
    values (v_id, (t->>'from')::int, nullif(t->>'to','')::int, (t->>'rate')::numeric);
  end loop;

  v_worst := public.assert_agreement_within_cap(v_id);

  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values (p_level, p_id, 'agreement_created',
          p_coverage || ' agreement, volume per ' || p_counting_scope || ' per ' || p_period ||
          ', worst branch total ' || to_char(round(v_worst * 100, 2), 'FM999990.00') || '%',
          coalesce(v_actor,'an administrator'), auth.uid());

  if v_breached then
    -- Against the party that signed, and against the group whose line breaches
    -- it: the ones who need to find out are both of them.
    for r in select * from public.rate_above_all_in(p_level, p_id) loop
      v_detail := public.all_in_breach_sentence(r.party_name, r.rate,
        (select name from public.agencies where id = p_id), v_mx);
      insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
      values (p_level, p_id, 'all_in_breach_confirmed', v_detail,
              coalesce(v_actor,'an administrator'), auth.uid());
      insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
      select 'group', a.group_id, 'all_in_breach_confirmed', v_detail,
             coalesce(v_actor,'an administrator'), auth.uid()
      from public.agencies a where a.id = p_id and a.group_id is not null;
    end loop;
    perform set_config('app.confirm_all_in_breach', 'off', true);
  end if;

  return v_id;
end $function$;

-- create_direct_application(uuid,numeric,date,text,text,text,text,text): 1 guard
CREATE OR REPLACE FUNCTION public.create_direct_application(p_applicant uuid, p_rent numeric DEFAULT NULL::numeric, p_tenancy_start date DEFAULT NULL::date, p_addr1 text DEFAULT NULL::text, p_addr2 text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_county text DEFAULT NULL::text, p_postcode text DEFAULT NULL::text)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ap public.applicants; v_partner uuid; v_branch uuid; v_agency uuid; a public.applications;
begin
  select * into ap from public.applicants where id = p_applicant;
  if not coalesce(found, false) then raise exception 'Applicant % not found', p_applicant using errcode = '22023'; end if;
  if ap.closed_at is not null then raise exception 'This account is closed.' using errcode = '42501'; end if;

  select id into v_partner from public.partners where slug = 'opndoor-direct';
  if v_partner is null then
    raise exception 'The direct route is not provisioned (partner slug opndoor-direct is missing)';
  end if;

  select b.id, b.agency_id into v_branch, v_agency
  from public.branches b
  join public.agencies ag on ag.id = b.agency_id
  where ag.partner_id = v_partner and b.name = 'Unattached'
  limit 1;
  if v_branch is null then raise exception 'The direct route has no house branch'; end if;

  insert into public.applications (
    guarantee_ref, branch_id, agency_id, partner_id, referrer_id, referrer_name,
    applicant_id,
    tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
    prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
    monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode,
    referencing_mode
  ) values (
    'GR-' || nextval('public.guarantee_ref_seq')::text, v_branch, v_agency, v_partner,
    null, 'Direct signup',
    p_applicant,
    ap.title, ap.first_name, ap.last_name, ap.dob, ap.email, ap.phone,
    nullif(btrim(coalesce(p_addr1, '')), ''), nullif(btrim(coalesce(p_addr2,'')), ''),
    nullif(btrim(coalesce(p_city, '')), ''), nullif(btrim(coalesce(p_county,'')), ''),
    nullif(upper(btrim(coalesce(p_postcode,''))), ''),
    coalesce(p_rent, 0), coalesce(p_tenancy_start, current_date + 30),
    'draft', now(), 0, 0, true,
    'opndoor_referenced'
  ) returning * into a;
  return a;
end $function$;

-- create_invited_user(uuid,text,text,text,uuid,uuid,boolean,text,uuid): 2 guards
CREATE OR REPLACE FUNCTION public.create_invited_user(p_id uuid, p_email text, p_full_name text, p_role text, p_partner uuid, p_home_branch uuid, p_sees_commission boolean, p_scope_kind text, p_scope_target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_estate boolean; v_level text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  select p.referencing_mode = 'opndoor_referenced' into v_estate
    from public.partners p where p.id = p_partner;
  v_estate := coalesce(v_estate, false);

  if not coalesce((public.is_admin()
          or (public.app_role() = 'management' and p_partner = public.app_partner())), false) then
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

-- create_joint_referral(uuid,jsonb,text,text,text,text,text,numeric,date): 7 guards
CREATE OR REPLACE FUNCTION public.create_joint_referral(p_branch uuid, p_tenants jsonb, p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text, p_rent numeric, p_tenancy_start date)
 RETURNS SETOF applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  ag uuid; pid uuid; v_route uuid; v_mode text; v_portal_ok boolean; v_estate boolean;
  v_n int; v_pct numeric; v_fee numeric; v_basis numeric; v_basis_unit text; v_agreement uuid;
  v_tenancy uuid; t jsonb; v_share_pct numeric;
  v_pcts numeric[]; v_fees numeric[]; v_rents numeric[]; v_emails text[]; v_i int := 0;
  v_app public.applications;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  v_n := jsonb_array_length(p_tenants);
  if v_n is null or v_n < 2 then
    raise exception 'A joint tenancy needs at least two tenants.' using errcode = '22023';
  end if;

  select b.agency_id, b.partner_id into ag, pid from public.branches b where b.id = p_branch;
  if ag is null then raise exception 'Selected branch not found' using errcode = '22023'; end if;
  if not coalesce((public.is_admin()
          or (public.app_role() in ('management','referrer') and pid = public.app_partner())), false) then
    raise exception 'not permitted for this partner' using errcode = '42501';
  end if;

  v_route := public.resolve_route_partner(p_branch, null);
  select p.portal_referrals_enabled into v_portal_ok from public.partners p where p.id = v_route;
  if not coalesce(found, false) then raise exception 'Route partner not found' using errcode = '22023'; end if;
  v_mode := public.resolve_referencing_mode(p_branch, v_route);
  v_estate := public.is_agent_estate(p_branch, v_route);

  if not coalesce(v_estate, false) then
    raise exception 'A joint tenancy needs an agency of ours to sit under, and this referral comes from a partner who sends them one tenant at a time. Refer each tenant separately.'
      using errcode = '22023';
  end if;

  if not coalesce(public.is_admin(), false) then
    if not coalesce((case when public.app_has_scope()
                 then p_branch in (select public.app_scope_branches())
                 else public.app_may_reach_branch(p_branch) end), false) then
      raise exception 'You can only refer against a branch within your own scope.' using errcode = '42501';
    end if;
  end if;
  if not coalesce(coalesce(v_portal_ok, true), false) then
    raise exception 'This partner does not create referrals in the portal.' using errcode = '42501';
  end if;

  select array_agg((x->>'share_percent')::numeric order by ord) into v_pcts
  from jsonb_array_elements(p_tenants) with ordinality as e(x, ord);
  select coalesce(sum(s), 0) into v_pct from unnest(v_pcts) s;
  if abs(v_pct - 100) > 0.01 then
    raise exception 'The tenants'' shares total %, not 100%%. Adjust them by %.',
      to_char(v_pct,'FM999990.00') || '%', to_char(100 - v_pct,'FM999990.00') || '%'
      using errcode = '22023';
  end if;

  select array_agg(lower(btrim(x->>'email'))) into v_emails from jsonb_array_elements(p_tenants) x;
  if (select count(distinct e) from unnest(v_emails) e) <> v_n then
    raise exception 'Two tenants have the same email address.' using errcode = '22023';
  end if;

  -- THE UNIT COMES OUT WITH THE QUANTITY. A basis of 1 recorded without it is
  -- one WEEK of rent, which is a quarter of what a one-month agreement charges.
  select f.fee_amount, f.fee_basis_weeks, f.fee_basis_unit, f.agreement_id
    into v_fee, v_basis, v_basis_unit, v_agreement
  from public.resolve_fee(p_branch, v_route, p_rent, v_n) f;
  v_fees  := public.apportion(v_fee, v_pcts);
  -- THE RENT, APPORTIONED THE SAME WAY AS THE FEE. Each tenant's deed covers
  -- this amount and the underwriter's premium is a percentage of it, so the
  -- parts must sum to the whole exactly, not to within a penny.
  v_rents := public.apportion(p_rent, v_pcts);

  insert into public.tenancies (monthly_rent, tenancy_start, prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode)
  values (p_rent, p_tenancy_start, btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')),''),
          btrim(p_city), nullif(btrim(coalesce(p_county,'')),''), upper(btrim(p_postcode)))
  returning id into v_tenancy;

  for t in select value from jsonb_array_elements(p_tenants) with ordinality as e(value, ord) order by ord loop
    v_i := v_i + 1;
    v_share_pct := (t->>'share_percent')::numeric;

    perform public.assert_referral_valid(
      p_branch, t->>'title', t->>'first', t->>'last', (t->>'dob')::date, t->>'email', t->>'phone',
      p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

    insert into public.applications(
      guarantee_ref, fee_amount, fee_basis_weeks, fee_basis_unit, pricing_agreement_id,
      tenancy_id, tenancy_position, share_percent, share_amount,
      branch_id, agency_id, partner_id, referrer_id, referrer_name,
      tenant_title, tenant_first_name, tenant_middle_name, tenant_last_name,
      tenant_dob, tenant_email, tenant_phone,
      prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
      monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode, referencing_mode
    ) values (
      'GR-' || nextval('public.guarantee_ref_seq')::text,
      v_fees[v_i], v_basis, coalesce(v_basis_unit, 'weeks'), v_agreement,
      v_tenancy, v_i, v_share_pct, v_rents[v_i],
      p_branch, ag, v_route, auth.uid(),
      (select full_name from public.users where id = auth.uid()),
      t->>'title', btrim(t->>'first'), nullif(btrim(coalesce(t->>'middle','')),''), btrim(t->>'last'),
      (t->>'dob')::date, btrim(t->>'email'), btrim(t->>'phone'),
      btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')),''), btrim(p_city),
      nullif(btrim(coalesce(p_county,'')),''), upper(btrim(p_postcode)),
      p_rent, p_tenancy_start, 'sent', now(),
      (select r.partner_rate from public.resolve_rates(p_branch, v_route) r),
      public.commission_total(p_branch, v_route, v_n),
      true, v_mode
    ) returning * into v_app;

    -- THE TENANCY'S COMMISSION, APPORTIONED, not this line's basis rounded on its
    -- own. Passing the whole fee, the split and this tenant's position lets the
    -- freeze round ONCE for the tenancy and then divide, the same way v_fees and
    -- v_rents above are divided, so the lines sum to the tenancy's commission
    -- exactly. Rounding each line separately put GR-20845 and GR-20846 a penny
    -- over their tenancy's 25%.
    perform public.freeze_commission_lines(
      v_app.id, p_branch, v_route, v_n, v_fees[v_i],
      v_fee, v_pcts, v_i);

    return next v_app;
  end loop;
end $function$;

-- create_partner(text,text,date,numeric,numeric,text,boolean,boolean): 2 guards
CREATE OR REPLACE FUNCTION public.create_partner(p_name text, p_status text DEFAULT 'onboarding'::text, p_live_from date DEFAULT NULL::date, p_partner_rate numeric DEFAULT 0.25, p_agent_rate numeric DEFAULT 0.10, p_referencing_mode text DEFAULT 'pre_referenced_screened'::text, p_portal_referrals boolean DEFAULT true, p_api_access boolean DEFAULT false)
 RETURNS partners
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare base text; v_slug text; n int := 2; res public.partners; who text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;

  if btrim(coalesce(p_name,'')) = '' then
    raise exception 'Partner name is required' using errcode = '22023';
  end if;
  -- Same validation as update_partner_settings, deliberately identical so a
  -- partner cannot be created in a state the edit screen would refuse to save.
  if p_partner_rate is null or p_partner_rate < 0 or p_partner_rate > 1 then
    raise exception 'Partner commission must be between 0 and 100%%' using errcode = '22023';
  end if;
  if p_agent_rate is null or p_agent_rate < 0 or p_agent_rate > 1 then
    raise exception 'Agent commission must be between 0 and 100%%' using errcode = '22023';
  end if;
  if coalesce(p_status,'') not in ('active','onboarding','paused') then
    raise exception 'Invalid status' using errcode = '22023';
  end if;
  if coalesce(p_referencing_mode,'') not in ('pre_referenced_open','pre_referenced_screened','opndoor_referenced') then
    raise exception 'Invalid referencing mode' using errcode = '22023';
  end if;

  -- partners_slug_valid restricts the slug to ^[a-z0-9-]+$, so strip anything
  -- else rather than letting the constraint reject a name a human typed
  -- reasonably.
  base := regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g');
  base := btrim(base, '-');   -- btrim takes the characters as a second arg; `both ... from` is trim() syntax
  base := left(nullif(base, ''), 40);
  if base is null then base := 'partner'; end if;

  v_slug := base;
  while exists (select 1 from public.partners where slug = v_slug) loop
    v_slug := base || '-' || n::text;
    n := n + 1;
  end loop;

  insert into public.partners(
    slug, name, status, live_from, partner_rate, agent_rate,
    referencing_mode, portal_referrals_enabled, api_access_enabled
  ) values (
    v_slug, btrim(p_name), p_status, p_live_from, p_partner_rate, p_agent_rate,
    p_referencing_mode, coalesce(p_portal_referrals, true), coalesce(p_api_access, false)
  ) returning * into res;

  who := coalesce((select full_name from public.users where id = auth.uid()), 'opndoor admin');

  -- A creation row, so the audit trail starts at the beginning rather than at
  -- the first edit. Without it a partner's history begins mid-story.
  insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
  values (res.id, 'created', null,
          format('%s (%s), %s, partner %s%%, agent %s%%, mode %s, portal %s, api %s',
                 res.name, res.slug, res.status,
                 to_char(res.partner_rate*100, 'FM990.0'), to_char(res.agent_rate*100, 'FM990.0'),
                 res.referencing_mode,
                 case when res.portal_referrals_enabled then 'on' else 'off' end,
                 case when res.api_access_enabled then 'on' else 'off' end),
          who);

  return res;
end $function$;

-- create_referral(uuid,text,text,text,date,text,text,text,text,text,text,text,numeric,date): 6 guards
CREATE OR REPLACE FUNCTION public.create_referral(p_branch uuid, p_tenant_title text, p_first text, p_last text, p_dob date, p_email text, p_phone text, p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text, p_rent numeric, p_tenancy_start date)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.applications; ag uuid; pid uuid; v_route uuid; v_mode text;
  v_portal_ok boolean; prate numeric; arate numeric;
  v_fee numeric; v_basis numeric; v_basis_unit text; v_agreement uuid; v_estate boolean;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  perform public.assert_referral_valid(
    p_branch, p_tenant_title, p_first, p_last, p_dob, p_email, p_phone,
    p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

  select b.agency_id, b.partner_id into ag, pid from public.branches b where b.id = p_branch;
  if ag is null then raise exception 'Selected branch not found' using errcode = '22023'; end if;

  if not coalesce((public.is_admin()
          or (public.app_role() in ('management','referrer') and pid = public.app_partner())), false) then
    raise exception 'not permitted for this partner' using errcode = '42501';
  end if;

  v_route := public.resolve_route_partner(p_branch, null);
  select p.portal_referrals_enabled into v_portal_ok from public.partners p where p.id = v_route;
  if not coalesce(found, false) then raise exception 'Route partner not found' using errcode = '22023'; end if;

  -- WHO CHECKS THE TENANT. The agency's own mode if it has said, else the route
  -- partner's. This is the journey, and it is what gets frozen onto the row.
  v_mode := public.resolve_referencing_mode(p_branch, v_route);
  -- WHAT KIND OF RELATIONSHIP. Never overridden by the answer above.
  v_estate := public.is_agent_estate(p_branch, v_route);

  -- Position ladder: a property of the ESTATE. An agency's staff refer against
  -- their own branches whether or not Opndoor checks their tenants.
  if not coalesce(public.is_admin() and v_estate, false) then
    if not coalesce((case
              when public.app_has_scope()
                then p_branch in (select public.app_scope_branches())
              else public.app_may_reach_branch(p_branch) end), false) then
      raise exception 'You can only refer against a branch within your own scope.' using errcode = '42501';
    end if;
  end if;

  -- THE PRICE. Rail-agnostic already: the agreement decides, standard terms are
  -- one month's rent exactly, a negotiated basis is weeks of rent.
  -- THE UNIT COMES OUT WITH THE QUANTITY. A basis of 1 recorded without it is
  -- one WEEK of rent, which is a quarter of what a one-month agreement charges.
  select f.fee_amount, f.fee_basis_weeks, f.fee_basis_unit, f.agreement_id
    into v_fee, v_basis, v_basis_unit, v_agreement
  from public.resolve_fee(p_branch, v_route, p_rent, 1) f;

  -- COMMISSION: the ESTATE's additive split, or the flat snapshotted rates.
  select r.partner_rate, r.agent_rate into prate, arate
  from public.resolve_rates(p_branch, v_route) r;
  if v_estate then
    arate := public.commission_total(p_branch, v_route, 1);
  end if;

  if not coalesce(coalesce(v_portal_ok, true), false) then
    raise exception 'This partner does not create referrals in the portal.' using errcode = '42501';
  end if;

  insert into public.applications(
    guarantee_ref, fee_amount, fee_basis_weeks, fee_basis_unit, pricing_agreement_id,
    branch_id, agency_id, partner_id, referrer_id, referrer_name,
    tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
    prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
    monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode,
    referencing_mode
  ) values (
    'GR-' || nextval('public.guarantee_ref_seq')::text,
    v_fee, v_basis, coalesce(v_basis_unit, 'weeks'), v_agreement,
    p_branch, ag, v_route, auth.uid(),
    (select full_name from public.users where id = auth.uid()),
    p_tenant_title, btrim(p_first), btrim(p_last), p_dob, btrim(p_email), btrim(p_phone),
    btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')), ''), btrim(p_city),
    nullif(btrim(coalesce(p_county,'')), ''), upper(btrim(p_postcode)),
    p_rent, p_tenancy_start, 'sent', now(), prate, arate, true,
    -- THE JOURNEY, frozen. create-referral forks on this: pre_referenced goes
    -- straight to a Stripe session, opndoor_referenced sends an invite.
    v_mode
  ) returning * into a;

  -- The basis is this applicant's own fee. For a tenancy of one that is the
  -- whole fee; create_joint_referral passes each applicant's share instead.
  if v_estate then
    perform public.freeze_commission_lines(a.id, p_branch, v_route, 1, v_fee);
  end if;

  return a;
end $function$;

-- create_referral_api(uuid,boolean,uuid,uuid,text,text,text,date,text,text,text,text,text,text,text,numeric,date): 1 guard
CREATE OR REPLACE FUNCTION public.create_referral_api(p_partner uuid, p_livemode boolean, p_referrer uuid, p_branch uuid, p_tenant_title text, p_first text, p_last text, p_dob date, p_email text, p_phone text, p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text, p_rent numeric, p_tenancy_start date)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ag uuid; pid uuid; prate numeric; arate numeric; a public.applications; rname text;
        v_ref text; v_mode text;
begin
  if p_partner is null then raise exception 'Partner is required.' using errcode = '22023'; end if;
  if p_referrer is null then raise exception 'Referrer is required.' using errcode = '22023'; end if;
  if p_livemode is null then raise exception 'livemode is required.' using errcode = '22023'; end if;

  perform public.assert_referral_valid(
    p_branch, p_tenant_title, p_first, p_last, p_dob, p_email, p_phone,
    p_addr1, p_addr2, p_city, p_county, p_postcode, p_rent, p_tenancy_start);

  select b.agency_id, b.partner_id, p.partner_rate, p.agent_rate, p.referencing_mode
    into ag, pid, prate, arate, v_mode
  from public.branches b
  join public.partners p on p.id = b.partner_id
  where b.id = p_branch;

  if ag is null then raise exception 'Selected branch not found' using errcode = '22023'; end if;

  -- The cross-PARTNER guard stays. Deliberately the same message whether the
  -- branch belongs to another partner or does not exist, so the API cannot be
  -- used to probe for the existence of another partner's orgs.
  if pid <> p_partner then
    raise exception 'Selected branch not found' using errcode = '22023';
  end if;

  -- The cross-MODE guard is GONE. Orgs are no longer per mode: a sandbox
  -- application references the partner's real branch, because the org is not the
  -- thing being rehearsed and there is now no other org for it to reference.

  select u.full_name into rname
  from public.users u
  where u.id = p_referrer and u.partner_id = p_partner;

  if not coalesce(found, false) then
    raise exception 'Referrer not found for this partner.' using errcode = '22023';
  end if;

  v_ref := case when p_livemode
                then 'GR-'      || nextval('public.guarantee_ref_seq')::text
                else 'GR-TEST-' || nextval('public.guarantee_ref_sandbox_seq')::text
           end;

  insert into public.applications(
    guarantee_ref, branch_id, agency_id, partner_id, referrer_id, referrer_name,
    tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
    prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
    monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode,
    referencing_mode
  ) values (
    v_ref, p_branch, ag, p_partner, p_referrer,
    rname,
    p_tenant_title, btrim(p_first), btrim(p_last), p_dob, btrim(p_email), btrim(p_phone),
    btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')), ''), btrim(p_city),
    nullif(btrim(coalesce(p_county,'')), ''), upper(btrim(p_postcode)),
    p_rent, p_tenancy_start, 'sent', now(), prate, arate, p_livemode,
    v_mode
  ) returning * into a;

  return a;
end $function$;

-- create_referral_target(text,text,text,text,text,text,text,text): 3 guards
CREATE OR REPLACE FUNCTION public.create_referral_target(p_agency text, p_branch text, p_agency_email text DEFAULT NULL::text, p_agency_contact_name text DEFAULT NULL::text, p_agency_phone text DEFAULT NULL::text, p_branch_email text DEFAULT NULL::text, p_branch_contact_name text DEFAULT NULL::text, p_branch_phone text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pid uuid; me uuid := auth.uid(); who text; ag_id uuid; br_id uuid;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
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
    if not coalesce(public.is_admin() and public.is_our_estate_partner(pid), false) then
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
    if not coalesce(public.is_admin() and public.is_our_estate_partner(pid), false) then
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

-- create_referral_target(text,text,text,text,text,text,text,text,text): 4 guards
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
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
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
    if not coalesce(v_admin, false) then raise exception 'Not permitted.' using errcode = '42501'; end if;
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
    if not coalesce(v_admin and public.is_our_estate_partner(pid), false) then
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
    if not coalesce(v_admin and public.is_our_estate_partner(pid), false) then
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

-- cron_health(): 2 guards
CREATE OR REPLACE FUNCTION public.cron_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_since        timestamptz := now() - interval '24 hours';
  v_jobs         jsonb;
  v_recent_http  jsonb;
  v_by_job       jsonb;
  v_http_alert   boolean;
  v_counts       jsonb;
  v_base_url     text;
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  if not coalesce(public.is_admin(), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  v_base_url := public.ops_functions_base_url();

  select coalesce(jsonb_agg(obj order by jobname), '[]'::jsonb)
  into v_jobs
  from (
    select
      job.jobname as jobname,
      jsonb_build_object(
        'jobname', job.jobname,
        'schedule', job.schedule,
        'active', job.active,
        'last_status', lr.status,
        'last_return_message', lr.return_message,
        'last_run', lr.start_time,
        'last_end', lr.end_time,
        'http_status_code', hr.status_code,
        'http_created', hr.created,
        'http_ok', case when hr.status_code is null then null
                        else hr.status_code between 200 and 299 end,
        'needs_base_url', (job.command ilike '%ops_functions_base_url%'),
        -- A job that is off on purpose reads as off, not as failing.
        'disabled_here', (job.jobname ilike '%hubspot%' and public.ops_hubspot_disabled())
      ) as obj
    from cron.job job
    left join lateral (
      select d.status, d.return_message, d.start_time, d.end_time
      from cron.job_run_details d
      where d.jobid = job.jobid
      order by d.start_time desc nulls last
      limit 1
    ) lr on true
    left join lateral (
      select r.status_code, r.created
      from net._http_response r
      where lr.start_time is not null
        and r.created >= lr.start_time
        and r.created <  lr.start_time + interval '5 minutes'
      order by r.created asc
      limit 1
    ) hr on true
  ) s;

  with attributed as (
    select
      r.id, r.status_code, r.created, r.content, r.error_msg, r.timed_out,
      (r.status_code is not null and r.status_code between 200 and 299) as ok,
      a.jobname
    from net._http_response r
    left join lateral (
      select j.jobname
      from cron.job_run_details d
      join cron.job j on j.jobid = d.jobid
      where d.start_time is not null
        and d.start_time <= r.created
        and r.created < d.start_time + interval '5 minutes'
      order by d.start_time desc
      limit 1
    ) a on true
    where r.created > v_since
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', id, 'status_code', status_code, 'ok', ok, 'created', created,
             'content', left(content, 160), 'error_msg', error_msg,
             'timed_out', timed_out, 'job', jobname
           ) order by ok asc, created desc
         ), '[]'::jsonb)
  into v_recent_http
  from (select * from attributed order by ok asc, created desc limit 40) t;

  with attributed as (
    select
      r.id, r.status_code, r.created, r.content, r.error_msg, r.timed_out,
      (r.status_code is not null and r.status_code between 200 and 299) as ok,
      a.jobname
    from net._http_response r
    left join lateral (
      select j.jobname
      from cron.job_run_details d
      join cron.job j on j.jobid = d.jobid
      where d.start_time is not null
        and d.start_time <= r.created
        and r.created < d.start_time + interval '5 minutes'
      order by d.start_time desc
      limit 1
    ) a on true
    where r.created > v_since
  )
  select coalesce(jsonb_agg(obj order by errors desc, total desc), '[]'::jsonb)
  into v_by_job
  from (
    select
      count(*) as total,
      count(*) filter (where not ok) as errors,
      jsonb_build_object(
        'job', jobname,
        'total', count(*),
        'errors', count(*) filter (where not ok),
        'disabled_here', (jobname ilike '%hubspot%' and public.ops_hubspot_disabled()),
        'latest', (array_agg(
          jsonb_build_object(
            'id', id, 'status_code', status_code, 'ok', ok, 'created', created,
            'content', left(content, 160), 'error_msg', error_msg, 'timed_out', timed_out,
            'job', jobname
          ) order by created desc
        ))[1]
      ) as obj
    from attributed
    group by jobname
  ) s;

  select (r.status_code is null or r.status_code not between 200 and 299)
  into v_http_alert
  from net._http_response r
  order by r.created desc
  limit 1;
  v_http_alert := coalesce(v_http_alert, false);

  select jsonb_build_object(
    'window_hours', 24,
    'email_sends', (
      select count(*) from public.activity_log
      where at > v_since and kind in (
        'payment_email_sent','payment_email_resent','payment_reminder',
        'payment_reminder_email_sent','expiry_reminder_email_sent',
        'refund_email_sent','payment_receipt_sent','tenant_deed_email_sent')),
    'email_failures', (
      select count(*) from public.activity_log
      where at > v_since and kind in (
        'payment_email_failed','payment_reminder_email_failed',
        'expiry_reminder_email_failed','refund_email_failed',
        'payment_receipt_failed','tenant_deed_email_failed')),
    'webhook_failures', (
      select count(*) from public.ops_alerts
      where created_at > v_since and alert_type like 'webhook_error%'),
    'deed_failures', (
      select count(*) from public.activity_log
      where at > v_since and kind in ('deed_error','deed_delivery_failed')),
    'anomalies', (
      select count(*) from public.activity_log
      where at > v_since and kind in ('payment_anomaly','refund_anomaly')),
    'http_errors', (
      select count(*) from net._http_response
      where created > v_since
        and (status_code is null or status_code not between 200 and 299))
  ) into v_counts;

  return jsonb_build_object(
    'generated_at', now(),
    'http_alert', v_http_alert,
    'functions_base_url', v_base_url,
    'hubspot_disabled', public.ops_hubspot_disabled(),
    'jobs', v_jobs,
    'recent_http', v_recent_http,
    'http_by_job', v_by_job,
    'counts', v_counts
  );
end
$function$;

-- decline_application(text,text): 3 guards
CREATE OR REPLACE FUNCTION public.decline_application(p_ref text, p_reason text DEFAULT NULL::text)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications; who text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where guarantee_ref = p_ref;
  if not coalesce(found, false) then raise exception 'application not found'; end if;
  if not coalesce(public.is_opndoor_staff(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
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

-- decline_application_by_token(uuid,text): 2 guards
CREATE OR REPLACE FUNCTION public.decline_application_by_token(p_token uuid, p_reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare t public.payment_page_tokens; a public.applications; lbl text;
begin
  select * into t from public.payment_page_tokens where token = p_token and expires_at > now();
  if not coalesce(found, false) then raise exception 'invalid or expired token' using errcode = '22023'; end if;
  select * into a from public.applications where id = t.application_id;
  if not coalesce(found, false) then raise exception 'application not found'; end if;
  -- Only an open referral (Sent or auto-Expired) can be declined; anything else
  -- (already declined, paid, deed) returns its current status unchanged.
  if a.status not in ('sent', 'expired') then return a.status; end if;
  if p_reason is null or p_reason not in ('another_guarantor','tenancy_fell_through','other') then
    p_reason := 'other';
  end if;
  update public.applications
    set status = 'withdrawn', withdrawn_at = now(), withdrawn_reason = p_reason,
        withdrawn_by_tenant = true, withdrawn_by = null
    where id = a.id;
  lbl := case p_reason
           when 'another_guarantor' then 'found another guarantor'
           when 'tenancy_fell_through' then 'tenancy fell through'
           else 'other' end;
  insert into public.activity_log(application_id, kind, message, actor, visibility)
  values (a.id, 'withdrawn',
    'Application withdrawn by the tenant (' || lbl || ')' || case when a.status = 'expired' then ', from an expired link' else '' end || '. No payment was taken.', 'Tenant', 'business');
  return 'withdrawn';
end $function$;

-- detach_user_from_agency(uuid,uuid): 3 guards
CREATE OR REPLACE FUNCTION public.detach_user_from_agency(p_user uuid, p_agency uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_target public.users;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into v_target from public.users where id = p_user;
  if not coalesce(found, false) then raise exception 'User not found' using errcode = '22023'; end if;

  if not coalesce((public.is_admin()
          or (public.app_role() = 'management' and v_target.partner_id = public.app_partner()
              and public.app_may_reach_agency(p_agency)
              and public.user_within_caller_scope(p_user))), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  perform public.assert_may_act_on_user(p_user);

  -- The trigger recomputes user_attached for the pair and deletes the
  -- relationship row when nothing else holds it up.
  delete from public.user_agency_attachments where user_id = p_user and agency_id = p_agency;
end $function$;

-- dev_delete_api_key(uuid): 2 guards
CREATE OR REPLACE FUNCTION public.dev_delete_api_key(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_partner uuid; v_used timestamptz; v_requests bigint;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select k.partner_id, k.last_used_at into v_partner, v_used
  from public.partner_api_keys k where k.id = p_id;
  if v_partner is null then raise exception 'Key not found.' using errcode = '22023'; end if;

  if not coalesce((public.app_role() in ('developer','management') and v_partner = public.app_partner()), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  select count(*) into v_requests from public.partner_api_request_log l where l.api_key_id = p_id;
  if v_used is not null or v_requests > 0 then
    raise exception 'This key has been used, so it cannot be deleted. Revoke it instead.'
      using errcode = '22023';
  end if;

  delete from public.partner_api_keys where id = p_id;
end $function$;

-- dev_delete_webhook_endpoint(uuid): 2 guards
CREATE OR REPLACE FUNCTION public.dev_delete_webhook_endpoint(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_partner uuid; v_deliveries bigint;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select e.partner_id into v_partner from public.partner_webhook_endpoints e where e.id = p_id;
  if v_partner is null then raise exception 'Endpoint not found.' using errcode = '22023'; end if;
  if not coalesce((public.app_role() = 'developer' and v_partner = public.app_partner()), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  select count(*) into v_deliveries
  from public.partner_webhook_deliveries d where d.endpoint_id = p_id;
  if v_deliveries > 0 then
    raise exception 'This endpoint has delivery history, so it cannot be deleted. Disable it instead.'
      using errcode = '22023';
  end if;

  delete from public.partner_webhook_endpoints where id = p_id;
end $function$;

-- dev_purge_sandbox(uuid): 1 guard
CREATE OR REPLACE FUNCTION public.dev_purge_sandbox(p_partner uuid DEFAULT NULL::uuid)
 RETURNS TABLE(applications_deleted bigint, agencies_deleted bigint, branches_deleted bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_apps bigint; v_ag bigint; v_br bigint; v_partner uuid;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  if public.is_admin() then
    v_partner := p_partner;
  elsif public.app_role() = 'developer' then
    v_partner := public.app_partner();
  else
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- Transaction-local, and set here rather than by any caller.
  perform set_config('app.purging_sandbox', 'on', true);

  -- Cascades take activity_log, notes, payment tokens and webhook deliveries.
  with d as (
    delete from public.applications a
     where not a.livemode and (v_partner is null or a.partner_id = v_partner)
    returning 1)
  select count(*) into v_apps from d;

  with d as (
    delete from public.branches b
     where not b.livemode and (v_partner is null or b.partner_id = v_partner)
    returning 1)
  select count(*) into v_br from d;

  with d as (
    delete from public.agencies g
     where not g.livemode and (v_partner is null or g.partner_id = v_partner)
    returning 1)
  select count(*) into v_ag from d;

  perform set_config('app.purging_sandbox', 'off', true);

  return query select v_apps, v_ag, v_br;
end $function$;

-- dev_replay_webhook_delivery(uuid): 2 guards
CREATE OR REPLACE FUNCTION public.dev_replay_webhook_delivery(p_delivery uuid)
 RETURNS TABLE(out_id uuid, out_replay_count integer, out_queued_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_partner uuid; v_delivered timestamptz; v_count int;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  select e.partner_id, d.delivered_at into v_partner, v_delivered
  from public.partner_webhook_deliveries d
  join public.partner_webhook_endpoints e on e.id = d.endpoint_id
  where d.id = p_delivery;

  if v_partner is null then raise exception 'Delivery not found.' using errcode = '22023'; end if;

  if not coalesce((
    public.is_admin()
    or (public.app_role() = 'developer' and v_partner = public.app_partner())
  ), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if v_delivered is not null then
    raise exception 'This delivery already succeeded, so there is nothing to replay.' using errcode = '22023';
  end if;

  update public.partner_webhook_deliveries d set
    -- The round that just ended is pushed onto the history BEFORE it is cleared.
    prior_attempts = d.prior_attempts || jsonb_build_object(
      'attempts',    d.attempts,
      'last_status', d.last_status,
      'last_error',  left(coalesce(d.last_error, ''), 400),
      'dead_at',     d.dead_at,
      'ended_at',    now()
    ),
    replay_count   = d.replay_count + 1,
    last_replay_at = now(),
    last_replay_by = auth.uid(),

    -- Back on the queue. next_attempt_at is now() rather than a backoff: a human
    -- has just said the endpoint is fixed, so waiting is the wrong default.
    attempts        = 0,
    next_attempt_at = now(),
    dead_at         = null,
    claimed_at      = null,
    last_status     = null,
    last_error      = null
  where d.id = p_delivery
  returning d.replay_count into v_count;

  return query select p_delivery, v_count, now();
end $function$;

-- dev_revoke_api_key(uuid): 2 guards
CREATE OR REPLACE FUNCTION public.dev_revoke_api_key(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_partner uuid;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select k.partner_id into v_partner from public.partner_api_keys k where k.id = p_id;
  if v_partner is null then raise exception 'Key not found.' using errcode = '22023'; end if;

  if not coalesce((public.app_role() in ('developer','management') and v_partner = public.app_partner()), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  update public.partner_api_keys set revoked_at = now() where id = p_id and revoked_at is null;
end $function$;

-- dev_update_webhook_endpoint(uuid,text[],boolean): 2 guards
CREATE OR REPLACE FUNCTION public.dev_update_webhook_endpoint(p_id uuid, p_events text[] DEFAULT NULL::text[], p_active boolean DEFAULT NULL::boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_partner uuid;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select e.partner_id into v_partner from public.partner_webhook_endpoints e where e.id = p_id;
  if v_partner is null then raise exception 'Endpoint not found.' using errcode = '22023'; end if;
  if not coalesce((public.app_role() = 'developer' and v_partner = public.app_partner()), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  update public.partner_webhook_endpoints
     set events = coalesce(p_events, events),
         active = coalesce(p_active, active)
   where id = p_id;
end $function$;

-- dev_webhook_endpoint_secret(uuid): 2 guards
CREATE OR REPLACE FUNCTION public.dev_webhook_endpoint_secret(p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_partner uuid; v_secret text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  select e.partner_id, e.secret into v_partner, v_secret
  from public.partner_webhook_endpoints e where e.id = p_id;
  if v_partner is null then raise exception 'Endpoint not found.' using errcode = '22023'; end if;

  -- Deliberately no admin branch. An opndoor admin asking for this is either
  -- helping a partner debug, in which case the partner should read it out, or
  -- doing something that needs a conversation first.
  if not coalesce((public.app_role() = 'developer' and v_partner = public.app_partner()), false) then
    raise exception 'Signing secrets are only visible to that partner''s own developers.'
      using errcode = '42501';
  end if;

  return v_secret;
end $function$;

-- dismiss_agency_match(uuid,text): 3 guards
CREATE OR REPLACE FUNCTION public.dismiss_agency_match(p_application uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid; who text;
begin
  if not coalesce(public.is_aal2(), false)  then raise exception 'MFA required'  using errcode = '42501'; end if;
  if not coalesce(public.is_opndoor_staff(), false) then raise exception 'not permitted' using errcode = '42501'; end if;

  update public.application_agency_match
     set state = 'dismissed', resolved_by = auth.uid(), resolved_at = now(), updated_at = now()
   where application_id = p_application;
  if not coalesce(found, false) then raise exception 'No match to dismiss' using errcode = '22023'; end if;

  me := auth.uid();
  select full_name into who from public.users where id = me;
  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values ('application', p_application, 'agency_match_dismissed',
          coalesce(nullif(btrim(p_note), ''), 'Not in network; left on the direct house branch'),
          coalesce(who, 'opndoor admin'), me);
end $function$;

-- end_agreement(uuid): 3 guards
CREATE OR REPLACE FUNCTION public.end_agreement(p_agreement uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor text; a record;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  select * into a from public.pricing_agreements where id = p_agreement;
  if not coalesce(found, false) then raise exception 'Agreement not found' using errcode = '22023'; end if;
  if a.is_standard then raise exception 'Standard terms cannot be ended.' using errcode = '22023'; end if;
  if a.ended_at is not null then raise exception 'That agreement has already ended.' using errcode = '22023'; end if;
  select full_name into v_actor from public.users where id = auth.uid();
  update public.pricing_agreements set ended_at = now() where id = p_agreement;
  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values (a.scope_level, a.scope_id, 'agreement_ended',
          'Back to standard terms unless a rate is now set.', coalesce(v_actor,'an administrator'), auth.uid());
end $function$;

-- log_view_as(text,text): 2 guards
CREATE OR REPLACE FUNCTION public.log_view_as(p_kind text, p_label text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := auth.uid();
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_opndoor_staff(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_kind not in ('partner', 'agency') then raise exception 'invalid target kind' using errcode = '22023'; end if;
  insert into public.view_as_audit(actor_id, actor_name, target_kind, target_label)
  values (me, coalesce((select full_name from public.users where id = me), 'an administrator'),
          p_kind, coalesce(nullif(btrim(p_label), ''), '(unnamed)'));
end $function$;

-- mark_withdrawn(text,text,text): 3 guards, owned
CREATE OR REPLACE FUNCTION public.mark_withdrawn(p_ref text, p_reason text, p_note text)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications; r text; owned boolean; who text; lbl text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where guarantee_ref = p_ref;
  if not coalesce(found, false) then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := coalesce(a.referrer_id = auth.uid(), false);
  if not coalesce((public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and public.app_may_reach_branch(a.branch_id))
          or (r = 'referrer' and owned)), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if a.status <> 'sent' then raise exception 'Only an application at Sent (before payment) can be withdrawn.' using errcode = '42501'; end if;
  if p_reason not in ('another_guarantor','tenancy_fell_through','duplicate','other') then
    raise exception 'Invalid withdrawal reason' using errcode = '22023';
  end if;
  if p_reason = 'other' and coalesce(btrim(p_note), '') = '' then
    raise exception 'A note is required when the reason is Other.' using errcode = '22023';
  end if;
  update public.applications
    set status = 'withdrawn', withdrawn_at = now(), withdrawn_reason = p_reason,
        withdrawn_note = nullif(btrim(coalesce(p_note,'')), ''), withdrawn_by = auth.uid()
    where id = a.id returning * into a;
  who := coalesce((select full_name from public.users where id = auth.uid()), 'a user');
  lbl := case p_reason
           when 'another_guarantor' then 'tenant found another guarantor'
           when 'tenancy_fell_through' then 'tenancy fell through'
           when 'duplicate' then 'duplicate referral'
           else 'other' end;
  insert into public.activity_log(application_id, kind, message, actor, visibility)
  values (a.id, 'withdrawn',
    'Application withdrawn (' || lbl || ')' || case when a.withdrawn_note is not null then ': ' || a.withdrawn_note else '' end || '.',
    who, 'business');
  return a;
end $function$;

-- merge_agencies(uuid,uuid,text): 4 guards
CREATE OR REPLACE FUNCTION public.merge_agencies(p_keep uuid, p_merge uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a_keep public.agencies; a_merge public.agencies;
  v_branches int := 0; v_apps int := 0; v_contacts int := 0;
  v_rels int := 0; v_attach int := 0; v_renamed jsonb := '[]'::jsonb;
  r record; v_new_name text; who text; me uuid;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_keep = p_merge then raise exception 'Cannot merge an agency into itself' using errcode = '22023'; end if;

  select * into a_keep  from public.agencies where id = p_keep;
  if not coalesce(found, false) then raise exception 'Surviving agency not found' using errcode = '22023'; end if;
  select * into a_merge from public.agencies where id = p_merge;
  if not coalesce(found, false) then raise exception 'Merged agency not found' using errcode = '22023'; end if;

  -- Placeholders are not agencies and must never be merged with one. Merging a
  -- house row would attach every direct application to a real letting agency.
  if a_keep.is_placeholder or a_merge.is_placeholder then
    raise exception 'Placeholder agencies cannot be merged' using errcode = '22023';
  end if;

  me := auth.uid();
  select full_name into who from public.users where id = me;

  -- ---- branches -----------------------------------------------------------
  -- unique (agency_id, name) means a name collision would abort the whole
  -- merge. Rather than refuse, the incoming branch is suffixed with where it
  -- came from and the rename is reported, because two branches that genuinely
  -- share a name are usually two real offices and losing one is worse than an
  -- ugly name a human can tidy.
  for r in select id, name from public.branches where agency_id = p_merge loop
    v_new_name := r.name;
    if exists (select 1 from public.branches b where b.agency_id = p_keep and b.name = r.name) then
      v_new_name := r.name || ' (' || a_merge.name || ')';
      -- Still colliding after the suffix: give up on prettiness, stay unique.
      if exists (select 1 from public.branches b where b.agency_id = p_keep and b.name = v_new_name) then
        v_new_name := v_new_name || ' ' || left(r.id::text, 8);
      end if;
      v_renamed := v_renamed || jsonb_build_object('branch', r.id, 'from', r.name, 'to', v_new_name);
    end if;
    update public.branches set agency_id = p_keep, name = v_new_name where id = r.id;
    v_branches := v_branches + 1;
  end loop;

  -- ---- applications -------------------------------------------------------
  -- agency_id is denormalised onto applications and is normally maintained by
  -- applications_sync_partner, which only fires on insert or on a branch_id
  -- update. Moving the branch does not rewrite history, so the rows are
  -- repointed here. partner_id is NOT touched: that is the ROUTE, and a merge
  -- of two org records does not change how any application arrived.
  update public.applications set agency_id = p_keep where agency_id = p_merge;
  get diagnostics v_apps = row_count;

  -- ---- contacts -----------------------------------------------------------
  -- partner_id is deliberately left alone. Each contact stays in the book of
  -- the partner that created it.
  update public.agent_contacts set agency_id = p_keep where agency_id = p_merge;
  get diagnostics v_contacts = row_count;

  -- ---- relationships ------------------------------------------------------
  -- Unioned: a partner who could reach either row can reach the survivor, and
  -- the reasons are OR-ed so nothing is downgraded.
  insert into public.partner_agency_relationships
    (partner_id, agency_id, introduced, user_attached, transacted, first_seen_at)
  select r2.partner_id, p_keep, r2.introduced, r2.user_attached, r2.transacted, r2.first_seen_at
  from public.partner_agency_relationships r2
  where r2.agency_id = p_merge
  on conflict (partner_id, agency_id) do update
    set introduced    = public.partner_agency_relationships.introduced    or excluded.introduced,
        user_attached = public.partner_agency_relationships.user_attached or excluded.user_attached,
        transacted    = public.partner_agency_relationships.transacted    or excluded.transacted,
        first_seen_at = least(public.partner_agency_relationships.first_seen_at, excluded.first_seen_at),
        updated_at    = now();
  get diagnostics v_rels = row_count;
  delete from public.partner_agency_relationships where agency_id = p_merge;

  -- ---- user attachments ---------------------------------------------------
  insert into public.user_agency_attachments (user_id, agency_id, created_by)
  select ua.user_id, p_keep, ua.created_by
  from public.user_agency_attachments ua
  where ua.agency_id = p_merge
  on conflict (user_id, agency_id) do nothing;
  get diagnostics v_attach = row_count;
  delete from public.user_agency_attachments where agency_id = p_merge;

  -- ---- the merged row goes ------------------------------------------------
  delete from public.agencies where id = p_merge;

  insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
  values ('agency', p_keep, 'merged',
          format('Merged "%s" into "%s"%s', a_merge.name, a_keep.name,
                 case when coalesce(btrim(p_note),'') = '' then '' else ': ' || btrim(p_note) end),
          coalesce(who, 'opndoor admin'), me);

  return jsonb_build_object(
    'kept', p_keep, 'kept_name', a_keep.name,
    'merged', p_merge, 'merged_name', a_merge.name,
    'branches_moved', v_branches, 'applications_repointed', v_apps,
    'contacts_moved', v_contacts, 'relationships_unioned', v_rels,
    'attachments_moved', v_attach, 'branches_renamed', v_renamed
  );
end $function$;

-- my_application_delivery(uuid): 2 guards, owned
CREATE OR REPLACE FUNCTION public.my_application_delivery(p_app uuid)
 RETURNS TABLE(state text, to_email text, to_name text, source text, auto_send boolean, attempted_to text, attempted_source text, failed_at timestamp with time zone, reason text, sent_at timestamp with time zone, held boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications; r text; owned boolean;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where id = p_app;
  if not found then return; end if;
  r := public.app_role();
  owned := coalesce(a.referrer_id = auth.uid(), false);
  if not coalesce((public.is_admin()
          or r = 'opndoor_manager'
          or (r in ('management','referrer','developer') and a.partner_id = public.app_partner()
              and public.app_may_reach_branch(a.branch_id))), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  -- `owned` is read so a referrer's own application is reachable even where a
  -- scope would not otherwise admit it; the branch test above already covers
  -- the common case.
  if r = 'referrer' and not owned and not public.is_admin() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return query
  select
    case
      -- Order matters and is the whole point of the migration. A row that
      -- errored is FAILED even though it is also queued; a row with nobody to
      -- send to is HELD and was never attempted; a row with neither is simply
      -- not attempted yet, which is not a problem.
      when a.delivery_failed_at is not null then 'failed'
      when a.awaiting_staff_send            then 'cannot_deliver'
      when a.deed_sent_at is not null       then 'delivered'
      else 'not_attempted'
    end,
    t.email, t.display_name, t.source, t.auto_send,
    a.delivery_attempted_to, a.delivery_source, a.delivery_failed_at, a.delivery_reason,
    a.deed_sent_at, a.awaiting_staff_send
  from (select 1) one
  left join lateral public.deed_delivery_target(p_app) t on true;
end $function$;

-- my_org_shape(uuid): 1 guard
CREATE OR REPLACE FUNCTION public.my_org_shape(p_partner uuid DEFAULT NULL::uuid)
 RETURNS TABLE(refers_own_stock boolean, agency_count integer, branch_count integer, collapse_agency boolean, collapse_branch boolean, may_add_agency boolean, only_agency_id uuid, only_agency_name text, only_branch_id uuid, only_branch_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_partner uuid;
  v_own     boolean;
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if public.is_admin() and p_partner is not null then
    v_partner := p_partner;
  else
    v_partner := public.app_partner();
  end if;

  if v_partner is null then
    return;
  end if;

  select p.refers_own_stock into v_own from public.partners p where p.id = v_partner;
  v_own := coalesce(v_own, false);

  return query
  with reachable as (
    select b.id as bid, b.name as bname, a.id as aid, a.name as aname
      from public.branches b
      join public.agencies a on a.id = b.agency_id
     where a.partner_id = v_partner
       and (
         case
           -- A position says which branches, and on our estate it is the only
           -- thing that does. WAS: a home_branch_id arm beneath this one, and
           -- an `else true` beneath that.
           when public.app_has_scope() then b.id in (select s from public.app_scope_branches() s)
           -- No position on our own estate is now impossible; if it somehow
           -- happens, the honest answer is the empty set, which the client
           -- draws as "nothing is set up for your account yet".
           when public.is_our_estate_partner(v_partner) then false
           -- A supplier without a position sees their own company. Stated, not
           -- defaulted to, so the closed default below is the one a new arm meets.
           when not public.is_our_estate_partner(v_partner) then true
           else false
         end
       )
  ),
  agg as (
    select
      count(distinct r.aid)::int       as ag,
      count(*)::int                    as br,
      (array_agg(distinct r.aid))[1]   as aid1,
      (array_agg(distinct r.aname))[1] as aname1,
      (array_agg(r.bid))[1]            as bid1,
      (array_agg(r.bname))[1]          as bname1
    from reachable r
  )
  select
    v_own,
    agg.ag,
    agg.br,
    (v_own and agg.ag = 1),
    (v_own and agg.br = 1),
    (not v_own),
    case when agg.ag = 1 then agg.aid1   end,
    case when agg.ag = 1 then agg.aname1 end,
    case when agg.br = 1 then agg.bid1   end,
    case when agg.br = 1 then agg.bname1 end
  from agg;
end $function$;

-- org_add_contact(uuid,uuid,text,text,text,text,boolean): 2 guards
CREATE OR REPLACE FUNCTION public.org_add_contact(p_agency_id uuid, p_branch_id uuid, p_name text, p_role text, p_email text, p_phone text, p_primary boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := auth.uid(); pid uuid; new_id uuid; v_email text := btrim(coalesce(p_email,''));
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
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
  if not coalesce((public.is_admin()
          or (public.app_role() = 'management' and pid = public.app_partner()
              and public.app_may_reach_contact(p_agency_id, p_branch_id, pid))), false) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  insert into public.agent_contacts(agency_id, branch_id, name, email, phone, contact_role, is_primary, created_by)
  values (p_agency_id, p_branch_id, btrim(coalesce(p_name,'')), v_email, nullif(btrim(coalesce(p_phone,'')),''), nullif(btrim(coalesce(p_role,'')),''), coalesce(p_primary,false), me)
  returning id into new_id;
  return new_id;
end $function$;

-- org_remove_contact(uuid): 2 guards
CREATE OR REPLACE FUNCTION public.org_remove_contact(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pid uuid; a_id uuid; b_id uuid; n int;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select partner_id, agency_id, branch_id into pid, a_id, b_id
    from public.agent_contacts where id = p_id;
  if pid is null then raise exception 'Contact not found.' using errcode = '22023'; end if;
  if not coalesce((public.is_admin()
          or (public.app_role() = 'management' and pid = public.app_partner()
              and public.app_may_reach_contact(a_id, b_id, pid))), false) then
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

-- org_set_primary_contact(uuid): 2 guards
CREATE OR REPLACE FUNCTION public.org_set_primary_contact(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pid uuid; a_id uuid; b_id uuid;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select partner_id, agency_id, branch_id into pid, a_id, b_id
    from public.agent_contacts where id = p_id;
  if pid is null then raise exception 'Contact not found.' using errcode = '22023'; end if;
  if not coalesce((public.is_admin()
          or (public.app_role() = 'management' and pid = public.app_partner()
              and public.app_may_reach_contact(a_id, b_id, pid))), false) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  -- Single-row update; agent_contacts_maintain_primary demotes the old primary.
  update public.agent_contacts set is_primary = true where id = p_id;
end $function$;

-- org_update_contact(uuid,text,text,text,text,boolean): 2 guards
CREATE OR REPLACE FUNCTION public.org_update_contact(p_id uuid, p_name text, p_role text, p_email text, p_phone text, p_primary boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pid uuid; a_id uuid; b_id uuid; v_email text := btrim(coalesce(p_email,'')); has_primary boolean;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select partner_id, agency_id, branch_id into pid, a_id, b_id from public.agent_contacts where id = p_id;
  if pid is null then raise exception 'Contact not found.' using errcode = '22023'; end if;
  if not coalesce((public.is_admin()
          or (public.app_role() = 'management' and pid = public.app_partner()
              and public.app_may_reach_contact(a_id, b_id, pid))), false) then
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

-- origin_is_agent_estate(text,text,text): 1 guard
CREATE OR REPLACE FUNCTION public.origin_is_agent_estate(p_agency text, p_branch text, p_partner_slug text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_branch uuid; v_partner uuid;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  if p_partner_slug is not null and btrim(p_partner_slug) <> '' then
    select id into v_partner from public.partners where slug = p_partner_slug;
  end if;
  if v_partner is not null and not public.is_admin()
     and v_partner is distinct from public.app_partner() then
    return false;
  end if;

  select b.id into v_branch
  from public.branches b join public.agencies a on a.id = b.agency_id
  where b.name = p_branch and a.name = p_agency
    and (v_partner is null or b.partner_id = v_partner)
  limit 1;

  if v_branch is not null and not (
       public.is_admin()
       or exists (select 1 from public.branches b2 where b2.id = v_branch
                   and (public.app_reachable_agency(b2.agency_id)
                        or (public.app_has_scope() and b2.id in (select public.app_scope_branches())))))
  then
    v_branch := null;
  end if;

  if v_branch is null then
    -- An agency that does not exist yet inherits its partner's shape.
    return coalesce((select p.referencing_mode = 'opndoor_referenced'
                       from public.partners p where p.id = v_partner), false);
  end if;

  return public.is_agent_estate(v_branch, public.resolve_route_partner(v_branch, null));
end $function$;

-- origin_referencing_mode(text,text,text): 1 guard
CREATE OR REPLACE FUNCTION public.origin_referencing_mode(p_agency text, p_branch text, p_partner_slug text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_branch uuid; v_partner uuid; v_route uuid;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  if p_partner_slug is not null and btrim(p_partner_slug) <> '' then
    select id into v_partner from public.partners where slug = p_partner_slug;
  end if;
  -- Only an admin may ask about a partner other than their own.
  if v_partner is not null and not public.is_admin()
     and v_partner is distinct from public.app_partner() then
    return null;
  end if;

  select b.id into v_branch
  from public.branches b join public.agencies a on a.id = b.agency_id
  where b.name = p_branch and a.name = p_agency
    and (v_partner is null or b.partner_id = v_partner)
  limit 1;

  -- Adds no reach: an agent cannot learn another agency's rail by typing its name.
  if v_branch is not null and not (
       public.is_admin()
       or exists (select 1 from public.branches b2 where b2.id = v_branch
                   and (public.app_reachable_agency(b2.agency_id)
                        or (public.app_has_scope() and b2.id in (select public.app_scope_branches())))))
  then
    v_branch := null;
  end if;

  if v_branch is null then
    -- No such branch yet. It will be created under this partner, so the partner's
    -- own mode is the honest answer.
    return (select p.referencing_mode from public.partners p where p.id = v_partner);
  end if;

  v_route := public.resolve_route_partner(v_branch, null);
  return public.resolve_referencing_mode(v_branch, v_route);
end $function$;

-- record_eligibility_payment(uuid,numeric,text,text,boolean): 1 guard
CREATE OR REPLACE FUNCTION public.record_eligibility_payment(p_application uuid, p_amount numeric, p_session text, p_payment_intent text, p_livemode boolean)
 RETURNS application_eligibility_payments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications; r public.application_eligibility_payments;
begin
  select * into a from public.applications where id = p_application;
  if not coalesce(found, false) then
    raise exception 'Application % not found', p_application using errcode = '22023';
  end if;

  if a.livemode is distinct from p_livemode then
    raise exception 'Eligibility payment livemode does not match the application'
      using errcode = '22023';
  end if;

  if a.referencing_mode <> 'opndoor_referenced' then
    raise exception 'Application % is not on a rail that takes an eligibility fee', p_application
      using errcode = '22023';
  end if;

  insert into public.application_eligibility_payments
    (application_id, amount, stripe_checkout_session_id, stripe_payment_intent_id, livemode)
  values (p_application, p_amount, p_session, p_payment_intent, p_livemode)
  on conflict (application_id) do update
    set stripe_checkout_session_id = coalesce(public.application_eligibility_payments.stripe_checkout_session_id,
                                              excluded.stripe_checkout_session_id)
  returning * into r;

  -- NO STATUS CHANGE. Paying unlocks the rest of the form; it does not send
  -- anything to anybody. The move to 'referencing' belongs to submission, which
  -- is a decision the tenant makes when they have finished typing.
  return r;
end $function$;

-- record_provider_verdict(uuid,text,text): 1 guard
CREATE OR REPLACE FUNCTION public.record_provider_verdict(p_app uuid, p_verdict text, p_reason text DEFAULT NULL::text)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications;
begin
  if p_verdict not in ('approved','declined') then raise exception 'invalid verdict' using errcode = '22023'; end if;
  select * into a from public.applications where id = p_app;
  if not coalesce(found, false) then raise exception 'application not found'; end if;

  -- Always record what the provider said, whatever happens to the status.
  update public.applications
    set provider_verdict = p_verdict, provider_verdict_at = now()
    where id = a.id returning * into a;
  insert into public.activity_log(application_id, kind, message, actor, visibility)
  values (a.id, 'provider_verdict',
    'Lettings verdict received: ' || p_verdict
      || coalesce(' (' || nullif(btrim(coalesce(p_reason,'')),'') || ')', '') || '.',
    'Lettings', 'internal');

  -- Staff decided first: the verdict is on the record, the status stands.
  if a.decided_by_kind = 'staff' then
    return a;
  end if;

  -- No staff decision: the verdict becomes the decision, from awaiting only.
  if a.status = 'referencing' then
    if p_verdict = 'approved' then
      update public.applications
        set status = 'sent', decided_at = now(), decided_by_kind = 'provider'
        where id = a.id returning * into a;
    else
      update public.applications
        set status = 'declined', decided_at = now(), decided_by_kind = 'provider',
            decline_reason = nullif(btrim(coalesce(p_reason,'')), '')
        where id = a.id returning * into a;
    end if;
  end if;
  return a;
end $function$;

-- referral_fee_preview(text,text,text,numeric,numeric[]): 1 guard
CREATE OR REPLACE FUNCTION public.referral_fee_preview(p_agency text, p_branch text, p_partner_slug text, p_rent numeric, p_shares numeric[])
 RETURNS TABLE(fee_amount numeric, fee_basis_weeks numeric, is_standard boolean, agreement_id uuid, tenant_count integer, shares numeric[])
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_branch uuid; v_route uuid; v_partner uuid; v_n int; f record;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  v_n := greatest(coalesce(array_length(p_shares, 1), 1), 1);

  if p_partner_slug is not null and btrim(p_partner_slug) <> '' then
    select id into v_partner from public.partners where slug = p_partner_slug;
  end if;

  select b.id into v_branch
  from public.branches b join public.agencies a on a.id = b.agency_id
  where b.name = p_branch and a.name = p_agency
    and (v_partner is null or b.partner_id = v_partner)
  limit 1;

  -- Only branches the caller can already see. The preview adds no reach: an
  -- agent cannot price another agency's deal by typing its name.
  if v_branch is not null and not (
       public.is_admin()
       or exists (select 1 from public.branches b2 where b2.id = v_branch
                   and (public.app_reachable_agency(b2.agency_id)
                        or (public.app_has_scope() and b2.id in (select public.app_scope_branches())))))
  then
    v_branch := null;
  end if;

  v_route := case when v_branch is null then v_partner
                  else public.resolve_route_partner(v_branch, null) end;

  select f2.fee_amount, f2.fee_basis_weeks, f2.agreement_id
    into f
  from public.resolve_fee(v_branch, v_route, p_rent, v_n) f2;

  fee_amount := coalesce(f.fee_amount, p_rent);
  fee_basis_weeks := coalesce(f.fee_basis_weeks, 4.35);
  agreement_id := f.agreement_id;
  is_standard := coalesce((select pa.is_standard from public.pricing_agreements pa where pa.id = f.agreement_id), true);
  tenant_count := v_n;
  shares := public.apportion(fee_amount, coalesce(p_shares, array[100]::numeric[]));
  return next;
end $function$;

-- referrer_league(timestamp with time zone,timestamp with time zone,text): 1 guard
CREATE OR REPLACE FUNCTION public.referrer_league(p_start timestamp with time zone, p_end timestamp with time zone, p_scope text DEFAULT 'company'::text)
 RETURNS TABLE(name text, refs integer, fees numeric, is_self boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pid uuid := public.app_partner(); me uuid := auth.uid(); v_mode text; v_branches uuid[];
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
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

-- resolve_agency_match(uuid,uuid): 4 guards
CREATE OR REPLACE FUNCTION public.resolve_agency_match(p_application uuid, p_branch uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_before uuid; v_after uuid; me uuid; who text; v_bname text;
begin
  if not coalesce(public.is_aal2(), false)  then raise exception 'MFA required'  using errcode = '42501'; end if;
  if not coalesce(public.is_opndoor_staff(), false) then raise exception 'not permitted' using errcode = '42501'; end if;

  select name into v_bname from public.branches where id = p_branch;
  if not coalesce(found, false) then raise exception 'Branch not found' using errcode = '22023'; end if;

  select partner_id into v_before from public.applications where id = p_application;
  if not coalesce(found, false) then raise exception 'Application not found' using errcode = '22023'; end if;

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

-- send_deed_to_agent(uuid,text,boolean): 4 guards, owned
CREATE OR REPLACE FUNCTION public.send_deed_to_agent(p_app uuid, p_recipient_email text DEFAULT NULL::text, p_save_contact boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications; r text; owned boolean;
        v_emails text[]; v_names text[]; v_primary text; v_primary_name text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where id = p_app;
  if not coalesce(found, false) then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := coalesce(a.referrer_id = auth.uid(), false);
  if not coalesce((public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and public.app_may_reach_application_org(a.partner_id, a.agency_id, a.branch_id))
          or (r = 'referrer'   and owned)), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if not coalesce(public.can_send_deed(r, owned), false) then
    raise exception 'send not permitted for this role' using errcode = '42501';
  end if;
  if a.status <> 'deed' then raise exception 'deed not yet issued'; end if;
  if r = 'referrer' and (p_recipient_email is not null or p_save_contact) then
    raise exception 'referrers may only send to the resolved contact and cannot save contacts' using errcode = '42501';
  end if;
  if p_recipient_email is not null and p_recipient_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Invalid recipient email' using errcode = '22023';
  end if;

  -- THE WHOLE LIST, ordered so the referrer is first and is what a one-line
  -- "sent to" says when the screen has room for one name.
  select array_agg(t.email order by case t.source when 'referrer' then 1 when 'copy' then 2 else 3 end, t.email),
         array_agg(coalesce(t.display_name, t.email) order by case t.source when 'referrer' then 1 when 'copy' then 2 else 3 end, t.email)
    into v_emails, v_names
    from public.deed_delivery_target(p_app) t
   where coalesce(btrim(t.email), '') <> '';

  v_primary      := (v_emails)[1];
  v_primary_name := (v_names)[1];

  -- An override addresses the send to one person and does NOT silence the
  -- ladder's own answer, which the screen still shows as "resolved to".
  return jsonb_build_object(
    'sent_to',          coalesce(p_recipient_email, v_primary),
    'recipients',       case when p_recipient_email is not null
                             then to_jsonb(array[p_recipient_email])
                             else coalesce(to_jsonb(v_emails), '[]'::jsonb) end,
    'resolved_contact', v_primary,
    'resolved_name',    v_primary_name);
end $function$;

-- send_deed_to_landlord(uuid,text,text): 4 guards, owned
CREATE OR REPLACE FUNCTION public.send_deed_to_landlord(p_app uuid, p_name text, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications; r text; owned boolean; nm text; em text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select * into a from public.applications where id = p_app;
  if not coalesce(found, false) then raise exception 'application not found'; end if;
  r := public.app_role();
  owned := coalesce(a.referrer_id = auth.uid(), false);
  -- Same audience as send_deed_to_agent: an owning referrer, a manager in scope,
  -- or opndoor admin. The UI shows this button only to agency staff; the rule is
  -- enforced here independently of the UI.
  if not coalesce((public.is_admin()
          or (r = 'management' and a.partner_id = public.app_partner()
              and public.app_may_reach_branch(a.branch_id))
          or (r = 'referrer' and owned)), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if not coalesce(public.can_send_deed(r, owned), false) then
    raise exception 'send not permitted for this role' using errcode = '42501';
  end if;
  if a.status <> 'deed' then raise exception 'deed not yet issued' using errcode = '22023'; end if;

  nm := btrim(coalesce(p_name, ''));
  em := btrim(coalesce(p_email, ''));
  if nm = '' then raise exception 'Landlord name is required' using errcode = '22023'; end if;
  if em !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Invalid landlord email' using errcode = '22023';
  end if;

  -- Stored on the application so the send form prefills on a resend.
  update public.applications set landlord_name = nm, landlord_email = em where id = p_app;
  return jsonb_build_object('sent_to', em, 'landlord_name', nm);
end $function$;

-- set_agency_group(uuid,uuid): 3 guards
CREATE OR REPLACE FUNCTION public.set_agency_group(p_agency uuid, p_group uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := auth.uid(); a_pid uuid; g_pid uuid; v_rate numeric; v_name text; v_agr uuid;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select partner_id into a_pid from public.agencies where id = p_agency;
  if a_pid is null then raise exception 'Agency not found' using errcode = '22023'; end if;
  if not coalesce((public.is_admin() or (public.app_role() = 'management' and a_pid = public.app_partner()
                                and public.app_may_reach_agency(p_agency))), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_group is not null then
    select partner_id into g_pid from public.agency_groups where id = p_group;
    if g_pid is null then raise exception 'Group not found' using errcode = '22023'; end if;
    if g_pid <> a_pid then raise exception 'The group and the agency are under different partners.' using errcode = '22023'; end if;

    -- THE MISSING TEST, and the only line added to this function.
    if not coalesce((public.is_admin() or public.app_reachable_group(p_group, g_pid)), false) then
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

-- set_agency_level(uuid,text): 2 guards
CREATE OR REPLACE FUNCTION public.set_agency_level(p_user uuid, p_level text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cur    public.users;
  v_role text;
  v_sees boolean;
  v_old  text;
  v_actor text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  select * into cur from public.users where id = p_user;
  if cur.id is null then
    raise exception 'No such person.' using errcode = '22023';
  end if;

  -- Containment: within my partner, and within my positions if I have any.
  if not coalesce((public.is_admin()
          or (public.app_role() = 'management' and cur.partner_id = public.app_partner() and cur.role <> 'superadmin'
              and public.app_may_reach_user(cur.id))), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- Seniority, both halves. The first says I may touch this person; the second says
  -- I may hand out this level. Without the second a Manager could promote a
  -- Negotiator, who is below her, to Director, who is above her.
  perform public.assert_may_act_on_user(p_user);
  perform public.assert_may_grant_level(p_level);

  -- The three levels, spelled as the product spells them. Anything else is a
  -- typo and must not be guessed at. (assert_may_grant_level has already refused
  -- anything that is not one of the three; this maps the survivors.)
  if p_level = 'Director' then v_role := 'management'; v_sees := true;
  elsif p_level = 'Manager' then v_role := 'management'; v_sees := false;
  elsif p_level = 'Negotiator' then v_role := 'referrer'; v_sees := false;
  else
    raise exception 'An agency level is Director, Manager or Negotiator.' using errcode = '22023';
  end if;

  v_old := public.agency_level_of(p_user);

  /* DEMOTING CLEARS THE COMMISSION-STATEMENT TICK. receives_commission_statements
     is admin-set and nothing else ever cleared it, so a Director demoted to
     Manager kept receiving a monthly PDF of every commission line for their
     party. commission_statement_recipients now tests the level too, so this is
     the belt to that brace -- and it is the half that makes the row on screen
     honest rather than leaving a tick that no longer does anything. */
  if not v_sees and cur.receives_commission_statements then
    perform set_config('app.setting_commission_tick', 'on', true);
    update public.users set receives_commission_statements = false where id = p_user;
    perform set_config('app.setting_commission_tick', 'off', true);
    insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
    values ('user', p_user, 'commission_statement_tick_cleared',
            'level changed to ' || p_level, coalesce(v_actor, 'a manager'), auth.uid());
  end if;

  -- Opndoor's own staff are not agency people and have no level to set. Guarding
  -- here rather than letting the update through: this function would otherwise be
  -- a way to turn a superadmin into a referrer. agency_level_of returns null for
  -- them and for a developer, which is the same answer for the same reason.
  if v_old is null then
    raise exception 'That person is not agency staff, so they have no agency level.' using errcode = '22023';
  end if;

  if v_old = p_level then return; end if;

  update public.users set role = v_role, sees_commission = v_sees where id = p_user;

  v_actor := coalesce((select full_name from public.users where id = auth.uid()), 'an administrator');
  insert into public.user_audit (target_user, partner_id, action, old_value, new_value, actor, actor_id)
  values (p_user, cur.partner_id, 'agency level changed', v_old, p_level, v_actor, auth.uid());
end $function$;

-- set_agency_rates(uuid,numeric,numeric): 2 guards
CREATE OR REPLACE FUNCTION public.set_agency_rates(p_agency uuid, p_partner_rate numeric, p_agent_rate numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := auth.uid(); nm text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  update public.agencies set partner_rate = p_partner_rate, agent_rate = p_agent_rate
    where id = p_agency returning name into nm;
  if nm is null then raise exception 'Agency not found' using errcode = '22023'; end if;
  insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
  values ('agency', p_agency, 'commission_set',
    'partner ' || coalesce(round(p_partner_rate, 4)::text, 'inherit') || ', agent ' || coalesce(round(p_agent_rate, 4)::text, 'inherit'),
    coalesce((select full_name from public.users where id = me), 'an administrator'), me);
end $function$;

-- set_agency_referencing_mode(uuid,text): 2 guards
CREATE OR REPLACE FUNCTION public.set_agency_referencing_mode(p_agency uuid, p_mode text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_mode is not null and p_mode not in ('pre_referenced_open','pre_referenced_screened','opndoor_referenced') then
    raise exception 'Unknown referencing mode %', p_mode using errcode = '22023';
  end if;
  update public.agencies set referencing_mode = p_mode where id = p_agency;
end $function$;

-- set_app_setting_num(text,numeric): 2 guards
CREATE OR REPLACE FUNCTION public.set_app_setting_num(p_key text, p_value numeric)
 RETURNS app_settings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur public.app_settings; res public.app_settings; who text; me uuid := auth.uid();
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_key <> 'bordereau_insurance_rate' then raise exception 'Unknown setting' using errcode = '22023'; end if;
  if p_value is null or p_value < 0 or p_value > 100 then raise exception 'Rate must be between 0 and 100' using errcode = '22023'; end if;

  select * into cur from public.app_settings where key = p_key;
  who := coalesce((select full_name from public.users where id = me), 'an administrator');

  if cur.key is null then
    insert into public.app_settings(key, num_value, updated_by, updated_by_name)
    values (p_key, p_value, me, who) returning * into res;
    insert into public.settings_audit(key, old_value, new_value, actor, actor_id)
    values (p_key, null, p_value::text, who, me);
    return res;
  end if;

  if cur.num_value is distinct from p_value then
    insert into public.settings_audit(key, old_value, new_value, actor, actor_id)
    values (p_key, cur.num_value::text, p_value::text, who, me);
    update public.app_settings
      set num_value = p_value, updated_by = me, updated_by_name = who, updated_at = now()
      where key = p_key returning * into res;
    return res;
  end if;

  return cur; -- unchanged: no audit, no timestamp churn
end $function$;

-- set_application_status(uuid,text): 3 guards
CREATE OR REPLACE FUNCTION public.set_application_status(p_app uuid, p_status text)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.applications;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_status not in ('sent','paid','deed') then raise exception 'invalid status'; end if;
  select * into a from public.applications where id = p_app;
  if not coalesce(found, false) then raise exception 'application not found'; end if;
  -- opndoor admin only. Real Stripe/PandaDoc transitions run through service-role RPCs.
  if not coalesce(public.is_opndoor_staff(), false) then
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

-- set_branch_deed_recipient(uuid,uuid): 2 guards
CREATE OR REPLACE FUNCTION public.set_branch_deed_recipient(p_branch uuid, p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_partner uuid; v_user_partner uuid;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  select partner_id into v_partner from public.branches where id = p_branch;
  if v_partner is null then raise exception 'Branch not found' using errcode = '22023'; end if;
  select partner_id into v_user_partner from public.users where id = p_user;
  if v_user_partner is null or v_user_partner <> v_partner then
    raise exception 'The nominated recipient must be a user in this organisation.' using errcode = '22023';
  end if;
  if not coalesce((
    public.is_admin()
    or (public.app_role() = 'management'
        and v_partner = public.app_partner()
        and public.app_may_reach_branch(p_branch))
  ), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  insert into public.branch_deed_recipient (branch_id, user_id, set_by)
  values (p_branch, p_user, auth.uid())
  on conflict (branch_id) do update set user_id = excluded.user_id, set_by = excluded.set_by, set_at = now();
end $function$;

-- set_group_rates(uuid,numeric,numeric): 2 guards
CREATE OR REPLACE FUNCTION public.set_group_rates(p_group uuid, p_partner_rate numeric, p_agent_rate numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare me uuid := auth.uid(); nm text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  update public.agency_groups set partner_rate = p_partner_rate, agent_rate = p_agent_rate
    where id = p_group returning name into nm;
  if nm is null then raise exception 'Group not found' using errcode = '22023'; end if;
  insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
  values ('agency_group', p_group, 'commission_set',
    'partner ' || coalesce(round(p_partner_rate, 4)::text, 'inherit') || ', agent ' || coalesce(round(p_agent_rate, 4)::text, 'inherit'),
    coalesce((select full_name from public.users where id = me), 'an administrator'), me);
end $function$;

-- set_home_branch(uuid,uuid): 3 guards, app_role comparison
CREATE OR REPLACE FUNCTION public.set_home_branch(p_user uuid, p_branch uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_target public.users; v_old uuid;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  select * into v_target from public.users where id = p_user;
  if not coalesce(found, false) then raise exception 'User not found' using errcode = '22023'; end if;
  v_old := v_target.home_branch_id;

  if not coalesce(public.is_admin(), false) then
    if coalesce(public.app_role(), '') <> 'management' then
      raise exception 'not permitted' using errcode = '42501';
    end if;
    if v_target.partner_id is distinct from public.app_partner() then
      raise exception 'not permitted' using errcode = '42501';
    end if;
    -- Both ends of the move, and the person. Moving somebody INTO a branch
    -- you do not reach is the escalation; moving them OUT of one you do not
    -- reach is reaching into someone else's office to do it.
    if p_branch is not null and not public.app_may_reach_branch(p_branch) then
      raise exception 'You can only place somebody at a branch you reach.' using errcode = '42501';
    end if;
    if v_old is not null and not public.app_may_reach_branch(v_old) then
      raise exception 'You can only move somebody out of a branch you reach.' using errcode = '42501';
    end if;
    -- And never yourself, at any level. This is the reproduced escalation.
    if p_user = auth.uid() then
      raise exception 'Where you sit is set by your manager, not by you.' using errcode = '42501';
    end if;
    perform public.assert_may_act_on_user(p_user);
  end if;

  perform set_config('app.setting_home_branch', 'on', true);
  update public.users set home_branch_id = p_branch where id = p_user;
  perform set_config('app.setting_home_branch', 'off', true);

  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values ('user', p_user, 'home_branch_set',
          coalesce(v_old::text, 'none') || ' -> ' || coalesce(p_branch::text, 'none'),
          (select full_name from public.users where id = auth.uid()), auth.uid());
end $function$;

-- set_node_rate(text,uuid,numeric,boolean): 2 guards
CREATE OR REPLACE FUNCTION public.set_node_rate(p_level text, p_id uuid, p_rate numeric, p_confirm_breach boolean DEFAULT false)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_worst numeric; v_detail text; v_actor text; v_any boolean; b record;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;
  if p_level not in ('group','agency','branch') then
    raise exception 'Unknown level %', p_level using errcode = '22023';
  end if;
  if p_rate is not null and (p_rate < 0 or p_rate > 1) then
    raise exception 'A rate must be between 0%% and 100%%.' using errcode = '22023';
  end if;

  -- Clearing a rate can never breach a deal below: it removes a line.
  v_any := p_rate is not null
       and exists (select 1 from public.all_in_agreements_below(p_level, p_id));
  if v_any then
    v_detail := public.all_in_breach_detail(p_level, p_id, p_rate);
    if p_confirm_breach then
      -- Transaction-local, set here rather than by any caller.
      perform set_config('app.confirm_all_in_breach', 'on', true);
    end if;
  end if;

  if p_level = 'group'  then update public.agency_groups set agent_rate = p_rate where id = p_id;
  elsif p_level = 'agency' then update public.agencies     set agent_rate = p_rate where id = p_id;
  else                          update public.branches      set agent_rate = p_rate where id = p_id;
  end if;

  if v_any and p_confirm_breach then
    select full_name into v_actor from public.users where id = auth.uid();
    insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
    values (p_level, p_id, 'all_in_breach_confirmed', v_detail,
            coalesce(v_actor, 'an administrator'), auth.uid());
    -- EVERY deal that was broken, on its own record. A group over three all-in
    -- agencies breaches three agreements, and each of those agencies is entitled
    -- to find it on theirs.
    for b in select * from public.all_in_agreements_below(p_level, p_id) loop
      insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
      select pa.scope_level, pa.scope_id, 'all_in_breach_confirmed',
             public.all_in_breach_sentence(
               (select coalesce(g.name, a.name) from (select 1) o
                  left join public.agency_groups g on p_level = 'group'  and g.id = p_id
                  left join public.agencies      a on p_level = 'agency' and a.id = p_id),
               p_rate, b.party_name, b.agreed_rate),
             coalesce(v_actor, 'an administrator'), auth.uid()
      from public.pricing_agreements pa where pa.id = b.agreement_id;
    end loop;
    perform set_config('app.confirm_all_in_breach', 'off', true);
  end if;

  select max(t.total) into v_worst
  from (
    select public.commission_total(b2.id, b2.partner_id) as total
    from public.branches b2
    left join public.agencies a on a.id = b2.agency_id
    where (p_level = 'branch' and b2.id = p_id)
       or (p_level = 'agency' and b2.agency_id = p_id)
       or (p_level = 'group'  and a.group_id = p_id)
  ) t;

  if v_worst is not null and v_worst > 0.50 then
    raise exception 'That rate would take a branch to % of the guarantee fee. The most a branch may pay out in total is 50%%.',
      to_char(round(v_worst * 100, 2), 'FM999990.00') || '%' using errcode = '22023';
  end if;
  return coalesce(v_worst, 0);
end $function$;

-- set_receives_commission_statements(uuid,boolean): 3 guards
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
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  select * into v_target from public.users where id = p_user;
  if not coalesce(found, false) then raise exception 'User not found' using errcode = '22023'; end if;

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
  if not coalesce(public.is_admin(), false) then
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

-- set_receives_notifications(uuid,boolean): 2 guards
CREATE OR REPLACE FUNCTION public.set_receives_notifications(p_user uuid, p_on boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ok boolean;
  v_partner uuid;
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;

  select partner_id into v_partner from public.users where id = p_user;
  if v_partner is null and not exists (select 1 from public.users where id = p_user) then
    raise exception 'No such person.' using errcode = 'P0002';
  end if;

  v_ok := public.is_admin()
    or (public.app_role() = 'management'
        and v_partner = public.app_partner()
        and (p_user = auth.uid() or public.user_within_caller_scope(p_user))
        and (p_user = auth.uid()
             or coalesce(public.level_rank_of(p_user), 99) >= coalesce(public.level_rank_of(auth.uid()), 99)));

  if not coalesce(v_ok, false) then
    raise exception 'You can only change this for people at or below your own position, in your own agency.'
      using errcode = '42501';
  end if;

  perform set_config('app.setting_notifications_tick', 'on', true);
  update public.users set receives_notifications = coalesce(p_on, false) where id = p_user;
  perform set_config('app.setting_notifications_tick', 'off', true);

  /* AUDITED INTO org_audit, NOT activity_log. activity_log.application_id is
     NOT NULL and this is not about an application, so a row there throws
     23502 on the first call. The commission tick had the same problem and
     solved it the same way: the record belongs against the PARTY, which is
     what somebody later asks about ("who turned this on for Regent"). */
  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  select coalesce(c.level, 'user'), coalesce(c.org_id, p_user),
         case when coalesce(p_on, false) then 'notifications_on' else 'notifications_off' end,
         coalesce(nullif(btrim(u.full_name), ''), u.email)
           || case when coalesce(p_on, false) then ' now receives ' else ' no longer receives ' end
           || 'notifications for their position',
         coalesce((select a.full_name from public.users a where a.id = auth.uid()), 'System'),
         auth.uid()
    from public.users u
    left join lateral public.commission_statement_party(p_user) c on true
   where u.id = p_user;

  return coalesce(p_on, false);
end $function$;

-- set_referrer_leaderboard_mode(text,text): 2 guards
CREATE OR REPLACE FUNCTION public.set_referrer_leaderboard_mode(p_slug text, p_mode text)
 RETURNS partners
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur public.partners; res public.partners; who text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if p_mode not in ('full','rankings','private') then raise exception 'Invalid leaderboard mode' using errcode = '22023'; end if;
  select * into cur from public.partners where slug = p_slug;
  if cur.id is null then raise exception 'Partner not found' using errcode = '22023'; end if;
  /* THE MODE IS THE PARTNER'S, and on the house route the partner is every
     agency Opndoor carries: one agency's Manager could set how every other
     agency's leaderboard behaves. */
  if not coalesce((public.is_admin() or (public.app_role() = 'management' and cur.id = public.app_partner()
                                and not public.is_our_estate_partner(cur.id))), false) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;
  who := coalesce((select full_name from public.users where id = auth.uid()), 'an administrator');
  if cur.referrer_leaderboard_mode is distinct from p_mode then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'referrer_leaderboard', cur.referrer_leaderboard_mode, p_mode, who);
  end if;
  update public.partners set referrer_leaderboard_mode = p_mode where id = cur.id returning * into res;
  return res;
end $function$;

-- set_user_scope(uuid,text,uuid): 3 guards
CREATE OR REPLACE FUNCTION public.set_user_scope(p_user uuid, p_kind text, p_target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_target public.users;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;

  select * into v_target from public.users where id = p_user;
  if not coalesce(found, false) then raise exception 'User not found' using errcode = '22023'; end if;

  if not coalesce((public.is_admin()
          or (public.app_role() = 'management' and v_target.partner_id = public.app_partner())), false) then
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

-- staff_payment_page_token(text): 1 guard
CREATE OR REPLACE FUNCTION public.staff_payment_page_token(p_ref text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_app public.applications; v_token uuid;
begin
  select * into v_app from public.applications where guarantee_ref = p_ref;
  if not found then return null; end if;

  if not coalesce((public.is_admin()
       or (public.app_role() = 'management' and v_app.partner_id = public.app_partner()
           and public.app_may_reach_branch(v_app.branch_id))
       or (public.app_role() = 'referrer'   and v_app.referrer_id = auth.uid())), false) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  insert into public.payment_page_tokens(application_id, guarantee_ref, expires_at)
  values (v_app.id, v_app.guarantee_ref, now() + interval '90 days')
  on conflict (application_id) do update set expires_at = excluded.expires_at
  returning token into v_token;
  return v_token;
end $function$;

-- submit_application_for_referencing(uuid): 4 guards
CREATE OR REPLACE FUNCTION public.submit_application_for_referencing(p_application uuid)
 RETURNS applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a public.applications;
  prof public.application_profiles;
  v_months int;
  v_statements int;
  v_missing text := '';
begin
  select * into a from public.applications where id = p_application;
  if not coalesce(found, false) then raise exception 'Application % not found', p_application using errcode = '22023'; end if;

  if a.status <> 'draft' then
    raise exception 'This application has already been sent.' using errcode = '42501';
  end if;

  -- THE FEE. First, because it is the one somebody might try to route around.
  if not coalesce(public.eligibility_fee_paid(p_application), false) then
    raise exception 'The application fee has not been paid.' using errcode = '42501';
  end if;

  if coalesce(btrim(a.tenant_title), '') = '' then v_missing := v_missing || 'title, '; end if;
  if a.tenant_dob is null                     then v_missing := v_missing || 'date of birth, '; end if;
  if coalesce(btrim(a.tenant_phone), '') = '' then v_missing := v_missing || 'phone, '; end if;
  if coalesce(a.monthly_rent, 0) <= 0         then v_missing := v_missing || 'monthly rent, '; end if;
  if a.tenancy_start is null                  then v_missing := v_missing || 'tenancy start date, '; end if;

  select * into prof from public.application_profiles where application_id = p_application;
  if coalesce(btrim(prof.nationality), '') = ''            then v_missing := v_missing || 'nationality, '; end if;
  if coalesce(btrim(prof.right_to_rent_category), '') = '' then v_missing := v_missing || 'right to rent, '; end if;
  if coalesce(btrim(prof.declared_name), '') = ''          then v_missing := v_missing || 'your name on the declaration, '; end if;
  if prof.declared_at is null                              then v_missing := v_missing || 'the declaration tick, '; end if;

  if v_missing <> '' then
    raise exception 'Still needed: %', left(v_missing, length(v_missing) - 2) using errcode = '23502';
  end if;

  v_months := public.address_history_months(p_application);
  if v_months < 36 then
    raise exception 'We need three years of address history. You have given us % months.', v_months
      using errcode = '23502';
  end if;

  -- PROOF OF ADDRESS. Every address needs its proof type chosen AND its document,
  -- scoped to that address. The address step's Continue gates on the same.
  if exists (
    select 1 from public.application_addresses ad
    where ad.application_id = p_application
      and (coalesce(btrim(ad.proof_type), '') = ''
           or not exists (
             select 1 from public.application_documents d
             where d.application_id = p_application
               and d.kind = 'proof_of_address'
               and d.address_id = ad.id))
  ) then
    raise exception 'Each address needs its proof of address type chosen and document uploaded.'
      using errcode = '23502';
  end if;

  if not coalesce(exists (select 1 from public.application_incomes i
                  where i.application_id = p_application and not i.is_additional), false) then
    raise exception 'We need at least one main income.' using errcode = '23502';
  end if;

  -- FINANCIALS. Three months of bank statements, OR a completed bank connection
  -- (open banking). The connection is a bank_connection document, written when the
  -- vendor is wired in; a connected applicant then needs no statements.
  if not coalesce(exists (select 1 from public.application_documents d
                  where d.application_id = p_application and d.kind = 'bank_connection'), false) then
    select count(*) into v_statements
    from public.application_documents d
    where d.application_id = p_application and d.kind = 'bank_statement';
    if v_statements < 3 then
      raise exception 'We need three months of bank statements, or a connected bank. You have uploaded %.', v_statements
        using errcode = '23502';
    end if;
  end if;

  update public.applications set status = 'referencing' where id = p_application;
  update public.application_profiles
     set completed_at = coalesce(completed_at, now()), updated_at = now()
   where application_id = p_application;

  insert into public.activity_log (application_id, kind, message, actor)
  values (p_application, 'sent_for_referencing',
          'Application completed and sent for referencing.', 'Tenant');

  select * into a from public.applications where id = p_application;
  return a;
end $function$;

-- sync_application_partner(): 1 guard
CREATE OR REPLACE FUNCTION public.sync_application_partner()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare b record;
begin
  select agency_id, partner_id into b from public.branches where id = new.branch_id;
  if not coalesce(found, false) then raise exception 'branch % not found', new.branch_id; end if;

  -- Structural, always.
  new.agency_id := b.agency_id;

  -- The route. Derived ONLY when the caller did not state one. Both existing
  -- create paths state one, and state the same value this would derive, so this
  -- branch is not reached by the referral path at all.
  if new.partner_id is null then
    new.partner_id := b.partner_id;
  end if;

  return new;
end $function$;

-- trigger_crm_sync(): 1 guard
CREATE OR REPLACE FUNCTION public.trigger_crm_sync()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_req bigint; v_base text;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  v_base := public.ops_functions_base_url();
  if v_base is null then
    -- Raise rather than return quietly: a person is watching this button, and
    -- telling them nothing happened beats a green tick over a call never made.
    raise exception 'The functions base URL is not configured. Seed ops_secrets.functions_base_url with https://<project-ref>.supabase.co before using this.'
      using errcode = '22023';
  end if;

  select net.http_post(
    url := v_base || '/functions/v1/hubspot-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ops-secret', (select secret from public.ops_secrets where name = 'reminders_cron')),
    body := jsonb_build_object('limit', 200)
  ) into v_req;
  return jsonb_build_object('ok', true, 'request_id', v_req);
end $function$;

-- trigger_hubspot_sync(): 1 guard
CREATE OR REPLACE FUNCTION public.trigger_hubspot_sync()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_req bigint; v_base text;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  v_base := public.ops_functions_base_url();
  if v_base is null then
    raise exception 'The functions base URL is not configured. Seed ops_secrets.functions_base_url with https://<project-ref>.supabase.co before using this.'
      using errcode = '22023';
  end if;

  select net.http_post(
    url := v_base || '/functions/v1/hubspot-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ops-secret', (select secret from public.ops_secrets where name = 'reminders_cron')),
    body := jsonb_build_object('limit', 200)
  ) into v_req;
  return jsonb_build_object('ok', true, 'request_id', v_req);
end $function$;

-- update_partner_settings(text,text,text,date,numeric,numeric,text,boolean,boolean): 2 guards
CREATE OR REPLACE FUNCTION public.update_partner_settings(p_slug text, p_name text, p_status text, p_live_from date, p_partner_rate numeric, p_agent_rate numeric, p_referencing_mode text, p_portal_referrals boolean, p_api_access boolean)
 RETURNS partners
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cur public.partners; res public.partners; who text;
begin
  if not coalesce(public.is_aal2(), false) then raise exception 'MFA required' using errcode = '42501'; end if;
  if not coalesce(public.is_admin(), false) then raise exception 'not permitted' using errcode = '42501'; end if;

  select * into cur from public.partners where slug = p_slug;
  if cur.id is null then raise exception 'Partner not found' using errcode = '22023'; end if;

  if btrim(coalesce(p_name,'')) = '' then raise exception 'Partner name is required' using errcode = '22023'; end if;
  if p_partner_rate is null or p_partner_rate < 0 or p_partner_rate > 1 then raise exception 'Partner commission must be between 0 and 100%%' using errcode = '22023'; end if;
  if p_agent_rate is null or p_agent_rate < 0 or p_agent_rate > 1 then raise exception 'Agent commission must be between 0 and 100%%' using errcode = '22023'; end if;
  if coalesce(p_status,'') not in ('active','onboarding','paused') then raise exception 'Invalid status' using errcode = '22023'; end if;
  if coalesce(p_referencing_mode,'') not in ('pre_referenced_open','pre_referenced_screened','opndoor_referenced') then
    raise exception 'Invalid referencing mode' using errcode = '22023';
  end if;

  who := coalesce((select full_name from public.users where id = auth.uid()), 'opndoor admin');

  -- One audit row per changed field (old -> new). Rates recorded to ONE DECIMAL
  -- (never rounded to whole %) so 9.5% can never be mistaken for 10%.
  if cur.partner_rate is distinct from p_partner_rate then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'partner_rate', to_char(cur.partner_rate*100, 'FM990.0') || '%', to_char(p_partner_rate*100, 'FM990.0') || '%', who);
  end if;
  if cur.agent_rate is distinct from p_agent_rate then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'agent_rate', to_char(cur.agent_rate*100, 'FM990.0') || '%', to_char(p_agent_rate*100, 'FM990.0') || '%', who);
  end if;
  if cur.status is distinct from p_status then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'status', cur.status, p_status, who);
  end if;
  if cur.live_from is distinct from p_live_from then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'live_from', coalesce(to_char(cur.live_from,'YYYY-MM'),'—'), coalesce(to_char(p_live_from,'YYYY-MM'),'—'), who);
  end if;
  if cur.name is distinct from p_name then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'name', cur.name, p_name, who);
  end if;

  -- The three new ones. referencing_mode is recorded with its raw value rather
  -- than a friendly label: this trail is read when somebody asks what changed
  -- and when, and a label that gets reworded later makes old rows unreadable.
  if cur.referencing_mode is distinct from p_referencing_mode then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'referencing_mode', cur.referencing_mode, p_referencing_mode, who);
  end if;
  if cur.portal_referrals_enabled is distinct from p_portal_referrals then
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'portal_referrals_enabled',
            case when cur.portal_referrals_enabled then 'on' else 'off' end,
            case when p_portal_referrals then 'on' else 'off' end, who);
  end if;
  if cur.api_access_enabled is distinct from p_api_access then
    -- Worth its own note in the trail: turning this off stops EXISTING keys
    -- working, not just new ones, so this row explains an outage somebody will
    -- be investigating later.
    insert into public.partner_audit(partner_id, field, old_value, new_value, actor)
    values (cur.id, 'api_access_enabled',
            case when cur.api_access_enabled then 'on' else 'off' end,
            case when p_api_access then 'on (existing keys work again)' else 'off (all existing keys stop working)' end,
            who);
  end if;

  update public.partners
    set name = p_name, status = p_status, live_from = p_live_from,
        partner_rate = p_partner_rate, agent_rate = p_agent_rate,
        referencing_mode = p_referencing_mode,
        portal_referrals_enabled = p_portal_referrals,
        api_access_enabled = p_api_access
    where id = cur.id
    returning * into res;

  return res;
end $function$;

-- users_level_ladder_guard(): 1 guard
CREATE OR REPLACE FUNCTION public.users_level_ladder_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.role is distinct from old.role
     or new.status is distinct from old.status then
    if not coalesce((public.may_act_on_user(old.id)
            or current_user in ('service_role', 'postgres', 'supabase_admin')), false) then
      raise exception 'You can only change the level or access of someone below your own level.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $function$;

