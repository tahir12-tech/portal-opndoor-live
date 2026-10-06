-- A SUPPLIER'S SETTLEMENT STATEMENT HAS A STORED REFERENCE TOO.
--
-- Fold F3: "Statement: reference becomes STMT-YYYY-MM-NNNN, sequential per
-- payee per month, stable across renames (no name slug)."
--
-- The month statement already carries one, minted by
-- commission_statement_ref. The two SETTLEMENT statements do not: they build
-- `STMT-<PAYEE-SLUG>-<YYYYMM>` from the payee's name in the client, which is
-- exactly the name slug F3 says to stop using. Rename Rightmove and every
-- reference already issued to them stops matching.
--
-- The client comment explaining why they were left alone says they "have no
-- payee key to ask the RPC with (the partner one is not even keyed on a
-- payee the table knows)". That is true and it is what this fixes: the CASE
-- that decides whether a caller may read a reference knows group, agency,
-- branch and user, and a PARTNER is none of those, so asking for one was
-- refused. One arm.
--
-- WHO MAY READ A PARTNER'S REFERENCE. An opndoor admin, who already falls
-- through above; and the partner themselves, which is `v_id = app_partner()`
-- -- on the supplier rail partner_id IS the company boundary, so that is the
-- right test there and is the same test the supplier's own screens use. It
-- is emphatically NOT the right test on the agency rail, where every agency
-- shares the house partner, but an agency payee arrives through the 'agency'
-- arm and never this one.
--
-- The rest of the body is 20261006740000's, verbatim. Copied rather than
-- edited in place because that migration is applied and a correction is a new
-- file.
--
-- Extends the isolation suite: tenant_isolation.test.sql already asserts that
-- a Director cannot mint a reference for another party and that a Manager
-- without the capability cannot mint one at all; both still hold, because
-- this adds an arm to the reach test and changes neither gate above it.

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
    null;
  elsif auth.uid() is null
        and coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    -- The monthly run. See 20261006740000.
    null;
  else
    v_tail  := regexp_replace(coalesce(p_payee_key, ''), '^.*\|', '');
    v_kind  := split_part(v_tail, ':', 1);
    v_ident := substring(v_tail from position(':' in v_tail) + 1);

    if v_ident is null or v_ident = '' or v_kind = '' then
      raise exception 'That is not a payee.' using errcode = '22023';
    end if;

    if v_ident like 'name/%' then
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
                -- A SUPPLIER READING ITS OWN. On the supplier rail partner_id
                -- IS the company, so this is the boundary there. An agency
                -- payee never reaches this arm; it arrives as 'agency'.
                when 'partner' then v_id = public.app_partner()
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
