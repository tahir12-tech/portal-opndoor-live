-- ===========================================================================
-- DIRECT-RAIL AGENCY MATCHING, back-office and invisible to the tenant.
--
-- A direct-signup tenant types the letting agency's name free-text, exactly as
-- now. We match that string to a network agency SERVER SIDE, afterwards, so the
-- signup form never becomes a way to enumerate which agencies work with us.
--
-- THE RULES THIS ENCODES, all decided deliberately:
--
--   Strictest match.   Auto-accept ONLY an exact normalised-name match, and
--                       only the AGENCY. No fuzzy auto-accept at all. The fuzzy
--                       scores are still computed and stored, so we can watch
--                       what tenants actually type and loosen the rule later
--                       against real data rather than a guess.
--   Never the branch.   A match resolves the agency and nothing else. The branch
--                       is always chosen by a person, because the tenant gave us
--                       an agency name and no branch signal we would trust.
--   Never blocks.       The match is a side effect of submission. A failure here
--                       is logged and dropped; the application proceeds. The deed
--                       needs the tenant's email, which is already required, and
--                       needs nothing from this.
--   Route is pinned.    Setting a branch derives agency_id (structural) but must
--                       leave partner_id alone. Commission follows the route the
--                       application arrived by (opndoor-direct), never the agency
--                       it lands on. resolve_agency_match refuses the write if
--                       the route moves, and an assertion at the foot proves it.
--   Direct rail only.   The referral path already carries a real branch and its
--                       own partner. The matcher no-ops on anything that is not
--                       an opndoor-direct application, so that path is untouched.
--
-- ADDITIVE. One new table, three new admin RPCs, one matcher, one extension.
-- Nothing existing changes shape, and the Rightmove referral path passes through
-- none of it.
-- ===========================================================================

-- pg_trgm is for the fuzzy SCORES ONLY, which are logged and never accepted on.
-- The exact match reuses agencies.name_key and needs no extension.
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. The normalisation, as a function so the exact match and the stored
--    name_key cannot drift. It is the SAME expression the generated column uses
--    (20260812100000): lower, trim, strip a trailing Ltd or Limited. An
--    assertion at the foot proves the two agree for every agency, because an
--    exact match that normalised differently from dedup would mean two things by
--    "the same agency".
-- ---------------------------------------------------------------------------
create or replace function public.match_name_key(p_name text)
returns text language sql immutable set search_path to '' as $fn$
  select lower(btrim(regexp_replace(btrim(coalesce(p_name, '')), '\s+(ltd|limited)\.?$', '', 'i')));
$fn$;

comment on function public.match_name_key(text) is
  'Normalises a free-text agency name the same way agencies.name_key is generated, so an exact match means what dedup and the partner API mean. Match-only; does not change the stored key.';

revoke all on function public.match_name_key(text) from public, anon;
grant execute on function public.match_name_key(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Where a match lives. One row per direct application with a named agency.
--    The result is a CANDIDATE, not a branch: nothing here touches the
--    application until a person resolves it.
-- ---------------------------------------------------------------------------
create table if not exists public.application_agency_match (
  application_id  uuid primary key references public.applications(id) on delete cascade,
  typed_name      text not null,                 -- what the tenant typed, snapshotted
  typed_name_key  text not null,                 -- normalised, for the exact match
  -- The one exact, unambiguous, confirmed agency, or null when zero or several.
  auto_agency_id  uuid references public.agencies(id) on delete set null,
  -- Top fuzzy candidates {agency_id, name, partner_id, sim}. LOGGED FOR
  -- CALIBRATION, never accepted on. This is how we learn what to loosen to.
  candidates      jsonb not null default '[]'::jsonb,
  state           text not null default 'needs_review'
                    check (state in ('needs_review', 'resolved', 'dismissed')),
  resolved_branch_id uuid references public.branches(id) on delete set null,
  resolved_by     uuid references public.users(id) on delete set null,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.application_agency_match is
  'The reconciliation queue for direct-rail agency names. A row is a candidate an admin resolves to a branch or dismisses; it never changes the application on its own. See 20260824120000.';

create index if not exists application_agency_match_open_idx
  on public.application_agency_match (created_at desc) where state = 'needs_review';

-- All access is through the definer RPCs below. No direct table grant.
alter table public.application_agency_match enable row level security;
revoke all on table public.application_agency_match from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The matcher. Called after a direct application is submitted. Records a
--    candidate; changes nothing on the application.
-- ---------------------------------------------------------------------------
create or replace function public.match_application_agency(p_application uuid)
returns void
language plpgsql security definer set search_path to '' as $fn$
declare
  v_direct uuid;
  a public.applications;
  v_typed text; v_kind text; v_key text;
  v_auto uuid; v_exact int;
  v_candidates jsonb;
begin
  select id into v_direct from public.partners where slug = 'opndoor-direct';

  select * into a from public.applications where id = p_application;
  if not found then return; end if;

  -- Direct rail only. The referral path carries its own branch and partner and
  -- must never pass through here.
  if a.partner_id is distinct from v_direct then return; end if;

  select kind, agency_name into v_kind, v_typed
    from public.application_delivery_contacts where application_id = p_application;

  -- Only a letting agent has an agency. A private landlord, or a blank name, has
  -- nothing to reconcile; retire any stale row (the kind can change while draft).
  if v_kind is distinct from 'letting_agent' or coalesce(btrim(v_typed), '') = '' then
    delete from public.application_agency_match where application_id = p_application;
    return;
  end if;

  v_key := public.match_name_key(v_typed);

  -- EXACT, AND ONLY EXACT. Auto-accept the agency when exactly one confirmed,
  -- non-placeholder, live agency shares the normalised name. Zero or several
  -- both mean a person decides. The branch is never auto-set either way.
  -- min(uuid) does not exist in PostgreSQL; array_agg then index, and only keep
  -- it when there was exactly one.
  select count(*), (array_agg(id))[1] into v_exact, v_auto
    from public.agencies
   where not is_placeholder and review_state = 'confirmed' and livemode
     and name_key = v_key;
  if v_exact <> 1 then v_auto := null; end if;

  -- Fuzzy candidates, for CALIBRATION ONLY. Never used to accept anything.
  select coalesce(jsonb_agg(c order by (c->>'sim')::numeric desc), '[]'::jsonb)
    into v_candidates
  from (
    select jsonb_build_object(
             'agency_id', ag.id, 'name', ag.name, 'partner_id', ag.partner_id,
             'sim', round(extensions.similarity(public.match_name_key(ag.name), v_key)::numeric, 3)
           ) as c
    from public.agencies ag
    where not ag.is_placeholder and ag.review_state = 'confirmed' and ag.livemode
      and extensions.similarity(public.match_name_key(ag.name), v_key) > 0.1
    order by extensions.similarity(public.match_name_key(ag.name), v_key) desc
    limit 5
  ) s;

  insert into public.application_agency_match
    (application_id, typed_name, typed_name_key, auto_agency_id, candidates, state, updated_at)
  values (p_application, btrim(v_typed), v_key, v_auto, v_candidates, 'needs_review', now())
  on conflict (application_id) do update set
    typed_name     = excluded.typed_name,
    typed_name_key = excluded.typed_name_key,
    auto_agency_id = excluded.auto_agency_id,
    candidates     = excluded.candidates,
    -- Re-matching must not reopen a row a person already resolved or dismissed.
    state          = case when public.application_agency_match.state = 'needs_review'
                          then 'needs_review'
                          else public.application_agency_match.state end,
    updated_at     = now();
end $fn$;

comment on function public.match_application_agency(uuid) is
  'Records an agency-match CANDIDATE for a direct application. Auto-accepts only an exact name_key match, and only the agency; never the branch, never the application. No-op off the direct rail. Called as a non-blocking side effect of submission.';

revoke all on function public.match_application_agency(uuid) from public, anon;
grant execute on function public.match_application_agency(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. The admin queue.
-- ---------------------------------------------------------------------------
create or replace function public.agency_match_queue()
returns table (
  application_id   uuid,
  guarantee_ref    text,
  tenant_name      text,
  property         text,
  typed_name       text,
  auto_agency_id   uuid,
  auto_agency_name text,
  candidates       jsonb,
  created_at       timestamptz
)
language plpgsql stable security definer set search_path to '' as $fn$
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  return query
    select m.application_id, a.guarantee_ref,
           btrim(coalesce(a.tenant_first_name, '') || ' ' || coalesce(a.tenant_last_name, '')),
           btrim(coalesce(a.prop_city, '') || ' ' || coalesce(a.prop_postcode, '')),
           m.typed_name, m.auto_agency_id, ag.name, m.candidates, m.created_at
      from public.application_agency_match m
      join public.applications a on a.id = m.application_id
      left join public.agencies ag on ag.id = m.auto_agency_id
     where m.state = 'needs_review'
     order by m.created_at desc;
end $fn$;

comment on function public.agency_match_queue() is
  'The direct-rail agency reconciliation queue: candidates awaiting a person. Admin only.';

revoke all on function public.agency_match_queue() from public, anon;
grant execute on function public.agency_match_queue() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Resolve: a person sets the branch. THE PIN lives here.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_agency_match(p_application uuid, p_branch uuid)
returns void
language plpgsql security definer set search_path to '' as $fn$
declare v_before uuid; v_after uuid; me uuid; who text; v_bname text;
begin
  if not public.is_aal2()  then raise exception 'MFA required'  using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;

  select name into v_bname from public.branches where id = p_branch;
  if not found then raise exception 'Branch not found' using errcode = '22023'; end if;

  select partner_id into v_before from public.applications where id = p_application;
  if not found then raise exception 'Application not found' using errcode = '22023'; end if;

  update public.applications set branch_id = p_branch where id = p_application;

  -- THE PIN. Setting a branch derives agency_id but must not move the route.
  -- Commission follows how the application arrived, never whose branch it is. If
  -- this ever fires, route attribution has regressed and we refuse the write
  -- rather than silently pay the wrong partner.
  select partner_id into v_after from public.applications where id = p_application;
  if v_after is distinct from v_before then
    raise exception 'attribution changed on branch assignment (% to %); refusing', v_before, v_after
      using errcode = '42501';
  end if;

  update public.application_agency_match
     set state = 'resolved', resolved_branch_id = p_branch,
         resolved_by = auth.uid(), resolved_at = now(), updated_at = now()
   where application_id = p_application;

  me := auth.uid();
  select full_name into who from public.users where id = me;
  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values ('branch', p_branch, 'agency_match_resolved',
          format('Set direct application %s to branch "%s"', p_application, v_bname),
          coalesce(who, 'opndoor admin'), me);
end $fn$;

comment on function public.resolve_agency_match(uuid, uuid) is
  'Admin plus AAL2. Points a direct application at a real branch (deriving agency_id) and REFUSES if partner_id moves. Audited.';

revoke all on function public.resolve_agency_match(uuid, uuid) from public, anon;
grant execute on function public.resolve_agency_match(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Dismiss: not in the network. Leaves the application on the house branch.
-- ---------------------------------------------------------------------------
create or replace function public.dismiss_agency_match(p_application uuid, p_note text default null)
returns void
language plpgsql security definer set search_path to '' as $fn$
declare me uuid; who text;
begin
  if not public.is_aal2()  then raise exception 'MFA required'  using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;

  update public.application_agency_match
     set state = 'dismissed', resolved_by = auth.uid(), resolved_at = now(), updated_at = now()
   where application_id = p_application;
  if not found then raise exception 'No match to dismiss' using errcode = '22023'; end if;

  me := auth.uid();
  select full_name into who from public.users where id = me;
  insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
  values ('application', p_application, 'agency_match_dismissed',
          coalesce(nullif(btrim(p_note), ''), 'Not in network; left on the direct house branch'),
          coalesce(who, 'opndoor admin'), me);
end $fn$;

comment on function public.dismiss_agency_match(uuid, text) is
  'Admin plus AAL2. Marks a direct agency name as not in the network; the application stays on the house branch. Audited.';

revoke all on function public.dismiss_agency_match(uuid, text) from public, anon;
grant execute on function public.dismiss_agency_match(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Prove it, rather than assert it.
-- ---------------------------------------------------------------------------

-- 7a. The exact match must mean what dedup means.
do $$
begin
  if exists (
    select 1 from public.agencies where public.match_name_key(name) is distinct from name_key
  ) then
    raise exception 'match_name_key disagrees with agencies.name_key: the exact match would diverge from dedup';
  end if;
end $$;

-- 7b. THE PIN, exercised against a real direct application and a foreign branch,
--     in a sub-transaction that rolls back. Skipped only when the dev data has
--     neither, never silently passed.
do $$
declare v_direct uuid; v_app uuid; v_before uuid; v_after uuid; v_fbranch uuid;
begin
  select id into v_direct from public.partners where slug = 'opndoor-direct';
  select id, partner_id into v_app, v_before
    from public.applications where partner_id = v_direct limit 1;
  select b.id into v_fbranch
    from public.branches b join public.agencies ag on ag.id = b.agency_id
   where ag.partner_id is distinct from v_direct and not ag.is_placeholder
   limit 1;

  if v_app is null or v_fbranch is null then
    raise notice 'attribution-pin assertion skipped: no direct application or foreign branch in this database';
    return;
  end if;

  begin
    update public.applications set branch_id = v_fbranch where id = v_app;
    select partner_id into v_after from public.applications where id = v_app;
    if v_after is distinct from v_before then
      raise exception 'PIN FAILED: partner_id moved from % to % on a branch assignment', v_before, v_after;
    end if;
    -- Undo the probe write; we only needed to observe the trigger.
    raise exception 'rollback_pin_probe';
  exception when others then
    if SQLERRM <> 'rollback_pin_probe' then raise; end if;
  end;
end $$;
