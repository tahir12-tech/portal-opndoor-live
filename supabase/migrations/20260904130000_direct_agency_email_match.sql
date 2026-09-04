-- ===========================================================================
-- DIRECT-RAIL AGENCY MATCH: add an EMAIL match, ahead of the name match.
--
-- When a direct tenant names a letting agent and the delivery contact's email is
-- one we already hold as an AGENT CONTACT at an agency, that is exact and belongs
-- to one branch. Unlike the free-text name (which resolves the agency only, and
-- never the branch, and never without a person), an email can set BOTH the agency
-- and the branch and auto-accept.
--
-- The rules, all deliberate:
--   Agent contacts only.  Match public.agent_contacts (the org tree), NEVER
--                          public.users (a partner's staff). A branch-level
--                          contact carries a branch; that is what lets it set both.
--   Route is pinned.       Setting the branch derives agency_id but partner_id
--                          stays opndoor-direct, exactly as resolve_agency_match.
--                          The same guard fires (and rolls back) if it moves.
--   Email first.           If the email hits, the name match does not run. If it
--                          misses (zero or several contacts), fall through to the
--                          existing name match and its reconciliation queue.
--   Respects a decision.   Never reopens an application already resolved or
--                          dismissed by a person (or a prior auto-match).
--   Logged the same way.   A resolved application_agency_match row plus an
--                          org_audit entry, marked matched_by = 'email', so the
--                          Direct matches tab shows it and how it was made.
--
-- ADDITIVE. One new column, the matcher rewritten to add the email pass, and the
-- queue widened to surface recent auto-matches. The referral path passes through
-- none of it (the matcher no-ops off the direct rail).
-- ===========================================================================

alter table public.application_agency_match
  add column if not exists matched_by text
    check (matched_by is null or matched_by in ('email'));

comment on column public.application_agency_match.matched_by is
  'How an auto-accepted match was made. ''email'' = an exact agent-contact email set the branch and agency without a person. Null for a name candidate or a human resolve.';

-- ---------------------------------------------------------------------------
-- The matcher: email pass first, then the unchanged name pass.
-- ---------------------------------------------------------------------------
create or replace function public.match_application_agency(p_application uuid)
returns void
language plpgsql security definer set search_path to '' as $fn$
declare
  v_direct uuid;
  a public.applications;
  v_typed text; v_kind text; v_email text; v_key text;
  v_auto uuid; v_exact int;
  v_candidates jsonb;
  v_state text;
  v_ecount int; v_branch uuid; v_eagency uuid;
  v_before uuid; v_after uuid;
begin
  select id into v_direct from public.partners where slug = 'opndoor-direct';

  select * into a from public.applications where id = p_application;
  if not found then return; end if;

  -- Direct rail only. The referral path carries its own branch and partner.
  if a.partner_id is distinct from v_direct then return; end if;

  select kind, agency_name, email into v_kind, v_typed, v_email
    from public.application_delivery_contacts where application_id = p_application;

  -- Only a letting agent has an agency to reconcile. A landlord or a blank name
  -- has nothing; retire any stale row (the kind can change while draft).
  if v_kind is distinct from 'letting_agent' or coalesce(btrim(v_typed), '') = '' then
    delete from public.application_agency_match where application_id = p_application;
    return;
  end if;

  v_key := public.match_name_key(v_typed);

  -- Never reopen a row a person already resolved or dismissed (or a prior email
  -- auto-match). Only an unmatched application is eligible for the email pass.
  select state into v_state from public.application_agency_match where application_id = p_application;

  -- EMAIL PASS, FIRST. Exactly one branch-level agent contact (never a staff user)
  -- whose email equals the delivery contact's email, at a confirmed, live, non
  -- placeholder agency. Its branch sets agency + branch and auto-accepts. Zero or
  -- several fall through to the name pass.
  if coalesce(btrim(v_email), '') <> '' and coalesce(v_state, 'needs_review') = 'needs_review' then
    select count(*), (array_agg(c.branch_id))[1], (array_agg(ag.id))[1]
      into v_ecount, v_branch, v_eagency
      from public.agent_contacts c
      join public.branches  b  on b.id  = c.branch_id
      join public.agencies  ag on ag.id = b.agency_id
     where c.branch_id is not null
       and lower(btrim(c.email)) = lower(btrim(v_email))
       and not ag.is_placeholder and ag.review_state = 'confirmed' and ag.livemode;

    if v_ecount = 1 then
      -- Set the branch (derives agency_id structurally). THE PIN: partner_id must
      -- not move; commission follows the direct route the application arrived by.
      -- Same guard as resolve_agency_match; a raise rolls this non-blocking matcher
      -- back, so a regression fails safe on the house branch rather than mis-paying.
      v_before := a.partner_id;
      update public.applications set branch_id = v_branch where id = p_application;
      select partner_id into v_after from public.applications where id = p_application;
      if v_after is distinct from v_before then
        raise exception 'attribution changed on email auto-match (% to %); refusing', v_before, v_after
          using errcode = '42501';
      end if;

      insert into public.application_agency_match
        (application_id, typed_name, typed_name_key, auto_agency_id, candidates,
         state, matched_by, resolved_branch_id, resolved_at, updated_at)
      values (p_application, btrim(v_typed), v_key, v_eagency, '[]'::jsonb,
              'resolved', 'email', v_branch, now(), now())
      on conflict (application_id) do update set
        typed_name         = excluded.typed_name,
        typed_name_key     = excluded.typed_name_key,
        auto_agency_id     = excluded.auto_agency_id,
        candidates         = '[]'::jsonb,
        state              = 'resolved',
        matched_by         = 'email',
        resolved_branch_id = excluded.resolved_branch_id,
        resolved_at        = now(),
        updated_at         = now();

      -- Logged the same way a person's resolve is (a branch org_audit entry), so
      -- the Direct matches tab can show the match and that email made it.
      insert into public.org_audit (entity_type, entity_id, action, detail, actor, actor_id)
      values ('branch', v_branch, 'agency_match_resolved',
              format('Auto-matched direct application %s to this branch by the contact email', p_application),
              'System (email match)', null);
      return;  -- the name pass does not run
    end if;
  end if;

  -- NAME PASS (unchanged): reached when the email missed. Exact name_key only for
  -- auto_agency_id, and only the agency; the branch is always a person's call.
  select count(*), (array_agg(id))[1] into v_exact, v_auto
    from public.agencies
   where not is_placeholder and review_state = 'confirmed' and livemode
     and name_key = v_key;
  if v_exact <> 1 then v_auto := null; end if;

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
    (application_id, typed_name, typed_name_key, auto_agency_id, candidates, state, matched_by, updated_at)
  values (p_application, btrim(v_typed), v_key, v_auto, v_candidates, 'needs_review', null, now())
  on conflict (application_id) do update set
    typed_name     = excluded.typed_name,
    typed_name_key = excluded.typed_name_key,
    auto_agency_id = excluded.auto_agency_id,
    candidates     = excluded.candidates,
    -- Re-matching must not reopen or relabel a row a person already resolved or
    -- dismissed (or that a prior email pass auto-resolved).
    state      = case when public.application_agency_match.state = 'needs_review'
                      then 'needs_review' else public.application_agency_match.state end,
    matched_by = case when public.application_agency_match.state = 'needs_review'
                      then null else public.application_agency_match.matched_by end,
    updated_at = now();
end $fn$;

comment on function public.match_application_agency(uuid) is
  'Records an agency match for a direct application. Email pass first: an exact agent-contact email (branch level, at a confirmed live agency) auto-accepts the branch and agency, pinning partner_id. On a miss it falls to the name pass, which auto-accepts only an exact agency name and never the branch. No-op off the direct rail; never blocks submission.';

revoke all on function public.match_application_agency(uuid) from public, anon;
grant execute on function public.match_application_agency(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- The queue, widened: still the needs-review candidates, plus recent email
-- auto-matches so the Direct matches tab shows them and how they were made.
-- The reconciliation badge counts unreviewed agencies, not this, so surfacing
-- resolved rows here does not inflate it.
--
-- CREATE OR REPLACE cannot widen a function's return type (the row shape gains
-- state / matched_by / resolved_branch_name), so drop the old signature first;
-- the grant is re-applied below.
-- ---------------------------------------------------------------------------
drop function if exists public.agency_match_queue();

create or replace function public.agency_match_queue()
returns table (
  application_id       uuid,
  guarantee_ref        text,
  tenant_name          text,
  property             text,
  typed_name           text,
  auto_agency_id       uuid,
  auto_agency_name     text,
  candidates           jsonb,
  state                text,
  matched_by           text,
  resolved_branch_name text,
  created_at           timestamptz
)
language plpgsql stable security definer set search_path to '' as $fn$
begin
  if not public.is_admin() then raise exception 'not permitted' using errcode = '42501'; end if;
  return query
    select m.application_id, a.guarantee_ref,
           btrim(coalesce(a.tenant_first_name, '') || ' ' || coalesce(a.tenant_last_name, '')),
           btrim(coalesce(a.prop_city, '') || ' ' || coalesce(a.prop_postcode, '')),
           m.typed_name, m.auto_agency_id, ag.name, m.candidates,
           m.state, m.matched_by, rb.name, m.created_at
      from public.application_agency_match m
      join public.applications a  on a.id  = m.application_id
      left join public.agencies ag on ag.id = m.auto_agency_id
      left join public.branches rb on rb.id = m.resolved_branch_id
     where m.state = 'needs_review'
        or (m.state = 'resolved' and m.matched_by = 'email'
            and m.resolved_at > now() - interval '14 days')
     order by (m.state = 'needs_review') desc, coalesce(m.resolved_at, m.created_at) desc;
end $fn$;

comment on function public.agency_match_queue() is
  'The direct-rail agency reconciliation queue: needs-review candidates for a person, plus email auto-matches resolved in the last 14 days (read-only, so the tab shows what matched itself and how). Admin only.';

revoke all on function public.agency_match_queue() from public, anon;
grant execute on function public.agency_match_queue() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Prove the email pass, against real data, in a sub-transaction that rolls back.
-- Skipped (never silently passed) when the dev data lacks a direct application
-- and a branch-level agent contact to exercise it with.
-- ---------------------------------------------------------------------------
do $$
declare
  v_direct uuid; v_app uuid; v_email text; v_branch uuid; v_agency uuid;
  v_before uuid; v_after uuid; v_state text; v_mby text; v_rbranch uuid;
begin
  select id into v_direct from public.partners where slug = 'opndoor-direct';

  -- A branch-level agent contact at a confirmed, live, non-placeholder agency,
  -- whose email is UNIQUE among such contacts (so the email pass finds exactly one
  -- and fires; a shared email would legitimately fall through and fail this probe).
  select c.email, c.branch_id, b.agency_id into v_email, v_branch, v_agency
    from public.agent_contacts c
    join public.branches b  on b.id  = c.branch_id
    join public.agencies ag on ag.id = b.agency_id
   where c.branch_id is not null and coalesce(btrim(c.email), '') <> ''
     and not ag.is_placeholder and ag.review_state = 'confirmed' and ag.livemode
     and (select count(*)
            from public.agent_contacts c2
            join public.branches  b2  on b2.id  = c2.branch_id
            join public.agencies  ag2 on ag2.id = b2.agency_id
           where c2.branch_id is not null
             and lower(btrim(c2.email)) = lower(btrim(c.email))
             and not ag2.is_placeholder and ag2.review_state = 'confirmed' and ag2.livemode) = 1
   limit 1;

  select id, partner_id into v_app, v_before
    from public.applications where partner_id = v_direct limit 1;

  if v_email is null or v_app is null then
    raise notice 'email-match assertion skipped: no branch-level agent contact or direct application in this database';
    return;
  end if;

  begin
    -- Point a direct application's delivery contact at that email, re-match, and
    -- assert it auto-resolved to the contact's branch with partner_id pinned.
    insert into public.application_delivery_contacts (application_id, kind, agency_name, last_name, email, phone)
    values (v_app, 'letting_agent', 'Probe Agency', 'Probe', v_email, '07700900000')
    on conflict (application_id) do update set kind = 'letting_agent', agency_name = 'Probe Agency',
      last_name = 'Probe', email = excluded.email, phone = '07700900000';
    -- Start from a clean match row so the needs_review guard lets the email pass run.
    delete from public.application_agency_match where application_id = v_app;

    perform public.match_application_agency(v_app);

    select state, matched_by, resolved_branch_id into v_state, v_mby, v_rbranch
      from public.application_agency_match where application_id = v_app;
    select partner_id into v_after from public.applications where id = v_app;

    if v_state is distinct from 'resolved' or v_mby is distinct from 'email' or v_rbranch is distinct from v_branch then
      raise exception 'EMAIL MATCH FAILED: state=%, matched_by=%, branch=% (expected resolved/email/%)', v_state, v_mby, v_rbranch, v_branch;
    end if;
    if v_after is distinct from v_before then
      raise exception 'PIN FAILED on email auto-match: partner_id moved from % to %', v_before, v_after;
    end if;

    raise exception 'rollback_email_probe';
  exception when others then
    if SQLERRM <> 'rollback_email_probe' then raise; end if;
  end;
end $$;
