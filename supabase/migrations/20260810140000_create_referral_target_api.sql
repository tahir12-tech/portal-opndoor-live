-- create_referral_target_api: on-the-fly org resolution for the partner API.
--
-- The machine-callable sibling of create_referral_target, which cannot be reused
-- for the same three reasons create_referral cannot: it gates on is_aal2(),
-- reads auth.uid() for created_by and the audit actor, and derives the partner
-- from app_partner(). All three are absent on an API-key request.
--
-- BEHAVIOUR DELIBERATELY MIRRORS THE PORTAL PATH, so an org created by a partner
-- through the API is indistinguishable from one created on the New Application
-- form:
--
--   * matches an existing agency and branch case-insensitively within the
--     partner, so 'FOO LETTINGS' does not create a second 'Foo Lettings'
--   * a blank branch name becomes 'Head office', the same default
--   * new records get review_state = 'pending_review', so they surface in the
--     Reconciliation queue exactly as on-the-fly portal creations do
--   * writes the same org_audit rows
--   * a supplied contact is created as is_primary = true
--
-- ONE DELIBERATE DIFFERENCE, AND IT IS THE POINT OF THE ENDPOINT. The portal
-- path accepts a blank contact email and creates the org anyway. This refuses.
--
-- An agency or branch with no contact produces applications that take payment
-- and then fail at deed generation, because the deed path resolves the agent
-- email through effective_primary_contact and dead-ends without it
-- (_shared/pandadoc.ts:414-418), after the tenant has already paid. A human on
-- the form is present to fix that. A partner posting in bulk is not, and would
-- generate a batch of paid applications that all fail the same way.
--
-- p_partner comes from the verified API key. p_actor is the resolved referrer,
-- used for created_by and the audit actor so the trail names a real user rather
-- than "the API".

create or replace function public.create_referral_target_api(
  p_partner uuid,
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
  if btrim(coalesce(p_agency,'')) = '' then raise exception 'Agency is required' using errcode = '22023'; end if;

  select full_name into who from public.users where id = p_actor and partner_id = p_partner;
  if not found then raise exception 'Referrer not found for this partner.' using errcode = '22023'; end if;
  who := coalesce(who, 'a referrer');

  select id into ag_id from public.agencies
   where partner_id = p_partner and lower(name) = lower(btrim(p_agency)) limit 1;

  -- The contact email is mandatory only when something is actually being
  -- created. Referencing an existing org that already resolves a contact does
  -- not need one.
  if ag_id is null and v_email = '' then
    raise exception 'A contact email is required to create a new agency.' using errcode = '22023';
  end if;

  if ag_id is null then
    insert into public.agencies(name, partner_id, review_state, created_by)
    values (btrim(p_agency), p_partner, 'pending_review', p_actor) returning id into ag_id;
    ag_new := true;
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('agency', ag_id, 'created', btrim(p_agency), who, p_actor);
  end if;

  select id into br_id from public.branches
   where agency_id = ag_id and lower(name) = lower(v_branch) limit 1;

  if br_id is null and v_email = '' then
    raise exception 'A contact email is required to create a new branch.' using errcode = '22023';
  end if;

  if br_id is null then
    insert into public.branches(name, agency_id, partner_id, review_state, created_by)
    values (v_branch, ag_id, p_partner, 'pending_review', p_actor) returning id into br_id;
    br_new := true;
    insert into public.org_audit(entity_type, entity_id, action, detail, actor, actor_id)
    values ('branch', br_id, 'created', v_branch, who, p_actor);
  end if;

  if ag_new and v_email <> '' then
    insert into public.agent_contacts(agency_id, partner_id, name, email, phone, is_primary, created_by)
    values (ag_id, p_partner, btrim(coalesce(p_contact_name,'')), v_email,
            nullif(btrim(coalesce(p_contact_phone,'')),''), true, p_actor);
  end if;

  if br_new and v_email <> '' then
    insert into public.agent_contacts(branch_id, partner_id, name, email, phone, is_primary, created_by)
    values (br_id, p_partner, btrim(coalesce(p_contact_name,'')), v_email,
            nullif(btrim(coalesce(p_contact_phone,'')),''), true, p_actor);
  end if;

  -- Final guard, and the reason this function exists. Whatever route got us
  -- here, refuse to hand back a branch that cannot produce a deed. This is the
  -- same call the deed path makes, so it cannot disagree with it.
  if (public.effective_primary_contact(br_id)).email is null then
    raise exception 'This branch has no primary agent contact, so a deed could not be issued.' using errcode = '22023';
  end if;

  return br_id;
end $function$;

comment on function public.create_referral_target_api(uuid, uuid, text, text, text, text, text) is
  'On-the-fly agency and branch resolution for the partner API. Mirrors create_referral_target, including case-insensitive matching, the Head office default, pending_review state and org_audit rows. Differs in refusing to create an org without a contact email, and in refusing to return a branch that cannot issue a deed.';

revoke all on function public.create_referral_target_api(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_referral_target_api(uuid, uuid, text, text, text, text, text) to service_role;
