/* =====================================================================
   A REFERENCE IS SHOWN ONLY ONCE THE STATEMENT HAS BEEN POSTED.

   Matt, 2026-10-03, with a screenshot of an October statement carrying
   STMT-2026-10-0001: "Statements for a month not yet posted (e.g.
   October 2026 today) ... don't show a reference even if one was
   assigned before the reference fix."

   20261007650000 split minting from reading, so nothing takes a number
   by being looked at any more. What it could not undo is the numbers
   already taken: three on dev, measured and reported, including
   October's -- minted on 26 September, when somebody opened October's
   statement in a month that has not ended.

   EXISTENCE WAS THE WRONG TEST and postedness is the right one. The refs
   table records a number reserved; `commission_statement_sends` records
   a statement actually sent. Only the second is a fact about the world.

   NOTHING IS DELETED OR RENUMBERED. The reserved rows stay, and that is
   deliberate: `mint_commission_statement_ref` looks a payee up before
   allocating, so when the real run posts October it will find
   STMT-2026-10-0001 waiting for Regent's Lettings and reuse it. Deleting
   them is what would risk a gap, not keeping them.
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
  /* AND ONLY ONCE IT HAS ACTUALLY BEEN POSTED. Matt, 2026-10-03: "don't
     show a reference even if one was assigned before the reference fix
     (STMT-2026-10-0001 was assigned this morning)."

     20261007650000 stopped READING from minting, which fixed everything
     from that moment on and left behind the numbers already taken --
     three on dev, including October's, which is a month that has not
     ended. A reference that names no posted statement is not a
     reference; it is a number somebody's screen produced.

     SO POSTEDNESS IS THE TEST, not existence. `commission_statement_sends`
     carries a row per payee per month when the run actually sends, and
     that is the only record of a statement having been issued. The refs
     row stays exactly where it is: the run will reuse it when it posts,
     which is what keeps the sequence from gapping. */
  select r.seq into v_seq
    from public.commission_statement_refs r
    join public.commission_statement_sends s
      on s.statement_month = r.statement_month and s.payee_key = r.payee_key
   where r.statement_month = p_month and r.payee_key = p_payee_key;
  if not found then return null; end if;
  return 'STMT-' || p_month || '-' || lpad(v_seq::text, 4, '0');
end $$;
