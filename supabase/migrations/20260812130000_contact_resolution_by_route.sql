-- ===========================================================================
-- Which contact, when an agency has several partners' contacts on it.
--
-- THE PROBLEM SHARING CREATES
-- Before sharing, an agency belonged to one partner, so every contact on it
-- belonged to that partner and "the primary contact" was unambiguous.
-- effective_primary_contact does `where is_primary limit 1`
-- (20260702134358:38-42), which was correct because there was only ever one
-- partner's worth of contacts to choose between.
--
-- Under sharing that is no longer true. Two partners can both reach an agency
-- and each keeps their own contact book on it (20260812120000), so `limit 1`
-- now picks ARBITRARILY between two partners' primaries. For deed delivery that
-- means an executed Deed of Guarantee can be emailed to the wrong agency
-- contact: not a stranger, but the right agency reached through somebody else's
-- relationship, which is a disclosure of one partner's applicant to another
-- partner's staff.
--
-- WHY THE OLD FUNCTION IS LEFT ALONE
-- effective_primary_contact is called by the partner API's org listing, the
-- deed code and has_agent_contact. Changing its signature or its answer would
-- reach all of them at once, on the referral path, to fix a problem that cannot
-- occur until an agency actually has two partners' contacts. So it stays, and a
-- partner-aware sibling is added beside it. On any agency with one partner's
-- contacts the two return the same row, which is every agency today.
-- ===========================================================================

create or replace function public.effective_primary_contact_route(p_branch uuid, p_partner uuid)
returns public.agent_contacts
language sql stable security definer set search_path to '' as $$
  -- Branch-level before agency-level, which is the precedence
  -- effective_contacts already uses, with the partner scope added. One query
  -- and an ORDER BY rather than two lookups and a coalesce, because a row
  -- composite cannot be coalesced.
  select c.*
    from public.agent_contacts c
   where c.partner_id = p_partner
     and c.is_primary
     and (
       c.branch_id = p_branch
       or (c.branch_id is null
           and c.agency_id = (select b.agency_id from public.branches b where b.id = p_branch))
     )
   order by (c.branch_id is not null) desc, c.created_at asc
   limit 1
$$;

comment on function public.effective_primary_contact_route(uuid, uuid) is
  'The primary contact AT this branch that belongs to a given partner, branch-level before agency-level. Exists because org sharing lets one agency hold several partners'' contact books, and effective_primary_contact''s `limit 1` would otherwise pick between them arbitrarily and could email a deed through another partner''s relationship.';

revoke all on function public.effective_primary_contact_route(uuid, uuid) from public, anon;
grant execute on function public.effective_primary_contact_route(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Deed delivery resolves by ROUTE.
--
-- Reproduced in full from 20260812040000. The change is the contact fallback:
-- it now asks for the contact belonging to the application's own route partner,
-- and only then falls back to the unscoped primary. The unscoped fallback stays
-- so that an application whose route partner keeps no contact book at that
-- agency still delivers rather than silently failing, and `source` says which
-- happened so the difference is visible rather than assumed.
-- ---------------------------------------------------------------------------
create or replace function public.deed_delivery_target(p_application uuid)
returns table (email text, display_name text, source text, verified boolean)
language sql stable security definer set search_path to '' as $$
  select
    coalesce(d.email, rc.email, c.email),
    coalesce(
      nullif(btrim(coalesce(d.agency_name, '')), ''),
      nullif(btrim(coalesce(d.first_name, '') || ' ' || coalesce(d.last_name, '')), ''),
      rc.name, c.name
    ),
    case
      when d.application_id is not null then 'delivery_contact'
      when rc.id is not null            then 'route_contact'
      else 'branch_contact'
    end,
    case when d.application_id is not null then d.verified_at is not null else true end
  from public.applications a
  left join public.application_delivery_contacts d on d.application_id = a.id
  left join lateral (
    select * from public.effective_primary_contact_route(a.branch_id, a.partner_id)
  ) rc on true
  left join lateral (
    select * from public.effective_primary_contact(a.branch_id)
  ) c on true
  where a.id = p_application
$$;

comment on function public.deed_delivery_target(uuid) is
  'Where an executed deed goes: the tenant-named delivery contact, else the primary contact belonging to this application''s own route partner, else the unscoped branch primary. source says which was used. The route-scoped step exists so a shared agency cannot deliver one partner''s deed through another partner''s contact.';

-- ---------------------------------------------------------------------------
-- Today every agency has exactly one partner's contacts, so the route-scoped
-- answer and the unscoped answer must agree everywhere. If they already differ,
-- sharing has been used before this fix landed and somebody needs to look.
-- ---------------------------------------------------------------------------
do $$
declare v_diff int;
begin
  select count(*) into v_diff
  from public.applications a
  where a.branch_id is not null
    and (select email from public.effective_primary_contact_route(a.branch_id, a.partner_id)) is not null
    and (select email from public.effective_primary_contact_route(a.branch_id, a.partner_id))
        is distinct from (select email from public.effective_primary_contact(a.branch_id));
  if v_diff > 0 then
    raise warning 'ROUTE CONTACT DIFFERS from the unscoped primary on % application(s). Expected zero before org sharing is used. Investigate before relying on deed delivery.', v_diff;
  end if;
end $$;
