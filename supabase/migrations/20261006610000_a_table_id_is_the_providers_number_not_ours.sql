-- A table_id IS THE PROVIDER'S NUMBER, NOT OURS.
--
-- Round 6, M6. The referencing hand-over rail claims each inbound delivery by
-- the provider's `table_id`, and both keys put that number in ONE GLOBAL
-- namespace:
--
--   referencing_inbound_events    PRIMARY KEY (table_id)
--   application_provider_links    UNIQUE      (table_id)
--
-- A table_id is the provider's own row number. It is unique inside THEIR
-- system, not inside ours, and we hand out one token per agency precisely so
-- that "a leaked token compromises one agency" -- that is 20260812170000's own
-- stated reason for the per-agency token form. A global key defeats it:
--
--   * token A POSTs {"table_id": N} where N is agency B's row number. They are
--     sequential and A can see its own, so N is a guess away. A wins the
--     claim. B's genuine delivery then hits 23505 and is answered HTTP 200
--     "User already sent to guarantor." -- so the PROVIDER marks it delivered,
--     B's tenant is never created, and application_provider_links' unique
--     means B can never be linked either.
--   * it is mode-blind as well: a SANDBOX token can burn a LIVE table_id. That
--     is the other half of round 5's M6, which 20261006490000 fixed only in
--     the creator.
--
-- THE NAMESPACE IS THE PARTNER AND THE MODE. Not the token: a token can be
-- rotated, and keying on it would let the same delivery be re-claimed under a
-- new one. The provider is the partner; live and sandbox are separate
-- universes. So both keys become (partner_id, livemode, table_id).
--
-- Safe to re-key: all three tables are empty on dev (0 events, 0 links, 0
-- tokens) and the rail is not in use anywhere. Both columns are derived from
-- the authenticated TOKEN, never from the payload, which is the same rule
-- 20261006490000 established for livemode on the creator.

-- ---------------------------------------------------------------------------
-- referencing_inbound_events
-- ---------------------------------------------------------------------------
alter table public.referencing_inbound_events
  add column if not exists partner_id uuid references public.partners(id),
  add column if not exists livemode boolean;

-- Backfill from the token before the columns are made NOT NULL. There are no
-- rows today; this is here so the migration is correct if that changes before
-- it is applied anywhere else.
update public.referencing_inbound_events e
   set partner_id = t.partner_id, livemode = t.livemode
  from public.referencing_inbound_tokens t
 where t.id = e.token_id and (e.partner_id is null or e.livemode is null);

alter table public.referencing_inbound_events
  alter column livemode set not null;

alter table public.referencing_inbound_events
  drop constraint if exists referencing_inbound_events_pkey;
alter table public.referencing_inbound_events
  add constraint referencing_inbound_events_pkey
  primary key (partner_id, livemode, table_id);

comment on constraint referencing_inbound_events_pkey on public.referencing_inbound_events is
  'The provider''s row number is unique inside THEIR system. Ours is scoped by '
  'the partner the presenting token belongs to and by its mode, so one '
  'provider cannot claim or burn another''s delivery, and a sandbox token '
  'cannot burn a live one.';

-- ---------------------------------------------------------------------------
-- application_provider_links
-- ---------------------------------------------------------------------------
-- Denormalised from the application rather than joined, because a unique
-- constraint cannot span two tables.
alter table public.application_provider_links
  add column if not exists partner_id uuid references public.partners(id),
  add column if not exists livemode boolean;

update public.application_provider_links l
   set partner_id = a.partner_id, livemode = a.livemode
  from public.applications a
 where a.id = l.application_id and (l.partner_id is null or l.livemode is null);

alter table public.application_provider_links
  drop constraint if exists application_provider_links_table_id_key;
create unique index if not exists application_provider_links_provider_row
  on public.application_provider_links (partner_id, livemode, table_id);

-- And keep them true: the link's partner and mode ARE the application's, so
-- they are stamped rather than trusted from a caller.
create or replace function public.application_provider_links_stamp()
returns trigger language plpgsql security definer set search_path to '' as $function$
begin
  select a.partner_id, a.livemode into new.partner_id, new.livemode
    from public.applications a where a.id = new.application_id;
  if new.livemode is null then
    raise exception 'That application does not exist.' using errcode = '22023';
  end if;
  return new;
end $function$;

drop trigger if exists application_provider_links_stamp on public.application_provider_links;
create trigger application_provider_links_stamp
  before insert or update of application_id on public.application_provider_links
  for each row execute function public.application_provider_links_stamp();

revoke all on function public.application_provider_links_stamp() from public, anon, authenticated;
