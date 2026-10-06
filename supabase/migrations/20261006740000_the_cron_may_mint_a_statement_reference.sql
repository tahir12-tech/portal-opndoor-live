-- THE MONTHLY STATEMENT HAS NEVER BEEN SENT, TO ANYBODY.
--
-- commission_statement_ref falls through its gate only for is_admin() or
-- app_role() = 'opndoor_manager'. The monthly run is two pg_cron jobs
-- (20261005150000) posting to the commission-statements Edge Function, which
-- calls this RPC with the SERVICE key and no user JWT at all. Measured on dev
-- rather than reasoned:
--
--   set local role service_role;
--   current_user = service_role, auth.uid() IS NULL,
--   is_admin() = false, may_see_commission() = false
--
--   select public.commission_statement_ref('2026-11', <a real payee key>);
--   ERROR 42501: You can only read a statement for a party you hold.
--
-- So the gate refuses the only caller that ever runs it, for every payee,
-- every month. public.commission_statement_sends holds ZERO rows on dev. The
-- three rows in commission_statement_refs were minted from a browser by one
-- seeding transaction on 2026-09-26 -- identical created_at to the
-- microsecond across three consecutive subtransaction ids, which is one
-- top-level call site, not three months of cron runs.
--
-- NOT A PRODUCTION FAULT. The whole subsystem is absent from the live 65
-- migrations: `git grep -l commission_statement 3520a26 -- supabase/migrations`
-- returns nothing. It would have shipped broken at cutover instead, which is
-- the only reason it is worth fixing now rather than later.
--
-- WHY THE OBVIOUS TEST FOR "IS THIS THE CRON" IS WRONG HERE. The codebase
-- already has an idiom for it, `current_user in ('service_role','postgres',
-- 'supabase_admin')`, used in five places. All five are SECURITY INVOKER
-- trigger functions, where current_user really is the caller, so they are
-- correct. This function is SECURITY DEFINER, and inside one of those
-- current_user is the OWNER. Measured:
--
--   security definer  -> current_user = postgres
--   security invoker  -> current_user = service_role
--
-- Copying the idiom here would therefore have written a test that is TRUE for
-- every caller, opening the gate to every signed-in user in the product. That
-- is the whole finding, and it is why the arm below tests something else.
--
-- WHAT THE ARM ACTUALLY TESTS, and both halves are load-bearing:
--
--   auth.uid() is null      no end user is attached to this request. A
--                           signed-in caller always has one, so no browser
--                           session reaches this arm however its role claim
--                           is spelled.
--   verified role claim     PostgREST sets request.jwt.claims from the token
--                           it has already verified against the project
--                           secret. A caller who can forge that claim holds
--                           the service key and has everything anyway.
--
-- Asserted in both directions:
--   the_work_still_works.test.sql  the cron can now mint one (failed first)
--   tenant_isolation.test.sql      a Director still cannot mint for an agency
--                                  they do not hold; a Manager without
--                                  sees_commission still cannot, even for
--                                  their own; and a signed-in caller carrying
--                                  a service_role claim is still refused,
--                                  because they have a uid
--
-- Nothing else in the body changes. Everything from `v_tail :=` down is the
-- text of 20261006470000:1052 unaltered.

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
  elsif auth.uid() is null
        and coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    -- THE MONTHLY RUN. No end user is attached to the request and the
    -- verified token says service_role: this is the cron reaching the Edge
    -- Function, which is the only unattended caller there is. It mints a
    -- reference for a payee the SERVER chose, not one a browser asked for.
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

comment on function public.commission_statement_ref(text, text) is
  'Mints or returns the STMT-YYYY-MM-NNNN reference for one payee in one '
  'month. Readable by an opndoor admin, by a Director for a party they hold, '
  'and by the unattended monthly run -- no end user plus a verified '
  'service_role token. Not by current_user, which inside a SECURITY DEFINER '
  'function is the owner and would be true for everybody (20261006740000).';
