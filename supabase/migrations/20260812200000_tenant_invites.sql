-- ===========================================================================
-- The front door for a tenant an agent referred.
--
-- THE PROBLEM
-- On the referral path the tenant gets a PAYMENT link, because by the time an
-- agent has referred them a Rightmove applicant is already referenced and the
-- only thing left is to pay. On a rail where WE arrange the reference that is
-- the wrong link: there is nothing to pay for yet, and the tenant has an hour
-- of form to fill first. Same journey, different entry.
--
-- WHY NOT REUSE payment_page_tokens
-- It is one token per application keyed to a payment, it grants access without
-- an account, and it is refreshed to 90 days on every reminder send. This grants
-- something different: the right to ATTACH an application to whichever account
-- claims it. That is a one-time act with a shorter life and an audit trail, and
-- overloading the payment token with it would mean a payment link could silently
-- rebind an application to a new owner.
--
-- SINGLE USE, and claimed_by is recorded. An invite that could be claimed twice
-- would let a forwarded email move somebody else's application into a stranger's
-- account.
-- ===========================================================================

create table if not exists public.tenant_invites (
  token      uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,

  -- Who it was sent to. The claim checks this, so forwarding the email to a
  -- different address does not hand over the application.
  email      text not null,

  expires_at timestamptz not null,
  claimed_at timestamptz,
  claimed_by uuid references public.applicants(id) on delete set null,
  created_at timestamptz not null default now(),

  -- One live invite per application. A re-send replaces rather than adds, so
  -- an old link in an old email cannot be used after a new one is issued.
  unique (application_id)
);

create index if not exists tenant_invites_email_idx on public.tenant_invites (lower(email));

alter table public.tenant_invites enable row level security;
-- No policies: service_role only. The token IS the credential, exactly as
-- payment_page_tokens has always been.

comment on table public.tenant_invites is
  'A one-time link that lets a tenant claim an application an agent created for them, on a rail where Opndoor arranges the reference. Not a payment link: it grants the right to ATTACH the application to an account, which is why it is single use and checks the address it was sent to.';

-- ---------------------------------------------------------------------------
-- Minting. Idempotent per application: re-sending replaces the token, so the
-- previous link stops working the moment a new one is issued.
-- ---------------------------------------------------------------------------
create or replace function public.mint_tenant_invite(p_application uuid, p_days int default 30)
returns uuid
language plpgsql security definer set search_path to ''
as $function$
declare v_email text; v_token uuid;
begin
  select tenant_email into v_email from public.applications where id = p_application;
  if v_email is null or btrim(v_email) = '' then
    raise exception 'Application % has no tenant email to invite', p_application using errcode = '22023';
  end if;

  insert into public.tenant_invites (application_id, email, expires_at)
  values (p_application, btrim(lower(v_email)), now() + make_interval(days => p_days))
  on conflict (application_id) do update
    set token = gen_random_uuid(),
        email = excluded.email,
        expires_at = excluded.expires_at,
        claimed_at = null, claimed_by = null
  returning token into v_token;

  return v_token;
end $function$;

revoke all on function public.mint_tenant_invite(uuid, int) from public, anon, authenticated;
grant execute on function public.mint_tenant_invite(uuid, int) to service_role;

-- ---------------------------------------------------------------------------
-- Claiming. The only thing that attaches an application to an account.
-- ---------------------------------------------------------------------------
create or replace function public.claim_tenant_invite(p_token uuid, p_applicant uuid)
returns public.applications
language plpgsql security definer set search_path to ''
as $function$
declare inv public.tenant_invites; ap public.applicants; a public.applications;
begin
  select * into inv from public.tenant_invites where token = p_token;
  if not found then raise exception 'This link is not valid.' using errcode = '22023'; end if;
  if inv.expires_at < now() then raise exception 'This link has expired.' using errcode = '22023'; end if;

  select * into ap from public.applicants where id = p_applicant;
  if not found then raise exception 'Account not found.' using errcode = '22023'; end if;

  -- The address must match. Otherwise a forwarded email hands somebody else's
  -- application, with their name, address and income on it, to whoever opened it.
  if lower(btrim(ap.email)) <> lower(btrim(inv.email)) then
    raise exception 'This link was sent to a different email address.' using errcode = '42501';
  end if;

  -- Already claimed BY THIS ACCOUNT is a resume, not an error: the tenant
  -- clicking the same link from a second device must land in their form.
  if inv.claimed_at is not null and inv.claimed_by is distinct from p_applicant then
    raise exception 'This link has already been used.' using errcode = '42501';
  end if;

  update public.applications set applicant_id = p_applicant
   where id = inv.application_id and applicant_id is null;

  update public.tenant_invites
     set claimed_at = coalesce(claimed_at, now()), claimed_by = p_applicant
   where token = p_token;

  select * into a from public.applications where id = inv.application_id;
  return a;
end $function$;

revoke all on function public.claim_tenant_invite(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_tenant_invite(uuid, uuid) to service_role;

-- What the landing page may show BEFORE anybody signs in. Deliberately thin:
-- enough to prove the link is real and say what it is for, and nothing that
-- would matter if the link were forwarded.
create or replace function public.tenant_invite_summary(p_token uuid)
returns table (valid boolean, email text, prop_addr1 text, prop_postcode text,
               monthly_rent numeric, tenancy_start date, already_claimed boolean)
language sql stable security definer set search_path to '' as $$
  select
    i.expires_at > now(),
    i.email,
    a.prop_addr1, a.prop_postcode, a.monthly_rent, a.tenancy_start,
    i.claimed_at is not null
  from public.tenant_invites i
  join public.applications a on a.id = i.application_id
  where i.token = p_token
$$;

revoke all on function public.tenant_invite_summary(uuid) from public, anon, authenticated;
grant execute on function public.tenant_invite_summary(uuid) to service_role;

comment on function public.tenant_invite_summary(uuid) is
  'What the invite landing page may show before sign-in: enough to prove the link is real, and nothing that would matter if the email were forwarded. No tenant name, no income, no reference.';
