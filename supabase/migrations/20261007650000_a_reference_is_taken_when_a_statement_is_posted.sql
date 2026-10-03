/* =====================================================================
   A REFERENCE IS TAKEN WHEN A STATEMENT IS POSTED, AND NEVER BY LOOKING.

   Matt, 2026-10-03, three times over: "Statement references are being
   assigned when a statement is viewed or exported (e.g. STMT-2026-10-0001
   for October, which hasn't ended; STMT-2026-09-0004 for Frost via
   Kestrel yesterday). A reference must only be assigned when the monthly
   run actually posts a statement."

   `commission_statement_ref` looked the number up and, finding none,
   INSERTED one. Every caller therefore minted: the Reporting heading, all
   three statement exports, and the supplier's own statement card. Three
   numbers on dev were taken with nothing sent -- the two Matt named and
   one more taken this morning while Kestrel's Reporting was open.

   SPLIT IN TWO, with the reach logic unchanged in both.

     commission_statement_ref        reads. Returns null when the month
                                     has not been posted.
     mint_commission_statement_ref   mints, and only the monthly run may
                                     call it.

   THE REACH PREAMBLE IS REPRODUCED FROM THE DEPLOYED DEFINITION rather
   than retyped. It is forty lines of isolation -- which agency, branch,
   group, user or partner a caller may read a statement for -- and three
   pgTAP files assert it. Retyping it to change the tail is how one of
   those arms would quietly lose a case.
   ===================================================================== */

CREATE OR REPLACE FUNCTION public.commission_statement_ref(p_month text, p_payee_key text)
 RETURNS text
language plpgsql security definer set search_path = '' as $$
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

  /* LOOK IT UP. NEVER MINT. Matt, 2026-10-03: "A reference must only be
     assigned when the monthly run actually posts a statement. Viewing,
     exporting or previewing shows 'Reference assigned when the statement
     is posted'."

     THIS FUNCTION MINTED ON READ, and its own callers said so: the
     comment in CommissionStatement.tsx reads "commission_statement_ref
     MINTS on read. Asking for every payee in the month would burn a
     sequence number for every party an admin merely scrolled past" --
     which is a workaround for this line, written by somebody who had
     noticed. Three numbers on dev were taken that way, including
     STMT-2026-10-0001 for a month that has not ended.

     NULL, NOT AN ERROR, and not a placeholder string. A month with no
     posted statement has no reference, which is a fact about the month
     and not a failure; the caller renders the sentence. Returning text
     here would put wording in the database and give every reader a
     different chance to get it wrong. */
  select seq into v_seq from public.commission_statement_refs
   where statement_month = p_month and payee_key = p_payee_key;
  if not found then return null; end if;
  return 'STMT-' || p_month || '-' || lpad(v_seq::text, 4, '0');
end $$;

/* =====================================================================
   THE MINTING HALF, FOR THE MONTHLY RUN.
   Same reach logic, same sequence, same shape of number. What is new
   is that it refuses anybody who is not the run, and that it is the
   only thing in the schema that writes commission_statement_refs.
   ===================================================================== */

CREATE OR REPLACE FUNCTION public.mint_commission_statement_ref(p_month text, p_payee_key text)
 RETURNS text
language plpgsql security definer set search_path = '' as $$
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

  /* THE MONTHLY RUN, AND NOBODY ELSE. Matt: "A reference must only be
     assigned when the monthly run actually posts a statement."

     The preamble above already admits an admin, because reading a
     statement is an admin thing to do. Taking a NUMBER is not: it is the
     act of issuing, and the only caller that issues is the run, which
     reaches the database as service_role with no uid. An admin who wants
     a number posts the statement.

     AFTER the reach checks rather than before them, so a caller with no
     business asking about a payee still gets "you can only read a
     statement for a party you hold" and learns nothing about whether one
     has been posted. */
  if not (auth.uid() is null and coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'A statement reference is taken when the statement is posted.'
      using errcode = '42501';
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
end $$;

/* NOT FROM A BROWSER. Every function is born with EXECUTE to PUBLIC, which
   `npm run drift` catches and which 20261007080000 exists because an
   earlier revoke forgot. `from public, anon, authenticated` names all
   three: granting through role membership is how the last one stayed
   callable. */
revoke all on function public.mint_commission_statement_ref(text, text)
  from public, anon, authenticated;
grant execute on function public.mint_commission_statement_ref(text, text)
  to service_role;
