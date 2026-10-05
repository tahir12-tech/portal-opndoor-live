-- THE PICKER SEARCH HAD NO similarity() TO CALL.
--
-- A correction to 20261008270000, in a new migration because that one
-- is already on dev.
--
-- pg_trgm is installed in the `extensions` schema, not in public, and
-- this function is `set search_path = ''` like every other definer
-- here. So `public.similarity(...)` resolved to nothing and EVERY
-- search raised 42883: the function was unusable from the first
-- keystroke.
--
-- THE INDEXES WERE FINE, which is why the migration applied cleanly:
-- CREATE INDEX runs under the session search_path, not the function's,
-- so `gin_trgm_ops` resolved and all four landed. Only the call inside
-- the body was broken, and nothing in the apply could see it. Worth
-- recording: a migration applying without error says the DDL parsed,
-- not that the function runs.

CREATE OR REPLACE FUNCTION public.search_agencies_for_referral(p_partner uuid, p_query text, p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, name text, address text, offices integer, matched_on text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_q text := btrim(coalesce(p_query, ''));
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  -- TWO CHARACTERS BEFORE WE ASK THE DATABASE ANYTHING. One letter
  -- matches most of the book and is a scan dressed up as a search.
  if length(v_q) < 2 then return; end if;

  return query
  select a.id, a.name, a.address,
         (select count(*)::integer from public.branches b where b.agency_id = a.id),
         m.how
  from public.agencies a
  cross join lateral (
    select case
      when a.name ilike v_q || '%' then 0
      when a.name ilike '%' || v_q || '%' then 1
      when exists (select 1 from public.branches b
                    where b.agency_id = a.id and b.name ilike '%' || v_q || '%') then 2
      when coalesce(a.address, '') ilike '%' || v_q || '%' then 3
      when exists (select 1 from public.branches b
                    where b.agency_id = a.id and coalesce(b.address, '') ilike '%' || v_q || '%') then 3
      else null
    end as rank,
    case
      when a.name ilike '%' || v_q || '%' then 'name'
      when exists (select 1 from public.branches b
                    where b.agency_id = a.id and b.name ilike '%' || v_q || '%') then 'office'
      else 'address'
    end as how
  ) m
  where m.rank is not null
    and a.partner_id = p_partner
    and coalesce(a.is_placeholder, false) = false
    -- THE AUTHORISATION TEST. See the header: the partner filter above
    -- is a route filter and is not this.
    and public.app_reachable_agency(a.id)
  /* THE TIEBREAK NEEDS NO EXTENSION. It was similarity(), which lives
     in the `extensions` schema -- and this function runs with
     search_path = '', so the call resolved to nothing and every search
     raised 42883. Qualifying it would work and would tie the picker to
     where an extension happens to be installed.

     AND SIMILARITY WAS ADDING LITTLE HERE. The matching is substring,
     not fuzzy, so every row already contains what was typed; what the
     reader wants next is the one where it appears EARLIEST and the
     name is shortest -- "Frost" before "Frost Partnership Lettings
     Group" before "North Frost". strpos gives that, deterministically,
     so the list does not reshuffle between keystrokes. */
  order by m.rank, strpos(lower(a.name), lower(v_q)), length(a.name), a.name
  -- ONE MORE THAN ASKED FOR, so the caller can say "keep typing to
  -- narrow it down" without a second counting query over the same set.
  limit greatest(coalesce(p_limit, 20), 1) + 1;
end $function$;
