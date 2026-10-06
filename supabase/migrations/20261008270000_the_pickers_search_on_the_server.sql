-- THE PICKERS MUST SCALE TO RIGHTMOVE.
--
-- Matt (dg): "with a large supplier (Rightmove could have thousands of
-- agencies), don't list everything on click. Show 'Start typing an
-- agency name' with the 10 most recently used agencies for that
-- person, then search as they type (name, office or postcode),
-- returning the best 20 matches with 'Keep typing to narrow it down' if
-- there are more. Keep 'Add a new agency' at the bottom. Same for
-- offices when an agency has many. Make sure search is done on the
-- server, not by loading every agency into the page."
--
-- THE BINDING HALF IS THE LAST SENTENCE. `searchAgencies` filters an
-- array the browser already holds, so the page holds every agency. At
-- a few hundred that is invisible; at thousands it is the referral form
-- failing to open, on the partner Wednesday is for. Showing 20 results
-- out of a list you have already downloaded solves nothing.
--
-- =========================================================================
-- WHY REACHABILITY IS IN THE WHERE CLAUSE AND NOT APPLIED AFTERWARDS
-- =========================================================================
--
-- It would be faster to take the first 21 text matches and then drop the
-- ones the caller may not reach. It would also be wrong: if twenty of
-- those twenty-one belong to another estate, the reader is shown one
-- result and told that is all there is. The limit has to be applied to
-- the rows they may SEE, so app_reachable_agency sits in the predicate
-- and the trigram indexes below are what keep that cheap.
--
-- AND partner_id IS NOT THE AUTHORISATION TEST. Every agency Opndoor
-- onboards shares one house partner, so `partner_id = p_partner` scopes
-- the picker to a ROUTE and says nothing about who may see what.
-- app_reachable_agency is the test; the partner filter is a filter.
--
-- =========================================================================
-- POSTCODE
-- =========================================================================
--
-- There is no postcode column on either table: `address` is free text
-- and the postcode is inside it. So "search by postcode" is a substring
-- of the address, which is also why the trigram index matters -- a
-- leading-wildcard ILIKE cannot use a btree.

create extension if not exists pg_trgm;

create index if not exists agencies_name_trgm
  on public.agencies using gin (name extensions.gin_trgm_ops);

create index if not exists agencies_address_trgm
  on public.agencies using gin (address extensions.gin_trgm_ops);

create index if not exists branches_name_trgm
  on public.branches using gin (name extensions.gin_trgm_ops);

create index if not exists branches_address_trgm
  on public.branches using gin (address extensions.gin_trgm_ops);
-- The recents read walks one person's applications newest first.
create index if not exists applications_referrer_recent
  on public.applications (referrer_id, created_at desc) where agency_id is not null;

/* WHAT THE READER TYPED, MATCHED THREE WAYS AND RANKED ONE.

   Matt's order is "name, office or postcode", and the ranking has to
   put a name match above an address match or a postcode shared by
   thirty offices buries the agency somebody is typing.

     0  the name starts with what they typed
     1  the name contains it
     2  one of its offices matches by name
     3  the address (which is where a postcode lives) matches

   TIES BREAK BY similarity THEN BY NAME, so the list is stable between
   keystrokes: a board that reshuffles under the cursor is unusable. */
create or replace function public.search_agencies_for_referral(
  p_partner uuid, p_query text, p_limit integer default 20
) returns table(id uuid, name text, address text, offices integer, matched_on text)
language plpgsql
stable security definer
set search_path = ''
as $$
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
  order by m.rank, public.similarity(a.name, v_q) desc, a.name
  -- ONE MORE THAN ASKED FOR, so the caller can say "keep typing to
  -- narrow it down" without a second counting query over the same set.
  limit greatest(coalesce(p_limit, 20), 1) + 1;
end $$;

/* THE TEN THIS PERSON LAST REFERRED FOR, which is the empty state.

   Matt wants something useful before a single key is pressed, and the
   honest source is what they have actually done: applications they
   referred, newest first, one row per agency. No new table and nothing
   to keep in step -- a "recents" store would be a second record of a
   fact the referrals already carry, and it would drift.

   BY referrer_id, NOT BY WHO IS LOOKING AT THE SCREEN'S ESTATE: "the 10
   most recently used agencies for that PERSON". A manager who refers
   rarely gets a short list, which is honest, and the search is one
   keystroke away. */
create or replace function public.recent_agencies_for_referral(
  p_partner uuid, p_limit integer default 10
) returns table(id uuid, name text, address text, offices integer, last_used timestamptz)
language plpgsql
stable security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;

  return query
  select a.id, a.name, a.address,
         (select count(*)::integer from public.branches b where b.agency_id = a.id),
         max(ap.created_at)
  from public.applications ap
  join public.agencies a on a.id = ap.agency_id
  where ap.referrer_id = auth.uid()
    and a.partner_id = p_partner
    and coalesce(a.is_placeholder, false) = false
    and public.app_reachable_agency(a.id)
  group by a.id, a.name, a.address
  order by max(ap.created_at) desc
  limit greatest(coalesce(p_limit, 10), 1);
end $$;

/* AND THE SAME FOR OFFICES, "when an agency has many".

   Scoped to one agency, so reachability is asked once of the agency
   rather than per office: an office the caller could not reach inside
   an agency they can is not a state this product has. */
create or replace function public.search_branches_for_referral(
  p_agency uuid, p_query text, p_limit integer default 20
) returns table(id uuid, name text, address text, area text)
language plpgsql
stable security definer
set search_path = ''
as $$
declare v_q text := btrim(coalesce(p_query, ''));
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  if not coalesce(public.app_reachable_agency(p_agency), false) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return query
  select b.id, b.name, b.address, b.area
  from public.branches b
  where b.agency_id = p_agency
    and coalesce(b.is_placeholder, false) = false
    and (v_q = '' or b.name ilike '%' || v_q || '%'
         or coalesce(b.address, '') ilike '%' || v_q || '%'
         or coalesce(b.area, '') ilike '%' || v_q || '%')
  /* AN EMPTY QUERY IS ALLOWED HERE AND NOT ON AGENCIES, which is the
     asymmetry Matt's wording carries: "same for offices WHEN AN AGENCY
     HAS MANY". An agency's office list is bounded by that agency, so
     opening it is reasonable; the agency list is bounded by the
     supplier, which is the thing that can be thousands. */
  order by b.name
  limit greatest(coalesce(p_limit, 20), 1) + 1;
end $$;

revoke all on function public.search_agencies_for_referral(uuid, text, integer) from public, anon;
revoke all on function public.recent_agencies_for_referral(uuid, integer) from public, anon;
revoke all on function public.search_branches_for_referral(uuid, text, integer) from public, anon;
grant execute on function public.search_agencies_for_referral(uuid, text, integer) to authenticated;
grant execute on function public.recent_agencies_for_referral(uuid, integer) to authenticated;
grant execute on function public.search_branches_for_referral(uuid, text, integer) to authenticated;
