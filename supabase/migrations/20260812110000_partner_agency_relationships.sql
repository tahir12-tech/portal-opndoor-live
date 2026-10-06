-- ===========================================================================
-- Visibility follows a RELATIONSHIP, not ownership.
--
-- THE PROBLEM OWNERSHIP CANNOT SOLVE
-- agencies.partner_id says who introduced an agency, and agencies_select uses
-- it as the visibility rule. So an agency belongs to exactly one partner and is
-- invisible to every other. Route attribution (20260812010000) lets one agency
-- give a different commercial answer per route, but a referrer who cannot SEE
-- an agency cannot select it, cannot refer against it, and route attribution
-- has nothing to attribute. The two halves are the same rule.
--
-- THE THREE WAYS A RELATIONSHIP BEGINS, AND WHY THE ORDER MATTERS
--   introduced     this partner put the agency into the system
--   user_attached  this partner has a user who works there
--   transacted     this partner has an application at this agency
--
-- The first two are BOOTSTRAPS and the third is not. "Transacted with it"
-- cannot be the way a relationship starts, because it is circular: to refer
-- against an agency you must see it, and under transacted-with you only see it
-- after you have referred. An agent at an agency somebody else introduced is
-- reached by user_attached; that is the case the whole design exists for.
-- transacted exists to KEEP a relationship alive after the introducing reason
-- goes away, not to create one.
--
-- WHY A TABLE AND NOT A PREDICATE
-- The alternative is an RLS predicate that derives the relationship live, by
-- joining applications on every agency read. Three things wrong with it: it is
-- a correlated subquery on the hot path of every org screen, it makes
-- visibility a side effect of data rather than a fact somebody can inspect, and
-- it cannot express "we used to work with them and no longer do" without a
-- second mechanism anyway. A row that says why is auditable; a join is not.
--
-- CONTACTS ARE NOT AFFECTED BY ANY OF THIS. See 20260812120000. Sharing an
-- agency does not share a contact book, and that is deliberate and permanent.
-- ===========================================================================

create table if not exists public.partner_agency_relationships (
  partner_id uuid not null references public.partners(id) on delete cascade,
  agency_id  uuid not null references public.agencies(id) on delete cascade,

  -- Independent booleans rather than a single "source", because a partner can
  -- acquire a relationship several ways and losing one must not silently drop
  -- the others. A partner who introduced an agency AND has staff there AND has
  -- transacted keeps visibility until all three are false.
  introduced    boolean not null default false,
  user_attached boolean not null default false,
  transacted    boolean not null default false,

  first_seen_at timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  primary key (partner_id, agency_id),

  -- A relationship with no reason is not a relationship. Deleting the last
  -- reason must delete the row, not leave one that grants visibility for
  -- nothing.
  constraint relationship_has_a_reason check (introduced or user_attached or transacted)
);

create index if not exists partner_agency_rel_agency_idx
  on public.partner_agency_relationships (agency_id);

alter table public.partner_agency_relationships enable row level security;

-- A partner may see their OWN relationships and nobody else's. Reading the full
-- table would tell one partner which other partners work with an agency, which
-- is a client list by another route.
drop policy if exists partner_agency_rel_select on public.partner_agency_relationships;
create policy partner_agency_rel_select on public.partner_agency_relationships
  for select to authenticated
  using (public.is_admin() or partner_id = public.app_partner());

comment on table public.partner_agency_relationships is
  'Which partners can reach which agencies, and why. Replaces agencies.partner_id as the VISIBILITY rule; that column keeps its other meaning, which is who introduced the agency. Never exposes one partner''s relationships to another: that would be a client list.';

-- ---------------------------------------------------------------------------
-- Backfill. Every existing agency becomes an "introduced" relationship with the
-- partner that owns it today, so visibility after this migration is EXACTLY
-- what it was before it. Nobody gains sight of anything.
-- ---------------------------------------------------------------------------
insert into public.partner_agency_relationships (partner_id, agency_id, introduced)
select a.partner_id, a.id, true
from public.agencies a
on conflict (partner_id, agency_id) do update set introduced = true;

-- ---------------------------------------------------------------------------
-- A user attached to an agency. The bootstrap that makes cross-route reach
-- possible: an agent works at an agency, so their partner can reach it,
-- whoever introduced it.
-- ---------------------------------------------------------------------------
create table if not exists public.user_agency_attachments (
  user_id    uuid not null references public.users(id) on delete cascade,
  agency_id  uuid not null references public.agencies(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null,
  primary key (user_id, agency_id)
);

alter table public.user_agency_attachments enable row level security;

drop policy if exists user_agency_attachments_select on public.user_agency_attachments;
create policy user_agency_attachments_select on public.user_agency_attachments
  for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.users u
                where u.id = user_id and u.partner_id = public.app_partner())
  );

comment on table public.user_agency_attachments is
  'Which agencies a member of staff actually works at. The bootstrap for cross-route reach: it is what lets an agent refer against an agency another partner introduced. Maintains the user_attached flag on partner_agency_relationships.';

-- ---------------------------------------------------------------------------
-- Keeping the flags true. Three maintainers, one per reason.
-- ---------------------------------------------------------------------------

-- introduced: set at creation, from the column that still records it.
create or replace function public.rel_mark_introduced() returns trigger
language plpgsql security definer set search_path to '' as $function$
begin
  insert into public.partner_agency_relationships (partner_id, agency_id, introduced)
  values (new.partner_id, new.id, true)
  on conflict (partner_id, agency_id) do update
    set introduced = true, updated_at = now();
  return new;
end $function$;

drop trigger if exists agencies_mark_introduced on public.agencies;
create trigger agencies_mark_introduced after insert on public.agencies
  for each row execute function public.rel_mark_introduced();

-- user_attached: recomputed for the pair, so removing one user of several does
-- not drop the flag while another still works there.
create or replace function public.rel_sync_user_attached() returns trigger
language plpgsql security definer set search_path to '' as $function$
declare v_user uuid; v_agency uuid; v_partner uuid; v_still boolean;
begin
  v_user   := coalesce(new.user_id, old.user_id);
  v_agency := coalesce(new.agency_id, old.agency_id);
  select u.partner_id into v_partner from public.users u where u.id = v_user;
  if v_partner is null then return coalesce(new, old); end if;   -- opndoor admin: no partner to relate

  select exists (
    select 1 from public.user_agency_attachments ua
    join public.users u on u.id = ua.user_id
    where ua.agency_id = v_agency and u.partner_id = v_partner
  ) into v_still;

  if v_still then
    insert into public.partner_agency_relationships (partner_id, agency_id, user_attached)
    values (v_partner, v_agency, true)
    on conflict (partner_id, agency_id) do update
      set user_attached = true, updated_at = now();
  else
    -- Last user gone. Clear the flag, and delete the row if nothing else holds
    -- it up, because relationship_has_a_reason would otherwise reject the update.
    delete from public.partner_agency_relationships
     where partner_id = v_partner and agency_id = v_agency
       and not introduced and not transacted;
    update public.partner_agency_relationships
       set user_attached = false, updated_at = now()
     where partner_id = v_partner and agency_id = v_agency;
  end if;
  return coalesce(new, old);
end $function$;

drop trigger if exists user_agency_attachments_sync on public.user_agency_attachments;
create trigger user_agency_attachments_sync
  after insert or delete on public.user_agency_attachments
  for each row execute function public.rel_sync_user_attached();

-- transacted: an application at an agency keeps the relationship alive.
--
-- THIS FIRES ON THE REFERRAL PATH, so it is written to be incapable of failing
-- it. The insert cannot violate a foreign key, because both ids come from a row
-- that already satisfies them, and cannot violate the check, because it sets
-- transacted true. Placeholders are skipped: a direct signup transacting with
-- its own house row is noise.
create or replace function public.rel_mark_transacted() returns trigger
language plpgsql security definer set search_path to '' as $function$
begin
  if exists (select 1 from public.agencies a where a.id = new.agency_id and a.is_placeholder) then
    return new;
  end if;
  insert into public.partner_agency_relationships (partner_id, agency_id, transacted)
  values (new.partner_id, new.agency_id, true)
  on conflict (partner_id, agency_id) do update
    set transacted = true, updated_at = now();
  return new;
end $function$;

drop trigger if exists applications_mark_transacted on public.applications;
create trigger applications_mark_transacted after insert on public.applications
  for each row execute function public.rel_mark_transacted();

-- ---------------------------------------------------------------------------
-- The question every policy will ask, in one place.
-- ---------------------------------------------------------------------------
create or replace function public.partner_can_reach_agency(p_agency uuid)
returns boolean
language sql stable security definer set search_path to '' as $$
  select public.is_admin()
      or exists (
        select 1 from public.partner_agency_relationships r
        where r.agency_id = p_agency and r.partner_id = public.app_partner()
      )
$$;

revoke all on function public.partner_can_reach_agency(uuid) from public, anon;
grant execute on function public.partner_can_reach_agency(uuid) to authenticated;

-- Visibility must be unchanged by this migration. Every agency reachable before
-- it is reachable after it, and no agency became reachable by anyone new.
do $$
declare v_missing int; v_extra int;
begin
  select count(*) into v_missing
  from public.agencies a
  where not exists (
    select 1 from public.partner_agency_relationships r
    where r.agency_id = a.id and r.partner_id = a.partner_id);
  if v_missing > 0 then
    raise exception '% agenc(ies) lost visibility: no relationship for the owning partner', v_missing;
  end if;

  select count(*) into v_extra
  from public.partner_agency_relationships r
  join public.agencies a on a.id = r.agency_id
  where r.partner_id <> a.partner_id;
  if v_extra > 0 then
    raise exception '% relationship(s) grant visibility beyond the owning partner on a migration that must change nothing', v_extra;
  end if;
end $$;
