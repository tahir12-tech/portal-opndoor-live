-- ===========================================================================
-- The house routes, and the agent a direct tenant names.
--
-- TWO DECISIONS THIS ENCODES
--
-- 1. A DIRECT SIGNUP DOES NOT ATTACH TO AN AGENCY. The agent a tenant names is
--    a DELIVERY CONTACT for the deed and nothing else. They have agreed to
--    nothing, the tenant is not their customer, and letting tenant-typed agency
--    names into the org tree would put the reconciliation queue on the critical
--    path of every direct application. What the deed actually needs from that
--    agent is an email address, not an org-tree position.
--
-- 2. PARTNER MEANS ROUTE. Direct is a house partner, LIB is a partner,
--    Rightmove is a partner, an agent referrer belongs to the partner they work
--    for. Combined with 20260812010000 this is what lets one agency be reached
--    by several routes and give a different commercial answer each time.
--
-- WHY PARTNER ROWS ARE CREATED BY MIGRATION WHEN NONE EVER HAVE BEEN
-- 20260811090000 says it plainly: no migration has ever inserted a partner, the
-- rows were made by hand, which is why the Rightmove migration has to match on
-- name and can silently match nothing. These two are different in kind. They are
-- not customers, they are infrastructure: without them the direct and LIB rails
-- have no route to attribute to and no branch to satisfy a NOT NULL foreign key.
-- Creating them by hand would reintroduce exactly the "which id is it on this
-- project" problem, so they get stable, known slugs instead.
--
-- IDEMPOTENT. Re-applying changes nothing. Safe on a project where a previous
-- attempt part-succeeded.
--
-- ADDITIVE FOR THE REFERRAL PATH: yes, completely. New partner rows with their
-- own org tree, and a new table nothing existing reads. No existing row is
-- touched, no existing function changes. Rightmove cannot see these partners
-- (partners_select is scoped to the caller's own partner) and cannot see their
-- applications (applications_select likewise).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The house routes.
--
-- Rates are ZERO on both. Direct earns no commission by decision. LIB's
-- commercial terms are not settled, and zero is the value that cannot quietly
-- pay somebody the wrong amount while nobody is looking. See HANDOVER open items.
-- ---------------------------------------------------------------------------
do $$
declare
  v_direct uuid; v_lib uuid;
  v_partner uuid;
begin
  -- Direct. referencing_mode is opndoor_referenced: WE arrange the reference
  -- (through LIB) rather than receiving one. portal_referrals stays FALSE
  -- because a direct application is not created through the portal referral
  -- form; an agent referral at an agency is that agent's partner's route, not
  -- this one. api_access FALSE: no key is ever minted for a house route.
  insert into public.partners (slug, name, status, live_from, partner_rate, agent_rate,
                               referencing_mode, portal_referrals_enabled, api_access_enabled)
  values ('opndoor-direct', 'Opndoor Direct', 'active', current_date, 0, 0,
          'opndoor_referenced', false, false)
  on conflict (slug) do nothing;
  select id into v_direct from public.partners where slug = 'opndoor-direct';

  -- The referencing provider's own hand-overs: they reference somebody for one
  -- of their agency customers, the result needs a guarantor, and they pass the
  -- tenant to us. Already referenced on arrival, and no Opndoor criteria are
  -- applied, which is what pre_referenced_open means.
  --
  -- Named neutrally on purpose. This row is the provider described in
  -- PARTNER-API.md section 15, and that section's whole point is that the
  -- provider is never named on a partner-facing surface. A partner name renders
  -- in the admin UI, so it does not get to be the exception.
  insert into public.partners (slug, name, status, live_from, partner_rate, agent_rate,
                               referencing_mode, portal_referrals_enabled, api_access_enabled)
  values ('referencing-partner', 'Referencing Partner', 'active', current_date, 0, 0,
          'pre_referenced_open', false, false)
  on conflict (slug) do nothing;
  select id into v_lib from public.partners where slug = 'referencing-partner';

  -- Each house route needs one agency and one branch, because applications
  -- carries NOT NULL foreign keys to both and relaxing those would touch every
  -- read on the referral path. This is a placeholder org, not a real agency, and
  -- the deed does NOT go to its contact: see the delivery contact below.
  foreach v_partner in array array[v_direct, v_lib]
  loop
    insert into public.agencies (partner_id, name, review_state)
    values (v_partner, 'Unattached', 'confirmed')
    on conflict (partner_id, name) do nothing;

    -- branches.partner_id is NOT NULL and set by the branches_sync_partner
    -- trigger from the agency, so it is deliberately not listed here.
    insert into public.branches (agency_id, name, review_state)
    select a.id, 'Unattached', 'confirmed'
    from public.agencies a
    where a.partner_id = v_partner and a.name = 'Unattached'
    on conflict (agency_id, name) do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The delivery contact.
--
-- One per application, optional. Present on a direct signup, absent everywhere
-- else, which is why it is a separate table rather than six nullable columns on
-- applications: the referral path would carry six permanently-null columns and
-- every new column on that table now needs its own grant (20260811180000).
--
-- NOT an agent_contacts row. That table is the org tree, it is partner-scoped,
-- it feeds has_agent_contact, and putting unverified tenant-typed data in it
-- would make a direct signup look like a confirmed agency relationship.
-- ---------------------------------------------------------------------------
create table if not exists public.application_delivery_contacts (
  application_id uuid primary key references public.applications(id) on delete cascade,

  -- Who the tenant says manages the property.
  kind        text not null check (kind in ('letting_agent','private_landlord')),
  agency_name text,
  title       text,
  first_name  text,
  last_name   text,
  email       text not null,
  phone       text,

  -- UNVERIFIED UNTIL SOMEBODY SAYS OTHERWISE. This address came from a tenant
  -- and nobody has confirmed the person behind it agreed to receive a Deed of
  -- Guarantee. Anything that sends a legal instrument here must read this.
  verified_at timestamptz,
  verified_by uuid references public.users(id) on delete set null,

  created_at  timestamptz not null default now(),

  -- A letting agent is a company and needs a name; a private landlord is a
  -- person and needs a surname. Enforced rather than left to the form, because
  -- the form is not the only writer once the API rails exist.
  constraint delivery_contact_named check (
    (kind = 'letting_agent'    and coalesce(btrim(agency_name), '') <> '')
    or (kind = 'private_landlord' and coalesce(btrim(last_name), '') <> '')
  )
);

alter table public.application_delivery_contacts enable row level security;

-- Read follows the application exactly. Written as an EXISTS against
-- applications rather than restating the partner rule, so this table can never
-- drift from the visibility of the row it belongs to.
drop policy if exists delivery_contacts_select on public.application_delivery_contacts;
create policy delivery_contacts_select on public.application_delivery_contacts
  for select to authenticated
  using (exists (select 1 from public.applications a where a.id = application_id));

-- No insert/update/delete policy. Writes go through service_role, the same
-- posture as payment_page_tokens: the writer is a tenant-facing Edge Function,
-- and a tenant is not an authenticated portal principal.

comment on table public.application_delivery_contacts is
  'The letting agent or private landlord a DIRECT tenant named, as a delivery destination for the deed. Not an org-tree relationship: nobody here has agreed to anything, which is what verified_at records. Absent on the referral and API rails.';
comment on column public.application_delivery_contacts.verified_at is
  'Null means nobody has confirmed this address belongs to someone willing to receive a Deed of Guarantee. Read this before sending a legal instrument to it.';

-- ---------------------------------------------------------------------------
-- 3. Where a deed should be delivered, in one place.
--
-- Prefers the delivery contact when one exists, else the branch's effective
-- primary contact, which is exactly what every existing caller resolves today.
-- On the referral path there is never a delivery contact, so this returns the
-- same row send_deed_to_agent already resolves. Nothing is rewired to use it in
-- this migration: it exists so the deed work has one answer to point at instead
-- of inventing a second one.
-- ---------------------------------------------------------------------------
create or replace function public.deed_delivery_target(p_application uuid)
returns table (email text, display_name text, source text, verified boolean)
language sql stable security definer set search_path to '' as $$
  select
    coalesce(d.email, c.email),
    coalesce(
      nullif(btrim(coalesce(d.agency_name, '')), ''),
      nullif(btrim(coalesce(d.first_name, '') || ' ' || coalesce(d.last_name, '')), ''),
      c.name
    ),
    case when d.application_id is not null then 'delivery_contact' else 'branch_contact' end,
    case when d.application_id is not null then d.verified_at is not null else true end
  from public.applications a
  left join public.application_delivery_contacts d on d.application_id = a.id
  left join lateral (
    select * from public.effective_primary_contact(a.branch_id)
  ) c on true
  where a.id = p_application
$$;

comment on function public.deed_delivery_target(uuid) is
  'Where an executed deed should go: the tenant-named delivery contact when there is one, else the branch primary contact. verified=false means a tenant typed the address and nobody has checked it. Returns the existing answer unchanged for every referral-path application.';

revoke all on function public.deed_delivery_target(uuid) from public, anon;
grant execute on function public.deed_delivery_target(uuid) to authenticated, service_role;
