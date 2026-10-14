-- Agency search also serves Opendoor staff, whose agency referral form can
-- search across more than one route. A NULL partner means all agencies the
-- caller is authorised to reach; a UUID keeps supplier search route-scoped.
--
-- Return the owning partner slug so same-named agencies in separate estates
-- remain distinguishable when staff search across routes.

drop function public.search_agencies_for_referral(uuid, text, integer);
drop function public.recent_agencies_for_referral(uuid, integer);

create function public.search_agencies_for_referral(
  p_partner uuid, p_query text, p_limit integer default 20
) returns table(
  id uuid, name text, address text, offices integer, matched_on text, partner_slug text
)
language plpgsql
stable security definer
set search_path = ''
as $$
declare v_q text := btrim(coalesce(p_query, ''));
begin
  if not coalesce(public.is_aal2(), false) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  if length(v_q) < 2 then return; end if;

  return query
  select a.id, a.name, a.address,
         (select count(*)::integer from public.branches b where b.agency_id = a.id),
         m.how, p.slug
  from public.agencies a
  join public.partners p on p.id = a.partner_id
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
    and (p_partner is null or a.partner_id = p_partner)
    and coalesce(a.is_placeholder, false) = false
    and public.app_reachable_agency(a.id)
  order by m.rank, strpos(lower(a.name), lower(v_q)), length(a.name), a.name
  limit greatest(coalesce(p_limit, 20), 1) + 1;
end $$;

create function public.recent_agencies_for_referral(
  p_partner uuid, p_limit integer default 10
) returns table(
  id uuid, name text, address text, offices integer, last_used timestamptz, partner_slug text
)
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
         max(ap.created_at), p.slug
  from public.applications ap
  join public.agencies a on a.id = ap.agency_id
  join public.partners p on p.id = a.partner_id
  where ap.referrer_id = auth.uid()
    and (p_partner is null or a.partner_id = p_partner)
    and coalesce(a.is_placeholder, false) = false
    and public.app_reachable_agency(a.id)
  group by a.id, a.name, a.address, p.slug
  order by max(ap.created_at) desc
  limit greatest(coalesce(p_limit, 10), 1);
end $$;

revoke all on function public.search_agencies_for_referral(uuid, text, integer) from public, anon;
revoke all on function public.recent_agencies_for_referral(uuid, integer) from public, anon;
grant execute on function public.search_agencies_for_referral(uuid, text, integer) to authenticated;
grant execute on function public.recent_agencies_for_referral(uuid, integer) to authenticated;
