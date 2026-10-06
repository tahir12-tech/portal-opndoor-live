-- livemode on the org read path.
--
-- partner_api_orgs never touches applications, so livemode_audit() has nothing
-- to say about it and the assertion in the previous migration passed with this
-- function unguarded. That is worth noticing rather than glossing: the audit
-- checks exactly one thing, and a check that looks like general protection while
-- covering one table is the kind of thing that gets trusted too far.
--
-- Sandbox org creation is kept, so sandbox agencies and branches genuinely
-- exist. Without a predicate here, GET /v1/orgs with a sandbox key returns the
-- partner's real agencies and branches: their whole office list, disclosed to
-- whoever holds a test key. That is a disclosure rather than a cosmetic bug, and
-- it is also the list a developer would then pick branch ids from, which the
-- cross-mode guard in create_referral_api would reject with "Selected branch not
-- found" and make look like a broken API.
--
-- Same treatment as the others: mandatory argument, old signature dropped, so a
-- caller that has not been updated fails at deploy rather than silently reading
-- live data.

drop function if exists public.partner_api_orgs(uuid);

create function public.partner_api_orgs(p_partner uuid, p_livemode boolean)
returns table (
  agency_id                 uuid,
  agency_name               text,
  agency_has_agent_contact  boolean,
  branch_id                 uuid,
  branch_name               text,
  branch_has_agent_contact  boolean
)
language sql security definer set search_path to '' stable
as $function$
  select
    a.id,
    a.name,
    exists (
      select 1 from public.agent_contacts c
      where c.agency_id = a.id and c.is_primary
    ) as agency_has_agent_contact,
    b.id,
    b.name,
    -- Null branch (an agency with no branches) yields null, not false: there is
    -- no branch to answer the question about.
    case when b.id is null then null
         else ((public.effective_primary_contact(b.id)).email is not null)
    end as branch_has_agent_contact
  from public.agencies a
  -- The partner filter is repeated on the join rather than moved to the WHERE
  -- clause, so an agency with no branches still returns one row. branches.partner_id
  -- is trigger-maintained from the agency (core_schema.sql:146-152) so this is
  -- defence in depth rather than a distinct condition. livemode is repeated for
  -- the same reason and needs it more: unlike partner_id, nothing maintains it
  -- across the two tables, so a branch could in principle disagree with its
  -- agency and this makes such a branch invisible rather than leaked.
  left join public.branches b
    on b.agency_id = a.id
   and b.partner_id = p_partner
   and b.livemode = p_livemode
  where a.partner_id = p_partner
    and a.livemode = p_livemode
  order by a.name, b.name nulls first;
$function$;

revoke all on function public.partner_api_orgs(uuid, boolean) from public, anon, authenticated;
grant execute on function public.partner_api_orgs(uuid, boolean) to service_role;

-- ---------- org creation by name ----------
-- Sandbox org creation is kept, because Rightmove send two payload shapes and a
-- partner has to be able to rehearse both. That means this function can create
-- real rows in agencies, branches and agent_contacts, and every one of them has
-- to be stamped with the caller's mode.
--
-- The lookups matter as much as the inserts. Without livemode on the two SELECTs
-- below, a sandbox call naming an agency the partner already has live would
-- silently ATTACH to the live agency rather than create a sandbox one, and then
-- create a sandbox branch underneath it. The partner's real agency record would
-- grow a test branch, visible to management in the portal and in the
-- reconciliation queue, with nothing marking it as fake.
--
-- Same treatment: mandatory argument, old signature dropped.
drop function if exists public.create_referral_target_api(
  uuid, uuid, text, text, text, text, text);

create function public.create_referral_target_api(
  p_partner uuid,
  p_livemode boolean,
  p_actor uuid,
  p_agency text,
  p_branch text,
  p_contact_email text,
  p_contact_name text default null,
  p_contact_phone text default null
) returns uuid
language plpgsql security definer set search_path to ''
as $function$
declare
  ag_id uuid; br_id uuid; ag_new boolean := false; br_new boolean := false;
  who text; v_email text := btrim(coalesce(p_contact_email,''));
  v_branch text := coalesce(nullif(btrim(coalesce(p_branch,'')), ''), 'Head office');
begin
  if p_partner is null then raise exception 'Partner is required.' using errcode = '22023'; end if;
  if p_livemode is null then raise exception 'livemode is required.' using errcode = '22023'; end if;
  if btrim(coalesce(p_agency,'')) = '' then raise exception 'Agency is required' using errcode = '22023'; end if;

  select full_name into who from public.users where id = p_actor and partner_id = p_partner;
  if not found then raise exception 'Referrer not found for this partner.' using errcode = '22023'; end if;
  who := coalesce(who, 'a referrer');

  select id into ag_id from public.agencies
   where partner_id = p_partner and livemode = p_livemode
     and lower(name) = lower(btrim(p_agency)) limit 1;

  -- The contact email is mandatory only when something is actually being
  -- created. Referencing an existing org that already resolves a contact does
  -- not need one.
  if ag_id is null and v_email = '' then
    raise exception 'A contact email is required to create a new agency.' using errcode = '22023';
  end if;

  if ag_id is null then
    insert into public.agencies(name, partner_id, review_state, created_by, livemode)
    values (btrim(p_agency), p_partner, 'pending_review', p_actor, p_livemode) returning id into ag_id;
    ag_new := true;
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('agency', ag_id, 'created', btrim(p_agency), who, p_actor);
  end if;

  select id into br_id from public.branches
   where agency_id = ag_id and livemode = p_livemode and lower(name) = lower(v_branch) limit 1;

  if br_id is null and v_email = '' then
    raise exception 'A contact email is required to create a new branch.' using errcode = '22023';
  end if;

  if br_id is null then
    insert into public.branches(name, agency_id, partner_id, review_state, created_by, livemode)
    values (v_branch, ag_id, p_partner, 'pending_review', p_actor, p_livemode) returning id into br_id;
    br_new := true;
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('branch', br_id, 'created', v_branch, who, p_actor);
  end if;

  if ag_new and v_email <> '' then
    insert into public.agent_contacts(agency_id, partner_id, name, email, phone, is_primary, created_by, livemode)
    values (ag_id, p_partner, btrim(coalesce(p_contact_name,'')), v_email,
            nullif(btrim(coalesce(p_contact_phone,'')),''), true, p_actor, p_livemode);
  end if;

  if br_new and v_email <> '' then
    insert into public.agent_contacts(branch_id, partner_id, name, email, phone, is_primary, created_by, livemode)
    values (br_id, p_partner, btrim(coalesce(p_contact_name,'')), v_email,
            nullif(btrim(coalesce(p_contact_phone,'')),''), true, p_actor, p_livemode);
  end if;

  -- Final guard, and the reason this function exists. Whatever route got us
  -- here, refuse to hand back a branch that cannot produce a deed. This is the
  -- same call the deed path makes, so it cannot disagree with it.
  if (public.effective_primary_contact(br_id)).email is null then
    raise exception 'This branch has no primary agent contact, so a deed could not be issued.' using errcode = '22023';
  end if;

  return br_id;
end $function$;

revoke all on function public.create_referral_target_api(
  uuid, boolean, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_referral_target_api(
  uuid, boolean, uuid, text, text, text, text, text) to service_role;
