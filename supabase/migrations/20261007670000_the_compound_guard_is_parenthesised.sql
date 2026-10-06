/* =====================================================================
   AND THE COMPOUND CONDITION IS PARENTHESISED INSIDE THE COALESCE.

   20261007660000 wrapped the run guard, and `guardsAreNullSafe.test.ts`
   failed it again on its stricter second rule:

     "wraps a COMPOUND condition whole, because `not` binds tighter than
      `and`"

   That test strips the `coalesce( ... , false)` it finds and then asks
   whether what is left still has a top-level `and` -- counting only
   operators OUTSIDE parentheses. My condition was

     not coalesce(A and B, false)

   which IS wrapped whole and is correct, but reads to that check exactly
   like the mistake it exists to catch: an operand wrapped while `not`
   applies to something wider. 20261006470000 is the migration it is
   named for.

   So the term gets its own parentheses:

     not coalesce((A and B), false)

   Identical to Postgres, and unambiguous to a reader and to the guard.
   The lesson is the guard's, not the expression's: a rule you cannot
   check mechanically is a rule that gets waived.

   A THIRD MIGRATION ON ONE FUNCTION, rather than an edit of the second.
   20261007660000 has been applied to dev, and "any correction to an
   earlier migration goes in a NEW migration" has no exception for one
   that happens to be idempotent -- the whole value of the rule is that
   dev equals a clean filename-order apply without anybody having to
   reason about which exceptions were safe.
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
  if not coalesce((auth.uid() is null and coalesce(auth.jwt() ->> 'role', '') = 'service_role'), false) then
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
