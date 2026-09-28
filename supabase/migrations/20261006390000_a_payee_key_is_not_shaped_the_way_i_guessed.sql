-- A PAYEE KEY IS NOT SHAPED THE WAY I GUESSED.
--
-- 20261006350000 put a reach gate on commission_statement_ref, which was
-- right: it read and MINTED any payee's statement number, and minting
-- consumes the month's next sequence, so calling it for somebody else both
-- read their reference and moved their counter.
--
-- The gate parses the key as '<kind>:<uuid>'. The key is actually
--
--     <partner slug>|<level>:<org uuid>
--     <partner slug>|<level>:name/<lowercased org name>     (historic rows)
--
-- built by payeeKey() in src/data/commissionSplit.ts:84 with the slug
-- prepended by the caller. Three real rows on dev, all of the first form:
--
--     opndoor-agents|agency:b93277db-9e0a-4ac6-bff9-6a4a1500b1ea
--
-- So split_part(key, ':', 1) returned 'opndoor-agents|agency', matched no arm
-- of my CASE, fell to `else false`, and raised 42501. Every statement
-- reference for every non-admin has been refused since that migration.
--
-- I did not catch it because the pgTAP test I wrote for the gate passes a key
-- I invented in the same shape as the parser. A test and the code it tests
-- sharing one wrong assumption is the failure mode of writing both at once,
-- and the fix is a test built from the same helper the product uses. That
-- test is in this migration's companion pgTAP change, using a real key.
--
-- THE HISTORIC 'name/' FORM is handled rather than refused. Those rows have no
-- org id, so there is no uuid to reach-check; matching the name against the
-- caller's own reachable orgs is exact enough, and refusing them outright
-- would lock a Director out of their own older statements.
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
