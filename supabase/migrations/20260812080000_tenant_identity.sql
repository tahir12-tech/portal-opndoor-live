-- ===========================================================================
-- TENANT IDENTITY: a principal that is authenticated and is not staff.
--
-- THE RULE, AND IT IS ENFORCED RATHER THAN INTENDED
-- A tenant is an applicant. A member of staff is a public.users row. Nobody is
-- both, and that is guaranteed by triggers on both tables rather than by
-- everyone remembering. The two identities share auth.users, because Supabase
-- Auth is the only thing that issues a session, and they share nothing else.
--
-- ---------------------------------------------------------------------------
-- WHY A TENANT CANNOT BE A public.users ROW
-- ---------------------------------------------------------------------------
-- Not a preference. The schema forbids it twice over:
--   users.role is a closed CHECK of four staff roles (core_schema.sql:53,
--     widened once at 20260810210000:32-34)
--   users_partner_by_role requires every non-superadmin to have a partner_id
--     (core_schema.sql:58-61), and a direct tenant has no partner
-- Widening either to fit a tenant would change the meaning of every policy in
-- the database, all of which are written in terms of app_role() and
-- app_partner() reading that table.
--
-- ---------------------------------------------------------------------------
-- WHY THIS CHANGES NO RLS POLICY AT ALL, WHICH IS THE POINT
-- ---------------------------------------------------------------------------
-- A tenant has NO public.users row. Therefore:
--   app_role()    returns null  -> every `app_role() in (...)` arm is false
--   app_partner() returns null  -> every `partner_id = app_partner()` arm is
--                                  false, because null = anything is null
--   is_admin()    is false
--   is_aal2()     is false for a tenant session, and require_aal2 is a
--                 RESTRICTIVE policy on applications, so it ANDs with every
--                 permissive one and blocks the row regardless
--
-- A tenant JWT presented to PostgREST therefore reads NOTHING, on every table,
-- by the policies that already exist. Four independent reasons, any one of
-- which is sufficient. Nothing is relaxed to make room for tenants, because the
-- moment require_aal2 is relaxed every Rightmove read and write changes with
-- it. REGRESSION F3 asserts this in both directions.
--
-- Tenants reach their own data through a service-role Edge Function that checks
-- the caller first, which is the same posture payment-page has had since it was
-- written: the token is the authorisation, and no anon role can execute
-- anything (anon execute was revoked project-wide at 20260702135800:4).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The applicant.
-- ---------------------------------------------------------------------------
create table if not exists public.applicants (
  -- Shares the primary key with auth.users, exactly as public.users does, so a
  -- session resolves to at most one applicant and there is no second id to keep
  -- in step.
  id uuid primary key references auth.users(id) on delete cascade,

  email      text not null,
  title      text,
  first_name text not null,
  last_name  text not null,
  dob        date,
  phone      text,

  -- Their own account, so their own verification state. Distinct from
  -- auth.users.email_confirmed_at deliberately: that records that the address
  -- receives mail, this records that WE asked and they answered, and the two
  -- can legitimately differ when an address is changed later.
  email_verified_at timestamptz,

  -- Set when the account is closed rather than deleting the row: applications
  -- reference it and a guarantee outlives the account that created it.
  closed_at  timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One account per address. Case-insensitive, because a tenant who signs up as
-- Sam@x and returns as sam@x is the same person and a second account would give
-- them a second set of applications they cannot see from the first.
create unique index if not exists applicants_email_key on public.applicants (lower(email));

alter table public.applicants enable row level security;

-- NO POLICIES, deliberately. Not "none yet". A tenant reaches this row through
-- the tenant Edge Function under service_role, and no staff role has any reason
-- to read the applicant table directly: staff read tenant details from the
-- application, which is where they have always been.
comment on table public.applicants is
  'Tenant identity. Shares auth.users with staff and shares nothing else; the mutual-exclusion triggers below make being both impossible. No RLS policies: a tenant has no public.users row, so app_role() and app_partner() are null and every existing policy already refuses them. Reached only through a service-role Edge Function.';

-- ---------------------------------------------------------------------------
-- 2. Mutually exclusive BY CONSTRUCTION.
--
-- A CHECK constraint cannot contain a subquery, so this is a pair of triggers,
-- one on each table. Both directions are covered because either table can be
-- written first and whichever is second must be the one that refuses.
--
-- This is not defensive tidiness. A principal that is both staff and applicant
-- would have app_role() return a staff role while holding a tenant session,
-- which is precisely the shape of an escalation: it would read every
-- application at their partner through PostgREST while believing itself to be a
-- tenant surface.
-- ---------------------------------------------------------------------------
create or replace function public.assert_not_staff() returns trigger
language plpgsql security definer set search_path to '' as $function$
begin
  if exists (select 1 from public.users u where u.id = new.id) then
    raise exception 'Identity % is already a staff user and cannot also be an applicant', new.id
      using errcode = '23505';
  end if;
  return new;
end $function$;

create or replace function public.assert_not_applicant() returns trigger
language plpgsql security definer set search_path to '' as $function$
begin
  if exists (select 1 from public.applicants a where a.id = new.id) then
    raise exception 'Identity % is already an applicant and cannot also be a staff user', new.id
      using errcode = '23505';
  end if;
  return new;
end $function$;

drop trigger if exists applicants_not_staff on public.applicants;
create trigger applicants_not_staff before insert or update of id on public.applicants
  for each row execute function public.assert_not_staff();

drop trigger if exists users_not_applicant on public.users;
create trigger users_not_applicant before insert or update of id on public.users
  for each row execute function public.assert_not_applicant();

-- ---------------------------------------------------------------------------
-- 3. The link from an application to the applicant who owns it.
--
-- NULLABLE, and null on every application that exists. The referral and API
-- rails have no applicant account: a Rightmove tenant keeps the tokenised link
-- and never signs in. This is what makes the column additive.
--
-- NOT NULL here would break create_referral_api's explicit insert list and take
-- the API create path down on the next request, which is REGRESSION F5.3.
-- ---------------------------------------------------------------------------
alter table public.applications
  add column if not exists applicant_id uuid references public.applicants(id) on delete set null;

create index if not exists applications_applicant_idx on public.applications (applicant_id);

comment on column public.applications.applicant_id is
  'The tenant account that owns this application, on the rails where tenants have accounts. NULL on the referral and API rails, where the tenant is reached by tokenised link and never signs in. Nullable permanently: this is what keeps the column additive.';

-- THE COLUMN GRANT. The table grant on applications was revoked and re-granted
-- per column (20260811180000), so a new column arrives with NO grant and is
-- invisible to the client until this line runs. Forgetting it does not error,
-- it just silently returns nothing, which is why REGRESSION F5.1 exists.
grant select (applicant_id) on public.applications to authenticated;

-- ---------------------------------------------------------------------------
-- 4. What a tenant may see of their own application.
--
-- An explicit column list, not select *. This is the tenant-facing read model
-- and it is the place a future column leaks from if it is written as a wildcard.
-- Commission is absent and must stay absent: partner_rate and agent_rate are
-- off the table grant entirely and this function must never reintroduce them.
--
-- Takes the applicant id as an argument and is granted to service_role only.
-- The Edge Function resolves the caller from their JWT and passes it; the
-- function never reads auth.uid() itself, so it cannot be tricked into
-- answering for a session it was not given.
-- ---------------------------------------------------------------------------
create or replace function public.tenant_applications(p_applicant uuid)
returns table (
  id uuid,
  guarantee_ref text,
  status text,
  payment_state text,
  deed_state text,
  monthly_rent numeric,
  tenancy_start date,
  prop_addr1 text,
  prop_city text,
  prop_postcode text,
  issue_date date,
  expiry_date date,
  eligibility_paid boolean,
  created_at timestamptz
)
language sql stable security definer set search_path to '' as $$
  select
    a.id, a.guarantee_ref, a.status, a.payment_state, a.deed_state,
    a.monthly_rent, a.tenancy_start,
    a.prop_addr1, a.prop_city, a.prop_postcode,
    a.issue_date, a.expiry_date,
    exists (select 1 from public.application_eligibility_payments e where e.application_id = a.id),
    a.created_at
  from public.applications a
  where a.applicant_id = p_applicant
  order by a.created_at desc
$$;

comment on function public.tenant_applications(uuid) is
  'What a tenant may see of their own applications. Explicit column list, never select *: commission is off the table grant and must never reappear here. Takes the applicant id rather than reading auth.uid(), so it answers only for the identity the caller was verified as.';

revoke all on function public.tenant_applications(uuid) from public, anon, authenticated;
grant execute on function public.tenant_applications(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Creating an applicant, and starting an application from one.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_applicant(
  p_id uuid, p_email text, p_title text, p_first text, p_last text,
  p_dob date, p_phone text
) returns public.applicants
language plpgsql security definer set search_path to '' as $function$
declare r public.applicants;
begin
  insert into public.applicants (id, email, title, first_name, last_name, dob, phone)
  values (p_id, btrim(p_email), p_title, btrim(p_first), btrim(p_last), p_dob, btrim(p_phone))
  on conflict (id) do update
    set email = excluded.email, title = excluded.title,
        first_name = excluded.first_name, last_name = excluded.last_name,
        dob = excluded.dob, phone = excluded.phone, updated_at = now()
  returning * into r;
  return r;
end $function$;

revoke all on function public.upsert_applicant(uuid, text, text, text, text, date, text) from public, anon, authenticated;
grant execute on function public.upsert_applicant(uuid, text, text, text, text, date, text) to service_role;

-- A direct signup's application. Starts at 'draft', on the direct house route,
-- with no branch of its own: it uses the house branch, because branch_id is NOT
-- NULL and the agent a tenant names is a DELIVERY CONTACT rather than an org
-- attachment (20260812040000).
create or replace function public.create_direct_application(
  p_applicant uuid,
  p_rent numeric, p_tenancy_start date,
  p_addr1 text, p_addr2 text, p_city text, p_county text, p_postcode text
) returns public.applications
language plpgsql security definer set search_path to ''
as $function$
declare v_partner uuid; v_branch uuid; v_agency uuid; ap public.applicants; a public.applications;
begin
  select * into ap from public.applicants where id = p_applicant;
  if not found then raise exception 'Applicant % not found', p_applicant using errcode = '22023'; end if;
  if ap.closed_at is not null then raise exception 'This account is closed.' using errcode = '42501'; end if;

  select p.id into v_partner from public.partners p where p.slug = 'opndoor-direct';
  if v_partner is null then
    raise exception 'The direct route is not provisioned (partner slug opndoor-direct is missing)';
  end if;

  select b.id, b.agency_id into v_branch, v_agency
  from public.branches b
  join public.agencies ag on ag.id = b.agency_id
  where ag.partner_id = v_partner and b.name = 'Unattached'
  limit 1;
  if v_branch is null then
    raise exception 'The direct route has no house branch';
  end if;

  insert into public.applications (
    guarantee_ref, branch_id, agency_id, partner_id, referrer_id, referrer_name,
    applicant_id,
    tenant_title, tenant_first_name, tenant_last_name, tenant_dob, tenant_email, tenant_phone,
    prop_addr1, prop_addr2, prop_city, prop_county, prop_postcode,
    monthly_rent, tenancy_start, status, sent_at, partner_rate, agent_rate, livemode,
    referencing_mode
  ) values (
    'GR-' || nextval('public.guarantee_ref_seq')::text, v_branch, v_agency, v_partner,
    -- referrer_id is NOT NULL and references public.users. A direct signup has
    -- no referrer, and the applicant deliberately cannot be one: they are not
    -- staff, by construction. NULL is impossible here, so this is the single
    -- honest reason this rail still needs a house identity. See the note below.
    null, 'Direct signup',
    p_applicant,
    ap.title, ap.first_name, ap.last_name, ap.dob, ap.email, ap.phone,
    btrim(p_addr1), nullif(btrim(coalesce(p_addr2,'')), ''), btrim(p_city),
    nullif(btrim(coalesce(p_county,'')), ''), upper(btrim(p_postcode)),
    p_rent, p_tenancy_start,
    -- draft, NOT sent. 'sent' means a payment link is out and starts the
    -- 15-day lapse clock and the chasers. A direct applicant has not paid the
    -- eligibility fee yet and has nothing to be chased for.
    'draft', now(), 0, 0, true,
    'opndoor_referenced'
  ) returning * into a;
  return a;
end $function$;

revoke all on function public.create_direct_application(uuid, numeric, date, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.create_direct_application(uuid, numeric, date, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 6. referrer_id.
--
-- applications.referrer_id is NOT NULL and references public.users. A direct
-- signup has no referrer, and the applicant cannot stand in because an
-- applicant is not staff by construction, which is the whole point of the
-- exclusion above.
--
-- The two ways around it are both worse than the honest answer: a house "Direct
-- Signup" user invents a staff identity that can be granted a role and appears
-- in the user list and the league, and reusing the applicant's id is exactly
-- the both-identities escalation the triggers above exist to prevent.
--
-- So the column becomes nullable, in its OWN migration (20260812090000), with
-- its own constraint replacing the guarantee that NOT NULL used to give:
-- every application has a referrer or an applicant, never neither. It is a
-- separate migration because relaxing a constraint on the applications table is
-- a deliberate change to shared ground and deserves to be revertable on its own.
-- ---------------------------------------------------------------------------
