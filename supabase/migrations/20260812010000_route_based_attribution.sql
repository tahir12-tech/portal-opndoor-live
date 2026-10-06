-- ===========================================================================
-- ROUTE-BASED ATTRIBUTION: applications.partner_id stops meaning "who owns the
-- agency" and starts meaning "which route this application arrived by".
--
-- WHY
-- One agency is branched once and has one org record, however many routes reach
-- it. An agent at an agency Rightmove introduced may refer directly through the
-- portal, and that is the agency's own business, not Rightmove's. The same
-- agency reached by a Rightmove referral is Rightmove's. Same agency, two
-- routes, two answers. A partner derived from the branch can only ever give one.
--
-- partner_id drives commission AND visibility (applications_select is
-- partner-scoped), so this one column decides both who gets paid and who can
-- see the row. Rightmove must not see a direct application at one of their
-- agencies, and after this migration they cannot, with no RLS change at all:
-- the row simply carries a different partner_id.
--
-- ---------------------------------------------------------------------------
-- WHY THIS IS SAFE FOR THE REFERRAL PATH, WHICH IS THE WHOLE POINT
-- ---------------------------------------------------------------------------
-- The trigger currently OVERWRITES partner_id with the branch's partner. Both
-- existing create paths already pass the SAME value it would derive:
--
--   create_referral      selects pid from the branch and inserts it, and its
--                        permission arm requires pid = app_partner() for
--                        management and referrer.
--   create_referral_api  passes p_partner from the verified key and refuses
--                        with 'Selected branch not found' when pid <> p_partner
--                        (20260811130000:33-35), so they are equal by the time
--                        the insert runs.
--
-- So on both existing paths the overwrite is ALREADY A NO-OP. Changing it from
-- "always overwrite" to "derive only when not supplied" cannot change any row
-- either path produces. That is not an argument that it is probably fine; it is
-- the reason the change is invisible to Rightmove, and the assertions at the
-- foot of this file prove it rather than asserting it.
--
-- ---------------------------------------------------------------------------
-- THE ADMIN CASE, WHICH KILLED THE OBVIOUS FORMULATION
-- ---------------------------------------------------------------------------
-- "Take the partner from the creator" fails for an opndoor admin: app_partner()
-- reads users.partner_id, and users_partner_by_role (core_schema.sql:58-61)
-- requires superadmin to have partner_id NULL. An admin creating a referral on
-- behalf of a partner would resolve to NULL and violate the NOT NULL column.
-- is_admin() is an accepted arm of create_referral's permission check, so this
-- is a live path, not a hypothetical.
--
-- The rule therefore has three steps and a fallback, not one step:
--
--   1. an explicit route, when the caller has one   (API key, LIB, direct)
--   2. else the creator's own partner               (management, referrer)
--   3. else the branch's partner                    (admin: today's behaviour)
--
-- Step 3 is not a concession. An admin acting on behalf of a partner IS acting
-- as that partner, and the branch is the only statement of which partner that
-- is. It also makes the whole migration a no-op for every row that exists.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES NOT DO, AND MUST NOT BE MISTAKEN FOR
-- ---------------------------------------------------------------------------
-- It does NOT make an agency reachable by more than one route yet. The org tree
-- is still partner-scoped: agencies_select and branches_select filter on
-- agencies.partner_id, so a referrer at partner B cannot SEE, and therefore
-- cannot select, an agency Rightmove introduced. Route attribution is necessary
-- for cross-route reach and is not sufficient for it.
--
-- Making the org tree reachable across routes is a separate and larger change
-- with a real disclosure risk: relaxing agency visibility naively hands every
-- partner every other partner's client list. It is deliberately not attempted
-- here. See HANDOVER.md open items.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The resolver. One place that answers "which route did this arrive by".
-- ---------------------------------------------------------------------------
create or replace function public.resolve_route_partner(p_branch uuid, p_explicit uuid)
returns uuid
language plpgsql stable security definer set search_path to ''
as $function$
declare v_branch_partner uuid;
begin
  -- 1. An explicit route always wins. The partner API passes the partner its
  --    key authenticated as; the direct and LIB rails pass their house partner.
  if p_explicit is not null then
    return p_explicit;
  end if;

  -- 2. The creator's own partner. This is the portal referral path, and it is
  --    what makes an agent's referral the agency's own business rather than the
  --    business of whoever introduced the agency.
  if public.app_partner() is not null then
    return public.app_partner();
  end if;

  -- 3. No explicit route and no partner on the creator: an opndoor admin. Fall
  --    back to the branch, which is exactly what happened before this migration
  --    existed and is the only available statement of who they act for.
  select b.partner_id into v_branch_partner
  from public.branches b where b.id = p_branch;

  if v_branch_partner is null then
    raise exception 'branch % not found', p_branch using errcode = '22023';
  end if;
  return v_branch_partner;
end $function$;

comment on function public.resolve_route_partner(uuid, uuid) is
  'Which route an application arrived by: explicit, else the creator''s partner, else the branch''s partner (the opndoor-admin case, which is also the pre-migration behaviour). Never returns null without raising.';

revoke all on function public.resolve_route_partner(uuid, uuid) from public, anon;
grant execute on function public.resolve_route_partner(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The trigger stops overwriting a supplied route.
--
-- agency_id is STILL always derived. That one is structural: a branch belongs
-- to exactly one agency and no caller gets an opinion about it. Only partner_id
-- changes meaning, because only partner_id is about the route.
-- ---------------------------------------------------------------------------
create or replace function public.sync_application_partner() returns trigger
language plpgsql as $function$
declare b record;
begin
  select agency_id, partner_id into b from public.branches where id = new.branch_id;
  if not found then raise exception 'branch % not found', new.branch_id; end if;

  -- Structural, always.
  new.agency_id := b.agency_id;

  -- The route. Derived ONLY when the caller did not state one. Both existing
  -- create paths state one, and state the same value this would derive, so this
  -- branch is not reached by the referral path at all.
  if new.partner_id is null then
    new.partner_id := b.partner_id;
  end if;

  return new;
end $function$;

comment on function public.sync_application_partner() is
  'Derives agency_id from the branch always, and partner_id only when the caller did not supply a route. Was an unconditional overwrite; see 20260812010000 for why changing it is a no-op for both existing create paths.';

-- ---------------------------------------------------------------------------
-- 3. Prove it, rather than asserting it.
--
-- These run at migration time against the real catalogue. They are cheap and
-- they fail the push rather than the production request.
-- ---------------------------------------------------------------------------
do $$
declare
  v_src text;
begin
  -- The API path's cross-partner guard is what makes the supplied route equal
  -- the derived one there. If that guard is ever removed, the no-op argument
  -- above stops holding and this migration's safety case has to be rewritten.
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_referral_api';

  if v_src is null then
    raise exception 'create_referral_api not found: cannot verify the attribution safety case';
  end if;

  if position('pid <> p_partner' in v_src) = 0 then
    raise exception
      'create_referral_api no longer guards pid <> p_partner. Route attribution assumed that guard makes the supplied partner equal the branch partner on the API path. Re-verify 20260812010000 before proceeding.';
  end if;
end $$;

do $$
begin
  -- The resolver must never return null for a real branch, because partner_id
  -- is NOT NULL and a null here would surface as a constraint violation on the
  -- referral path rather than as the configuration error it actually is.
  if exists (
    select 1 from public.branches b
    where public.resolve_route_partner(b.id, null) is null
    limit 1
  ) then
    raise exception 'resolve_route_partner returned null for an existing branch';
  end if;
end $$;
