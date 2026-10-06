-- MAKE DEV SAY WHAT THE FILES SAY.
--
-- scripts/schema-drift.mjs compares the final state the migration files
-- describe against dev's catalogue. It found five function bodies where they
-- disagree, and two of them are fixes that were written, applied, TESTED and
-- then silently rolled back on dev:
--
--   create_invited_user     dev still calls set_user_scope, so it still asks
--                           the ladder about a person who does not exist yet
--   set_user_scope          dev still has the containment inline rather than
--                           delegating to assert_may_grant_position
--   agreement_for_agency    dev lacks the may_see_commission() gate
--   commission_statement_ref  dev has the version with no reach gate at all
--
-- HOW THAT HAPPENED, because it is the process fault underneath this whole
-- round. Several of these migrations were GENERATED: read pg_get_functiondef
-- into a file, apply a substitution, emit the result. If that snapshot is
-- taken before a later change and emitted after it, the later change is
-- discarded without a word. That is what re-running an old migration does
-- too, and it is why dev and the files parted company badly enough that a
-- revoke which broke every user invite sat green in the suite.
--
-- Two of these were tested and passed. commission_statement_ref returned the
-- refusal sentence that only the NEW version contains, so it was live at that
-- moment and is not now. A passing test proves the code was right when it
-- ran, not that it is still there.
--
-- So: the files are restated here, extracted from them verbatim by
-- scripts/extract-latest-definition.mjs rather than retyped. This migration
-- is a no-op on a clean apply and a correction on dev, which is the only
-- shape a drift fix is allowed to have.

-- create_invited_user, as 20261006380000_what_the_third_reviewer_found.sql defines it
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

-- set_user_scope, as 20261006380000_what_the_third_reviewer_found.sql defines it
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

-- agreement_for_agency, as 20261006380000_what_the_third_reviewer_found.sql defines it
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

-- commission_statement_ref, as 20261006390000_a_payee_key_is_not_shaped_the_way_i_guessed.sql defines it
create or replace function public.commission_statement_ref(p_month text, p_payee_key text)
returns text
language plpgsql security definer set search_path to ''
as $function$
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
      if not public.may_see_commission() then
        raise exception 'You can only read a statement for a party you hold.' using errcode = '42501';
      end if;
      if not (
        (v_kind = 'agency' and exists (select 1 from public.agencies a
            where lower(btrim(a.name)) = v_name and public.app_may_reach_agency(a.id)))
        or (v_kind = 'branch' and exists (select 1 from public.branches b
            where lower(btrim(b.name)) = v_name and public.app_may_reach_branch(b.id)))
        or (v_kind = 'group' and exists (select 1 from public.agency_groups g
            where lower(btrim(g.name)) = v_name and public.app_reachable_group(g.id, g.partner_id)))
      ) then
        raise exception 'You can only read a statement for a party you hold.' using errcode = '42501';
      end if;
    else
      begin
        v_id := v_ident::uuid;
      exception when others then
        raise exception 'That is not a payee.' using errcode = '22023';
      end;
      if not public.may_see_commission() then
        raise exception 'You can only read a statement for a party you hold.' using errcode = '42501';
      end if;
      if not (case v_kind
                when 'group'  then public.app_reachable_group(v_id, (select partner_id from public.agency_groups where id = v_id))
                when 'agency' then public.app_may_reach_agency(v_id)
                when 'branch' then public.app_may_reach_branch(v_id)
                when 'user'   then public.app_may_reach_user(v_id)
                else false
              end) then
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

-- ===========================================================================
-- AND agency_match_queue, WRITTEN OUT INSTEAD OF PATCHED BY STRING SURGERY
-- ===========================================================================
-- 20261006380000 added its missing is_aal2() step-up with a DO block that
-- read pg_get_functiondef, did a replace() on the text and executed the
-- result. It worked, and it made the migration non-declarative: the file no
-- longer says what the function IS, so the drift check cannot compare them
-- and reported it forever. A migration should be readable as the answer, not
-- as a recipe for computing the answer. Here it is, literally.
CREATE OR REPLACE FUNCTION public.agency_match_queue()
 RETURNS TABLE(application_id uuid, guarantee_ref text, tenant_name text, property text, typed_name text, auto_agency_id uuid, auto_agency_name text, candidates jsonb, state text, matched_by text, resolved_branch_name text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_opndoor_staff() and public.is_aal2() then raise exception 'not permitted' using errcode = '42501'; end if;
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
