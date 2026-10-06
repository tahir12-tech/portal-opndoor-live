-- A NEW PARTNER CAN BE SYNCED.
--
-- hubspot-sync makes the primary applicant-to-partner association from
-- hubspot_partner_map. That table was seeded ONCE, by 20260705150500, with a
-- `select ... from public.partners` as they stood on 5 July 2026. Every partner
-- on dev was created on or after 11 August, so the table is EMPTY while seven
-- partners hold live sync cursors:
--
--   select (select count(*) from hubspot_partner_map) as map_rows,
--          (select count(*) from partners)            as partners,
--          (select count(*) from hubspot_sync_cursor_partner) as cursors;
--   -->  map_rows 0 | partners 7 | cursors 7
--
-- And 20260812030000, which introduced the per-partner cursor, added a trigger
-- that seeds hubspot_sync_cursor_partner when a partner is inserted WITHOUT a
-- companion for the map. So every partner created since is drained from birth and
-- can never be synced: the sync picks up its events, finds no map row, and stops.
-- That is the recurring HubSpot sync error, and it gets worse rather than better
-- with time, because each new partner adds a queue that can never drain.
--
-- TWO HALVES, because one without the other is the bug again:
--   the BACKFILL fixes the seven partners that exist,
--   the TRIGGER stops the eighth from being born broken.
-- The original seed had only the first half, which is why this is the second time
-- the table has needed filling.
--
-- IDENTITY, unchanged from the original seed: the HubSpot partner id and the
-- company key are derived from the slug (hs_partner_id = slug,
-- partner_company_key = 'PARTNER:' || slug). Whether that is the right identity
-- is a HubSpot question and not one this migration reopens; it is what the sync
-- already looks up by, so anything else would break the partners that do work.

-- ---------------------------------------------------------------------------
-- 1. THE SEVEN THAT EXIST.
--
-- The same statement as 20260705150500, deliberately: re-running a seed that is
-- idempotent by construction is the cheapest correct backfill, and it repairs a
-- row that was deactivated or renamed as well as inserting a missing one.
-- ---------------------------------------------------------------------------
insert into public.hubspot_partner_map (partner_id, partner_slug, hs_partner_id, partner_company_key)
select id, slug, slug, 'PARTNER:' || slug from public.partners
on conflict (partner_id) do update set
  partner_slug = excluded.partner_slug, hs_partner_id = excluded.hs_partner_id,
  partner_company_key = excluded.partner_company_key, active = true, updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. AND EVERY PARTNER AFTER THEM.
--
-- Mirrors the cursor trigger from 20260812030000 so the two facts a partner needs
-- in order to sync are created together and cannot drift apart again. A partner
-- with a cursor and no map row is exactly the state this migration exists to
-- repair, so the two triggers firing on the same insert is the point.
--
-- AFTER INSERT rather than BEFORE: the row must exist for the foreign key, and a
-- failure here must not abort the partner's own creation. Onboarding a partner is
-- the business act; wiring its CRM mapping is bookkeeping that follows it.
-- ---------------------------------------------------------------------------
create or replace function public.hubspot_seed_partner_map()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  insert into public.hubspot_partner_map (partner_id, partner_slug, hs_partner_id, partner_company_key)
  values (new.id, new.slug, new.slug, 'PARTNER:' || new.slug)
  on conflict (partner_id) do update set
    partner_slug = excluded.partner_slug, hs_partner_id = excluded.hs_partner_id,
    partner_company_key = excluded.partner_company_key, active = true, updated_at = now();
  return new;
end $function$;

comment on function public.hubspot_seed_partner_map() is
  'Gives a newly created partner its hubspot_partner_map row, so the sync can associate its applicants. Companion to the cursor trigger from 20260812030000, whose absence left every partner created after 5 July 2026 drained but unsyncable.';

drop trigger if exists hubspot_seed_partner_map on public.partners;
create trigger hubspot_seed_partner_map
  after insert on public.partners
  for each row execute function public.hubspot_seed_partner_map();

-- ---------------------------------------------------------------------------
-- 3. AND A SLUG CHANGE FOLLOWS THE PARTNER.
--
-- partner_company_key is derived from the slug, so renaming a partner's slug
-- without updating the map leaves the sync associating against a company key
-- HubSpot no longer knows. Cheap to keep in step, and the alternative is a class
-- of silent mis-association that looks exactly like the fault above.
-- ---------------------------------------------------------------------------
create or replace function public.hubspot_follow_partner_slug()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  if new.slug is distinct from old.slug then
    update public.hubspot_partner_map
       set partner_slug = new.slug, hs_partner_id = new.slug,
           partner_company_key = 'PARTNER:' || new.slug, updated_at = now()
     where partner_id = new.id;
  end if;
  return new;
end $function$;

drop trigger if exists hubspot_follow_partner_slug on public.partners;
create trigger hubspot_follow_partner_slug
  after update of slug on public.partners
  for each row execute function public.hubspot_follow_partner_slug();
